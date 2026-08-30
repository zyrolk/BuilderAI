/**
 * ADR-052 — TypeScript compiler failure diagnostic parser (P1-E Slice 1).
 */

import type {
  BoundedFailureDiagnosticSource,
  FailureDiagnosticDraft,
} from '../bounded-failure-diagnostic.types';
import type { ControlledTerminalCommandId } from '../../controlled-terminal/controlled-terminal.types';

const TYPESCRIPT_SOURCE: BoundedFailureDiagnosticSource = 'TYPESCRIPT';

/** Canonical tsc format: path(line,col): error TS####: message */
const TYPESCRIPT_DIAGNOSTIC_PATTERN =
  /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+([A-Z0-9]+):\s*(.*)$/iu;

export function parseTypeScriptFailureDiagnostics(input: {
  readonly text: string;
  readonly commandId: ControlledTerminalCommandId;
}): readonly FailureDiagnosticDraft[] {
  const drafts: FailureDiagnosticDraft[] = [];
  for (const line of input.text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const match = TYPESCRIPT_DIAGNOSTIC_PATTERN.exec(trimmed);
    if (match === null) continue;
    const [, rawPath, lineText, columnText, severityText, code, message] = match;
    if (rawPath === undefined || lineText === undefined || columnText === undefined) continue;
    drafts.push({
      source: TYPESCRIPT_SOURCE,
      commandId: input.commandId,
      severity: severityText?.toLowerCase() === 'warning' ? 'WARNING' : 'ERROR',
      code,
      relativePath: rawPath.trim(),
      line: Number.parseInt(lineText, 10),
      column: Number.parseInt(columnText, 10),
      boundedMessage: message?.trim(),
    });
  }
  return drafts;
}
