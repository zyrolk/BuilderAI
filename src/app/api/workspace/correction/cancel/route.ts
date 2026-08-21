import { WorkspaceRuntimeError } from '../../../../../application/workspace';
import {
  assertTrustedLocalRequest,
  LocalRequestRejectedError,
  mapWorkspaceRuntimeErrorStatus,
  readBoundedJson,
} from '../../../../../infrastructure/workspace';
import { getReadyLocalCorrectionLoopService } from '../../../../../infrastructure/workspace/local-feature-workflow-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  try {
    assertTrustedLocalRequest(request);
    const body = await readBoundedJson(request);
    const workflowId = readRequiredString(body, 'workflowId');
    const reason = readOptionalString(body, 'reason') ?? 'correction cancelled';
    const service = await getReadyLocalCorrectionLoopService();
    const session = await service.cancelCorrection(workflowId, reason);
    return json({ session }, 200);
  } catch (error: unknown) {
    if (error instanceof LocalRequestRejectedError) {
      return json({ code: error.code, message: error.message }, 403);
    }
    if (error instanceof WorkspaceRuntimeError) {
      const mappedStatus = mapWorkspaceRuntimeErrorStatus(error);
      return json({ code: error.code, message: error.message }, mappedStatus ?? 409);
    }
    return json({ code: 'WORKFLOW_FAILED', message: 'Correction could not be cancelled.' }, 500);
  }
}

function readRequiredString(body: unknown, field: string): string {
  if (typeof body !== 'object' || body === null) {
    throw new WorkspaceRuntimeError('INVALID_REQUEST', `${field} is required.`);
  }
  const value = Reflect.get(body, field);
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new WorkspaceRuntimeError('INVALID_REQUEST', `${field} is required.`);
  }
  return value.trim();
}

function readOptionalString(body: unknown, field: string): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const value = Reflect.get(body, field);
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function json(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
