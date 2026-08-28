import type { AgentProviderAssistedDigest } from './http-agent-workflow';

export function operatorActionLabel(action: string): string {
  switch (action) {
    case 'RETRY_PROVIDER_ASSISTED':
      return 'Click “Run provider-assisted tool turn” again after reviewing the goal.';
    case 'CORRECT_PHASE':
      return 'Wait for or transition to a phase that allows this tool, then retry.';
    case 'ENABLE_BROWSER_APPROVAL':
      return 'Check the explicit localhost browser observation approval, then retry.';
    case 'USE_OPERATOR_PRESET':
      return 'Use a bounded operator preset tool turn instead of forged provider fields.';
    case 'REVIEW_GOAL':
      return 'Clarify the agent goal so the provider can propose valid soft intents.';
    default:
      return 'Review the rejection and retry explicitly when ready.';
  }
}

export function formatProviderAssistedSummary(digest: AgentProviderAssistedDigest): string {
  return `Proposed ${digest.proposedCount} · accepted ${digest.acceptedCount} · rejected ${digest.rejectedCount}`;
}
