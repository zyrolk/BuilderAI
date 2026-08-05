import { WorkspaceRuntimeError } from '../../../../application/workspace';
import {
  assertTrustedLocalRequest,
  LocalRequestRejectedError,
  mapWorkspaceRuntimeErrorStatus,
  readBoundedJson,
  readWorkspaceRequestSecurityEvidence,
} from '../../../../infrastructure/workspace';
import { getLocalWorkspaceRuntime } from '../../../../infrastructure/workspace/local-feature-workflow-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  try {
    assertTrustedLocalRequest(request);
    const body = await readBoundedJson(request);
    const evidence = readWorkspaceRequestSecurityEvidence(request, body, 'APPLY');
    const preparationId = field(body, 'preparationId');
    const approved =
      typeof body === 'object' && body !== null && Reflect.get(body, 'approved') === true;
    const completion = await getLocalWorkspaceRuntime().approveAndApply(
      preparationId,
      approved,
      evidence,
    );
    return json(completion, 200);
  } catch (error: unknown) {
    if (error instanceof LocalRequestRejectedError) {
      return json({ code: error.code, message: error.message }, 403);
    }
    if (error instanceof WorkspaceRuntimeError) {
      const mappedStatus = mapWorkspaceRuntimeErrorStatus(error);
      return json({ code: error.code, message: error.message }, mappedStatus ?? 409);
    }
    return json({ code: 'WORKFLOW_FAILED', message: 'The workflow could not be completed.' }, 500);
  }
}

function field(value: unknown, name: string): string {
  if (typeof value !== 'object' || value === null) return '';
  const candidate = Reflect.get(value, name);
  return typeof candidate === 'string' ? candidate : '';
}

function json(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
