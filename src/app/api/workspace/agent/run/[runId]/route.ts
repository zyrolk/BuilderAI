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
  toBoundedToolEvidenceHttpView,
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
    const tool = await agent.getToolEvidence(runId);
    return agentJson(
      {
        run: toAgentRunHttpView(run),
        toolLoop: {
          evidence: tool.evidence.map((record) => toBoundedToolEvidenceHttpView(record)),
          ...(tool.budget === undefined
            ? {}
            : {
                budget: {
                  toolCalls: tool.budget.toolCalls,
                  providerTurns: tool.budget.providerTurns,
                  b4VerificationCalls: tool.budget.b4VerificationCalls,
                  browserObservationCalls: tool.budget.browserObservationCalls,
                },
              }),
        },
      },
      200,
    );
  } catch (error: unknown) {
    return mapAgentRouteError(error);
  }
}
