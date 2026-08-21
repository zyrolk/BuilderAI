import { createCancellationTokenFromSignal } from '../../../../../../../application/workspace/request-cancellation';
import {
  assertAuthorizedWorkspaceRequest,
  assertTrustedLocalRequest,
  readBoundedJson,
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
 * POST /api/workspace/agent/run/:runId/plan
 * Delegates to AgentOperatingService.plan + pauseAtGate2. Never applies.
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
      action: 'PREPARE',
    });
    const { runId: rawRunId } = await context.params;
    const runId = readRunIdParam(rawRunId);
    const cancellation = createCancellationTokenFromSignal(request.signal);
    const agent = await getReadyLocalAgentOperatingService();
    const current = await agent.getRun(runId);
    if (current.projectId !== security.projectId) {
      return agentJson({ code: 'NOT_FOUND', message: 'AgentRun not found.' }, 404);
    }
    await agent.plan(runId, { cancellation });
    const paused = await agent.pauseAtGate2(runId);
    return agentJson(
      {
        run: toAgentRunHttpView(paused.run),
        preparationId: paused.preparationId,
        expiresAt: paused.expiresAt,
        awaitingGate2: true,
        gate2Review: {
          schemaVersion: paused.gate2Review.schemaVersion,
          totalCharacterCount: paused.gate2Review.totalCharacterCount,
          truncated: paused.gate2Review.truncated,
          operationCount: paused.gate2Review.operationDiffs.length,
          ...(paused.gate2Review.truncationMessage === undefined
            ? {}
            : { truncationMessage: paused.gate2Review.truncationMessage }),
        },
        ...(paused.applyAuthorizationToken === undefined
          ? {}
          : { applyAuthorizationToken: paused.applyAuthorizationToken }),
      },
      200,
    );
  } catch (error: unknown) {
    return mapAgentRouteError(error);
  }
}
