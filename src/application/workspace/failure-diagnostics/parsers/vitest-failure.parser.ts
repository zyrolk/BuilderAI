/**
 * ADR-052 — Vitest/test failure diagnostic parser (P1-E Slice 1).
 * Narrow support only — ambiguous stack frames are ignored.
 */

import type {
  BoundedFailureDiagnosticSource,
  FailureDiagnosticDraft,
} from '../bounded-failure-diagnostic.types';
import type { ControlledTerminalCommandId } from '../../controlled-terminal/controlled-terminal.types';

const VITEST_SOURCE: BoundedFailureDiagnosticSource = 'VITEST';

/** Vitest stack pointer: optional fn name then path:line:col */
const VITEST_STACK_POINTER_PATTERN = /^\s*(?:❯|at)\s+(?:\S+\s+)?(\S+):(\d+):(\d+)\s*$/iu;

/** Direct file:line:col at line start (test files only). */
const VITEST_DIRECT_LOCATION_PATTERN = /^(\S+\.(?:test|spec)\.(?:[cm]?[jt]sx?)):(\d+):(\d+)\s*$/iu;

export function parseVitestFailureDiagnostics(input: {
  readonly text: string;
  readonly commandId: ControlledTerminalCommandId;
}): readonly FailureDiagnosticDraft[] {
  const drafts: FailureDiagnosticDraft[] = [];
  for (const line of input.text.split('\n')) {
    const trimmed = line.trimEnd();
    if (trimmed.length === 0) continue;

    const stack = VITEST_STACK_POINTER_PATTERN.exec(trimmed);
    if (stack !== null) {
      const [, rawPath, lineText, columnText] = stack;
      if (rawPath === undefined || lineText === undefined || columnText === undefined) continue;
      if (!looksLikeSourceFile(rawPath)) continue;
      drafts.push({
        source: VITEST_SOURCE,
        commandId: input.commandId,
        severity: 'ERROR',
        relativePath: rawPath,
        line: Number.parseInt(lineText, 10),
        column: Number.parseInt(columnText, 10),
      });
      continue;
    }

    const direct = VITEST_DIRECT_LOCATION_PATTERN.exec(trimmed);
    if (direct !== null) {
      const [, rawPath, lineText, columnText] = direct;
      if (rawPath === undefined || lineText === undefined || columnText === undefined) continue;
      drafts.push({
        source: VITEST_SOURCE,
        commandId: input.commandId,
        severity: 'ERROR',
        relativePath: rawPath,
        line: Number.parseInt(lineText, 10),
        column: Number.parseInt(columnText, 10),
      });
    }
  }
  return drafts;
}

function looksLikeSourceFile(value: string): boolean {
  return /\.(?:[cm]?[jt]sx?)$/iu.test(value);
}
