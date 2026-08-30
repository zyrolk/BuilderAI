/**
 * ADR-052 — ESLint failure diagnostic parser (P1-E Slice 1).
 */

import type {
  BoundedFailureDiagnosticSource,
  FailureDiagnosticDraft,
} from '../bounded-failure-diagnostic.types';
import type { ControlledTerminalCommandId } from '../../controlled-terminal/controlled-terminal.types';

const ESLINT_SOURCE: BoundedFailureDiagnosticSource = 'ESLINT';

/** Compact unix-like: file:line:col: error: message (rule) */
const ESLINT_COMPACT_PATTERN =
  /^([^:]+):(\d+):(\d+):\s*(error|warning):\s*(.*?)(?:\s+\(([^)]+)\))?\s*$/iu;

/** Stylish indented: line:col  severity  message  rule */
const ESLINT_STYLISH_LINE_PATTERN =
  /^\s*(\d+):(\d+)\s+(error|warning)\s+(.+?)(?:\s{2,}([\w@/-]+))?\s*$/iu;

export function parseEslintFailureDiagnostics(input: {
  readonly text: string;
  readonly commandId: ControlledTerminalCommandId;
}): readonly FailureDiagnosticDraft[] {
  const drafts: FailureDiagnosticDraft[] = [];
  let pendingPath: string | undefined;

  for (const line of input.text.split('\n')) {
    const trimmed = line.trimEnd();
    if (trimmed.length === 0) {
      pendingPath = undefined;
      continue;
    }

    const compact = ESLINT_COMPACT_PATTERN.exec(trimmed);
    if (compact !== null) {
      const [, rawPath, lineText, columnText, severityText, message, rule] = compact;
      if (rawPath === undefined || lineText === undefined || columnText === undefined) continue;
      drafts.push(
        buildEslintDraft({
          commandId: input.commandId,
          rawPath,
          line: Number.parseInt(lineText, 10),
          column: Number.parseInt(columnText, 10),
          severityText,
          message,
          rule,
        }),
      );
      continue;
    }

    const stylish = ESLINT_STYLISH_LINE_PATTERN.exec(trimmed);
    if (stylish !== null && pendingPath !== undefined) {
      const [, lineText, columnText, severityText, message, rule] = stylish;
      if (lineText === undefined || columnText === undefined) continue;
      drafts.push(
        buildEslintDraft({
          commandId: input.commandId,
          rawPath: pendingPath,
          line: Number.parseInt(lineText, 10),
          column: Number.parseInt(columnText, 10),
          severityText,
          message,
          rule,
        }),
      );
      continue;
    }

    if (
      !trimmed.startsWith(' ') &&
      !trimmed.includes(': error') &&
      !trimmed.includes(': warning')
    ) {
      pendingPath = trimmed;
    }
  }

  return drafts;
}

function buildEslintDraft(input: {
  readonly commandId: ControlledTerminalCommandId;
  readonly rawPath: string;
  readonly line: number;
  readonly column: number;
  readonly severityText?: string;
  readonly message?: string;
  readonly rule?: string;
}): FailureDiagnosticDraft {
  return {
    source: ESLINT_SOURCE,
    commandId: input.commandId,
    severity: input.severityText?.toLowerCase() === 'warning' ? 'WARNING' : 'ERROR',
    code: input.rule?.trim(),
    relativePath: input.rawPath.trim(),
    line: input.line,
    column: input.column,
    boundedMessage: input.message?.trim(),
  };
}
