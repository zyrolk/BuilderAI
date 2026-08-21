import { WorkspaceRuntimeError } from '../../../../../application/workspace';
import type { WorkspaceCompletion } from '../../../../../application/workspace/workspace-runtime.types';
import {
  assertTrustedLocalRequest,
  LocalRequestRejectedError,
  mapWorkspaceRuntimeErrorStatus,
  readBoundedJson,
} from '../../../../../infrastructure/workspace';
import { getReadyLocalCorrectionLoopService } from '../../../../../infrastructure/workspace/local-feature-workflow-runtime';
import { CorrectionPersistenceError } from '../../../../../application/workspace/correction-loop';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  try {
    assertTrustedLocalRequest(request);
    const body = await readBoundedJson(request);
    const workflowId = readRequiredString(body, 'workflowId');
    const completion = parseCompletion(body);
    const service = await getReadyLocalCorrectionLoopService();
    const session = await service.recordVerificationComplete(workflowId, completion);
    return json({ session }, 200);
  } catch (error: unknown) {
    if (error instanceof LocalRequestRejectedError) {
      return json({ code: error.code, message: error.message }, 403);
    }
    if (error instanceof CorrectionPersistenceError) {
      return json({ code: 'CORRECTION_PERSISTENCE_FAILED', message: error.message }, 500);
    }
    if (error instanceof WorkspaceRuntimeError) {
      const mappedStatus = mapWorkspaceRuntimeErrorStatus(error);
      return json({ code: error.code, message: error.message }, mappedStatus ?? 409);
    }
    return json(
      { code: 'WORKFLOW_FAILED', message: 'Correction verification could not be recorded.' },
      500,
    );
  }
}

function parseCompletion(body: unknown): WorkspaceCompletion {
  if (typeof body !== 'object' || body === null) {
    throw new WorkspaceRuntimeError('INVALID_REQUEST', 'Completion payload is required.');
  }
  const applyResult = Reflect.get(body, 'applyResult');
  if (typeof applyResult !== 'object' || applyResult === null) {
    throw new WorkspaceRuntimeError('INVALID_REQUEST', 'applyResult is required.');
  }
  const verificationReport = Reflect.get(body, 'verificationReport');
  const runtimeBrowserVerificationReport = Reflect.get(body, 'runtimeBrowserVerificationReport');
  return {
    applyResult,
    ...(verificationReport === undefined ? {} : { verificationReport }),
    ...(runtimeBrowserVerificationReport === undefined ? {} : { runtimeBrowserVerificationReport }),
  } as WorkspaceCompletion;
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

function json(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
