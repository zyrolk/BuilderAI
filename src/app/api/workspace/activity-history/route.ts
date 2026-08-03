import {
  parseWorkspaceActivity,
  type ActivityHistory,
  type WorkspaceActivity,
} from '../../../../application/workspace';
import {
  assertTrustedLocalRequest,
  LocalRequestRejectedError,
} from '../../../../infrastructure/workspace';
import { getLocalActivityHistory } from '../../../../infrastructure/workspace/local-feature-workflow-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    assertTrustedLocalRequest(request);
    const raw = await getLocalActivityHistory().readHistory();
    return json(sanitizeActivityHistory(raw), 200);
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

function sanitizeActivityHistory(raw: ActivityHistory): ActivityHistory {
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.activities)) {
    return { schemaVersion: 1, activities: [] };
  }
  const activities: WorkspaceActivity[] = [];
  for (const entry of raw.activities) {
    try {
      activities.push(parseWorkspaceActivity(entry));
    } catch {
      // Omit malformed persisted entries rather than leaking arbitrary fields.
    }
  }
  return { schemaVersion: 1, activities };
}

function errorResponse(error: unknown): Response {
  if (error instanceof LocalRequestRejectedError) {
    return json({ code: error.code, message: error.message }, 403);
  }
  return json(
    {
      code: 'INTERNAL_WORKFLOW_ERROR',
      message: 'An unexpected workflow error occurred. Review the server diagnostic log.',
    },
    500,
  );
}

function json(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
