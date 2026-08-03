import { describe, expect, it, vi } from 'vitest';

import type { DecompositionContextPackage } from './decomposition-context.service';
import { FeatureDecompositionService } from './feature-decomposition.service';
import {
  buildDecompositionPromptPackage,
  DECOMPOSITION_PROMPT_MAX_CHARACTERS,
} from '../../core/feature-decomposition';
import { ExecutionRequestValidator } from '../../core/execution-engine';
import type { ExecutionRequest } from '../../core/execution-engine';
import { PromptPackageValidator } from '../../core/prompt-orchestrator';
import { loadCanonicalProjectBrain } from '../../core/project-brain';
import type { BlueprintReaderService } from '../../core/blueprint-reader';

const context: DecompositionContextPackage = {
  schemaVersion: 1,
  featureRequest: 'Add checkout',
  project: {
    id: 'demo',
    name: 'Demo',
    vision: 'Vision',
    milestone: 'M1',
  },
  goals: ['Ship checkout'],
  constraints: ['No autonomous apply'],
  architecture: {
    summary: 'Layered architecture',
    modules: [{ path: 'src/core', responsibility: 'Core logic' }],
  },
  repository: {
    totalSourcePaths: 2,
    topLevelAreas: [{ prefix: 'src/core', count: 1 }],
    indicators: ['tests-present'],
  },
  rootConfiguration: {
    packageName: 'demo',
    scripts: ['test'],
    frameworkHints: ['next'],
  },
  ownershipBoundaries: [
    'Project Brain is canonical durable governance—not generic workflow state.',
    'Feature workflow plans persist under .builderai.',
  ],
};

function createDecompositionExecutionRequest(
  prompt: ExecutionRequest['prompt'],
  correlationId: string,
  requestedAt: string,
): ExecutionRequest {
  return {
    schemaVersion: 1,
    executionId: correlationId,
    prompt,
    metadata: {
      correlationId,
      requestedAt,
      values: { source: 'feature-decomposition' },
    },
    policy: {
      priority: 'NORMAL',
      validationMode: 'STRICT',
      failureStrategy: 'RETRY_THEN_FAIL',
      retry: {
        maximumRetries: 1,
        delayStrategy: 'FIXED',
        baseDelayMs: 300,
        maximumDelayMs: 300,
        retryableErrorCodes: ['OUTPUT_TRUNCATED', 'PROVIDER_UNAVAILABLE'],
      },
      timeout: { durationMs: 120_000, startsAt: 'QUEUED' },
    },
    cancellation: { cancelled: false, subscribe: () => () => undefined },
  };
}

describe('feature decomposition execution boundary', () => {
  it('passes ExecutionRequestValidator for the live decomposition prompt path', () => {
    const correlationId = 'decompose-boundary-001';
    const requestedAt = '2026-08-01T00:00:00.000Z';
    const prompt = buildDecompositionPromptPackage(context, correlationId);

    new PromptPackageValidator().validate(prompt);
    expect(prompt.budget.characters).toBe(JSON.stringify(prompt).length);
    expect(prompt.budget.characters).toBeLessThanOrEqual(DECOMPOSITION_PROMPT_MAX_CHARACTERS);
    const contextPresent = prompt.sections.some(({ kind }) => kind === 'CONTEXT');
    const contextOmitted = prompt.budget.omittedSections.some(({ kind }) => kind === 'CONTEXT');
    expect(contextPresent).not.toBe(contextOmitted);

    const executionRequest = createDecompositionExecutionRequest(
      prompt,
      correlationId,
      requestedAt,
    );
    expect(() => new ExecutionRequestValidator().validate(executionRequest)).not.toThrow();
  });

  it('reaches mocked provider execution only after validation succeeds', async () => {
    const execute = vi.fn(async () => ({
      providerResponse: {
        schemaVersion: 1,
        providerId: 'test',
        model: 'test',
        status: 'SUCCEEDED',
        artifacts: [
          {
            kind: 'STRUCTURED_DATA',
            data: {
              title: 'Checkout feature',
              summary: 'Add checkout flow',
              tasks: [
                {
                  taskId: 'task-01',
                  title: 'Schema',
                  objective: 'Add schema',
                  scope: 'src',
                  dependencyIds: [],
                  expectedAreas: ['src/app'],
                  acceptanceCriteria: ['Criterion'],
                  order: 1,
                },
              ],
            },
          },
        ],
        metadata: { values: {} },
      },
      executionResult: {
        schemaVersion: 1,
        executionId: 'exec-001',
        status: 'SUCCEEDED',
        attempts: [],
        metadata: { values: {} },
      },
    }));
    const brain = loadCanonicalProjectBrain();
    const service = new FeatureDecompositionService({
      loadProjectBrain: () => brain,
      blueprintReader: {
        read: async () => ({
          valid: true,
          analysis: {
            projectId: 'demo',
            projectName: 'Demo',
            vision: 'Vision',
            goals: [],
            architecture: { scope: 'Layered', principles: ['Safety first'] },
            modules: [{ path: 'src/core', owner: 'core', responsibility: 'Core logic' }],
            milestones: { current: 'M1', completed: [] },
            features: [],
            requirements: [],
            constraints: [],
            techStack: [],
          },
          summary: { projectId: 'demo', projectName: 'Demo', vision: 'Vision' },
        }),
      } as unknown as BlueprintReaderService,
      sourceFiles: {
        listSourcePaths: async () => ['src/app/page.tsx', 'src/core/index.ts'],
        readSourceFile: async () => {
          throw new Error('not expected');
        },
      },
      providerExecution: {
        execute,
      } as never,
      projectRoot: process.cwd(),
      clock: { now: () => new Date('2026-08-01T00:00:00.000Z') },
      ids: { generate: () => 'decompose-boundary-002' },
    });

    await service.decompose('Add checkout with cart persistence');
    expect(execute).toHaveBeenCalledOnce();
    const calls = execute.mock.calls as unknown as ReadonlyArray<[ExecutionRequest]>;
    const request = calls[0]?.[0];
    expect(request).toBeDefined();
    if (request === undefined) throw new Error('Expected provider execution request.');
    expect(() => new ExecutionRequestValidator().validate(request)).not.toThrow();
  });
});
