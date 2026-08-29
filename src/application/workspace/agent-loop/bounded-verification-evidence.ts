/**
 * ADR-050: extract bounded structured B4 verification evidence from sanitized ToolResult.
 * Evidence / display only — never planning authority.
 */

import {
  CONTROLLED_TERMINAL_EXECUTION_STATUSES,
  isControlledTerminalCommandId,
  type ControlledTerminalCommandId,
  type ControlledTerminalExecutionStatus,
} from '../controlled-terminal/controlled-terminal.types';
import type { ToolJsonValue } from '../tool-registry/tool-registry.types';
import {
  BOUNDED_VERIFICATION_EVIDENCE_SCHEMA_VERSION,
  type BoundedVerificationEvidence,
} from './agent-loop.types';

export const VERIFICATION_EVIDENCE_TOOL_ID = 'run_verification_command' as const;

/** Server-owned verification stages used by ControlledTerminal catalog descriptors. */
export const BOUNDED_VERIFICATION_STAGES = [
  'DEPENDENCY_VALIDATION',
  'BUILD_VALIDATION',
  'TEST_VALIDATION',
  'LINT_VALIDATION',
  'TYPECHECK_VALIDATION',
  'FORMAT_VALIDATION',
  'UNKNOWN',
] as const;

export type BoundedVerificationStage = (typeof BOUNDED_VERIFICATION_STAGES)[number];

/**
 * Known B4 / SafeVerificationRunner policy block codes eligible for durable evidence.
 * Unknown arbitrary strings are omitted (or reject the whole projection when required).
 */
export const BOUNDED_VERIFICATION_POLICY_BLOCK_CODES = [
  'UNKNOWN_COMMAND_ID',
  'INVALID_PROJECT_ROOT',
  'SCRIPT_UNAVAILABLE',
  'FORBIDDEN_NPM_SUBCOMMAND',
  'FORBIDDEN_NPM_COMMAND',
  'FORBIDDEN_NPM_FLAGS',
  'FORBIDDEN_NPM_SCRIPT',
  'BUILDERAI_ROOT_FORBIDDEN',
  'FORBIDDEN_ENVIRONMENT_KEY',
  'FORBIDDEN_EXECUTABLE',
  'WORKFLOW_DEADLINE_EXCEEDED',
  'NPM_INVOCATION_UNAVAILABLE',
  'VERIFICATION_POLICY_BLOCKED',
] as const;

export type BoundedVerificationPolicyBlockCode =
  (typeof BOUNDED_VERIFICATION_POLICY_BLOCK_CODES)[number];

export const BOUNDED_VERIFICATION_EVIDENCE_MAX_SERIALIZED_CHARS = 512 as const;

export interface ExtractBoundedVerificationEvidenceInput {
  readonly toolId: string;
  readonly structured: ToolJsonValue | undefined;
}

/**
 * Extract bounded verification evidence from post-sanitizer structured tool output.
 * Returns undefined when extraction fails or tool is out of scope — never throws.
 * Prefer undefined over partial untrusted data.
 */
export function extractBoundedVerificationEvidence(
  input: ExtractBoundedVerificationEvidenceInput,
): BoundedVerificationEvidence | undefined {
  if (input.toolId !== VERIFICATION_EVIDENCE_TOOL_ID) return undefined;
  if (input.structured === undefined || typeof input.structured !== 'object') return undefined;
  if (Array.isArray(input.structured)) return undefined;

  const record = input.structured as Record<string, unknown>;

  if (!isControlledTerminalCommandId(record.commandId)) return undefined;
  if (!isBoundedVerificationStage(record.stage)) return undefined;
  if (!isControlledTerminalExecutionStatus(record.executionStatus)) return undefined;
  if (!isExitCode(record.exitCode)) return undefined;
  if (typeof record.timedOut !== 'boolean') return undefined;
  if (typeof record.cancelled !== 'boolean') return undefined;
  if (typeof record.policyBlocked !== 'boolean') return undefined;
  if (typeof record.outputLimited !== 'boolean') return undefined;

  const policyBlockCode = parseOptionalPolicyBlockCode(record.policyBlockCode);
  if (record.policyBlockCode !== undefined && policyBlockCode === undefined) {
    return undefined;
  }

  const evidence: BoundedVerificationEvidence = {
    evidenceSchemaVersion: BOUNDED_VERIFICATION_EVIDENCE_SCHEMA_VERSION,
    commandId: record.commandId,
    stage: record.stage,
    executionStatus: record.executionStatus,
    exitCode: record.exitCode,
    timedOut: record.timedOut,
    cancelled: record.cancelled,
    policyBlocked: record.policyBlocked,
    ...(policyBlockCode === undefined ? {} : { policyBlockCode }),
    outputLimited: record.outputLimited,
  };

  if (!validateVerificationEvidenceForPersistence(evidence)) return undefined;
  return evidence;
}

export function isBoundedVerificationStage(value: unknown): value is BoundedVerificationStage {
  return (
    typeof value === 'string' && (BOUNDED_VERIFICATION_STAGES as readonly string[]).includes(value)
  );
}

export function isControlledTerminalExecutionStatus(
  value: unknown,
): value is ControlledTerminalExecutionStatus {
  return (
    typeof value === 'string' &&
    (CONTROLLED_TERMINAL_EXECUTION_STATUSES as readonly string[]).includes(value)
  );
}

export function isBoundedVerificationPolicyBlockCode(
  value: unknown,
): value is BoundedVerificationPolicyBlockCode {
  return (
    typeof value === 'string' &&
    (BOUNDED_VERIFICATION_POLICY_BLOCK_CODES as readonly string[]).includes(value)
  );
}

export function validateVerificationEvidenceForPersistence(
  evidence: BoundedVerificationEvidence,
): boolean {
  if (evidence.evidenceSchemaVersion !== BOUNDED_VERIFICATION_EVIDENCE_SCHEMA_VERSION) {
    return false;
  }
  if (!isControlledTerminalCommandId(evidence.commandId)) return false;
  if (!isBoundedVerificationStage(evidence.stage)) return false;
  if (!isControlledTerminalExecutionStatus(evidence.executionStatus)) return false;
  if (!isExitCode(evidence.exitCode)) return false;
  if (typeof evidence.timedOut !== 'boolean') return false;
  if (typeof evidence.cancelled !== 'boolean') return false;
  if (typeof evidence.policyBlocked !== 'boolean') return false;
  if (typeof evidence.outputLimited !== 'boolean') return false;
  if (
    evidence.policyBlockCode !== undefined &&
    !isBoundedVerificationPolicyBlockCode(evidence.policyBlockCode)
  ) {
    return false;
  }

  const keys = Object.keys(evidence);
  const allowed = new Set([
    'evidenceSchemaVersion',
    'commandId',
    'stage',
    'executionStatus',
    'exitCode',
    'timedOut',
    'cancelled',
    'policyBlocked',
    'policyBlockCode',
    'outputLimited',
  ]);
  for (const key of keys) {
    if (!allowed.has(key)) return false;
  }

  try {
    assertNoForbiddenVerificationEvidenceKeys(evidence);
  } catch {
    return false;
  }

  const serialized = JSON.stringify(evidence);
  if (serialized.length > BOUNDED_VERIFICATION_EVIDENCE_MAX_SERIALIZED_CHARS) return false;
  return true;
}

export function assertNoForbiddenVerificationEvidenceKeys(value: unknown): void {
  const forbidden = [
    'stdout',
    'stderr',
    'diagnosticSummary',
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
    'outputDigest',
    'networkPolicy',
    'path',
    'paths',
    'line',
    'column',
    'url',
    'urls',
  ];
  walk(value, (key) => {
    if (forbidden.some((entry) => entry.toLowerCase() === key.toLowerCase())) {
      throw new Error(`Refusing verification evidence key "${key}".`);
    }
  });
}

function parseOptionalPolicyBlockCode(
  value: unknown,
): BoundedVerificationPolicyBlockCode | undefined {
  if (value === undefined) return undefined;
  if (!isBoundedVerificationPolicyBlockCode(value)) return undefined;
  return value;
}

function isExitCode(value: unknown): value is number | null {
  if (value === null) return true;
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
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

/** Operator-facing short label for catalog command ids (UI display only). */
export function verificationCommandDisplayLabel(commandId: ControlledTerminalCommandId): string {
  switch (commandId) {
    case 'npm-run-build':
      return 'Build';
    case 'npm-run-test':
      return 'Test';
    case 'npm-run-lint':
      return 'Lint';
    case 'npm-run-typecheck':
      return 'Typecheck';
    case 'npm-run-format':
      return 'Format';
    case 'npm-ls-omit-dev-json':
      return 'Dependencies';
    default: {
      const _exhaustive: never = commandId;
      return _exhaustive;
    }
  }
}

export function verificationExecutionStatusDisplayLabel(
  status: ControlledTerminalExecutionStatus,
): string {
  switch (status) {
    case 'SUCCEEDED':
      return 'PASSED';
    case 'FAILED':
      return 'FAILED';
    case 'TIMEOUT':
      return 'TIMEOUT';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'REJECTED_BY_POLICY':
      return 'BLOCKED';
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function formatVerificationEvidenceStatusLine(
  evidence: BoundedVerificationEvidence,
): string {
  const label = verificationCommandDisplayLabel(evidence.commandId);
  const status = verificationExecutionStatusDisplayLabel(evidence.executionStatus);
  if (evidence.executionStatus === 'FAILED' && evidence.exitCode !== null) {
    return `${label} — ${status} — exit ${String(evidence.exitCode)}`;
  }
  if (evidence.policyBlocked && evidence.policyBlockCode !== undefined) {
    return `${label} — ${status} — ${evidence.policyBlockCode}`;
  }
  return `${label} — ${status}`;
}
