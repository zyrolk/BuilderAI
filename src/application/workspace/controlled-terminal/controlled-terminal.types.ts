/**
 * P1-B B4 Controlled Terminal catalog contracts (ADR-040).
 * Catalog-only command ids — never free-form shell/argv.
 */

export const CONTROLLED_TERMINAL_COMMAND_IDS = [
  'npm-ls-omit-dev-json',
  'npm-run-build',
  'npm-run-test',
  'npm-run-lint',
  'npm-run-typecheck',
  'npm-run-format',
] as const;

export type ControlledTerminalCommandId = (typeof CONTROLLED_TERMINAL_COMMAND_IDS)[number];

export const CONTROLLED_TERMINAL_EXECUTION_STATUSES = [
  'SUCCEEDED',
  'FAILED',
  'TIMEOUT',
  'CANCELLED',
  'REJECTED_BY_POLICY',
] as const;

export type ControlledTerminalExecutionStatus =
  (typeof CONTROLLED_TERMINAL_EXECUTION_STATUSES)[number];

export interface ControlledTerminalCatalogEntry {
  readonly commandId: ControlledTerminalCommandId;
  readonly available: boolean;
  readonly scriptName?: string;
  readonly stage: string;
  readonly description: string;
}

/** Sanitizer-safe run result — must never use stdout/stderr key names. */
export interface ControlledTerminalRunResult {
  /** Catalog id when known; may be the rejected request string for policy blocks. */
  readonly commandId: string;
  readonly stage: string;
  readonly executionStatus: ControlledTerminalExecutionStatus;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly policyBlocked: boolean;
  readonly policyBlockCode?: string;
  readonly outputDigest: string;
  readonly diagnosticSummary: string;
  readonly outputLimited: boolean;
  readonly networkPolicy: 'disabled-unsupported';
}

export function isControlledTerminalCommandId(
  value: unknown,
): value is ControlledTerminalCommandId {
  return (
    typeof value === 'string' &&
    (CONTROLLED_TERMINAL_COMMAND_IDS as readonly string[]).includes(value)
  );
}
