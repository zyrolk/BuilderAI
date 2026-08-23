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
  assertNoToolTurnAuthorityFields,
  mapAgentRouteError,
  readRunIdParam,
  readToolTurnIntents,
  toAgentRunHttpView,
  toBoundedToolEvidenceHttpView,
} from '../../../agent-route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/workspace/agent/run/:runId/tool-turn
 * Authenticated, run-bound AgentLoop turn (ADR-044). Never applies FileApply / Gate2.
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
      assertNoToolTurnAuthorityFields(body);
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
    const intents = readToolTurnIntents(body);
    const cancellation = createCancellationTokenFromSignal(request.signal);
    const securityEvidence = readWorkspaceRequestSecurityEvidence(request, body, 'INVESTIGATE');
    const agent = await getReadyLocalAgentOperatingService();
    const current = await agent.getRun(runId);
    if (current.projectId !== security.projectId) {
      return agentJson({ code: 'NOT_FOUND', message: 'AgentRun not found.' }, 404);
    }
    const result = await agent.executeToolTurn(runId, {
      intents,
      securityEvidence: {
        // Server-owned: never invent Gate2 / Git APPLY approval from this route.
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
        evidence: result.evidence.map(toBoundedToolEvidenceHttpView),
        turn: summarizeTurn(result.turn),
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
