import { createCancellationTokenFromSignal } from '../../../../../../../application/workspace/request-cancellation';
import {
  assertAuthorizedWorkspaceRequest,
  assertTrustedLocalRequest,
  readBoundedJson,
  readWorkspaceRequestSecurityEvidence,
} from '../../../../../../../infrastructure/workspace';
import {
  getLocalWorkspaceSecurityConfiguration,
  getReadyLocalAgentOperatingService,
} from '../../../../../../../infrastructure/workspace/local-feature-workflow-runtime';
import {
  agentJson,
  assertNoClientAuthorityFields,
  mapAgentRouteError,
  readRunIdParam,
  toAgentRunHttpView,
} from '../../../agent-route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/workspace/agent/run/:runId/approve
 * Explicit operator intent required. Delegates to executeAfterApproval → existing approveAndApply.
 * Does not invent Gate 2 approval semantics.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  try {
    assertTrustedLocalRequest(request);
    const body = await readBoundedJson(request);
    if (typeof body === 'object' && body !== null) {
      assertNoClientAuthorityFields(body);
    }
    const security = getLocalWorkspaceSecurityConfiguration();
    assertAuthorizedWorkspaceRequest({
      security,
      request,
      body,
      action: 'APPLY',
    });
    const approved =
      typeof body === 'object' && body !== null && Reflect.get(body, 'approved') === true;
    const evidence = readWorkspaceRequestSecurityEvidence(request, body, 'APPLY');
    const { runId: rawRunId } = await context.params;
    const runId = readRunIdParam(rawRunId);
    const cancellation = createCancellationTokenFromSignal(request.signal);
    const agent = await getReadyLocalAgentOperatingService();
    const current = await agent.getRun(runId);
    if (current.projectId !== security.projectId) {
      return agentJson({ code: 'NOT_FOUND', message: 'AgentRun not found.' }, 404);
    }

    const result = await agent.executeAfterApproval(runId, {
      approved,
      evidence: {
        ...(evidence.bearerToken === undefined ? {} : { bearerToken: evidence.bearerToken }),
        ...(evidence.csrfToken === undefined ? {} : { csrfToken: evidence.csrfToken }),
        ...(evidence.applyAuthorizationToken === undefined
          ? {}
          : { applyAuthorizationToken: evidence.applyAuthorizationToken }),
      },
      cancellation,
    });

    if ('correctionWorkflowId' in result) {
      const explainResult = await agent.getExplainArtifact(runId);
      return agentJson(
        {
          run: toAgentRunHttpView(result.run),
          applyStatus: result.completion.applyResult.status,
          verificationStatus: result.completion.verificationReport?.status ?? null,
          correctionWorkflowId: result.correctionWorkflowId,
          canPrepareCorrection: result.canPrepareCorrection,
          awaitingCorrectionApproval: true,
          explain: explainResult.explain,
        },
        200,
      );
    }

    const explained = await agent.explain(runId);
    return agentJson(
      {
        run: toAgentRunHttpView(explained.run),
        applyStatus: result.completion.applyResult.status,
        verificationStatus: result.completion.verificationReport?.status ?? null,
        explanation: {
          summary: explained.explanation.summary,
          applyStatus: explained.explanation.applyStatus ?? null,
          verificationStatus: explained.explanation.verificationStatus ?? null,
        },
        explain: explained.explain,
      },
      200,
    );
  } catch (error: unknown) {
    return mapAgentRouteError(error);
  }
}
