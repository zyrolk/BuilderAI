import { normalizeProjectPath } from '../../../core/context-builder/internal/path';
import { ITERATION_FEEDBACK_LIMITS } from '../iteration-feedback.types';
import type { AgentRunPhase } from '../agent-operating/agent-run.types';
import type { ToolJsonValue } from '../tool-registry/tool-registry.types';
import {
  OPERATOR_TOOL_PLANNING_PROJECTION_SCHEMA_VERSION,
  type AgentLoopTurnStatus,
  type OperatorToolPlanningProjection,
} from './agent-loop.types';

/** ADR-047 Slice 2: operator B1/B2 investigation tools only. */
export const OPERATOR_PLANNING_PROJECTION_TOOL_IDS = [
  'search_repository',
  'inspect_readiness',
  'retrieve_relevant_context',
  'find_related_files',
  'inspect_file_outline',
  'inspect_imports',
] as const;

export type OperatorPlanningProjectionToolId =
  (typeof OPERATOR_PLANNING_PROJECTION_TOOL_IDS)[number];

/** Conservative per-record serialized cap (ADR-047). */
export const OPERATOR_PLANNING_PROJECTION_MAX_SERIALIZED_CHARS = 2_048 as const;

const READINESS_STATUS_MAX_CHARS = 32;
const MAX_NUMERIC = 1_000_000;

export interface ExtractOperatorToolPlanningProjectionInput {
  readonly runId: string;
  readonly toolId: string;
  readonly intentId: string;
  readonly phase: AgentRunPhase;
  readonly status: AgentLoopTurnStatus;
  readonly recordedAt: string;
  readonly summaryDigest: string;
  readonly structured: ToolJsonValue | undefined;
}

export function isOperatorPlanningProjectionToolId(
  toolId: string,
): toolId is OperatorPlanningProjectionToolId {
  return (OPERATOR_PLANNING_PROJECTION_TOOL_IDS as readonly string[]).includes(toolId);
}

/**
 * Extract bounded planning projection from post-sanitizer structured tool output.
 * Returns undefined when extraction fails or tool is out of scope — never throws.
 */
export function extractOperatorToolPlanningProjection(
  input: ExtractOperatorToolPlanningProjectionInput,
): OperatorToolPlanningProjection | undefined {
  if (input.status !== 'SUCCEEDED' && input.status !== 'REPLAYED') return undefined;
  if (!isOperatorPlanningProjectionToolId(input.toolId)) return undefined;
  if (input.structured === undefined || typeof input.structured !== 'object') return undefined;
  if (Array.isArray(input.structured)) return undefined;

  const record = input.structured as Record<string, unknown>;
  const extracted = extractFieldsForTool(input.toolId, record);
  if (extracted === undefined) return undefined;

  const projection: OperatorToolPlanningProjection = {
    projectionSchemaVersion: OPERATOR_TOOL_PLANNING_PROJECTION_SCHEMA_VERSION,
    sourceRunId: input.runId,
    toolId: input.toolId,
    intentId: input.intentId,
    phase: input.phase,
    status: input.status,
    recordedAt: input.recordedAt,
    provenance: 'OPERATOR_TOOL_TURN',
    summaryDigest: input.summaryDigest,
    ...extracted,
  };

  if (!validateProjectionForPersistence(projection)) return undefined;
  return projection;
}

function extractFieldsForTool(
  toolId: OperatorPlanningProjectionToolId,
  structured: Record<string, unknown>,
):
  | Partial<
      Pick<
        OperatorToolPlanningProjection,
        | 'pathHints'
        | 'existingPathHints'
        | 'candidatePathHints'
        | 'searchHitCount'
        | 'relevantFileCount'
        | 'readinessStatus'
        | 'truncated'
      >
    >
  | undefined {
  switch (toolId) {
    case 'search_repository':
      return extractSearchRepository(structured);
    case 'inspect_readiness':
      return extractInspectReadiness(structured);
    case 'retrieve_relevant_context':
      return extractRetrieveRelevantContext(structured);
    case 'find_related_files':
      return extractFindRelatedFiles(structured);
    case 'inspect_file_outline':
      return extractInspectFileOutline(structured);
    case 'inspect_imports':
      return extractInspectImports(structured);
    default:
      return undefined;
  }
}

function extractSearchRepository(
  structured: Record<string, unknown>,
): Partial<OperatorToolPlanningProjection> {
  const matches = asObjectArray(structured.matches);
  const paths = capPaths(
    matches
      .map((match) => readString(match, 'logicalPath'))
      .filter((path): path is string => path !== undefined),
  );
  const matchCount = boundedNumber(structured.matchCount) ?? paths.length;
  return {
    pathHints: paths,
    searchHitCount: matchCount,
    ...(typeof structured.truncated === 'boolean' ? { truncated: structured.truncated } : {}),
  };
}

function extractInspectReadiness(
  structured: Record<string, unknown>,
): Partial<OperatorToolPlanningProjection> {
  const status = readBoundedString(structured.status, READINESS_STATUS_MAX_CHARS);
  const indexed = boundedNumber(structured.indexedFileCount);
  return {
    ...(status === undefined ? {} : { readinessStatus: status }),
    ...(indexed === undefined ? {} : { relevantFileCount: indexed }),
  };
}

function extractRetrieveRelevantContext(
  structured: Record<string, unknown>,
): Partial<OperatorToolPlanningProjection> {
  const files = asObjectArray(structured.files);
  const paths = capPaths(
    files
      .map((file) => readString(file, 'logicalPath'))
      .filter((path): path is string => path !== undefined),
  );
  return {
    pathHints: paths,
    relevantFileCount: files.length,
    ...(typeof structured.truncated === 'boolean' ? { truncated: structured.truncated } : {}),
  };
}

function extractFindRelatedFiles(
  structured: Record<string, unknown>,
): Partial<OperatorToolPlanningProjection> {
  const anchor = readNormalizedPath(structured.anchorPath);
  const related = asObjectArray(structured.related);
  const relatedPaths = capPaths(
    related
      .map((entry) => readString(entry, 'logicalPath'))
      .filter((path): path is string => path !== undefined),
  );
  const pathHints = capPaths(anchor === undefined ? relatedPaths : [anchor, ...relatedPaths]);
  return {
    pathHints,
    ...(anchor === undefined ? {} : { existingPathHints: [anchor] }),
    ...(typeof structured.truncated === 'boolean' ? { truncated: structured.truncated } : {}),
  };
}

function extractInspectFileOutline(
  structured: Record<string, unknown>,
): Partial<OperatorToolPlanningProjection> {
  const logicalPath = readNormalizedPath(structured.logicalPath);
  if (logicalPath === undefined) return {};
  return {
    pathHints: [logicalPath],
    existingPathHints: [logicalPath],
    ...(typeof structured.truncated === 'boolean' ? { truncated: structured.truncated } : {}),
  };
}

function extractInspectImports(
  structured: Record<string, unknown>,
): Partial<OperatorToolPlanningProjection> {
  const fromPath = readNormalizedPath(structured.fromPath);
  const imports = asObjectArray(structured.imports);
  const existing: string[] = [];
  const candidates: string[] = [];
  for (const entry of imports) {
    const resolved = readNormalizedPath(entry.resolvedPath);
    if (resolved !== undefined) {
      existing.push(resolved);
      continue;
    }
    const specifier = readString(entry, 'specifier');
    if (specifier !== undefined && entry.relative === true) {
      candidates.push(specifier);
    }
  }
  const pathHints = capPaths([
    ...(fromPath === undefined ? [] : [fromPath]),
    ...existing,
    ...candidates,
  ]);
  return {
    pathHints,
    ...(fromPath === undefined ? {} : { existingPathHints: capPaths([fromPath, ...existing]) }),
    ...(candidates.length === 0 ? {} : { candidatePathHints: capPaths(candidates) }),
    ...(typeof structured.truncated === 'boolean' ? { truncated: structured.truncated } : {}),
  };
}

export function validateProjectionForPersistence(
  projection: OperatorToolPlanningProjection,
): boolean {
  if (projection.projectionSchemaVersion !== OPERATOR_TOOL_PLANNING_PROJECTION_SCHEMA_VERSION) {
    return false;
  }
  if (projection.provenance !== 'OPERATOR_TOOL_TURN') return false;
  if (projection.summaryDigest.length === 0 || projection.summaryDigest.length > 128) return false;
  if (!isOperatorPlanningProjectionToolId(projection.toolId)) return false;

  const arrays = [
    projection.pathHints,
    projection.existingPathHints,
    projection.candidatePathHints,
  ];
  for (const array of arrays) {
    if (array === undefined) continue;
    if (!Array.isArray(array) || array.length > ITERATION_FEEDBACK_LIMITS.MAX_PATH_HINTS) {
      return false;
    }
    for (const path of array) {
      if (typeof path !== 'string' || normalizePath(path) === undefined) return false;
    }
  }

  if (projection.searchHitCount !== undefined && !isBoundedCount(projection.searchHitCount)) {
    return false;
  }
  if (projection.relevantFileCount !== undefined && !isBoundedCount(projection.relevantFileCount)) {
    return false;
  }
  if (
    projection.readinessStatus !== undefined &&
    projection.readinessStatus.length > READINESS_STATUS_MAX_CHARS
  ) {
    return false;
  }

  const serialized = JSON.stringify(projection);
  if (serialized.length > OPERATOR_PLANNING_PROJECTION_MAX_SERIALIZED_CHARS) return false;

  try {
    assertNoForbiddenProjectionKeys(projection);
  } catch {
    return false;
  }
  return true;
}

export function assertNoForbiddenProjectionKeys(value: unknown): void {
  const forbidden = [
    'stdout',
    'stderr',
    'fileContents',
    'changePlan',
    'applyAuthorizationToken',
    'gate2Review',
    'providerResponse',
    'password',
    'apiKey',
    'secret',
    'preview',
    'content',
    'excerpt',
    'lineText',
    'cookie',
    'cookies',
    'env',
    'cwd',
    'shell',
    'command',
    'argv',
    'approved',
    'operatorApproved',
    'browserObservationApproved',
  ];
  walk(value, (key) => {
    if (forbidden.some((entry) => entry.toLowerCase() === key.toLowerCase())) {
      throw new Error(`Refusing projection key "${key}".`);
    }
  });
}

function walk(value: unknown, onKey: (key: string) => void): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry) => walk(entry, onKey));
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    onKey(key);
    walk(nested, onKey);
  }
}

function capPaths(paths: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const path of paths) {
    const normalized = normalizePath(path);
    if (normalized === undefined || seen.has(normalized)) continue;
    seen.add(normalized);
    ordered.push(normalized);
    if (ordered.length >= ITERATION_FEEDBACK_LIMITS.MAX_PATH_HINTS) break;
  }
  return ordered;
}

function normalizePath(path: string): string | undefined {
  const trimmed = path.trim();
  if (trimmed.length === 0 || trimmed.includes('..') || trimmed.startsWith('/')) return undefined;
  try {
    return normalizeProjectPath(trimmed);
  } catch {
    return undefined;
  }
}

function readNormalizedPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return normalizePath(value);
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function readBoundedString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.slice(0, max);
}

function boundedNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const rounded = Math.trunc(value);
  if (rounded < 0 || rounded > MAX_NUMERIC) return undefined;
  return rounded;
}

function isBoundedCount(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_NUMERIC;
}

function asObjectArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is Record<string, unknown> =>
      entry !== null && typeof entry === 'object' && !Array.isArray(entry),
  );
}
