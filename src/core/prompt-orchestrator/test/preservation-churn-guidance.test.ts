import { describe, expect, it } from 'vitest';

import { buildIterationFeedbackFromGate2Rejection } from '../../../application/workspace/iteration-feedback.service';
import { ITERATION_FEEDBACK_LIMITS } from '../../../application/workspace/iteration-feedback.types';
import {
  SMOKE_031_MARGINAL_CHURN_CHANGE_PLAN,
  SMOKE_031_SLICE4_OPERATOR_REASON,
} from '../../../application/workspace/test/smoke-031-marginal-churn.fixture';
import { SMOKE_031_REJECTED_CHANGE_PLAN } from '../../../application/workspace/test/smoke-031-preservation-rejection.fixture';
import type { ProjectChangePlan } from '../../../core/change-planner';
import { loadSmokeAtelierGoldenBaseline } from '../../../core/change-planner/test/fixtures/smoke-atelier-golden-fixture';
import { PrepareScopeService } from '../../update-scope';
import { MemoryWorkspaceBaselinePort } from '../../update-scope/test/workspace-baseline.fixture';
import {
  PRESERVATION_CONTRACT_INSTRUCTIONS,
  renderPreservationContractText,
} from '../internal/preservation-contract-renderer';
import { renderPreservationRejectionText } from '../internal/preservation-rejection-renderer';

const SMOKE_BASELINE_HTML = loadSmokeAtelierGoldenBaseline();

const ACCESSIBILITY_REQUEST =
  'Improve the existing counter page accessibility with the smallest possible change. Add aria-live="polite" to the counter value, add appropriate aria-labelledby relationships to the existing counter and quote sections, and ensure the existing buttons explicitly use type="button". Preserve all existing functionality, DOM IDs, aria-labels, text, quote content, localStorage behavior, script/style references, layout, and styling. Prefer modifying index.html only. Do not redesign or refactor unrelated code.';

describe('ADR-031 Slice 4 minimal-delta preservation contract', () => {
  it('includes explicit formatting and attribute-only surgicality guidance', () => {
    const text = PRESERVATION_CONTRACT_INSTRUCTIONS.map(
      ({ text: instruction }) => instruction,
    ).join('\n');
    expect(text).toContain('copied verbatim plus the smallest required textual delta');
    expect(text).toContain('not a semantically equivalent regeneration');
    expect(text).toContain('Copy CURRENT BASELINE verbatim first');
    expect(text).toContain('byte-for-byte identical');
    expect(text).toContain('Do not reformat unchanged lines');
    expect(text).toContain('indentation, whitespace, quote style, attribute order');
    expect(text).toContain('aria-live="polite"');
    expect(text).toContain('Do not replace or rewrite the element');
    expect(text).toContain('do not rename or reword headings merely to support aria-labelledby');
    expect(text).toContain('add type="button" to each existing button');
  });

  it('renders minimal-delta rules in active preservation contract for locked request', () => {
    const resolution = new PrepareScopeService().resolve({
      taskText: ACCESSIBILITY_REQUEST,
      sourcePaths: ['index.html', 'assets/app.js', 'assets/styles.css', 'assets/quotes.json'],
      baselinePort: new MemoryWorkspaceBaselinePort({
        'index.html': SMOKE_BASELINE_HTML,
      }),
    });

    const rendered = renderPreservationContractText(resolution.preservationContract!);
    expect(rendered).toContain('Minimal-delta UPDATE rules');
    expect(rendered).toContain('Do not reformat unchanged lines');
    expect(rendered).toContain('aria-live="polite"');
    expect(rendered).toContain('CURRENT BASELINE — index.html');
    expect(resolution.scopePlan.mode).toBe('HARD');
    expect(resolution.scopePlan.preferredMaximumUpdateOperations).toBe(1);
  });
});

describe('ADR-031 Slice 4 correction churn guidance', () => {
  it('uses structured HTML surgicality guidance instead of line-churn targets for golden elevated churn', () => {
    const feedback = buildIterationFeedbackFromGate2Rejection(
      SMOKE_031_MARGINAL_CHURN_CHANGE_PLAN,
      {
        operatorReason: SMOKE_031_SLICE4_OPERATOR_REASON,
      },
    );
    const rendered = renderPreservationRejectionText(feedback.preservationRejection!);

    expect(rendered).toContain('Structured HTML surgicality is authoritative');
    expect(rendered).toContain('Line churn 44.44% is diagnostic only');
    expect(rendered).not.toContain('target <40.00% (GOOD)');
    expect(rendered).not.toContain('prefer <20.00% (EXCELLENT; guidance only)');
    expect(rendered).toContain('44% churn (ELEVATED)');
    expect(rendered).toContain('surgicality EXCELLENT');
  });

  it('retains generic line-churn targets when structured HTML basis is absent', () => {
    const operation = SMOKE_031_MARGINAL_CHURN_CHANGE_PLAN.changeSet.operations[0];
    if (operation?.kind !== 'UPDATE_FILE') throw new Error('expected UPDATE_FILE');
    const genericPlan: ProjectChangePlan = {
      ...SMOKE_031_MARGINAL_CHURN_CHANGE_PLAN,
      changeSet: {
        operations: [
          {
            ...operation,
            logicalPath: 'assets/app.js',
            preservation: {
              ...operation.preservation!,
              structuredAnalysis: undefined,
              surgicality: {
                classification: 'MARGINAL',
                basis: 'GENERIC_LINE_LCS',
                reasons: ['Line churn 44.44% (elevated)'],
              },
            },
          },
        ],
      },
    };
    const feedback = buildIterationFeedbackFromGate2Rejection(genericPlan, {
      operatorReason: SMOKE_031_SLICE4_OPERATOR_REASON,
    });
    const rendered = renderPreservationRejectionText(feedback.preservationRejection!);

    expect(rendered).toContain('Churn correction: previous 44.44%');
    expect(rendered).toContain('target <40.00% (GOOD)');
    expect(rendered).toContain('prefer <20.00% (EXCELLENT; guidance only)');
  });

  it('includes churn guidance for HIGH churn rejections', () => {
    const feedback = buildIterationFeedbackFromGate2Rejection(SMOKE_031_REJECTED_CHANGE_PLAN);
    const rendered = renderPreservationRejectionText(feedback.preservationRejection!);
    expect(rendered).toContain('Churn correction: previous 100.00%');
    expect(rendered).toContain('target <40.00% (GOOD)');
  });

  it('omits churn guidance when churn is below elevated threshold', () => {
    const operation = SMOKE_031_MARGINAL_CHURN_CHANGE_PLAN.changeSet.operations[0];
    if (operation?.kind !== 'UPDATE_FILE') throw new Error('expected UPDATE_FILE');
    const lowChurnPlan: ProjectChangePlan = {
      ...SMOKE_031_MARGINAL_CHURN_CHANGE_PLAN,
      changeSet: {
        operations: [
          {
            ...operation,
            preservation: {
              ...operation.preservation!,
              churnRatio: 0.15,
              findings: [],
            },
          },
        ],
      },
    };
    const feedback = buildIterationFeedbackFromGate2Rejection(lowChurnPlan);
    const rendered = renderPreservationRejectionText(feedback.preservationRejection!);
    expect(rendered).not.toContain('Churn correction:');
  });

  it('keeps rendered preservation block within 800 characters for marginal churn fixture', () => {
    const feedback = buildIterationFeedbackFromGate2Rejection(
      SMOKE_031_MARGINAL_CHURN_CHANGE_PLAN,
      {
        operatorReason: SMOKE_031_SLICE4_OPERATOR_REASON,
      },
    );
    const rendered = renderPreservationRejectionText(feedback.preservationRejection!);
    expect(rendered.length).toBeLessThanOrEqual(
      ITERATION_FEEDBACK_LIMITS.MAX_PRESERVATION_REJECTION_RENDERED_CHARACTERS,
    );
  });

  it('keeps serialized feedback within ADR-031 budget for marginal churn correction', () => {
    const feedback = buildIterationFeedbackFromGate2Rejection(
      SMOKE_031_MARGINAL_CHURN_CHANGE_PLAN,
      {
        rejectedPreparationId: 'a4cbcac3-8ddf-4816-bbfb-6b9d7653cc3d',
        operatorReason: SMOKE_031_SLICE4_OPERATOR_REASON,
        priorRequestSummary: ACCESSIBILITY_REQUEST,
      },
    );
    expect(JSON.stringify(feedback).length).toBeLessThanOrEqual(
      ITERATION_FEEDBACK_LIMITS.MAX_SERIALIZED_CHARACTERS_WITH_PRESERVATION,
    );
  });
});
