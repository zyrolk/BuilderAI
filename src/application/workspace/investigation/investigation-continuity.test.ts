import { describe, expect, it } from 'vitest';

import { InMemoryInvestigationHandoffStore } from './investigation-continuity';
import type { InvestigationHandoffFeedback } from './investigation-handoff';

const HANDOFF: InvestigationHandoffFeedback = {
  schemaVersion: 1,
  kind: 'INVESTIGATION_HANDOFF',
  sourceInvestigationId: 'investigation-1',
  priorRequestSummary: 'Investigate the regression.',
  investigationSummary: 'The validator is involved.',
  pathHints: ['server/validator.ts'],
  existingPathHints: ['server/validator.ts'],
  candidatePathHints: [],
};

describe('InMemoryInvestigationHandoffStore', () => {
  it('retains a cloned handoff for its bounded process-local lifetime', () => {
    let now = new Date('2026-08-09T00:00:00.000Z');
    const store = new InMemoryInvestigationHandoffStore(
      { now: () => now },
      { ttlMs: 1_000, maximumEntries: 2 },
    );

    store.save(HANDOFF);
    const resolved = store.resolve(HANDOFF.sourceInvestigationId);
    expect(resolved).toEqual(HANDOFF);
    expect(resolved).not.toBe(HANDOFF);

    now = new Date(now.getTime() + 1_001);
    expect(store.resolve(HANDOFF.sourceInvestigationId)).toBeUndefined();
  });

  it('evicts the oldest entry deterministically when the bound is reached', () => {
    const store = new InMemoryInvestigationHandoffStore(
      { now: () => new Date('2026-08-09T00:00:00.000Z') },
      { ttlMs: 10_000, maximumEntries: 1 },
    );
    store.save(HANDOFF);
    store.save({ ...HANDOFF, sourceInvestigationId: 'investigation-2' });

    expect(store.resolve(HANDOFF.sourceInvestigationId)).toBeUndefined();
    expect(store.resolve('investigation-2')?.sourceInvestigationId).toBe('investigation-2');
  });
});
