import { ControlledGitService } from '../controlled-git/controlled-git.service';
import type { AppliedFileApplyBindingPort } from '../controlled-git/applied-file-apply-binding.port';
import { ControlledGitRunner } from '../../../infrastructure/controlled-git/controlled-git-runner';
import {
  createB4TerminalRegistry,
  type B4TerminalToolRegistryDeps,
} from './create-b4-terminal-registry';
import type { ToolExecutor } from './tool-executor';
import type { ToolPolicyGate } from './tool-policy';
import type { ToolRegistry } from './tool-registry';
import { createCommitGitSnapshotTool } from './tools/commit-git-snapshot.tool';
import { createInspectGitDiffTool } from './tools/inspect-git-diff.tool';
import { createInspectGitStatusTool } from './tools/inspect-git-status.tool';
import { createStageGitPathsTool } from './tools/stage-git-paths.tool';

export interface B5GitToolRegistryDeps extends B4TerminalToolRegistryDeps {
  readonly controlledGit: ControlledGitService;
}

/**
 * Additive B5 registry: B4 tools + controlled Git tools (ADR-041).
 * Must not wire FileApply, approveAndApply, unrestricted shell, push, or provider tool loops.
 */
export function createB5GitRegistry(deps: B5GitToolRegistryDeps): {
  readonly registry: ToolRegistry;
  readonly policy: ToolPolicyGate;
  readonly executor: ToolExecutor;
} {
  const { registry, policy, executor } = createB4TerminalRegistry(deps);
  registry.register(createInspectGitStatusTool({ controlledGit: deps.controlledGit }));
  registry.register(createInspectGitDiffTool({ controlledGit: deps.controlledGit }));
  registry.register(createStageGitPathsTool({ controlledGit: deps.controlledGit }));
  registry.register(createCommitGitSnapshotTool({ controlledGit: deps.controlledGit }));
  return { registry, policy, executor };
}

export interface CreateControlledGitServiceOptions {
  readonly appliedBindings: AppliedFileApplyBindingPort;
  readonly builderAiRoot?: string;
  readonly gitExecutable?: string;
  readonly createRunner?: (repositoryRoot: string) => ControlledGitRunner;
}

export function createControlledGitService(
  options: CreateControlledGitServiceOptions,
): ControlledGitService {
  return new ControlledGitService({
    appliedBindings: options.appliedBindings,
    builderAiRoot: options.builderAiRoot,
    createRunner:
      options.createRunner ??
      ((repositoryRoot) =>
        new ControlledGitRunner({
          repositoryRoot,
          builderAiRoot: options.builderAiRoot,
          gitExecutable: options.gitExecutable,
        })),
  });
}
