import {
  ProjectMemoryPersistenceError,
  ProjectMemoryValidationError,
  PROJECT_MEMORY_RECORD_CATEGORIES,
  type ExternalTargetProjectMemory,
  type ProjectMemoryRecordCategory,
} from '../../../../application/workspace/project-memory';
import { WorkspaceRuntimeError } from '../../../../application/workspace';
import {
  assertAuthorizedWorkspaceRequest,
  assertTrustedLocalRequest,
  LocalRequestRejectedError,
  mapWorkspaceRuntimeErrorStatus,
  readBoundedJson,
} from '../../../../infrastructure/workspace';
import {
  getLocalProjectMemory,
  getLocalWorkspaceSecurityConfiguration,
} from '../../../../infrastructure/workspace/local-feature-workflow-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    assertTrustedLocalRequest(request);
    const memory = await readProjectMemoryOrThrow();
    return json(memory, 200);
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertTrustedLocalRequest(request);
    const body = await readBoundedJson(request);
    const security = getLocalWorkspaceSecurityConfiguration();
    assertAuthorizedWorkspaceRequest({
      security,
      request,
      body,
      action: 'MEMORY_WRITE',
    });
    const service = getProjectMemoryServiceOrThrow();
    const category = readCategory(body);
    const memory = await writeMemoryRecord(service, category, body);
    return json(memory, 200);
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

async function writeMemoryRecord(
  service: NonNullable<ReturnType<typeof getLocalProjectMemory>>,
  category: ProjectMemoryRecordCategory,
  body: unknown,
): Promise<ExternalTargetProjectMemory> {
  switch (category) {
    case 'INVESTIGATION':
      return service.saveInvestigationMemory({
        investigationId: readRequiredString(body, 'investigationId'),
        requestSummary: readOptionalString(body, 'requestSummary') ?? '',
        report: {
          summary: readRequiredString(body, 'summary'),
          confidence: readConfidence(body),
          likelyRootCause: readOptionalString(body, 'likelyRootCause'),
          affectedAreas: readStringArray(body, 'affectedAreas'),
          recommendedNextSteps: readStringArray(body, 'recommendedNextSteps'),
          suggestedFixScope: readOptionalString(body, 'suggestedFixScope'),
        },
      });
    case 'DECISION':
    case 'FINDING':
      return service.saveOperatorRecord({
        category,
        summary: readRequiredString(body, 'summary'),
        supportingPaths: readStringArray(body, 'supportingPaths'),
        tags: readStringArray(body, 'tags'),
      });
    default:
      throw new WorkspaceRuntimeError('INVALID_REQUEST', 'Unsupported project memory category.');
  }
}

function getProjectMemoryServiceOrThrow(): NonNullable<ReturnType<typeof getLocalProjectMemory>> {
  const service = getLocalProjectMemory();
  if (service === undefined || !service.isEnabled()) {
    throw new WorkspaceRuntimeError(
      'WORKFLOW_FAILED',
      'Project memory is only available for external target projects.',
    );
  }
  return service;
}

async function readProjectMemoryOrThrow(): Promise<ExternalTargetProjectMemory> {
  const service = getLocalProjectMemory();
  if (service === undefined || !service.isEnabled()) {
    return {
      schemaVersion: 1,
      projectId: 'unavailable',
      updatedAt: new Date(0).toISOString(),
      decisions: [],
      completedWork: [],
      investigations: [],
      findings: [],
    };
  }
  return service.read();
}

function readCategory(body: unknown): ProjectMemoryRecordCategory {
  const category = readRequiredString(body, 'category').toUpperCase();
  if (!PROJECT_MEMORY_RECORD_CATEGORIES.includes(category as ProjectMemoryRecordCategory)) {
    throw new WorkspaceRuntimeError('INVALID_REQUEST', 'Project memory category is invalid.');
  }
  return category as ProjectMemoryRecordCategory;
}

function readRequiredString(body: unknown, field: string): string {
  const value = readOptionalString(body, field);
  if (value === undefined || value.length === 0) {
    throw new WorkspaceRuntimeError('INVALID_REQUEST', `${field} is required.`);
  }
  return value;
}

function readOptionalString(body: unknown, field: string): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const candidate = Reflect.get(body, field);
  return typeof candidate === 'string' ? candidate.trim() : undefined;
}

function readStringArray(body: unknown, field: string): readonly string[] {
  if (typeof body !== 'object' || body === null) return [];
  const candidate = Reflect.get(body, field);
  if (!Array.isArray(candidate)) return [];
  return candidate.filter((entry): entry is string => typeof entry === 'string');
}

function readConfidence(body: unknown): 'LOW' | 'MEDIUM' | 'HIGH' {
  const value = readOptionalString(body, 'confidence')?.toUpperCase();
  if (value === 'MEDIUM' || value === 'HIGH') return value;
  return 'LOW';
}

function json(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

function errorResponse(error: unknown): Response {
  if (error instanceof LocalRequestRejectedError) {
    return json({ code: error.code, message: error.message }, 403);
  }
  if (error instanceof ProjectMemoryValidationError) {
    return json(
      {
        code: 'PROJECT_MEMORY_VALIDATION_FAILED',
        message: error.message,
        issues: error.issues,
      },
      422,
    );
  }
  if (error instanceof ProjectMemoryPersistenceError) {
    return json({ code: error.code, message: error.message }, 409);
  }
  if (error instanceof WorkspaceRuntimeError) {
    const mappedStatus = mapWorkspaceRuntimeErrorStatus(error);
    return json({ code: error.code, message: error.message }, mappedStatus ?? 409);
  }
  return json(
    { code: 'WORKFLOW_FAILED', message: 'Project memory request could not be completed.' },
    500,
  );
}
