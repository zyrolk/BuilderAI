/**
 * ADR-052 Slice 2 — extract bounded failure diagnostics from a post-apply VerificationReport.
 * Planning DATA only. Does not expand correction mutation scope.
 */

import {
  VERIFICATION_STAGES,
  type VerificationReport,
  type VerificationStage,
  type VerificationStageStatus,
} from '../../../core/verification';
import type { WorkspacePathProtectionPolicy } from '../../../core/target-project/workspace-path-protection';
import {
  extractBoundedFailureDiagnostics,
  type BoundedFailureDiagnostic,
} from '../failure-diagnostics';
import {
  isControlledTerminalCommandId,
  type ControlledTerminalCommandId,
} from '../controlled-terminal/controlled-terminal.types';

/** Slice 2 planning caps (stricter than Slice 1 extractor max). */
export const MAX_STRUCTURED_FAILURE_DIAGNOSTICS_PER_STAGE = 4 as const;
export const MAX_STRUCTURED_FAILURE_DIAGNOSTICS_PER_ATTEMPT = 8 as const;

const PARSEABLE_FAILURE_STATUSES = new Set<VerificationStageStatus>([
  'FAILED',
  'TIMEOUT',
  'OUTPUT_LIMIT_EXCEEDED',
  'PROCESS_FAILED',
]);

const STAGE_TO_COMMAND: Readonly<Partial<Record<VerificationStage, ControlledTerminalCommandId>>> =
  {
    BUILD_VALIDATION: 'npm-run-build',
    TEST_VALIDATION: 'npm-run-test',
    LINT_VALIDATION: 'npm-run-lint',
    TYPECHECK_VALIDATION: 'npm-run-typecheck',
    FORMAT_VALIDATION: 'npm-run-format',
  };

export function extractCorrectionFailureDiagnostics(input: {
  readonly verificationReport: VerificationReport;
  readonly projectRoot: string;
  readonly pathProtection?: WorkspacePathProtectionPolicy;
}): readonly BoundedFailureDiagnostic[] {
  const aggregated: BoundedFailureDiagnostic[] = [];

  for (const stageName of VERIFICATION_STAGES) {
    if (aggregated.length >= MAX_STRUCTURED_FAILURE_DIAGNOSTICS_PER_ATTEMPT) break;
    const stage = input.verificationReport.stages.find((entry) => entry.stage === stageName);
    if (stage === undefined) continue;
    if (!PARSEABLE_FAILURE_STATUSES.has(stage.status)) continue;

    const commandId = resolveTrustedCommandId(stage.stage, stage.diagnostic?.commandDescriptorId);
    if (commandId === undefined) continue;

    const diagnosticText = joinAuthorizedExcerpts(
      stage.diagnostic?.stdoutExcerpt,
      stage.diagnostic?.stderrExcerpt,
    );
    if (diagnosticText.length === 0) continue;

    const extracted = extractBoundedFailureDiagnostics({
      commandId,
      projectRoot: input.projectRoot,
      diagnosticText,
      pathProtection: input.pathProtection,
    });

    const errors = extracted.filter((diagnostic) => diagnostic.severity === 'ERROR');
    const remaining = MAX_STRUCTURED_FAILURE_DIAGNOSTICS_PER_ATTEMPT - aggregated.length;
    const stageSlice = errors.slice(
      0,
      Math.min(MAX_STRUCTURED_FAILURE_DIAGNOSTICS_PER_STAGE, remaining),
    );
    aggregated.push(...stageSlice);
  }

  return aggregated;
}

export function resolveTrustedCommandId(
  stage: VerificationStage,
  commandDescriptorId: string | undefined,
): ControlledTerminalCommandId | undefined {
  const mapped = STAGE_TO_COMMAND[stage];
  if (
    isControlledTerminalCommandId(commandDescriptorId) &&
    mapped !== undefined &&
    commandDescriptorId === mapped
  ) {
    return commandDescriptorId;
  }
  return mapped;
}

function joinAuthorizedExcerpts(
  stdoutExcerpt: string | undefined,
  stderrExcerpt: string | undefined,
): string {
  return [stdoutExcerpt, stderrExcerpt]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join('\n');
}
