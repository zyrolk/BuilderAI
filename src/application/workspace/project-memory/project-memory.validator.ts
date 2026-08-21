import type { WorkspacePathProtectionPolicy } from '../../../core/target-project/workspace-path-protection';
import { DEFAULT_WORKSPACE_PATH_PROTECTION } from '../../../core/target-project/workspace-path-protection';
import { INVESTIGATION_CONFIDENCE_LEVELS } from '../investigation/investigation.types';
import {
  DEFAULT_PROJECT_MEMORY_CONFIGURATION,
  type ProjectMemoryConfiguration,
} from './project-memory-configuration';
import {
  sanitizeMemoryPaths,
  sanitizeMemorySummary,
  sanitizeMemoryTags,
} from './project-memory-sanitize';
import {
  PROJECT_MEMORY_RECORD_CATEGORIES,
  PROJECT_MEMORY_RECORD_STATUSES,
  PROJECT_MEMORY_SOURCES,
  ProjectMemoryValidationError,
  type ExternalTargetProjectMemory,
  type ProjectMemoryCompletedWork,
  type ProjectMemoryDecision,
  type ProjectMemoryFinding,
  type ProjectMemoryInvestigation,
  type ProjectMemoryRecord,
  type ProjectMemoryRecordCategory,
} from './project-memory.types';

const ID_PATTERN = /^[a-z0-9-]{8,128}$/iu;

export function normalizeProjectMemoryDocument(
  value: unknown,
  expectedProjectId: string,
  pathProtection: WorkspacePathProtectionPolicy = DEFAULT_WORKSPACE_PATH_PROTECTION,
): ExternalTargetProjectMemory {
  if (typeof value !== 'object' || value === null) {
    throw new ProjectMemoryValidationError([
      { path: 'root', message: 'Project memory must be an object.' },
    ]);
  }
  const schemaVersion = readNumberField(value, 'schemaVersion');
  if (schemaVersion !== 1) {
    throw new ProjectMemoryValidationError([
      { path: 'schemaVersion', message: 'Unsupported project memory schema version.' },
    ]);
  }
  const projectId = readStringField(value, 'projectId');
  if (projectId.length === 0) {
    throw new ProjectMemoryValidationError([
      { path: 'projectId', message: 'Project memory projectId is required.' },
    ]);
  }
  if (projectId !== expectedProjectId) {
    throw new ProjectMemoryValidationError([
      {
        path: 'projectId',
        message: `Project memory projectId "${projectId}" does not match "${expectedProjectId}".`,
      },
    ]);
  }
  const updatedAt = readIsoTimestamp(value, 'updatedAt') ?? new Date(0).toISOString();
  return {
    schemaVersion: 1,
    projectId,
    updatedAt,
    decisions: readCategoryRecords(value, 'decisions', 'DECISION', pathProtection),
    completedWork: readCategoryRecords(value, 'completedWork', 'COMPLETED_WORK', pathProtection),
    investigations: readCategoryRecords(value, 'investigations', 'INVESTIGATION', pathProtection),
    findings: readCategoryRecords(value, 'findings', 'FINDING', pathProtection),
  };
}

export function validateProjectMemoryRecordInput(
  input: unknown,
  category: ProjectMemoryRecordCategory,
  configuration: ProjectMemoryConfiguration = DEFAULT_PROJECT_MEMORY_CONFIGURATION,
  pathProtection: WorkspacePathProtectionPolicy = DEFAULT_WORKSPACE_PATH_PROTECTION,
): ProjectMemoryRecord {
  if (typeof input !== 'object' || input === null) {
    throw new ProjectMemoryValidationError([
      { path: 'record', message: 'Project memory record must be an object.' },
    ]);
  }
  const summary = sanitizeMemorySummary(
    readStringField(input, 'summary'),
    configuration.maximumSummaryCharacters,
  );
  if (summary.length === 0) {
    throw new ProjectMemoryValidationError([
      { path: 'summary', message: 'Project memory summary is required.' },
    ]);
  }
  const supportingPaths = sanitizeMemoryPaths(
    readStringArray(input, 'supportingPaths'),
    configuration.maximumSupportingPathsPerRecord,
    pathProtection,
  );
  const tags = sanitizeMemoryTags(
    readOptionalStringArray(input, 'tags'),
    configuration.maximumTagsPerRecord,
    configuration.maximumTagCharacters,
  );
  const source = readSource(input);
  const status = readOptionalStatus(input);
  const now = new Date().toISOString();
  const id = readOptionalId(input) ?? createDeterministicFallbackId(category, summary, now);
  if (!ID_PATTERN.test(id)) {
    throw new ProjectMemoryValidationError([
      { path: 'id', message: 'Project memory record id is invalid.' },
    ]);
  }
  const base = {
    id,
    createdAt: readIsoTimestamp(input, 'createdAt') ?? now,
    updatedAt: now,
    summary,
    supportingPaths,
    source,
    ...(tags.length === 0 ? {} : { tags }),
    ...(status === undefined ? {} : { status }),
  };

  switch (category) {
    case 'DECISION':
      return { ...base, category: 'DECISION' } satisfies ProjectMemoryDecision;
    case 'FINDING':
      return { ...base, category: 'FINDING' } satisfies ProjectMemoryFinding;
    case 'COMPLETED_WORK': {
      const preparationId = readOptionalString(input, 'preparationId');
      const verificationStatus =
        readOptionalString(input, 'verificationStatus') === 'PASSED' ? 'PASSED' : undefined;
      const workflowId = readOptionalString(input, 'workflowId');
      const changePlanDigest = readOptionalString(input, 'changePlanDigest');
      const verificationSummary = readOptionalString(input, 'verificationSummary');
      const correctionSummary = readOptionalString(input, 'correctionSummary');
      const completedAt = readOptionalString(input, 'completedAt');
      return {
        ...base,
        category: 'COMPLETED_WORK',
        ...(preparationId === undefined ? {} : { preparationId }),
        ...(verificationStatus === undefined ? {} : { verificationStatus }),
        ...(workflowId === undefined ? {} : { workflowId }),
        ...(changePlanDigest === undefined ? {} : { changePlanDigest }),
        ...(verificationSummary === undefined ? {} : { verificationSummary }),
        ...(correctionSummary === undefined ? {} : { correctionSummary }),
        ...(completedAt === undefined ? {} : { completedAt }),
      } satisfies ProjectMemoryCompletedWork;
    }
    case 'INVESTIGATION': {
      const investigationId = readStringField(input, 'investigationId');
      if (investigationId.length === 0) {
        throw new ProjectMemoryValidationError([
          { path: 'investigationId', message: 'Investigation id is required.' },
        ]);
      }
      const confidence = readConfidence(input);
      const likelyRootCause = readOptionalBoundedText(
        input,
        'likelyRootCause',
        configuration.maximumSummaryCharacters,
      );
      const affectedAreas = sanitizeMemoryPaths(
        readStringArray(input, 'affectedAreas'),
        configuration.maximumSupportingPathsPerRecord,
        pathProtection,
      );
      const recommendedNextStepSummary = readOptionalBoundedText(
        input,
        'recommendedNextStepSummary',
        configuration.maximumSummaryCharacters,
      );
      return {
        ...base,
        category: 'INVESTIGATION',
        investigationId,
        confidence,
        affectedAreas,
        ...(likelyRootCause === undefined ? {} : { likelyRootCause }),
        ...(recommendedNextStepSummary === undefined ? {} : { recommendedNextStepSummary }),
      } satisfies ProjectMemoryInvestigation;
    }
    default:
      throw new ProjectMemoryValidationError([
        { path: 'category', message: 'Unsupported project memory category.' },
      ]);
  }
}

export function pruneProjectMemory(
  memory: ExternalTargetProjectMemory,
  configuration: ProjectMemoryConfiguration = DEFAULT_PROJECT_MEMORY_CONFIGURATION,
): ExternalTargetProjectMemory {
  return {
    ...memory,
    decisions: pruneRecords(memory.decisions, configuration.maximumDecisions),
    completedWork: pruneRecords(memory.completedWork, configuration.maximumCompletedWork),
    investigations: pruneRecords(memory.investigations, configuration.maximumInvestigations),
    findings: pruneRecords(memory.findings, configuration.maximumFindings),
  };
}

function pruneRecords<T extends ProjectMemoryRecord>(records: readonly T[], maximum: number): T[] {
  const sorted = [...records].sort((left, right) => {
    const byUpdated = right.updatedAt.localeCompare(left.updatedAt);
    if (byUpdated !== 0) return byUpdated;
    return right.id.localeCompare(left.id);
  });
  return sorted.slice(0, maximum);
}

function readCategoryRecords<T extends ProjectMemoryRecord>(
  value: object,
  field: string,
  category: ProjectMemoryRecordCategory,
  pathProtection: WorkspacePathProtectionPolicy = DEFAULT_WORKSPACE_PATH_PROTECTION,
): readonly T[] {
  const entries = Reflect.get(value, field);
  if (!Array.isArray(entries)) return [];
  const records: T[] = [];
  for (const [index, entry] of entries.entries()) {
    try {
      const record = validateProjectMemoryRecordInput(
        entry,
        category,
        DEFAULT_PROJECT_MEMORY_CONFIGURATION,
        pathProtection,
      );
      if (record.category !== category) continue;
      records.push(record as T);
    } catch {
      continue;
    }
    if (records.length > DEFAULT_PROJECT_MEMORY_CONFIGURATION.maximumDecisions) break;
    if (index > 512) break;
  }
  return records;
}

function readStringField(value: object, field: string): string {
  const candidate = Reflect.get(value, field);
  return typeof candidate === 'string' ? candidate.trim() : '';
}

function readOptionalString(value: object, field: string): string | undefined {
  const candidate = readStringField(value, field);
  return candidate.length === 0 ? undefined : candidate;
}

function readNumberField(value: object, field: string): number | undefined {
  const candidate = Reflect.get(value, field);
  return typeof candidate === 'number' ? candidate : undefined;
}

function readStringArray(value: object, field: string): readonly string[] {
  const candidate = Reflect.get(value, field);
  if (!Array.isArray(candidate)) return [];
  return candidate.filter((entry): entry is string => typeof entry === 'string');
}

function readOptionalStringArray(value: object, field: string): readonly string[] | undefined {
  const values = readStringArray(value, field);
  return values.length === 0 ? undefined : values;
}

function readOptionalId(value: object): string | undefined {
  const id = readStringField(value, 'id');
  return id.length === 0 ? undefined : id;
}

function readIsoTimestamp(value: object, field: string): string | undefined {
  const candidate = readStringField(value, field);
  if (candidate.length === 0) return undefined;
  const parsed = Date.parse(candidate);
  if (Number.isNaN(parsed)) return undefined;
  return new Date(parsed).toISOString();
}

function readSource(value: object): (typeof PROJECT_MEMORY_SOURCES)[number] {
  const candidate = readStringField(value, 'source');
  return PROJECT_MEMORY_SOURCES.includes(candidate as (typeof PROJECT_MEMORY_SOURCES)[number])
    ? (candidate as (typeof PROJECT_MEMORY_SOURCES)[number])
    : 'OPERATOR';
}

function readOptionalStatus(
  value: object,
): (typeof PROJECT_MEMORY_RECORD_STATUSES)[number] | undefined {
  const candidate = readStringField(value, 'status');
  return PROJECT_MEMORY_RECORD_STATUSES.includes(
    candidate as (typeof PROJECT_MEMORY_RECORD_STATUSES)[number],
  )
    ? (candidate as (typeof PROJECT_MEMORY_RECORD_STATUSES)[number])
    : undefined;
}

function readConfidence(value: object): (typeof INVESTIGATION_CONFIDENCE_LEVELS)[number] {
  const candidate = readStringField(value, 'confidence').toUpperCase();
  return INVESTIGATION_CONFIDENCE_LEVELS.includes(
    candidate as (typeof INVESTIGATION_CONFIDENCE_LEVELS)[number],
  )
    ? (candidate as (typeof INVESTIGATION_CONFIDENCE_LEVELS)[number])
    : 'LOW';
}

function readOptionalBoundedText(
  value: object,
  field: string,
  maximumCharacters: number,
): string | undefined {
  const candidate = readStringField(value, field);
  if (candidate.length === 0) return undefined;
  return sanitizeMemorySummary(candidate, maximumCharacters);
}

function createDeterministicFallbackId(
  category: ProjectMemoryRecordCategory,
  summary: string,
  timestamp: string,
): string {
  const slug = summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48);
  return `${category.toLowerCase()}-${slug || 'record'}-${timestamp.slice(0, 19).replace(/[:T]/gu, '')}`;
}

export function listAllProjectMemoryRecords(
  memory: ExternalTargetProjectMemory,
): readonly ProjectMemoryRecord[] {
  return [
    ...memory.decisions,
    ...memory.completedWork,
    ...memory.investigations,
    ...memory.findings,
  ];
}

export { PROJECT_MEMORY_RECORD_CATEGORIES };
