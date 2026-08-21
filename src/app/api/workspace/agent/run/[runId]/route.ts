import {
  assertAuthorizedWorkspaceRequest,
  assertTrustedLocalRequest,
} from '../../../../../../infrastructure/workspace';
import {
  getLocalWorkspaceSecurityConfiguration,
  getReadyLocalAgentOperatingService,
} from '../../../../../../infrastructure/workspace/local-feature-workflow-runtime';
import {
  agentJson,
  mapAgentRouteError,
  readRunIdParam,
  toAgentRunHttpView,
} from '../../agent-route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/workspace/agent/run/:runId — bounded AgentRun status. Never applies. */
export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  try {
    assertTrustedLocalRequest(request);
    const security = getLocalWorkspaceSecurityConfiguration();
    assertAuthorizedWorkspaceRequest({
      security,
      request,
      body: {},
      action: 'INVESTIGATE',
    });
    const { runId: rawRunId } = await context.params;
    const runId = readRunIdParam(rawRunId);
    const agent = await getReadyLocalAgentOperatingService();
    const run = await agent.getRun(runId);
    if (run.projectId !== security.projectId) {
      return agentJson({ code: 'NOT_FOUND', message: 'AgentRun not found.' }, 404);
    }
    return agentJson({ run: toAgentRunHttpView(run) }, 200);
  } catch (error: unknown) {
    return mapAgentRouteError(error);
  }
}
