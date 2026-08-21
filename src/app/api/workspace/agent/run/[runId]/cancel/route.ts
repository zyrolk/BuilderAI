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

/** POST /api/workspace/agent/run/:runId/cancel — never applies. */
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
    const reason =
      typeof body === 'object' && body !== null && typeof Reflect.get(body, 'reason') === 'string'
        ? String(Reflect.get(body, 'reason')).trim().slice(0, 240)
        : 'agent run cancelled';
    const agent = await getReadyLocalAgentOperatingService();
    const current = await agent.getRun(runId);
    if (current.projectId !== security.projectId) {
      return agentJson({ code: 'NOT_FOUND', message: 'AgentRun not found.' }, 404);
    }
    const cancelled = await agent.cancel(runId, reason.length > 0 ? reason : 'agent run cancelled');
    return agentJson({ run: toAgentRunHttpView(cancelled.run) }, 200);
  } catch (error: unknown) {
    return mapAgentRouteError(error);
  }
}
