import { ContextBuilderService } from '../../context-builder';
import { createContextInput } from '../../context-builder/test/context-builder.fixture';
import {
  PROMPT_SECTION_ORDER,
  PromptOrchestratorService,
  PromptOrchestratorValidationError,
} from '..';

describe('prompt package builder', () => {
  it('builds the same provider-neutral package for identical inputs', async () => {
    const context = await new ContextBuilderService().build(await createContextInput());
    const service = new PromptOrchestratorService();
    const first = await service.build({ context, metadata: { task: 'test' } });
    const second = await service.build({ context, metadata: { task: 'test' } });

    expect(first).toEqual(second);
    expect(first.sections.map(({ kind }) => kind)).toEqual(PROMPT_SECTION_ORDER);
    expect(first.budget.characters).toBe(JSON.stringify(first).length);
  });

  it('places identity, task, goals, constraints, architecture, context, rules, and output contract once', async () => {
    const context = await new ContextBuilderService().build(await createContextInput());
    const packageValue = await new PromptOrchestratorService().build({ context });
    const system = packageValue.sections.find(({ kind }) => kind === 'SYSTEM');
    const task = packageValue.sections.find(({ kind }) => kind === 'TASK');
    const architecture = packageValue.sections.find(({ kind }) => kind === 'ARCHITECTURE');
    const rules = packageValue.sections.find(({ kind }) => kind === 'RULES');
    const promptContext = packageValue.sections.find(({ kind }) => kind === 'CONTEXT');
    const output = packageValue.sections.find(({ kind }) => kind === 'OUTPUT_CONTRACT');

    expect(system?.kind === 'SYSTEM' && system.identity.projectId).toBe(context.projectIdentity.id);
    expect(task?.kind === 'TASK' && task.task).toEqual(context.currentTask);
    expect(task?.kind === 'TASK' && task.goals).toEqual(context.goals);
    expect(task?.kind === 'TASK' && task.constraints).toEqual(context.constraints);
    expect(architecture?.kind === 'ARCHITECTURE' && architecture.architecture).toEqual(
      context.architectureSummary,
    );
    expect(rules?.kind === 'RULES' && rules.instructions.length).toBeGreaterThan(0);
    expect(
      promptContext?.kind === 'CONTEXT' &&
        promptContext.context.relevantDocumentation.every(
          ({ kind }) => !['project-brain', 'architecture', 'ai-rules'].includes(kind),
        ),
    ).toBe(true);
    expect(output?.kind === 'OUTPUT_CONTRACT' && output.expectedOutput.type).toBe('OBJECT');
  });

  it('rejects a Context Package whose recorded size was tampered with', async () => {
    const context = await new ContextBuilderService().build(await createContextInput());
    const invalid = {
      ...context,
      size: { ...context.size, characters: context.size.characters + 1 },
    };
    await expect(
      new PromptOrchestratorService().build({ context: invalid }),
    ).rejects.toBeInstanceOf(PromptOrchestratorValidationError);
  });

  it('supports caller-defined structured output contracts and scalar metadata', async () => {
    const context = await new ContextBuilderService().build(await createContextInput());
    const expectedOutput = {
      schemaVersion: 1 as const,
      type: 'OBJECT' as const,
      fields: [
        {
          name: 'result',
          description: 'Structured result.',
          type: 'OBJECT' as const,
          required: true,
        },
      ],
      allowAdditionalFields: false,
    };
    const packageValue = await new PromptOrchestratorService().build({
      context,
      expectedOutput,
      metadata: { request: 'one', retry: 0, reviewed: false },
    });
    const output = packageValue.sections.find(({ kind }) => kind === 'OUTPUT_CONTRACT');
    expect(output?.kind === 'OUTPUT_CONTRACT' && output.expectedOutput).toEqual(expectedOutput);
    expect(packageValue.metadata.values).toEqual({ request: 'one', retry: 0, reviewed: false });
  });
});
