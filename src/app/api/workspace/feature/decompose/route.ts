import { WorkspaceRuntimeError } from '../../../../../application/workspace';
import { ProviderContractViolationError } from '../../../../../core/ai-provider';
import { ChangePlanValidationError } from '../../../../../core/change-planner';
import { ContextBuilderValidationError } from '../../../../../core/context-builder';
import { PromptOrchestratorValidationError } from '../../../../../core/prompt-orchestrator';
import { ResponseProcessorValidationError } from '../../../../../core/response-processor';
import {
  assertTrustedLocalRequest,
  LocalRequestRejectedError,
  readBoundedJson,
} from '../../../../../infrastructure/workspace';
import {
  getLocalFeatureDecomposition,
  getLocalFeatureWorkflow,
} from '../../../../../infrastructure/workspace/local-feature-workflow-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  try {
    assertTrustedLocalRequest(request);
    const body = await readBoundedJson(request);
    const userRequest = readStringField(body, 'request');
    const draft = await getLocalFeatureDecomposition().decompose(userRequest);
    const plan = await getLocalFeatureWorkflow().saveDraft(draft);
    return json(plan, 200);
  } catch (error: unknown) {
    return errorResponse(error);
  }
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
  if (error instanceof ProviderContractViolationError) {
    return validationErrorResponse(error.code, error.message, error.issues);
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
