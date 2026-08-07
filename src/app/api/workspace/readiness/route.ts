import {
  assertAuthorizedWorkspaceRequest,
  assertTrustedLocalRequest,
  LocalRequestRejectedError,
} from '../../../../infrastructure/workspace';
import {
  getLocalExternalTargetReadiness,
  getLocalWorkspaceSecurityConfiguration,
} from '../../../../infrastructure/workspace/local-feature-workflow-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    assertTrustedLocalRequest(request);
    const security = getLocalWorkspaceSecurityConfiguration();
    assertAuthorizedWorkspaceRequest({
      security,
      request,
      body: {},
      action: 'READINESS',
    });
    const readiness = await getLocalExternalTargetReadiness();
    if (readiness === undefined) {
      return json(
        {
          code: 'READINESS_NOT_APPLICABLE',
          message: 'Readiness is only available for EXTERNAL_TARGET projects.',
        },
        404,
      );
    }
    return json(readiness, 200);
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function POST(): Promise<Response> {
  return json({ code: 'METHOD_NOT_ALLOWED', message: 'Use GET for readiness.' }, 405);
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
  return json({ code: 'READINESS_FAILED', message: 'Readiness could not be determined.' }, 500);
}
