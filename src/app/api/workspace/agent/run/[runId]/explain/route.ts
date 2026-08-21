import {
  assertAuthorizedWorkspaceRequest,
  assertTrustedLocalRequest,
} from '../../../../../../../infrastructure/workspace';
import {
  getLocalWorkspaceSecurityConfiguration,
  getReadyLocalAgentOperatingService,
} from '../../../../../../../infrastructure/workspace/local-feature-workflow-runtime';
import {
  agentJson,
  mapAgentRouteError,
  readRunIdParam,
  toAgentRunHttpView,
} from '../../../agent-route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/workspace/agent/run/:runId/explain
 * Read-only deterministic ExplainArtifact. Never mutates workspace or AgentRun phase.
 */
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
    const current = await agent.getRun(runId);
    if (current.projectId !== security.projectId) {
      return agentJson({ code: 'NOT_FOUND', message: 'AgentRun not found.' }, 404);
    }
    const result = await agent.getExplainArtifact(runId);
    return agentJson(
      {
        run: toAgentRunHttpView(result.run),
        explain: result.explain,
        persisted: result.persisted,
      },
      200,
    );
  } catch (error: unknown) {
    return mapAgentRouteError(error);
  }
}
