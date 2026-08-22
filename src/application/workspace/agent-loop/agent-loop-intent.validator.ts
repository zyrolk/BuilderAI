import {
  AgentLoopError,
  PROVIDER_AUTHORITY_FIELD_NAMES,
  type ProviderStructuredToolIntent,
} from './agent-loop.types';

const AUTHORITY_SET = new Set<string>(PROVIDER_AUTHORITY_FIELD_NAMES);

/**
 * Schema-validate provider structured tool intents (ADR-042).
 * Rejects authority-bearing fields on the intent object and nested arguments.
 */
export function parseProviderStructuredToolIntent(raw: unknown): ProviderStructuredToolIntent {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AgentLoopError('INVALID_INTENT_SCHEMA', 'Tool intent must be a non-array object.');
  }
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (AUTHORITY_SET.has(key)) {
      throw new AgentLoopError(
        'AUTHORITY_FIELD_REJECTED',
        `Provider must not supply authority field "${key}".`,
      );
    }
  }

  const toolId = typeof record.toolId === 'string' ? record.toolId.trim() : '';
  const intentId = typeof record.intentId === 'string' ? record.intentId.trim() : '';
  if (toolId.length === 0) {
    throw new AgentLoopError('INVALID_INTENT_SCHEMA', 'toolId is required.');
  }
  if (intentId.length === 0) {
    throw new AgentLoopError('INVALID_INTENT_SCHEMA', 'intentId is required.');
  }
  if (toolId === 'file_apply' || toolId === 'approve_and_apply' || toolId === 'approveAndApply') {
    throw new AgentLoopError(
      'FORBIDDEN_TOOL',
      'FileApply / approveAndApply cannot be invoked as tools.',
    );
  }
  if (toolId === 'git_push' || toolId === 'run_shell' || toolId === 'push') {
    throw new AgentLoopError('FORBIDDEN_TOOL', `Tool "${toolId}" is not available.`);
  }

  const args = record.arguments === undefined ? record.args : record.arguments;
  assertNoAuthorityFields(args, 'arguments');

  return {
    toolId,
    intentId,
    ...(args !== undefined ? { arguments: args } : {}),
  };
}

function assertNoAuthorityFields(value: unknown, path: string): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoAuthorityFields(entry, `${path}[${index}]`));
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (AUTHORITY_SET.has(key)) {
      throw new AgentLoopError(
        'AUTHORITY_FIELD_REJECTED',
        `Provider must not supply authority field "${path}.${key}".`,
      );
    }
    assertNoAuthorityFields(nested, `${path}.${key}`);
  }
}
