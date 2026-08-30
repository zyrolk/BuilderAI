import {
  mapAiProviderErrorResponse,
  WorkspaceRuntimeError,
} from '../../../../application/workspace';
import { AIProviderError } from '../../../../core/ai-provider';
import { ChangePlanValidationError } from '../../../../core/change-planner';
import { ContextBuilderValidationError } from '../../../../core/context-builder';
import { PromptOrchestratorValidationError } from '../../../../core/prompt-orchestrator';
import { ResponseProcessorValidationError } from '../../../../core/response-processor';
import { isInvestigationHandoffFeedback } from '../../../../application/workspace/investigation';
import { createCancellationTokenFromSignal } from '../../../../application/workspace/request-cancellation';
import {
  assertTrustedLocalRequest,
  LocalRequestRejectedError,
  mapWorkspaceRuntimeErrorStatus,
  readBoundedJson,
  assertAuthorizedWorkspaceRequest,
} from '../../../../infrastructure/workspace';
import {
  getLocalFeatureWorkflow,
  getLocalInvestigationService,
  getLocalWorkspaceRuntime,
  getLocalWorkspaceSecurityConfiguration,
  getLocalCorrectionLoopService,
} from '../../../../infrastructure/workspace/local-feature-workflow-runtime';
import {
  assertNoClientFailureDiagnosticAuthority,
  CORRECTION_PREPARE_KIND,
} from '../../../../application/workspace/correction-loop/correction-prepare-input';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  try {
    assertTrustedLocalRequest(request);
    const body = await readBoundedJson(request);
    if (typeof body === 'object' && body !== null) {
      assertNoClientFailureDiagnosticAuthority(body);
      const iterationCandidate = Reflect.get(body, 'iterationFeedback');
      if (typeof iterationCandidate === 'object' && iterationCandidate !== null) {
        assertNoClientFailureDiagnosticAuthority(iterationCandidate);
        if (Reflect.get(iterationCandidate, 'kind') === CORRECTION_PREPARE_KIND) {
          throw new WorkspaceRuntimeError(
            'INVALID_REQUEST',
            'Client-supplied CORRECTION_PREPARE is not accepted; server-derived diagnostics are authoritative.',
          );
        }
      }
    }
    const security = getLocalWorkspaceSecurityConfiguration();
    assertAuthorizedWorkspaceRequest({
      security,
      request,
      body,
      action: 'PREPARE',
    });
    const userRequest = readStringField(body, 'request');
    const iterationFeedback = readOptionalField(body, 'iterationFeedback');
    const investigationId = readOptionalString(body, 'investigationId');
    const featurePlanId = readOptionalString(body, 'featurePlanId');
    const taskId = readOptionalString(body, 'taskId');
    const dependencyOverrides = readOptionalStringArray(body, 'dependencyOverrides');
    const correctionWorkflowId = readOptionalString(body, 'correctionWorkflowId');

    if (investigationId === undefined && isInvestigationHandoffFeedback(iterationFeedback)) {
      throw new WorkspaceRuntimeError(
        'INVESTIGATION_REFERENCE_INVALID',
        'Prepare Fix requires a server-held investigation reference.',
      );
    }

    const authoritativeIterationFeedback =
      investigationId === undefined
        ? iterationFeedback
        : getAuthoritativeInvestigationHandoff(investigationId);

    const cancellation = createCancellationTokenFromSignal(request.signal);
    if (correctionWorkflowId !== undefined) {
      getLocalCorrectionLoopService().registerCancellation(correctionWorkflowId, cancellation);
    }

    try {
      if (featurePlanId !== undefined && taskId !== undefined) {
        const result = await getLocalFeatureWorkflow().prepareTask(
          { featurePlanId, taskId, dependencyOverrides },
          userRequest,
          authoritativeIterationFeedback,
        );
        return json({ ...result.preparation, featurePlan: result.plan }, 200);
      }

      const preparation =
        authoritativeIterationFeedback === undefined
          ? await getLocalWorkspaceRuntime().prepare(userRequest, undefined, cancellation)
          : await getLocalWorkspaceRuntime().prepare(
              userRequest,
              authoritativeIterationFeedback,
              cancellation,
            );
      return json(preparation, 200);
    } finally {
      if (correctionWorkflowId !== undefined && cancellation.cancelled) {
        await getLocalCorrectionLoopService().cancelCorrection(
          correctionWorkflowId,
          cancellation.reason ?? 'prepare cancelled',
        );
      }
    }
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

function getAuthoritativeInvestigationHandoff(investigationId: string): unknown {
  const handoff = getLocalInvestigationService().resolveInvestigationHandoff(investigationId);
  if (handoff === undefined) {
    throw new WorkspaceRuntimeError(
      'INVESTIGATION_REFERENCE_INVALID',
      'The investigation reference is unknown or expired.',
    );
  }
  return handoff;
}

function readOptionalField(value: unknown, field: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  return Reflect.has(value, field) ? Reflect.get(value, field) : undefined;
}

function readOptionalString(value: unknown, field: string): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = Reflect.get(value, field);
  return typeof candidate === 'string' && candidate.trim().length > 0
    ? candidate.trim()
    : undefined;
}

function readOptionalStringArray(value: unknown, field: string): readonly string[] | undefined {
  const candidate = readOptionalField(value, field);
  if (!Array.isArray(candidate)) return undefined;
  return candidate.filter((item): item is string => typeof item === 'string');
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
    const mappedStatus = mapWorkspaceRuntimeErrorStatus(error);
    if (mappedStatus !== undefined) {
      return json({ code: error.code, message: error.message }, mappedStatus);
    }
    const validationStatus =
      error.code === 'INVALID_REQUEST' ||
      error.code === 'INVALID_ITERATION_FEEDBACK' ||
      error.code === 'INVESTIGATION_REFERENCE_INVALID' ||
      error.code === 'INVALID_FEATURE_PLAN'
        ? 400
        : 422;
    return json({ code: error.code, message: error.message }, validationStatus);
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
  if (error instanceof AIProviderError) {
    const mapped = mapAiProviderErrorResponse(error);
    return json(mapped.body, mapped.status);
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
