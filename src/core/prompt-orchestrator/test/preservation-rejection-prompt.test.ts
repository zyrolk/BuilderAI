import { ContextBuilderService } from '../../context-builder';
import { createContextInput } from '../../context-builder/test/context-builder.fixture';
import { renderPreservationRejectionText } from '../internal/preservation-rejection-renderer';
import { PromptSectionBuilder } from '../builders/prompt-section.builder';
import { DEFAULT_PROMPT_TEMPLATE } from '../templates/default-prompt-template';
import { DEFAULT_PROMPT_OUTPUT_CONTRACT } from '..';
import { buildIterationFeedbackFromGate2Rejection } from '../../../application/workspace/iteration-feedback.service';
import { ITERATION_FEEDBACK_LIMITS } from '../../../application/workspace/iteration-feedback.types';
import {
  SMOKE_031_OPERATOR_REASON,
  SMOKE_031_REJECTED_CHANGE_PLAN,
  SMOKE_031_REJECTED_PREPARATION_ID,
} from '../../../application/workspace/test/smoke-031-preservation-rejection.fixture';

describe('Preservation rejection ITERATION rendering (ADR-031 Slice 2)', () => {
  it('includes rejected preservation status, path, churn, IDs, cross-file risks, findings, and operator reason', async () => {
    const feedback = buildIterationFeedbackFromGate2Rejection(SMOKE_031_REJECTED_CHANGE_PLAN, {
      rejectedPreparationId: SMOKE_031_REJECTED_PREPARATION_ID,
      operatorReason: SMOKE_031_OPERATOR_REASON,
    });
    expect(feedback.preservationRejection).toBeDefined();

    const context = await new ContextBuilderService().build(await createContextInput());
    const sections = new PromptSectionBuilder().build(
      DEFAULT_PROMPT_TEMPLATE,
      context,
      DEFAULT_PROMPT_OUTPUT_CONTRACT,
      feedback,
    );
    const iteration = sections.find(({ kind }) => kind === 'ITERATION');
    expect(iteration?.kind).toBe('ITERATION');
    if (iteration?.kind !== 'ITERATION') throw new Error('Expected ITERATION section.');

    const instructionText = iteration.instructions.map(({ text }) => text).join('\n');
    expect(instructionText).toContain('PREVIOUS PROPOSAL REJECTED FOR PRESERVATION VIOLATIONS');
    expect(instructionText).toContain('index.html');
    expect(instructionText).toContain('100% churn (HIGH)');
    expect(instructionText).toContain('increment-counter');
    expect(instructionText).toContain('reset-counter');
    expect(instructionText).toContain('next-quote');
    expect(instructionText).toContain('assets/app.js references');
    expect(instructionText).toContain('PRESERVATION_HIGH_CHURN_REWRITE');
    expect(instructionText).toContain('PRESERVATION_REMOVED_HTML_ID');
    expect(instructionText).toContain('PRESERVATION_CROSS_FILE_REFERENCE_RISK');
    expect(instructionText).toContain('Operator reason:');
    expect(instructionText).toContain('Preserve the supplied CURRENT BASELINE');
    expect(instructionText).toContain('minimum requested changes');

    const renderedRejection = renderPreservationRejectionText(feedback.preservationRejection!);
    expect(renderedRejection).toContain('Churn correction: previous 100.00%');
    expect(renderedRejection).toContain('target <40.00% (GOOD)');
  });

  it('does not include rejected artifact bodies, API keys, or environment values', async () => {
    const feedback = buildIterationFeedbackFromGate2Rejection(SMOKE_031_REJECTED_CHANGE_PLAN, {
      operatorReason: SMOKE_031_OPERATOR_REASON,
    });
    const rendered = renderPreservationRejectionText(feedback.preservationRejection!);
    const serialized = JSON.stringify(feedback);

    expect(rendered).not.toContain('rewritten proposal content omitted from fixture');
    expect(rendered).not.toContain('<html>');
    expect(serialized).not.toMatch(/sk-[A-Za-z0-9]+/u);
    expect(serialized).not.toContain('process.env');
    expect(serialized).not.toContain('.env');
  });

  it('keeps rendered preservation block within 800 characters', () => {
    const feedback = buildIterationFeedbackFromGate2Rejection(SMOKE_031_REJECTED_CHANGE_PLAN, {
      operatorReason: SMOKE_031_OPERATOR_REASON,
    });
    const rendered = renderPreservationRejectionText(feedback.preservationRejection!);
    expect(rendered.length).toBeLessThanOrEqual(
      ITERATION_FEEDBACK_LIMITS.MAX_PRESERVATION_REJECTION_RENDERED_CHARACTERS,
    );
  });

  it('renders deterministically for identical rejection inputs', () => {
    const feedback = buildIterationFeedbackFromGate2Rejection(SMOKE_031_REJECTED_CHANGE_PLAN, {
      operatorReason: SMOKE_031_OPERATOR_REASON,
    });
    const first = renderPreservationRejectionText(feedback.preservationRejection!);
    const second = renderPreservationRejectionText(feedback.preservationRejection!);
    expect(first).toBe(second);
  });
});
