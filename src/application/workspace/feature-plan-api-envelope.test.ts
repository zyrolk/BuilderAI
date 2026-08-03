import { describe, expect, it } from 'vitest';

import { normalizeFeaturePlan, serializedFeaturePlanLength } from './feature-plan.service';
import { FEATURE_PLAN_LIMITS, type FeaturePlan } from './feature-plan.types';
import { MAXIMUM_FEATURE_PLAN_BODY_BYTES } from '../../infrastructure/workspace/local-request-guard';

const NOW = '2026-08-01T00:00:00.000Z';

function createPlan(summaryLength: number, objectiveLength: number): FeaturePlan {
  return normalizeFeaturePlan(
    {
      schemaVersion: 1,
      featurePlanId: 'max-plan-envelope-1',
      sourceRequest: 'Near-maximum envelope validation plan',
      title: 'Maximum envelope plan',
      summary: 's'.repeat(summaryLength),
      status: 'DRAFT',
      createdAt: NOW,
      updatedAt: NOW,
      tasks: Array.from({ length: FEATURE_PLAN_LIMITS.MAX_TASKS }, (_, index) => ({
        taskId: `task-${String(index + 1).padStart(2, '0')}`,
        title: 'Task title bounded',
        objective: 'o'.repeat(objectiveLength),
        scope: 's'.repeat(FEATURE_PLAN_LIMITS.MAX_SCOPE),
        dependencyIds: [] as string[],
        expectedAreas: ['src', 'app', 'tests', 'docs'],
        acceptanceCriteria: ['c'.repeat(FEATURE_PLAN_LIMITS.MAX_ACCEPTANCE_CRITERION)],
        order: index + 1,
        status: 'PENDING' as const,
      })),
    },
    { now: NOW },
  );
}

function buildNearMaximumPlan(): FeaturePlan {
  let lowObjective = 1;
  let highObjective = FEATURE_PLAN_LIMITS.MAX_OBJECTIVE;
  let bestObjective = 1;

  while (lowObjective <= highObjective) {
    const mid = Math.floor((lowObjective + highObjective) / 2);
    try {
      createPlan(1, mid);
      bestObjective = mid;
      lowObjective = mid + 1;
    } catch {
      highObjective = mid - 1;
    }
  }

  let lowSummary = 1;
  let highSummary = FEATURE_PLAN_LIMITS.MAX_SUMMARY;
  let bestSummary = 1;

  while (lowSummary <= highSummary) {
    const mid = Math.floor((lowSummary + highSummary) / 2);
    try {
      const candidate = createPlan(mid, bestObjective);
      if (serializedFeaturePlanLength(candidate) <= FEATURE_PLAN_LIMITS.MAX_SERIALIZED_CHARACTERS) {
        bestSummary = mid;
        lowSummary = mid + 1;
      } else {
        highSummary = mid - 1;
      }
    } catch {
      highSummary = mid - 1;
    }
  }

  return createPlan(bestSummary, bestObjective);
}

describe('feature plan API envelope', () => {
  it('fits a maximum valid plan inside the feature-plan request body limit', () => {
    const plan = buildNearMaximumPlan();
    expect(serializedFeaturePlanLength(plan)).toBeLessThanOrEqual(
      FEATURE_PLAN_LIMITS.MAX_SERIALIZED_CHARACTERS,
    );
    expect(serializedFeaturePlanLength(plan)).toBeGreaterThan(
      FEATURE_PLAN_LIMITS.MAX_SERIALIZED_CHARACTERS - 512,
    );
    const envelope = JSON.stringify({ plan, mode: 'draft' });
    expect(envelope.length).toBeLessThanOrEqual(MAXIMUM_FEATURE_PLAN_BODY_BYTES);
    expect(MAXIMUM_FEATURE_PLAN_BODY_BYTES - envelope.length).toBeGreaterThan(0);
  });
});
