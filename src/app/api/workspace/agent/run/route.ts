import { createCancellationTokenFromSignal } from '../../../../../application/workspace/request-cancellation';
import {
  assertAuthorizedWorkspaceRequest,
  assertTrustedLocalRequest,
  readBoundedJson,
} from '../../../../../infrastructure/workspace';
import {
  getLocalWorkspaceSecurityConfiguration,
  getReadyLocalAgentOperatingService,
} from '../../../../../infrastructure/workspace/local-feature-workflow-runtime';
import {
  agentJson,
  mapAgentRouteError,
  readRequiredGoal,
  toAgentRunHttpView,
} from '../agent-route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/workspace/agent/run — start AgentRun (UNDERSTANDING). No mutation. */
export async function POST(request: Request): Promise<Response> {
  try {
    assertTrustedLocalRequest(request);
    const body = await readBoundedJson(request);
    const security = getLocalWorkspaceSecurityConfiguration();
    assertAuthorizedWorkspaceRequest({
      security,
      request,
      body,
      action: 'INVESTIGATE',
    });
    const goal = readRequiredGoal(body);
    const cancellation = createCancellationTokenFromSignal(request.signal);
    void cancellation;
    const agent = await getReadyLocalAgentOperatingService();
    const started = await agent.startRun(goal);
    return agentJson(
      {
        run: toAgentRunHttpView(started.run),
        investigationId: started.investigation.investigationId,
      },
      200,
    );
  } catch (error: unknown) {
    return mapAgentRouteError(error);
  }
}
