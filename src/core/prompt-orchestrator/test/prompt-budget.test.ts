import { ContextBuilderService } from '../../context-builder';
import { createContextInput } from '../../context-builder/test/context-builder.fixture';
import { PromptOrchestratorService, PromptOrchestratorValidationError } from '..';

describe('prompt budgeting', () => {
  it('omits the optional Context section and records evidence when the full prompt is too large', async () => {
    const context = await new ContextBuilderService().build(await createContextInput());
    const service = new PromptOrchestratorService();
    const full = await service.build({ context });
    const contextSection = full.sections.find(({ kind }) => kind === 'CONTEXT');
    if (contextSection === undefined) throw new Error('Context section fixture is missing.');
    const bounded = await service.build(
      { context },
      {
        templateId: 'builderai-standard',
        templateVersion: 1,
        maximumCharacters:
          full.budget.characters - Math.floor(JSON.stringify(contextSection).length / 2),
      },
    );

    expect(bounded.sections.some(({ kind }) => kind === 'CONTEXT')).toBe(false);
    expect(bounded.budget.omittedSections).toEqual([
      expect.objectContaining({ kind: 'CONTEXT', reason: 'BUDGET_LIMIT' }),
    ]);
    expect(bounded.budget.characters).toBeLessThanOrEqual(bounded.budget.maximumCharacters);
  });

  it('rejects a limit that cannot hold required sections', async () => {
    const context = await new ContextBuilderService().build(await createContextInput());
    await expect(
      new PromptOrchestratorService().build(
        { context },
        { templateId: 'builderai-standard', templateVersion: 1, maximumCharacters: 100 },
      ),
    ).rejects.toBeInstanceOf(PromptOrchestratorValidationError);
  });
});
