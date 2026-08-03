import { WorkspaceRuntimeError } from '../../../../../application/workspace';
import {
  assertTrustedLocalRequest,
  LocalRequestRejectedError,
  MAXIMUM_FEATURE_PLAN_BODY_BYTES,
  readBoundedJson,
} from '../../../../../infrastructure/workspace';
import { getLocalFeatureWorkflow } from '../../../../../infrastructure/workspace/local-feature-workflow-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    assertTrustedLocalRequest(request);
    const featurePlanId = readQueryParam(request, 'featurePlanId');
    const workflow = getLocalFeatureWorkflow();
    const plan =
      featurePlanId === undefined
        ? await workflow.getActivePlan()
        : await workflow.loadPlan(featurePlanId);
    if (plan === undefined) {
      return json({ plan: null }, 200);
    }
    return json({ plan }, 200);
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    assertTrustedLocalRequest(request, MAXIMUM_FEATURE_PLAN_BODY_BYTES);
    const body = await readBoundedJson(request, MAXIMUM_FEATURE_PLAN_BODY_BYTES);
    const planInput = readField(body, 'plan');
    const mode = readOptionalString(body, 'mode');
    const workflow = getLocalFeatureWorkflow();
    const plan =
      mode === 'edit-approved'
        ? await workflow.editApprovedPlan(planInput)
        : await workflow.updateDraftPlan(planInput);
    return json({ plan }, 200);
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

function readQueryParam(request: Request, name: string): string | undefined {
  const value = new URL(request.url).searchParams.get(name);
  return value === null || value.trim().length === 0 ? undefined : value.trim();
}

function readField(value: unknown, field: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  return Reflect.get(value, field);
}

function readOptionalString(value: unknown, field: string): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = Reflect.get(value, field);
  return typeof candidate === 'string' ? candidate : undefined;
}

function errorResponse(error: unknown): Response {
  if (error instanceof LocalRequestRejectedError) {
    return json({ code: error.code, message: error.message }, 403);
  }
  if (error instanceof WorkspaceRuntimeError) {
    const status =
      error.code === 'FEATURE_PLAN_NOT_FOUND'
        ? 404
        : error.code === 'INVALID_REQUEST' || error.code === 'INVALID_FEATURE_PLAN'
          ? 400
          : 422;
    return json({ code: error.code, message: error.message }, status);
  }
  return json(
    {
      code: 'INTERNAL_WORKFLOW_ERROR',
      message: 'An unexpected workflow error occurred. Review the server diagnostic log.',
    },
    500,
  );
}

function json(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
