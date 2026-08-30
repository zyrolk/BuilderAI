/**
 * ADR-052 — extract bounded structured failure diagnostics (P1-E Slice 1).
 * Parses already-captured bounded verification text — no new execution path.
 */

import { isControlledTerminalCommandId } from '../controlled-terminal/controlled-terminal.types';
import type { ControlledTerminalRunResult } from '../controlled-terminal/controlled-terminal.types';
import type { WorkspacePathProtectionPolicy } from '../../../core/target-project/workspace-path-protection';
import type {
  BoundedFailureDiagnostic,
  ExtractBoundedFailureDiagnosticsInput,
  FailureDiagnosticDraft,
} from './bounded-failure-diagnostic.types';
import { buildBoundedFailureDiagnostic } from './bounded-failure-diagnostic.validation';
import { MAX_FAILURE_DIAGNOSTICS_PER_INVOCATION } from './failure-diagnostic.constants';
import { resolveFailureDiagnosticParser } from './failure-diagnostic-registry';

export function extractBoundedFailureDiagnostics(
  input: ExtractBoundedFailureDiagnosticsInput & {
    readonly pathProtection?: WorkspacePathProtectionPolicy;
  },
): readonly BoundedFailureDiagnostic[] {
  try {
    if (!isControlledTerminalCommandId(input.commandId)) return [];
    if (input.executionStatus !== undefined && input.executionStatus !== 'FAILED') {
      return [];
    }
    const parser = resolveFailureDiagnosticParser(input.commandId);
    if (parser === undefined) return [];
    const text = input.diagnosticText;
    if (typeof text !== 'string' || text.trim().length === 0) return [];

    const drafts = parser({ text, commandId: input.commandId });
    return finalizeFailureDiagnostics({
      drafts,
      projectRoot: input.projectRoot,
      pathProtection: input.pathProtection,
    });
  } catch {
    return [];
  }
}

export function extractBoundedFailureDiagnosticsFromTerminalResult(input: {
  readonly result: ControlledTerminalRunResult;
  readonly projectRoot: string;
  readonly pathProtection?: WorkspacePathProtectionPolicy;
}): readonly BoundedFailureDiagnostic[] {
  if (!isControlledTerminalCommandId(input.result.commandId)) return [];
  return extractBoundedFailureDiagnostics({
    commandId: input.result.commandId,
    projectRoot: input.projectRoot,
    diagnosticText: input.result.diagnosticSummary,
    executionStatus: input.result.executionStatus,
    pathProtection: input.pathProtection,
  });
}

function finalizeFailureDiagnostics(input: {
  readonly drafts: readonly FailureDiagnosticDraft[];
  readonly projectRoot: string;
  readonly pathProtection?: WorkspacePathProtectionPolicy;
}): readonly BoundedFailureDiagnostic[] {
  const results: BoundedFailureDiagnostic[] = [];
  const seen = new Set<string>();

  for (const draft of input.drafts) {
    if (results.length >= MAX_FAILURE_DIAGNOSTICS_PER_INVOCATION) break;
    const diagnostic = buildBoundedFailureDiagnostic({
      draft,
      projectRoot: input.projectRoot,
      pathProtection: input.pathProtection,
    });
    if (diagnostic === undefined) continue;
    const key = dedupeKey(diagnostic);
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(diagnostic);
  }

  return results;
}

function dedupeKey(diagnostic: BoundedFailureDiagnostic): string {
  return [
    diagnostic.source,
    diagnostic.commandId,
    diagnostic.relativePath ?? '',
    diagnostic.line ?? '',
    diagnostic.column ?? '',
    diagnostic.code ?? '',
    diagnostic.severity,
  ].join('\u001f');
}
