import { WorkspaceRuntimeError } from '../../../../../application/workspace';
import { createCancellationTokenFromSignal } from '../../../../../application/workspace/request-cancellation';
import {
  completionToBeginInput,
  isCorrectionEligibleCompletion,
  CorrectionLoopCancelledError,
  CorrectionPersistenceError,
} from '../../../../../application/workspace/correction-loop';
import { buildIterationFeedbackFromCompletion } from '../../../../../application/workspace/iteration-feedback.service';
import type { WorkspaceCompletion } from '../../../../../application/workspace/workspace-runtime.types';
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
    const completion = parseCompletion(body);
    if (!isCorrectionEligibleCompletion(completion)) {
      throw new WorkspaceRuntimeError(
        'WORKFLOW_FAILED',
        'The completion outcome is not eligible for bounded correction.',
      );
    }
    const workflowId = readWorkflowId(body, completion);
    const service = await getReadyLocalCorrectionLoopService();
    const cancellation = createCancellationTokenFromSignal(request.signal);
    const result = await service.beginFromCompletion(
      workflowId,
      completion,
      {
        ...(readOptionalString(body, 'priorRequestSummary') === undefined
          ? {}
          : { priorRequestSummary: readOptionalString(body, 'priorRequestSummary') }),
        ...(readOptionalString(body, 'originalTaskSummary') === undefined
          ? {}
          : { originalTaskSummary: readOptionalString(body, 'originalTaskSummary') }),
        ...(readOptionalString(body, 'sourcePreparationId') === undefined
          ? {}
          : { sourcePreparationId: readOptionalString(body, 'sourcePreparationId') }),
        ...(readOptionalStringArray(body, 'investigationEvidencePaths') === undefined
          ? {}
          : {
              investigationEvidencePaths: readOptionalStringArray(
                body,
                'investigationEvidencePaths',
              ),
            }),
        ...(readOptionalStringArray(body, 'explicitlyAuthorizedPaths') === undefined
          ? {}
          : {
              explicitlyAuthorizedPaths: readOptionalStringArray(body, 'explicitlyAuthorizedPaths'),
            }),
      },
      { cancellation },
    );
    const iterationFeedback =
      result.canPrepare && completion !== undefined
        ? buildIterationFeedbackFromCompletion(completion, {
            ...(readOptionalString(body, 'sourcePreparationId') === undefined
              ? {}
              : { sourcePreparationId: readOptionalString(body, 'sourcePreparationId') }),
            ...(readOptionalString(body, 'priorRequestSummary') === undefined
              ? {}
              : { priorRequestSummary: readOptionalString(body, 'priorRequestSummary') }),
          })
        : undefined;
    return json(
      {
        ...result,
        ...(iterationFeedback === undefined ? {} : { iterationFeedback }),
      },
      200,
    );
  } catch (error: unknown) {
    if (error instanceof CorrectionLoopCancelledError) {
      const service = await getReadyLocalCorrectionLoopService();
      const session = service.getSession(error.workflowId);
      return json({ session, correctionRequest: '', canPrepare: false }, 409);
    }
    if (error instanceof CorrectionPersistenceError) {
      return json({ code: 'CORRECTION_PERSISTENCE_FAILED', message: error.message }, 500);
    }
    if (error instanceof LocalRequestRejectedError) {
      return json({ code: error.code, message: error.message }, 403);
    }
    if (error instanceof WorkspaceRuntimeError) {
      const mappedStatus = mapWorkspaceRuntimeErrorStatus(error);
      return json({ code: error.code, message: error.message }, mappedStatus ?? 409);
    }
    return json({ code: 'WORKFLOW_FAILED', message: 'Correction could not be started.' }, 500);
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

function readWorkflowId(body: unknown, completion: WorkspaceCompletion): string {
  const explicit = readOptionalString(body, 'workflowId');
  if (explicit !== undefined) return explicit;
  const sourcePreparationId = readOptionalString(body, 'sourcePreparationId');
  if (sourcePreparationId !== undefined) return sourcePreparationId;
  return completionToBeginInput(completion, 'anonymous-workflow').workflowId;
}

function readOptionalString(body: unknown, field: string): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const value = Reflect.get(body, field);
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readOptionalStringArray(body: unknown, field: string): readonly string[] | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const value = Reflect.get(body, field);
  if (!Array.isArray(value)) return undefined;
  const paths = value.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0,
  );
  return paths.length > 0 ? paths : undefined;
}

function json(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
