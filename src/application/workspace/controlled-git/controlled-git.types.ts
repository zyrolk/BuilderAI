/**
 * P1-B B5 Controlled Git contracts (ADR-041).
 */

export const CONTROLLED_GIT_COMMAND_IDS = [
  'git-status-porcelain',
  'git-diff-stat',
  'git-add-paths',
  'git-commit-message-file',
  'git-rev-parse-head',
  'git-branch-show-current',
  'git-rev-parse-git-dir',
  'git-rev-parse-is-inside-work-tree',
  'git-diff-cached-name-only',
  'git-diff-name-only',
  'git-ls-files-unmerged',
] as const;

export type ControlledGitCommandId = (typeof CONTROLLED_GIT_COMMAND_IDS)[number];

export const CONTROLLED_GIT_EXECUTION_STATUSES = [
  'SUCCEEDED',
  'FAILED',
  'TIMEOUT',
  'CANCELLED',
  'REJECTED_BY_POLICY',
] as const;

export type ControlledGitExecutionStatus = (typeof CONTROLLED_GIT_EXECUTION_STATUSES)[number];

export interface ControlledGitCommandDescriptor {
  readonly id: ControlledGitCommandId;
  readonly fixedArguments: readonly string[];
  readonly timeoutMs: number;
  readonly outputLimitBytes: number;
  /** When true, runner injects isolated hooksPath / config isolation for write safety. */
  readonly neutralizeHooks: boolean;
}

export interface AppliedFileApplyBinding {
  readonly preparationId: string;
  readonly appliedPaths: readonly string[];
  readonly headCommitAtApply?: string;
  readonly branchAtApply?: string;
  readonly baselineDigestAtApply?: string;
  readonly appliedAt: string;
}

export interface ControlledGitRunResult {
  readonly commandId: string;
  readonly executionStatus: ControlledGitExecutionStatus;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly policyBlocked: boolean;
  readonly policyBlockCode?: string;
  readonly outputDigest: string;
  readonly diagnosticSummary: string;
  readonly outputLimited: boolean;
}

export interface GitRepositorySafetySnapshot {
  readonly repositoryRoot: string;
  readonly branch?: string;
  readonly headCommit?: string;
  readonly detachedHead: boolean;
  readonly dirtyPaths: readonly string[];
  readonly stagedPaths: readonly string[];
  readonly unmergedPaths: readonly string[];
  readonly inMerge: boolean;
  readonly inRebase: boolean;
  readonly inCherryPick: boolean;
  readonly inBisect: boolean;
  readonly indexLocked: boolean;
  readonly gitDirIsDirectory: boolean;
  readonly isInsideWorkTree: boolean;
}
