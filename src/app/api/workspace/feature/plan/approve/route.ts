import { WorkspaceRuntimeError } from '../../../../../../application/workspace';
import {
  assertTrustedLocalRequest,
  LocalRequestRejectedError,
  readBoundedJson,
} from '../../../../../../infrastructure/workspace';
import { getLocalFeatureWorkflow } from '../../../../../../infrastructure/workspace/local-feature-workflow-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  try {
    assertTrustedLocalRequest(request);
    const body = await readBoundedJson(request);
    const featurePlanId = readStringField(body, 'featurePlanId');
    const workflow = getLocalFeatureWorkflow();
    const plan = await workflow.approvePlan(featurePlanId);
    return json({ plan }, 200);
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
