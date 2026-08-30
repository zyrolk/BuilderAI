/**
 * ADR-052 — catalog-linked failure diagnostic parser registry (P1-E Slice 1).
 */

import type { ControlledTerminalCommandId } from '../controlled-terminal/controlled-terminal.types';
import type { FailureDiagnosticDraft } from './bounded-failure-diagnostic.types';
import { parseEslintFailureDiagnostics } from './parsers/eslint-failure.parser';
import { parseTypeScriptFailureDiagnostics } from './parsers/typescript-failure.parser';
import { parseVitestFailureDiagnostics } from './parsers/vitest-failure.parser';

export type FailureDiagnosticParser = (input: {
  readonly text: string;
  readonly commandId: ControlledTerminalCommandId;
}) => readonly FailureDiagnosticDraft[];

/**
 * npm-run-build is intentionally unsupported in Slice 1 — output may mix tool formats.
 * npm-run-format and npm-ls-omit-dev-json are not failure-location sources.
 */
export const FAILURE_DIAGNOSTIC_PARSERS: Readonly<
  Partial<Record<ControlledTerminalCommandId, FailureDiagnosticParser>>
> = {
  'npm-run-typecheck': parseTypeScriptFailureDiagnostics,
  'npm-run-lint': parseEslintFailureDiagnostics,
  'npm-run-test': parseVitestFailureDiagnostics,
};

export function resolveFailureDiagnosticParser(
  commandId: ControlledTerminalCommandId,
): FailureDiagnosticParser | undefined {
  return FAILURE_DIAGNOSTIC_PARSERS[commandId];
}
