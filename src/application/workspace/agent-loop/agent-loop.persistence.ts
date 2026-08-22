import path from 'node:path';

import {
  assertSafeStatePath,
  readJsonFile,
  writeJsonAtomically,
} from '../../../infrastructure/workflow-ledger/filesystem-safe-write';
import { WorkflowLedgerError } from '../../../core/workflow-ledger';
import {
  AgentLoopError,
  AGENT_LOOP_SCHEMA_VERSION,
  type AgentLoopPersistedState,
} from './agent-loop.types';

const EVIDENCE_FILE = 'tool-loop-evidence.json';

/** Persistence port for bounded agent-loop evidence (filesystem or in-memory). */
export interface AgentLoopEvidenceStore {
  save(state: AgentLoopPersistedState): Promise<void>;
  load(runId: string): Promise<AgentLoopPersistedState | undefined>;
}

/**
 * Bounded tool-loop evidence under the AgentRun directory (ADR-042).
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

function parsePersistedAgentLoopState(
  raw: unknown,
  projectId: string,
  runId: string,
): AgentLoopPersistedState {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AgentLoopError('CORRUPT_STATE', 'Agent loop evidence must be an object.');
  }
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== AGENT_LOOP_SCHEMA_VERSION) {
    throw new AgentLoopError('INVALID_SCHEMA', 'Unsupported agent loop evidence schema.');
  }
  if (record.runId !== runId || record.projectId !== projectId) {
    throw new AgentLoopError('CORRUPT_STATE', 'Agent loop evidence identity mismatch.');
  }
  assertNoForbiddenPersistedKeys(record);
  return raw as AgentLoopPersistedState;
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
