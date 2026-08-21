import { WorkspaceRuntimeError } from '../../../../application/workspace';
import { createCancellationTokenFromSignal } from '../../../../application/workspace/request-cancellation';
import {
  assertTrustedLocalRequest,
  LocalRequestRejectedError,
  mapWorkspaceRuntimeErrorStatus,
  readBoundedJson,
  readWorkspaceRequestSecurityEvidence,
} from '../../../../infrastructure/workspace';
import {
  getLocalCorrectionLoopService,
  getLocalWorkspaceRuntime,
} from '../../../../infrastructure/workspace/local-feature-workflow-runtime';

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
    const correctionWorkflowId =
      typeof body === 'object' && body !== null
        ? readOptionalCorrectionWorkflowId(body)
        : undefined;
    const cancellation = createCancellationTokenFromSignal(request.signal);
    if (correctionWorkflowId !== undefined) {
      getLocalCorrectionLoopService().registerCancellation(correctionWorkflowId, cancellation);
    }
    try {
      const completion = await getLocalWorkspaceRuntime().approveAndApply(
        preparationId,
        approved,
        evidence,
        cancellation,
      );
      return json(completion, 200);
    } finally {
      if (correctionWorkflowId !== undefined && cancellation.cancelled) {
        await getLocalCorrectionLoopService().cancelCorrection(
          correctionWorkflowId,
          cancellation.reason ?? 'apply cancelled',
        );
      }
    }
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

function readOptionalCorrectionWorkflowId(body: object): string | undefined {
  const candidate = Reflect.get(body, 'correctionWorkflowId');
  return typeof candidate === 'string' && candidate.trim().length > 0
    ? candidate.trim()
    : undefined;
}

function json(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
