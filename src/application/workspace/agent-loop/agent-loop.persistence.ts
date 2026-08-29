import path from 'node:path';

import {
  assertSafeStatePath,
  readJsonFile,
  writeJsonAtomically,
} from '../../../infrastructure/workflow-ledger/filesystem-safe-write';
import { WorkflowLedgerError } from '../../../core/workflow-ledger';
import {
  assertNoForbiddenVerificationEvidenceKeys,
  validateVerificationEvidenceForPersistence,
} from './bounded-verification-evidence';
import {
  assertNoForbiddenProjectionKeys,
  validateProjectionForPersistence,
} from './operator-tool-planning-projection';
import {
  AgentLoopError,
  AGENT_LOOP_SCHEMA_VERSION,
  BOUNDED_VERIFICATION_EVIDENCE_SCHEMA_VERSION,
  isSupportedAgentLoopSchemaVersion,
  OPERATOR_TOOL_PLANNING_PROJECTION_SCHEMA_VERSION,
  type AgentLoopPersistedSchemaVersion,
  type AgentLoopPersistedState,
  type BoundedToolEvidenceRecord,
  type BoundedVerificationEvidence,
  type OperatorToolPlanningProjection,
} from './agent-loop.types';

const EVIDENCE_FILE = 'tool-loop-evidence.json';

/** Persistence port for bounded agent-loop evidence (filesystem or in-memory). */
export interface AgentLoopEvidenceStore {
  save(state: AgentLoopPersistedState): Promise<void>;
  load(runId: string): Promise<AgentLoopPersistedState | undefined>;
}

/**
 * Bounded tool-loop evidence under the AgentRun directory (ADR-042 / ADR-047).
 * Path: {stateRoot}/workflows/{projectId}/agent-runs/{runId}/tool-loop-evidence.json
 */
export class AgentLoopEvidencePersistence implements AgentLoopEvidenceStore {
  readonly stateRoot: string;
  readonly projectId: string;

  constructor(stateRoot: string, projectId: string) {
    this.stateRoot = path.resolve(stateRoot);
    this.projectId = projectId;
  }

  evidencePath(runId: string): string {
    return path.join(
      this.stateRoot,
      'workflows',
      this.projectId,
      'agent-runs',
      runId,
      EVIDENCE_FILE,
    );
  }

  async save(state: AgentLoopPersistedState): Promise<void> {
    if (state.projectId !== this.projectId) {
      throw new AgentLoopError(
        'PROJECT_MISMATCH',
        'Agent loop evidence projectId does not match persistence projectId.',
      );
    }
    if (state.schemaVersion !== AGENT_LOOP_SCHEMA_VERSION) {
      throw new AgentLoopError('INVALID_SCHEMA', 'Unsupported agent loop evidence schema.');
    }
    assertNoForbiddenPersistedKeys(state);
    const filePath = this.evidencePath(state.runId);
    try {
      await writeJsonAtomically(this.stateRoot, filePath, state);
    } catch (error: unknown) {
      if (error instanceof WorkflowLedgerError && error.code === 'INVALID_PATH') {
        throw new AgentLoopError('INVALID_PATH', error.message);
      }
      throw new AgentLoopError(
        'PERSISTENCE_FAILED',
        error instanceof Error ? error.message : 'Agent loop evidence persistence failed.',
      );
    }
  }

  async load(runId: string): Promise<AgentLoopPersistedState | undefined> {
    const filePath = this.evidencePath(runId);
    try {
      await assertSafeStatePath(this.stateRoot, filePath);
    } catch (error: unknown) {
      if (error instanceof WorkflowLedgerError && error.code === 'INVALID_PATH') {
        throw new AgentLoopError('INVALID_PATH', error.message);
      }
      throw error;
    }
    let raw: unknown;
    try {
      raw = await readJsonFile<unknown>(filePath);
    } catch (error: unknown) {
      if (error instanceof WorkflowLedgerError && error.code === 'CORRUPT_STATE') {
        throw new AgentLoopError('CORRUPT_STATE', 'Agent loop evidence file is corrupt.');
      }
      throw error;
    }
    if (raw === undefined) return undefined;
    return parsePersistedAgentLoopState(raw, this.projectId, runId);
  }
}

export function parsePersistedAgentLoopState(
  raw: unknown,
  projectId: string,
  runId: string,
): AgentLoopPersistedState {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AgentLoopError('CORRUPT_STATE', 'Agent loop evidence must be an object.');
  }
  const record = raw as Record<string, unknown>;
  const schemaVersion = record.schemaVersion;
  if (!isSupportedAgentLoopSchemaVersion(schemaVersion)) {
    throw new AgentLoopError('INVALID_SCHEMA', 'Unsupported agent loop evidence schema.');
  }
  if (record.runId !== runId || record.projectId !== projectId) {
    throw new AgentLoopError('CORRUPT_STATE', 'Agent loop evidence identity mismatch.');
  }
  assertNoForbiddenPersistedKeysExceptEvidenceProjections(record);

  const evidence = parseEvidenceRecords(record.evidence, runId, projectId);

  const parsed: AgentLoopPersistedState = {
    schemaVersion: schemaVersion as AgentLoopPersistedSchemaVersion,
    runId,
    projectId,
    budget: record.budget as AgentLoopPersistedState['budget'],
    evidence,
    ...(record.stoppedReason === undefined ? {} : { stoppedReason: String(record.stoppedReason) }),
    updatedAt: String(record.updatedAt),
  };
  assertNoForbiddenPersistedKeys(parsed);
  return parsed;
}

function parseEvidenceRecords(
  raw: unknown,
  runId: string,
  projectId: string,
): readonly BoundedToolEvidenceRecord[] {
  if (!Array.isArray(raw)) {
    throw new AgentLoopError('CORRUPT_STATE', 'Agent loop evidence records must be an array.');
  }
  return raw.map((entry, index) => parseEvidenceRecord(entry, runId, projectId, index));
}

function parseEvidenceRecord(
  raw: unknown,
  runId: string,
  projectId: string,
  index: number,
): BoundedToolEvidenceRecord {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AgentLoopError('CORRUPT_STATE', `Evidence record ${index} must be an object.`);
  }
  const record = raw as Record<string, unknown>;
  const schemaVersion = record.schemaVersion;
  if (!isSupportedAgentLoopSchemaVersion(schemaVersion)) {
    throw new AgentLoopError('CORRUPT_STATE', `Evidence record ${index} has unsupported schema.`);
  }

  const planningProjection = parsePlanningProjection(record.planningProjection);
  const verificationEvidence = parseVerificationEvidence(record.verificationEvidence);

  return {
    schemaVersion: schemaVersion as AgentLoopPersistedSchemaVersion,
    runId: typeof record.runId === 'string' ? record.runId : runId,
    projectId: typeof record.projectId === 'string' ? record.projectId : projectId,
    phase: record.phase as BoundedToolEvidenceRecord['phase'],
    toolId: String(record.toolId),
    intentId: String(record.intentId),
    status: record.status as BoundedToolEvidenceRecord['status'],
    recordedAt: String(record.recordedAt),
    summaryDigest: String(record.summaryDigest),
    ...(planningProjection === undefined ? {} : { planningProjection }),
    ...(verificationEvidence === undefined ? {} : { verificationEvidence }),
    ...(record.resultStatus === undefined
      ? {}
      : { resultStatus: record.resultStatus as BoundedToolEvidenceRecord['resultStatus'] }),
    ...(record.errorCode === undefined ? {} : { errorCode: String(record.errorCode) }),
    ...(record.preparationId === undefined ? {} : { preparationId: String(record.preparationId) }),
    ...(record.workflowId === undefined ? {} : { workflowId: String(record.workflowId) }),
  };
}

/** Malformed projections degrade gracefully — record loads without projection. */
function parsePlanningProjection(raw: unknown): OperatorToolPlanningProjection | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  if (record.projectionSchemaVersion !== OPERATOR_TOOL_PLANNING_PROJECTION_SCHEMA_VERSION) {
    return undefined;
  }
  try {
    assertNoForbiddenProjectionKeys(record);
  } catch {
    return undefined;
  }
  const projection = record as unknown as OperatorToolPlanningProjection;
  if (!validateProjectionForPersistence(projection)) {
    return undefined;
  }
  return projection;
}

/** Malformed verification evidence degrades gracefully — record loads without it. */
function parseVerificationEvidence(raw: unknown): BoundedVerificationEvidence | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  if (record.evidenceSchemaVersion !== BOUNDED_VERIFICATION_EVIDENCE_SCHEMA_VERSION) {
    return undefined;
  }
  try {
    assertNoForbiddenVerificationEvidenceKeys(record);
  } catch {
    return undefined;
  }
  const evidence = record as unknown as BoundedVerificationEvidence;
  if (!validateVerificationEvidenceForPersistence(evidence)) {
    return undefined;
  }
  return evidence;
}

function assertNoForbiddenPersistedKeysExceptEvidenceProjections(
  record: Record<string, unknown>,
): void {
  const { evidence, ...rest } = record;
  assertNoForbiddenPersistedKeys(rest);
  if (!Array.isArray(evidence)) return;
  for (const entry of evidence) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const evidenceRecord = entry as Record<string, unknown>;
    const recordRest = { ...evidenceRecord };
    delete recordRest.planningProjection;
    delete recordRest.verificationEvidence;
    assertNoForbiddenPersistedKeys(recordRest);
  }
}

function assertNoForbiddenPersistedKeys(value: unknown): void {
  const forbidden = [
    'stdout',
    'stderr',
    'fileContents',
    'changePlan',
    'applyAuthorizationToken',
    'gate2Review',
    'providerResponse',
    'password',
    'apiKey',
    'secret',
    'preview',
    'content',
    'excerpt',
    'lineText',
    'cookie',
    'cookies',
    'env',
    'cwd',
    'shell',
    'command',
    'argv',
    'approved',
    'operatorApproved',
    'browserObservationApproved',
  ];
  walk(value, (key) => {
    if (forbidden.some((entry) => entry.toLowerCase() === key.toLowerCase())) {
      throw new AgentLoopError(
        'FORBIDDEN_PERSISTED_KEY',
        `Refusing to persist forbidden key "${key}".`,
      );
    }
  });
}

function walk(value: unknown, onKey: (key: string) => void): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry) => walk(entry, onKey));
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    onKey(key);
    walk(nested, onKey);
  }
}
