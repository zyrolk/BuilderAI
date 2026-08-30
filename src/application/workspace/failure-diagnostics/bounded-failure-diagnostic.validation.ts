/**
 * ADR-052 — runtime validation for BoundedFailureDiagnostic.
 */

import type { WorkspacePathProtectionPolicy } from '../../../core/target-project/workspace-path-protection';
import { isControlledTerminalCommandId } from '../controlled-terminal/controlled-terminal.types';
import {
  BOUNDED_FAILURE_DIAGNOSTIC_SCHEMA_VERSION,
  MAX_FAILURE_DIAGNOSTIC_SERIALIZED_CHARS,
} from './failure-diagnostic.constants';
import {
  BOUNDED_FAILURE_DIAGNOSTIC_SEVERITIES,
  BOUNDED_FAILURE_DIAGNOSTIC_SOURCES,
  type BoundedFailureDiagnostic,
  type BoundedFailureDiagnosticSeverity,
  type BoundedFailureDiagnosticSource,
  type FailureDiagnosticDraft,
} from './bounded-failure-diagnostic.types';
import { normalizeFailureDiagnosticCode } from './diagnostic-code';
import {
  normalizeFailureDiagnosticColumn,
  normalizeFailureDiagnosticLine,
} from './diagnostic-location';
import { normalizeFailureDiagnosticMessage } from './diagnostic-message';
import { normalizeFailureDiagnosticRelativePath } from './diagnostic-path-normalization';

const FORBIDDEN_DIAGNOSTIC_KEYS = [
  'stdout',
  'stderr',
  'diagnosticSummary',
  'stack',
  'stackTrace',
  'rawOutput',
  'output',
  'environment',
  'token',
  'secret',
  'fullLog',
  'instructions',
  'approved',
  'operatorApproved',
  'applyAuthorizationToken',
  'changePlan',
  'gate2Review',
  'toolCalling',
  'fileContents',
  'content',
  'excerpt',
  'env',
  'cwd',
  'shell',
  'command',
  'argv',
  'providerResponse',
  'password',
  'apiKey',
  'cookie',
  'cookies',
  'url',
  'urls',
] as const;

export function assertNoForbiddenFailureDiagnosticKeys(value: unknown): void {
  walk(value, (key) => {
    if (FORBIDDEN_DIAGNOSTIC_KEYS.some((entry) => entry.toLowerCase() === key.toLowerCase())) {
      throw new Error(`Refusing failure diagnostic key "${key}".`);
    }
  });
}

export function validateBoundedFailureDiagnostic(diagnostic: BoundedFailureDiagnostic): boolean {
  if (diagnostic.schemaVersion !== BOUNDED_FAILURE_DIAGNOSTIC_SCHEMA_VERSION) return false;
  if (!isBoundedFailureDiagnosticSource(diagnostic.source)) return false;
  if (!isControlledTerminalCommandId(diagnostic.commandId)) return false;
  if (!isBoundedFailureDiagnosticSeverity(diagnostic.severity)) return false;

  if (
    diagnostic.code !== undefined &&
    normalizeFailureDiagnosticCode(diagnostic.code) === undefined
  ) {
    return false;
  }
  if (
    diagnostic.relativePath !== undefined &&
    (typeof diagnostic.relativePath !== 'string' ||
      diagnostic.relativePath.length === 0 ||
      diagnostic.relativePath.length > 512)
  ) {
    return false;
  }
  if (
    diagnostic.line !== undefined &&
    normalizeFailureDiagnosticLine(diagnostic.line) === undefined
  ) {
    return false;
  }
  if (
    diagnostic.column !== undefined &&
    normalizeFailureDiagnosticColumn(diagnostic.column) === undefined
  ) {
    return false;
  }
  if (
    diagnostic.boundedMessage !== undefined &&
    normalizeFailureDiagnosticMessage(diagnostic.boundedMessage) === undefined
  ) {
    return false;
  }

  const hasLocation =
    diagnostic.relativePath !== undefined ||
    diagnostic.line !== undefined ||
    diagnostic.column !== undefined;
  const hasCode = diagnostic.code !== undefined;
  const hasMessage = diagnostic.boundedMessage !== undefined;
  if (!hasLocation && !hasCode && !hasMessage) return false;

  try {
    assertNoForbiddenFailureDiagnosticKeys(diagnostic);
  } catch {
    return false;
  }

  const serialized = JSON.stringify(diagnostic);
  return serialized.length <= MAX_FAILURE_DIAGNOSTIC_SERIALIZED_CHARS;
}

export function buildBoundedFailureDiagnostic(input: {
  readonly draft: FailureDiagnosticDraft;
  readonly projectRoot: string;
  readonly pathProtection?: WorkspacePathProtectionPolicy;
}): BoundedFailureDiagnostic | undefined {
  const relativePath =
    input.draft.relativePath === undefined
      ? undefined
      : normalizeFailureDiagnosticRelativePath({
          rawPath: input.draft.relativePath,
          projectRoot: input.projectRoot,
          pathProtection: input.pathProtection,
        });

  const line =
    input.draft.line === undefined ? undefined : normalizeFailureDiagnosticLine(input.draft.line);
  const column =
    input.draft.column === undefined
      ? undefined
      : normalizeFailureDiagnosticColumn(input.draft.column);
  const code =
    input.draft.code === undefined ? undefined : normalizeFailureDiagnosticCode(input.draft.code);
  const boundedMessage =
    input.draft.boundedMessage === undefined
      ? undefined
      : normalizeFailureDiagnosticMessage(input.draft.boundedMessage);

  if (input.draft.line !== undefined && line === undefined) {
    return undefined;
  }
  if (input.draft.column !== undefined && column === undefined) {
    return undefined;
  }

  if ((line !== undefined || column !== undefined) && relativePath === undefined) {
    return undefined;
  }

  if (
    relativePath === undefined &&
    line === undefined &&
    column === undefined &&
    code === undefined
  ) {
    return undefined;
  }

  const diagnostic: BoundedFailureDiagnostic = {
    schemaVersion: BOUNDED_FAILURE_DIAGNOSTIC_SCHEMA_VERSION,
    source: input.draft.source,
    commandId: input.draft.commandId,
    severity: input.draft.severity,
    ...(code === undefined ? {} : { code }),
    ...(relativePath === undefined ? {} : { relativePath }),
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column }),
    ...(boundedMessage === undefined ? {} : { boundedMessage }),
  };

  return validateBoundedFailureDiagnostic(diagnostic) ? diagnostic : undefined;
}

function isBoundedFailureDiagnosticSource(value: unknown): value is BoundedFailureDiagnosticSource {
  return (
    typeof value === 'string' &&
    (BOUNDED_FAILURE_DIAGNOSTIC_SOURCES as readonly string[]).includes(value)
  );
}

function isBoundedFailureDiagnosticSeverity(
  value: unknown,
): value is BoundedFailureDiagnosticSeverity {
  return (
    typeof value === 'string' &&
    (BOUNDED_FAILURE_DIAGNOSTIC_SEVERITIES as readonly string[]).includes(value)
  );
}

function walk(value: unknown, onKey: (key: string) => void): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, onKey);
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    onKey(key);
    walk(nested, onKey);
  }
}
