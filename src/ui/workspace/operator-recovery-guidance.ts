import type { FileApplyResult } from '../../core/file-apply';

export const PARTIAL_APPLY_RECOVERY_STEPS = [
  'Inspect applied operations in the Apply Result tab.',
  'Inspect failed operations and error codes.',
  'Inspect the affected files on disk in the target repository.',
  'Run or inspect verification results where available.',
  'Reconcile the filesystem manually if operations left the target inconsistent.',
  'Start a fresh prepare from the current filesystem state for remaining or fix work.',
] as const;

export function partialApplyHeadline(): string {
  return 'Some file operations were written to disk; remaining operations may not have been applied.';
}

export function partialApplySafetyNotice(): string {
  return 'Automatic retry or AI correction from a stale pre-apply baseline is unsafe. Fresh prepare is required from the current filesystem state.';
}

export function appliedWithVerificationFailureHeadline(): string {
  return 'The file changes were applied, but verification failed.';
}

export function baselineDriftGuidance(): string {
  return 'Baseline drift was detected — target files changed after prepare. No mutations were applied for drifted operations. Start a fresh prepare from the current filesystem state.';
}

export function dependencyChangeGuidance(): string {
  return 'This plan changes package.json or lockfiles. Run npm install manually in the target repository if dependencies changed, then start a fresh prepare when the lockfile matches disk.';
}

export function verificationFailureCorrectionHint(): string {
  return 'You may request a bounded correction. The corrected plan returns to Gate 2 and requires explicit approval before apply.';
}

export function verificationTimeoutGuidance(): string {
  return 'Verification command exceeded the configured time limit. Review the stage diagnostics and retry after addressing slow or hanging commands.';
}

export function verificationInfrastructureGuidance(): string {
  return 'BuilderAI could not execute the verification stage reliably. This is not a normal code/test assertion failure.';
}

export function verificationCommandFailureGuidance(): string {
  return 'The verification command ran and reported a failure. Review bounded stdout/stderr excerpts below before requesting correction or investigation.';
}

export function freshPrepareRequiredNotice(): string {
  return 'Fresh prepare required from current filesystem state.';
}

export function summarizePartialApplyOperations(applyResult: FileApplyResult): {
  readonly appliedCount: number;
  readonly failedCount: number;
  readonly skippedCount: number;
} {
  return {
    appliedCount:
      applyResult.createdFiles.length +
      applyResult.updatedFiles.length +
      applyResult.deletedFiles.length,
    failedCount: applyResult.errors.length,
    skippedCount: applyResult.skippedFiles.length,
  };
}
