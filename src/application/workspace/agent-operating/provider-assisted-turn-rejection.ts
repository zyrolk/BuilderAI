import type { AgentLoopError } from '../agent-loop';
import type {
  ProviderAssistedIntentRejection,
  ProviderAssistedOperatorAction,
  ProviderAssistedRejectionCode,
  ProviderAssistedTurnDigest,
} from './provider-assisted-turn.types';

const BROWSER_TOOL_IDS = new Set([
  'inspect_browser_verification_catalog',
  'observe_localhost_page',
  'observe_browser_page',
]);

export function buildProviderAssistedTurnDigest(input: {
  readonly proposedCount: number;
  readonly acceptedCount: number;
  readonly rejections: readonly ProviderAssistedIntentRejection[];
}): ProviderAssistedTurnDigest {
  return {
    source: 'provider-structured-intent',
    toolCalling: false,
    proposedCount: input.proposedCount,
    acceptedCount: input.acceptedCount,
    rejectedCount: input.rejections.length,
    rejections: input.rejections,
  };
}

export function rejectionFromAgentLoopError(
  error: AgentLoopError,
  context: { readonly intentIndex: number; readonly intentId?: string; readonly toolId?: string },
): ProviderAssistedIntentRejection {
  const code = mapAgentLoopCode(error.code);
  return {
    code,
    intentIndex: context.intentIndex,
    ...(context.intentId === undefined ? {} : { intentId: context.intentId }),
    ...(context.toolId === undefined ? {} : { toolId: context.toolId }),
    message: truncateMessage(error.message),
    operatorAction: operatorActionFor(code, context.toolId),
  };
}

export function rejectionFromBatchError(
  code: ProviderAssistedRejectionCode,
  message: string,
): ProviderAssistedIntentRejection {
  return {
    code,
    message: truncateMessage(message),
    operatorAction: operatorActionFor(code),
  };
}

function mapAgentLoopCode(code: string): ProviderAssistedRejectionCode {
  switch (code) {
    case 'AUTHORITY_FIELD_REJECTED':
      return 'AUTHORITY_FIELD_FORBIDDEN';
    case 'FORBIDDEN_TOOL':
      return 'FORBIDDEN_TOOL';
    case 'INVALID_INTENT_SCHEMA':
    default:
      return 'INVALID_INTENT_SCHEMA';
  }
}

function operatorActionFor(
  code: ProviderAssistedRejectionCode,
  toolId?: string,
): ProviderAssistedOperatorAction {
  if (code === 'FORBIDDEN_TOOL' && toolId !== undefined && isBrowserTool(toolId)) {
    return 'ENABLE_BROWSER_APPROVAL';
  }
  switch (code) {
    case 'EMPTY_INTENTS':
    case 'INVALID_JSON':
    case 'NO_STRUCTURED_DATA':
    case 'MALFORMED_OUTPUT':
    case 'MISSING_INTENTS_ARRAY':
    case 'EXCEEDS_INTENT_CAP':
    case 'PROVIDER_EXECUTION_FAILED':
    case 'ALL_INTENTS_REJECTED':
      return 'RETRY_PROVIDER_ASSISTED';
    case 'AUTHORITY_FIELD_FORBIDDEN':
      return 'USE_OPERATOR_PRESET';
    case 'FORBIDDEN_TOOL':
      return 'CORRECT_PHASE';
    case 'INVALID_INTENT_SCHEMA':
      return 'REVIEW_GOAL';
    default:
      return 'RETRY_PROVIDER_ASSISTED';
  }
}

function isBrowserTool(toolId: string): boolean {
  return BROWSER_TOOL_IDS.has(toolId) || toolId.startsWith('browser_');
}

function truncateMessage(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length <= 240) return trimmed;
  return `${trimmed.slice(0, 237)}…`;
}
