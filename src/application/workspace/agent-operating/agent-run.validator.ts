import {
  AGENT_RUN_GOAL_MAX_CHARS,
  AGENT_RUN_ID_MAX_CHARS,
  AGENT_RUN_PHASES,
  AGENT_RUN_REFERENCE_ID_MAX_CHARS,
  AGENT_RUN_SCHEMA_VERSION,
  AGENT_RUN_STATUSES,
  AgentRunError,
  type AgentRun,
  type AgentRunPhase,
  type AgentRunReferences,
  type AgentRunStatus,
} from './agent-run.types';
import { statusForAgentRunPhase } from './agent-run-transitions';

/** Heuristic rejection of credential-like material in persisted AgentRun fields. */
const SECRET_LIKE =
  /(?:api[_-]?key\s*[=:]|secret[_-]?key\s*[=:]|password\s*[=:]|bearer\s+[a-z0-9\-._~+/]+=*|authorization\s*:\s*\S+)/i;

export function validateGoal(goal: string): string {
  const trimmed = goal.trim();
  if (trimmed.length === 0 || trimmed.length > AGENT_RUN_GOAL_MAX_CHARS) {
    throw new AgentRunError(
      'INVALID_GOAL',
      `AgentRun goal must be 1..${AGENT_RUN_GOAL_MAX_CHARS} characters.`,
    );
  }
  if (SECRET_LIKE.test(trimmed)) {
    throw new AgentRunError('INVALID_GOAL', 'AgentRun goal must not contain secret-like material.');
  }
  return trimmed;
}

export function validateId(value: string, label: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > AGENT_RUN_ID_MAX_CHARS ||
    trimmed.includes('..') ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed.includes('\0')
  ) {
    throw new AgentRunError('INVALID_REFERENCE', `Invalid ${label}.`);
  }
  return trimmed;
}

export function validateReferences(references: AgentRunReferences): AgentRunReferences {
  const next: AgentRunReferences = {};
  const keys = [
    'investigationId',
    'featurePlanId',
    'preparationId',
    'workflowId',
    'correctionWorkflowId',
  ] as const;
  for (const key of keys) {
    const value = references[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.length > AGENT_RUN_REFERENCE_ID_MAX_CHARS) {
      throw new AgentRunError('INVALID_REFERENCE', `Invalid ${key}.`);
    }
    if (
      value.includes('..') ||
      value.includes('/') ||
      value.includes('\\') ||
      value.includes('\0')
    ) {
      throw new AgentRunError('INVALID_REFERENCE', `Invalid ${key}.`);
    }
    if (SECRET_LIKE.test(value)) {
      throw new AgentRunError('INVALID_REFERENCE', `Invalid ${key}.`);
    }
    (next as Record<string, string>)[key] = value.trim();
  }
  return next;
}

export function parsePersistedAgentRun(raw: unknown, expectedProjectId: string): AgentRun {
  if (typeof raw !== 'object' || raw === null) {
    throw new AgentRunError('CORRUPT_STATE', 'AgentRun document is not an object.');
  }
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== AGENT_RUN_SCHEMA_VERSION) {
    throw new AgentRunError('CORRUPT_STATE', 'Unsupported AgentRun schemaVersion.');
  }
  if (typeof record.runId !== 'string' || typeof record.projectId !== 'string') {
    throw new AgentRunError('CORRUPT_STATE', 'AgentRun identity fields missing.');
  }
  if (record.projectId !== expectedProjectId) {
    throw new AgentRunError('CORRUPT_STATE', 'AgentRun projectId mismatch.');
  }
  if (
    typeof record.goal !== 'string' ||
    typeof record.createdAt !== 'string' ||
    typeof record.updatedAt !== 'string'
  ) {
    throw new AgentRunError('CORRUPT_STATE', 'AgentRun timestamp/goal fields missing.');
  }
  if (!isPhase(record.phase) || !isStatus(record.status)) {
    throw new AgentRunError('CORRUPT_STATE', 'AgentRun phase/status invalid.');
  }
  if (statusForAgentRunPhase(record.phase) !== record.status) {
    throw new AgentRunError('CORRUPT_STATE', 'AgentRun status does not match phase.');
  }
  const forbiddenKeys = [
    'changePlan',
    'approved',
    'approval',
    'applyAuthorizationToken',
    'providerResponse',
    'prompt',
    'fileContents',
    'screenshot',
    'rawOutput',
  ];
  for (const key of forbiddenKeys) {
    if (key in record) {
      throw new AgentRunError('CORRUPT_STATE', `AgentRun must not persist ${key}.`);
    }
  }
  const references =
    typeof record.references === 'object' && record.references !== null
      ? validateReferences(record.references as AgentRunReferences)
      : {};
  return {
    schemaVersion: AGENT_RUN_SCHEMA_VERSION,
    runId: validateId(record.runId, 'runId'),
    projectId: validateId(record.projectId, 'projectId'),
    goal: validateGoal(record.goal),
    phase: record.phase,
    status: record.status,
    references,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function isPhase(value: unknown): value is AgentRunPhase {
  return typeof value === 'string' && (AGENT_RUN_PHASES as readonly string[]).includes(value);
}

function isStatus(value: unknown): value is AgentRunStatus {
  return typeof value === 'string' && (AGENT_RUN_STATUSES as readonly string[]).includes(value);
}
