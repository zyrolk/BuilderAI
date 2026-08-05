import type { AIProviderResponse } from '../../core/ai-provider';
import type { ExecutionCancellationToken } from '../../core/execution-engine';
import type { ExecutionRequest } from '../../core/execution-engine';
import {
  buildDecompositionPromptPackage,
  parseDecompositionOutput,
  type RawDecompositionTask,
} from '../../core/feature-decomposition';
import type { ProjectContextReaderPort } from '../../core/target-project';
import type { ProjectBrain } from '../../core/project-brain';
import type { ProjectFileSource } from '../../core/context-builder';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DecompositionContextBuilder,
  measureDecompositionContext,
} from './decomposition-context.service';
import { normalizeFeaturePlan } from './feature-plan.service';
import type { FeaturePlan } from './feature-plan.types';
import {
  type ProviderExecutionPort,
  WorkspaceRuntimeError,
  type WorkspaceRuntimeClock,
  type WorkspaceRuntimeIdGenerator,
} from './workspace-runtime.types';

const RETRY_DELAY_MS = 300;

export interface FeatureDecompositionDependencies {
  readonly loadProjectBrain: () => ProjectBrain;
  readonly blueprintReader: ProjectContextReaderPort;
  readonly sourceFiles: ProjectFileSource;
  readonly providerExecution: ProviderExecutionPort;
  readonly projectRoot: string;
  readonly clock: WorkspaceRuntimeClock;
  readonly ids: WorkspaceRuntimeIdGenerator;
}

export class FeatureDecompositionService {
  private readonly contextBuilder = new DecompositionContextBuilder();

  constructor(private readonly dependencies: FeatureDecompositionDependencies) {}

  async decompose(request: string): Promise<FeaturePlan> {
    const sourceRequest = validateRequest(request);
    const correlationId = this.dependencies.ids.generate();
    const now = this.dependencies.clock.now().toISOString();
    const brain = this.dependencies.loadProjectBrain();
    const readerOutput = await this.dependencies.blueprintReader.read();
    const context = await this.contextBuilder.build(
      sourceRequest,
      brain,
      readerOutput,
      this.dependencies.sourceFiles,
      async (relativePath) => {
        try {
          return await readFile(path.join(this.dependencies.projectRoot, relativePath), 'utf8');
        } catch {
          return undefined;
        }
      },
    );
    if (measureDecompositionContext(context) > 15_000) {
      throw new WorkspaceRuntimeError('INVALID_REQUEST', 'Decomposition context exceeds budget.');
    }
    const prompt = buildDecompositionPromptPackage(context, correlationId);
    const providerOutput = await this.dependencies.providerExecution.execute(
      createExecutionRequest(correlationId, prompt, now),
    );
    const structured = extractStructuredOutput(providerOutput.providerResponse);
    const parsed = parseDecompositionOutput(structured);
    return normalizeFeaturePlan(
      {
        schemaVersion: 1,
        featurePlanId: correlationId,
        sourceRequest,
        title: parsed.title ?? 'Feature implementation plan',
        summary: parsed.summary ?? sourceRequest.slice(0, 500),
        status: 'DRAFT',
        tasks: normalizeRawTasks(parsed.tasks ?? []),
        createdAt: now,
        updatedAt: now,
      },
      { featurePlanId: correlationId, sourceRequest, now, forceStatus: 'DRAFT' },
    );
  }
}

function normalizeRawTasks(tasks: readonly RawDecompositionTask[]): unknown[] {
  return tasks.map((task, index) => ({
    taskId: task.taskId ?? `task-${String(index + 1).padStart(2, '0')}`,
    title: task.title ?? `Task ${index + 1}`,
    objective: task.objective ?? task.title ?? `Implement task ${index + 1}`,
    scope: task.scope ?? '',
    dependencyIds: task.dependencyIds ?? [],
    expectedAreas: task.expectedAreas ?? [],
    acceptanceCriteria: task.acceptanceCriteria ?? [],
    order: task.order ?? index + 1,
    status: 'PENDING',
  }));
}

function extractStructuredOutput(response: AIProviderResponse): unknown {
  const structured = response.artifacts.find((artifact) => artifact.kind === 'STRUCTURED_DATA');
  if (structured?.kind !== 'STRUCTURED_DATA' || typeof structured.data !== 'object') {
    throw new WorkspaceRuntimeError(
      'INVALID_FEATURE_PLAN',
      'Decomposition provider returned no structured output.',
    );
  }
  return structured.data;
}

function validateRequest(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 4_000 ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(normalized)
  ) {
    throw new WorkspaceRuntimeError(
      'INVALID_REQUEST',
      'Request must contain between 1 and 4,000 safe text characters.',
    );
  }
  return normalized;
}

function createExecutionRequest(
  executionId: string,
  prompt: ExecutionRequest['prompt'],
  requestedAt: string,
): ExecutionRequest {
  return {
    schemaVersion: 1,
    executionId,
    prompt,
    metadata: {
      correlationId: executionId,
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
        baseDelayMs: RETRY_DELAY_MS,
        maximumDelayMs: RETRY_DELAY_MS,
        retryableErrorCodes: ['OUTPUT_TRUNCATED', 'PROVIDER_UNAVAILABLE'],
      },
      timeout: { durationMs: 120_000, startsAt: 'QUEUED' },
    },
    cancellation: neverCancelled(),
  };
}

function neverCancelled(): ExecutionCancellationToken {
  return { cancelled: false, subscribe: () => () => undefined };
}
