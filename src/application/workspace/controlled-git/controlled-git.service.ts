import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { ExecutionCancellationToken } from '../../../core/execution-engine';
import { digestStructured } from '../../../core/workflow-ledger/services/workflow-digest.service';
import {
  ControlledGitPolicyViolationError,
  assertSafeRelativePath,
} from '../../../infrastructure/controlled-git/controlled-git-environment';
import type {
  ControlledGitRunner,
  ControlledGitRunnerDescriptor,
} from '../../../infrastructure/controlled-git/controlled-git-runner';
import type { AppliedFileApplyBindingPort } from './applied-file-apply-binding.port';
import {
  createGitAddPathsDescriptor,
  createGitCommitMessageFileDescriptor,
  createGitDiffStatDescriptor,
  createGitStatusPorcelainDescriptor,
} from './controlled-git-descriptors';
import {
  assertWritableGitState,
  captureGitRepositorySafetySnapshot,
  mapExecution,
  normalizePath,
} from './controlled-git-safety';
import type { ControlledGitRunResult } from './controlled-git.types';

export interface ControlledGitServiceDeps {
  readonly createRunner: (repositoryRoot: string) => ControlledGitRunner;
  readonly appliedBindings: AppliedFileApplyBindingPort;
  readonly builderAiRoot?: string;
  readonly defaultCommitMessage?: string;
}

/**
 * Catalog-only Controlled Git service (ADR-041).
 * Does not import FileApply or approveAndApply.
 */
export class ControlledGitService {
  constructor(private readonly deps: ControlledGitServiceDeps) {}

  async inspectStatus(input: {
    readonly projectId: string;
    readonly repositoryRoot: string;
    readonly cancellation?: ExecutionCancellationToken;
  }): Promise<ControlledGitRunResult & { readonly structured?: Record<string, unknown> }> {
    const root = this.resolveRoot(input.repositoryRoot);
    const runner = this.deps.createRunner(root);
    const safety = await captureGitRepositorySafetySnapshot(runner, root);
    if (!safety.ok) {
      return policyRejected('git-status-porcelain', safety.code, safety.message);
    }
    const execution = await runner.execute(createGitStatusPorcelainDescriptor(), {
      cancellation: input.cancellation,
    });
    const mapped = mapExecution(
      'git-status-porcelain',
      execution,
      digestStructured,
    ) as ControlledGitRunResult;
    return {
      ...mapped,
      structured: {
        branch: safety.snapshot.branch ?? null,
        headCommit: safety.snapshot.headCommit ?? null,
        detachedHead: safety.snapshot.detachedHead,
        dirtyPathCount: safety.snapshot.dirtyPaths.length,
        stagedPathCount: safety.snapshot.stagedPaths.length,
        dirtyPaths: safety.snapshot.dirtyPaths.slice(0, 100),
        stagedPaths: safety.snapshot.stagedPaths.slice(0, 100),
        unsafeOperationInProgress:
          safety.snapshot.inMerge ||
          safety.snapshot.inRebase ||
          safety.snapshot.inCherryPick ||
          safety.snapshot.inBisect,
      },
    };
  }

  async inspectDiff(input: {
    readonly projectId: string;
    readonly repositoryRoot: string;
    readonly cancellation?: ExecutionCancellationToken;
  }): Promise<ControlledGitRunResult> {
    const root = this.resolveRoot(input.repositoryRoot);
    const runner = this.deps.createRunner(root);
    const execution = await runner.execute(createGitDiffStatDescriptor(), {
      cancellation: input.cancellation,
    });
    return mapExecution('git-diff-stat', execution, digestStructured) as ControlledGitRunResult;
  }

  async stagePaths(input: {
    readonly projectId: string;
    readonly repositoryRoot: string;
    readonly preparationId: string;
    readonly requestedPaths: readonly string[];
    readonly operatorApproved: boolean;
    readonly expectedBranch?: string;
    readonly cancellation?: ExecutionCancellationToken;
  }): Promise<ControlledGitRunResult & { readonly stagedPaths?: readonly string[] }> {
    if (!input.operatorApproved) {
      return policyRejected(
        'git-add-paths',
        'OPERATOR_APPROVAL_REQUIRED',
        'Git write requires OPERATOR approval.',
      );
    }
    const root = this.resolveRoot(input.repositoryRoot);
    const binding = await this.deps.appliedBindings.readBinding({
      projectId: input.projectId,
      preparationId: input.preparationId,
    });
    if (binding === undefined) {
      return policyRejected(
        'git-add-paths',
        'STALE_FILE_APPLY_BINDING',
        'No successful FileApply binding found for preparationId.',
      );
    }
    if (binding.projectId !== input.projectId) {
      return policyRejected('git-add-paths', 'PROJECT_MISMATCH', 'Binding projectId mismatch.');
    }

    const allowed = new Set(binding.appliedPaths.map(normalizePath));
    let validatedPaths: string[];
    try {
      validatedPaths = validateRequestedSubset(input.requestedPaths, allowed, root);
    } catch (error: unknown) {
      if (error instanceof ControlledGitPolicyViolationError) {
        return policyRejected('git-add-paths', error.code, error.message);
      }
      throw error;
    }

    const runner = this.deps.createRunner(root);
    const safety = await captureGitRepositorySafetySnapshot(runner, root);
    if (!safety.ok) {
      return policyRejected('git-add-paths', safety.code, safety.message);
    }
    if (
      input.expectedBranch !== undefined &&
      safety.snapshot.branch !== undefined &&
      input.expectedBranch !== safety.snapshot.branch
    ) {
      return policyRejected(
        'git-add-paths',
        'BRANCH_MISMATCH',
        'Branch does not match expected branch.',
      );
    }
    if (
      binding.branchAtApply !== undefined &&
      safety.snapshot.branch !== undefined &&
      binding.branchAtApply !== safety.snapshot.branch
    ) {
      return policyRejected(
        'git-add-paths',
        'BRANCH_MISMATCH',
        'Branch drifted since FileApply binding.',
      );
    }
    if (
      binding.headCommitAtApply !== undefined &&
      safety.snapshot.headCommit !== undefined &&
      binding.headCommitAtApply !== safety.snapshot.headCommit
    ) {
      return policyRejected(
        'git-add-paths',
        'BASELINE_DRIFT',
        'Repository HEAD drifted since FileApply binding.',
      );
    }

    const writable = assertWritableGitState(safety.snapshot, allowed);
    if (!writable.ok) {
      return policyRejected('git-add-paths', writable.code, writable.message);
    }

    const descriptor = createGitAddPathsDescriptor(validatedPaths);
    const execution = await runner.execute(descriptor as ControlledGitRunnerDescriptor, {
      cancellation: input.cancellation,
    });
    const mapped = mapExecution(
      'git-add-paths',
      execution,
      digestStructured,
    ) as ControlledGitRunResult;
    return { ...mapped, stagedPaths: validatedPaths };
  }

  async commitSnapshot(input: {
    readonly projectId: string;
    readonly repositoryRoot: string;
    readonly preparationId: string;
    readonly operatorApproved: boolean;
    readonly commitMessage?: string;
    readonly expectedBranch?: string;
    readonly cancellation?: ExecutionCancellationToken;
  }): Promise<ControlledGitRunResult & { readonly commitHash?: string }> {
    if (!input.operatorApproved) {
      return policyRejected(
        'git-commit-message-file',
        'OPERATOR_APPROVAL_REQUIRED',
        'Git write requires OPERATOR approval.',
      );
    }
    const root = this.resolveRoot(input.repositoryRoot);
    const binding = await this.deps.appliedBindings.readBinding({
      projectId: input.projectId,
      preparationId: input.preparationId,
    });
    if (binding === undefined) {
      return policyRejected(
        'git-commit-message-file',
        'STALE_FILE_APPLY_BINDING',
        'No successful FileApply binding found for preparationId.',
      );
    }

    const allowed = new Set(binding.appliedPaths.map(normalizePath));
    const runner = this.deps.createRunner(root);
    const safety = await captureGitRepositorySafetySnapshot(runner, root);
    if (!safety.ok) {
      return policyRejected('git-commit-message-file', safety.code, safety.message);
    }
    if (safety.snapshot.detachedHead) {
      return policyRejected('git-commit-message-file', 'DETACHED_HEAD', 'Detached HEAD forbidden.');
    }
    if (
      input.expectedBranch !== undefined &&
      safety.snapshot.branch !== undefined &&
      input.expectedBranch !== safety.snapshot.branch
    ) {
      return policyRejected(
        'git-commit-message-file',
        'BRANCH_MISMATCH',
        'Branch does not match expected branch.',
      );
    }
    if (
      binding.branchAtApply !== undefined &&
      safety.snapshot.branch !== undefined &&
      binding.branchAtApply !== safety.snapshot.branch
    ) {
      return policyRejected(
        'git-commit-message-file',
        'BRANCH_MISMATCH',
        'Branch drifted since FileApply binding.',
      );
    }
    if (
      binding.headCommitAtApply !== undefined &&
      safety.snapshot.headCommit !== undefined &&
      binding.headCommitAtApply !== safety.snapshot.headCommit
    ) {
      return policyRejected(
        'git-commit-message-file',
        'BASELINE_DRIFT',
        'Repository HEAD drifted since FileApply binding.',
      );
    }

    const writable = assertWritableGitState(safety.snapshot, allowed);
    if (!writable.ok) {
      return policyRejected('git-commit-message-file', writable.code, writable.message);
    }
    if (safety.snapshot.stagedPaths.length === 0) {
      return policyRejected(
        'git-commit-message-file',
        'NOTHING_STAGED',
        'No allowlisted paths are staged for commit.',
      );
    }
    const illegalStaged = safety.snapshot.stagedPaths.filter((p) => !allowed.has(normalizePath(p)));
    if (illegalStaged.length > 0) {
      return policyRejected(
        'git-commit-message-file',
        'UNRELATED_STAGED_PATHS',
        'Staged paths are not a subset of Applied FileApply paths.',
      );
    }

    const message =
      sanitizeCommitMessage(input.commitMessage) ??
      this.deps.defaultCommitMessage ??
      `BuilderAI applied changes (${input.preparationId})`;

    const messageDir = await mkdtemp(path.join(tmpdir(), 'builderai-git-msg-'));
    const messageFile = path.join(messageDir, 'COMMIT_EDITMSG');
    await writeFile(messageFile, `${message}\n`, 'utf8');

    const beforeHead = safety.snapshot.headCommit;
    const descriptor = createGitCommitMessageFileDescriptor(messageFile);
    const execution = await runner.execute(descriptor as ControlledGitRunnerDescriptor, {
      cancellation: input.cancellation,
    });
    const mapped = mapExecution(
      'git-commit-message-file',
      execution,
      digestStructured,
    ) as ControlledGitRunResult;

    if (mapped.executionStatus !== 'SUCCEEDED') {
      return mapped;
    }

    // Detect unexpected hook-driven tree mutation / head movement failure modes without destructive recovery.
    const after = await captureGitRepositorySafetySnapshot(runner, root);
    if (!after.ok) {
      return {
        ...mapped,
        executionStatus: 'FAILED',
        policyBlocked: false,
        diagnosticSummary: 'Commit reported success but repository state is unreadable afterward.',
      };
    }
    if (beforeHead !== undefined && after.snapshot.headCommit === beforeHead) {
      return {
        ...mapped,
        executionStatus: 'FAILED',
        diagnosticSummary: 'Commit did not advance HEAD.',
      };
    }
    const unexpectedDirty = after.snapshot.dirtyPaths.filter((p) => !allowed.has(normalizePath(p)));
    if (unexpectedDirty.length > 0) {
      return {
        ...mapped,
        executionStatus: 'FAILED',
        policyBlockCode: 'HOOK_TREE_MODIFICATION',
        diagnosticSummary:
          'Post-commit working tree contains unexpected dirty paths (possible hook mutation).',
      };
    }

    return {
      ...mapped,
      commitHash: after.snapshot.headCommit,
    };
  }

  private resolveRoot(repositoryRoot: string): string {
    return path.resolve(repositoryRoot.trim());
  }
}

function validateRequestedSubset(
  requestedPaths: readonly string[],
  allowed: ReadonlySet<string>,
  repositoryRoot: string,
): string[] {
  if (requestedPaths.length === 0) {
    throw new ControlledGitPolicyViolationError('EMPTY_PATHSPEC', 'At least one path is required.');
  }
  const normalized: string[] = [];
  for (const raw of requestedPaths) {
    assertSafeRelativePath(raw, repositoryRoot);
    const logical = normalizePath(raw);
    if (logical === '.' || logical === '*' || logical.endsWith('/*')) {
      throw new ControlledGitPolicyViolationError(
        'FORBIDDEN_GLOB_PATHSPEC',
        'Broad pathspecs such as . or * are forbidden.',
      );
    }
    if (!allowed.has(logical)) {
      throw new ControlledGitPolicyViolationError(
        'PATH_NOT_IN_APPLIED_SET',
        `Path "${logical}" is not in the Applied FileApply path set.`,
      );
    }
    normalized.push(logical);
  }
  return [...new Set(normalized)];
}

function sanitizeCommitMessage(message: string | undefined): string | undefined {
  if (message === undefined) return undefined;
  const trimmed = message.replace(/\0/g, '').trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.slice(0, 2_000);
}

function policyRejected(
  commandId: string,
  policyBlockCode: string,
  message: string,
): ControlledGitRunResult {
  return {
    commandId,
    executionStatus: 'REJECTED_BY_POLICY',
    exitCode: null,
    timedOut: false,
    cancelled: false,
    policyBlocked: true,
    policyBlockCode,
    outputDigest: digestStructured({ policyBlockCode, message }),
    diagnosticSummary: message.slice(0, 1_024),
    outputLimited: false,
  };
}
