import {
  mapAiProviderErrorResponse,
  WorkspaceRuntimeError,
} from '../../../../application/workspace';
import { AIProviderError } from '../../../../core/ai-provider';
import { ChangePlanValidationError } from '../../../../core/change-planner';
import { ContextBuilderValidationError } from '../../../../core/context-builder';
import { PromptOrchestratorValidationError } from '../../../../core/prompt-orchestrator';
import { ResponseProcessorValidationError } from '../../../../core/response-processor';
import {
  assertTrustedLocalRequest,
  LocalRequestRejectedError,
  readBoundedJson,
} from '../../../../infrastructure/workspace';
import { getLocalWorkspaceRuntime } from '../../../../infrastructure/workspace/local-feature-workflow-runtime';
import { getLocalFeatureWorkflow } from '../../../../infrastructure/workspace/local-feature-workflow-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  try {
    assertTrustedLocalRequest(request);
    const body = await readBoundedJson(request);
    const userRequest = readStringField(body, 'request');
    const iterationFeedback = readOptionalField(body, 'iterationFeedback');
    const featurePlanId = readOptionalString(body, 'featurePlanId');
    const taskId = readOptionalString(body, 'taskId');
    const dependencyOverrides = readOptionalStringArray(body, 'dependencyOverrides');

    if (featurePlanId !== undefined && taskId !== undefined) {
      const result = await getLocalFeatureWorkflow().prepareTask(
        { featurePlanId, taskId, dependencyOverrides },
        userRequest,
        iterationFeedback,
      );
      return json({ ...result.preparation, featurePlan: result.plan }, 200);
    }

    const preparation =
      iterationFeedback === undefined
        ? await getLocalWorkspaceRuntime().prepare(userRequest)
        : await getLocalWorkspaceRuntime().prepare(userRequest, iterationFeedback);
    return json(preparation, 200);
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

function readOptionalField(value: unknown, field: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  return Reflect.has(value, field) ? Reflect.get(value, field) : undefined;
}

function readOptionalString(value: unknown, field: string): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = Reflect.get(value, field);
  return typeof candidate === 'string' && candidate.trim().length > 0
    ? candidate.trim()
    : undefined;
}

function readOptionalStringArray(value: unknown, field: string): readonly string[] | undefined {
  const candidate = readOptionalField(value, field);
  if (!Array.isArray(candidate)) return undefined;
  return candidate.filter((item): item is string => typeof item === 'string');
}

function readStringField(value: unknown, field: string): string {
  if (typeof value !== 'object' || value === null) return '';
  const candidate = Reflect.get(value, field);
  return typeof candidate === 'string' ? candidate : '';
}

function errorResponse(error: unknown): Response {
  if (error instanceof LocalRequestRejectedError) {
    return json({ code: error.code, message: error.message }, 403);
  }
  if (error instanceof WorkspaceRuntimeError) {
    const status =
      error.code === 'INVALID_REQUEST' ||
      error.code === 'INVALID_ITERATION_FEEDBACK' ||
      error.code === 'INVALID_FEATURE_PLAN'
        ? 400
        : 422;
    return json({ code: error.code, message: error.message }, status);
  }
  if (error instanceof ContextBuilderValidationError) {
    return validationErrorResponse(error.code, error.message, error.issues);
  }
  if (error instanceof PromptOrchestratorValidationError) {
    return validationErrorResponse(error.code, error.message, error.issues);
  }
  if (error instanceof ResponseProcessorValidationError) {
    return validationErrorResponse(error.code, error.message, error.issues);
  }
  if (error instanceof ChangePlanValidationError) {
    return validationErrorResponse(error.code, error.message, error.issues);
  }
  if (error instanceof AIProviderError) {
    const mapped = mapAiProviderErrorResponse(error);
    return json(mapped.body, mapped.status);
  }
  return json(
    {
      code: 'INTERNAL_WORKFLOW_ERROR',
      message: 'An unexpected workflow error occurred. Review the server diagnostic log.',
    },
    500,
  );
}

function validationErrorResponse(
  code: string,
  message: string,
  issues: readonly { readonly path: string; readonly message: string }[],
): Response {
  return json(
    {
      code,
      message: `${message} ${issues.map(({ path, message: issueMessage }) => `${path}: ${issueMessage}`).join('; ')}`,
      issues,
    },
    422,
  );
}

function json(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
