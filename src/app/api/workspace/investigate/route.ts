import {
  InvestigationValidationError,
  WorkspaceRuntimeError,
} from '../../../../application/workspace';
import {
  assertAuthorizedWorkspaceRequest,
  assertTrustedLocalRequest,
  LocalRequestRejectedError,
  mapWorkspaceRuntimeErrorStatus,
  readBoundedJson,
} from '../../../../infrastructure/workspace';
import {
  getLocalInvestigationService,
  getLocalWorkspaceSecurityConfiguration,
} from '../../../../infrastructure/workspace/local-feature-workflow-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  try {
    assertTrustedLocalRequest(request);
    const body = await readBoundedJson(request);
    const security = getLocalWorkspaceSecurityConfiguration();
    assertAuthorizedWorkspaceRequest({
      security,
      request,
      body,
      action: 'INVESTIGATE',
    });
    const userRequest = readStringField(body, 'request');
    const investigation = await getLocalInvestigationService().investigate(userRequest);
    return json(investigation, 200);
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

function readStringField(value: unknown, field: string): string {
  if (typeof value !== 'object' || value === null) return '';
  const candidate = Reflect.get(value, field);
  return typeof candidate === 'string' ? candidate : '';
}

function json(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

function errorResponse(error: unknown): Response {
  if (error instanceof LocalRequestRejectedError) {
    return json({ code: error.code, message: error.message }, 403);
  }
  if (error instanceof InvestigationValidationError) {
    return json(
      {
        code: 'INVESTIGATION_VALIDATION_FAILED',
        message: error.message,
        issues: error.issues,
      },
      422,
    );
  }
  if (error instanceof WorkspaceRuntimeError) {
    const mappedStatus = mapWorkspaceRuntimeErrorStatus(error);
    return json({ code: error.code, message: error.message }, mappedStatus ?? 409);
  }
  return json({ code: 'WORKFLOW_FAILED', message: 'Investigation could not be completed.' }, 500);
}
