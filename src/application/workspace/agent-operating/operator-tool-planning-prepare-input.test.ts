/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

import {
  isOperatorToolPlanningMergeInput,
  OPERATOR_TOOL_PLANNING_MERGE_KIND,
} from './operator-tool-planning-prepare-input';
import { buildInvestigationHandoffFeedback } from '../investigation/investigation-handoff';

describe('operator-tool-planning-prepare-input', () => {
  it('detects server-only merge input', () => {
    const handoff = buildInvestigationHandoffFeedback({
      sourceInvestigationId: 'inv-1',
      priorRequestSummary: 'task',
      investigationSummary: 'summary',
      sourcePaths: ['src/a.ts'],
      requestText: 'task',
      queries: ['task'],
      evidence: [],
      searchMatches: [],
      hypotheses: [],
      affectedAreas: [],
    });
    expect(
      isOperatorToolPlanningMergeInput({
        kind: OPERATOR_TOOL_PLANNING_MERGE_KIND,
        mergedHandoff: handoff,
      }),
    ).toBe(true);
    expect(isOperatorToolPlanningMergeInput(handoff)).toBe(false);
    expect(isOperatorToolPlanningMergeInput(null)).toBe(false);
  });
});
