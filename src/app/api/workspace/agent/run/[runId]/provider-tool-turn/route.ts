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
  assertNoProviderToolTurnAuthorityFields,
  mapAgentRouteError,
  readRunIdParam,
  toAgentRunHttpView,
  toBoundedToolEvidenceHttpView,
  toProviderAssistedDigestHttpView,
} from '../../../agent-route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/workspace/agent/run/:runId/provider-tool-turn
 * ADR-046: provider proposes structured intents (toolCalling:false); server executes via AgentLoop.
 * Explicit operator/product trigger only. Never accepts client-supplied intents.
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
      assertNoProviderToolTurnAuthorityFields(body);
    }
    const security = getLocalWorkspaceSecurityConfiguration();
    assertAuthorizedWorkspaceRequest({
      security,
      request,
      body,
      action: 'INVESTIGATE',
    });
    const { runId: rawRunId } = await context.params;
    const runId = readRunIdParam(rawRunId);
    const cancellation = createCancellationTokenFromSignal(request.signal);
    const securityEvidence = readWorkspaceRequestSecurityEvidence(request, body, 'INVESTIGATE');
    const agent = await getReadyLocalAgentOperatingService();
    const current = await agent.getRun(runId);
    if (current.projectId !== security.projectId) {
      return agentJson({ code: 'NOT_FOUND', message: 'AgentRun not found.' }, 404);
    }
    const result = await agent.executeProviderAssistedToolTurn(runId, {
      securityEvidence: {
        operatorApproved: false,
        browserObservationApproved: securityEvidence.browserObservationApproved === true,
        ...(securityEvidence.bearerToken === undefined
          ? {}
          : { bearerToken: securityEvidence.bearerToken }),
        ...(securityEvidence.csrfToken === undefined
          ? {}
          : { csrfToken: securityEvidence.csrfToken }),
      },
      cancellation,
    });
    return agentJson(
      {
        run: toAgentRunHttpView(result.run),
        budget: {
          toolCalls: result.budget.toolCalls,
          providerTurns: result.budget.providerTurns,
          b4VerificationCalls: result.budget.b4VerificationCalls,
          browserObservationCalls: result.budget.browserObservationCalls,
        },
        evidence: result.evidence.map((record) => toBoundedToolEvidenceHttpView(record)),
        turn: summarizeTurn(result.turn),
        emission:
          result.providerAssisted === undefined
            ? { source: 'provider-structured-intent', toolCalling: false }
            : toProviderAssistedDigestHttpView(result.providerAssisted),
      },
      200,
    );
  } catch (error: unknown) {
    return mapAgentRouteError(error);
  }
}

function summarizeTurn(turn: {
  readonly intentId?: string;
  readonly toolId?: string;
  readonly status?: string;
  readonly results?: readonly {
    readonly intentId: string;
    readonly toolId: string;
    readonly status: string;
    readonly replayed: boolean;
    readonly errorCode?: string;
  }[];
  readonly stopped?: boolean;
  readonly stopReason?: string;
  readonly turnIndex?: number;
  readonly replayed?: boolean;
  readonly errorCode?: string;
}): Record<string, unknown> {
  if (turn.results !== undefined) {
    return {
      kind: 'providerTurn',
      turnIndex: turn.turnIndex,
      stopped: turn.stopped === true,
      ...(turn.stopReason === undefined ? {} : { stopReason: turn.stopReason }),
      results: turn.results.map((item) => ({
        intentId: item.intentId,
        toolId: item.toolId,
        status: item.status,
        replayed: item.replayed,
        ...(item.errorCode === undefined ? {} : { errorCode: item.errorCode }),
      })),
    };
  }
  return {
    kind: 'intent',
    intentId: turn.intentId,
    toolId: turn.toolId,
    status: turn.status,
    replayed: turn.replayed === true,
    ...(turn.errorCode === undefined ? {} : { errorCode: turn.errorCode }),
  };
}
