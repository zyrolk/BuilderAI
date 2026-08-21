import { digestStructured } from '../../../core/workflow-ledger/services/workflow-digest.service';
import {
  TOOL_STRUCTURED_MAX_CHARS,
  TOOL_SUMMARY_MAX_CHARS,
  type ToolJsonValue,
} from './tool-registry.types';

/** Keys that must never appear in tool results returned to models or persisted step records. */
export const TOOL_RESULT_FORBIDDEN_KEYS = [
  'fileContents',
  'promptPackage',
  'stdoutExcerpt',
  'stderrExcerpt',
  'stdout',
  'stderr',
  'unifiedDiff',
  'screenshotArtifactId',
  'providerResponse',
  'applyAuthorizationToken',
  'changePlan',
  'gate2Review',
  'approved',
  'secret',
  'apikey',
  'apiKey',
  'password',
  'bearerToken',
  'accessToken',
  'csrfToken',
] as const;

const FORBIDDEN_KEY_SET = new Set<string>(
  TOOL_RESULT_FORBIDDEN_KEYS.map((key) => key.toLowerCase()),
);

export function truncateToolSummary(summary: string): string {
  const trimmed = summary.trim();
  if (trimmed.length <= TOOL_SUMMARY_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, TOOL_SUMMARY_MAX_CHARS - 1)}…`;
}

export function sanitizeToolStructured(
  value: ToolJsonValue | undefined,
): ToolJsonValue | undefined {
  if (value === undefined) return undefined;
  const sanitized = sanitizeValue(value, 0);
  const serialized = JSON.stringify(sanitized);
  if (serialized === undefined) return undefined;
  if (serialized.length <= TOOL_STRUCTURED_MAX_CHARS) {
    return sanitized as ToolJsonValue;
  }
  return {
    truncated: true,
    preview: `${serialized.slice(0, TOOL_STRUCTURED_MAX_CHARS - 1)}…`,
  };
}

export function assertNoForbiddenToolResultPayload(result: unknown): void {
  const serialized = JSON.stringify(result);
  for (const key of TOOL_RESULT_FORBIDDEN_KEYS) {
    if (serialized.includes(`"${key}"`)) {
      throw new Error(`ToolResult must not include ${key}.`);
    }
  }
}

export function digestToolStructured(value: ToolJsonValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  return digestStructured(value);
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > 8) return '[truncated-depth]';
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return value.length > 4_000 ? `${value.slice(0, 3_999)}…` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((entry) => sanitizeValue(entry, depth + 1));
  }
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEY_SET.has(key.toLowerCase())) continue;
      output[key] = sanitizeValue(entry, depth + 1);
    }
    return output;
  }
  return null;
}
