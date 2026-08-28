/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

import {
  formatProviderAssistedSummary,
  operatorActionLabel,
} from '../../../ui/workspace/provider-assisted-turn-display';

describe('provider-assisted-turn-display', () => {
  it('maps every operator action to guidance text', () => {
    expect(operatorActionLabel('RETRY_PROVIDER_ASSISTED')).toMatch(/again/i);
    expect(operatorActionLabel('CORRECT_PHASE')).toMatch(/phase/i);
    expect(operatorActionLabel('ENABLE_BROWSER_APPROVAL')).toMatch(/browser/i);
    expect(operatorActionLabel('USE_OPERATOR_PRESET')).toMatch(/preset/i);
    expect(operatorActionLabel('REVIEW_GOAL')).toMatch(/goal/i);
    expect(operatorActionLabel('UNKNOWN')).toMatch(/retry explicitly/i);
  });

  it('formats digest counts for operator summary', () => {
    expect(
      formatProviderAssistedSummary({
        source: 'provider-structured-intent',
        toolCalling: false,
        proposedCount: 3,
        acceptedCount: 2,
        rejectedCount: 1,
        rejections: [],
      }),
    ).toBe('Proposed 3 · accepted 2 · rejected 1');
  });
});
