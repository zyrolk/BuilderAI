import { WorkspaceRuntimeError } from '../../../../application/workspace';
import { ContextBuilderValidationError } from '../../../../core/context-builder';
import {
  assertTrustedLocalRequest,
  LocalRequestRejectedError,
  readBoundedJson,
} from '../../../../infrastructure/workspace';
import { getLocalWorkspaceRuntime } from '../../../../infrastructure/workspace/local-workspace-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  try {
    assertTrustedLocalRequest(request);
    const body = await readBoundedJson(request);
    const userRequest = readStringField(body, 'request');
    const preparation = await getLocalWorkspaceRuntime().prepare(userRequest);
    return json(preparation, 200);
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

function readStringField(value: unknown, field: string): string {
  if (typeof value !== 'object' || value === null) return '';
  const candidate = Reflect.get(value, field);
  return typeof candidate === 'string' ? candidate : '';
}

function errorResponse(error: unknown): Response {
  if (error instanceof LocalRequestRejectedError) {
    return json({ code: error.code, message: error.message }, 403);
  }
  if (error instanceof WorkspaceRuntimeError) {
    const status = error.code === 'INVALID_REQUEST' ? 400 : 422;
    return json({ code: error.code, message: error.message }, status);
  }
  if (error instanceof ContextBuilderValidationError) {
    return json(
      {
        code: error.code,
        message: `${error.message} ${error.issues
          .map(({ path, message }) => `${path}: ${message}`)
          .join('; ')}`,
        issues: error.issues,
      },
      422,
    );
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
