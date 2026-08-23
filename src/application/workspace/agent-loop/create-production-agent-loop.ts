import { ChangePlannerService } from '../../../core/change-planner';
import type { WorkspacePathProtectionPolicy } from '../../../core/target-project/workspace-path-protection';
import type { WorkspaceSecurityConfiguration } from '../workspace-authorization.types';
import { WorkspaceAuthorizationService } from '../workspace-authorization.service';
import { InMemoryAppliedFileApplyBindingStore } from '../controlled-git/applied-file-apply-binding.port';
import {
  EditProposalService,
  type EditProposalPreparePort,
} from '../edit-proposal/edit-proposal.service';
import type { ExternalTargetReadiness } from '../external-target-readiness/external-target-readiness.types';
import { createControlledGitService } from '../tool-registry/create-b5-git-registry';
import { createControlledTerminalService } from '../tool-registry/create-b4-terminal-registry';
import {
  createControlledLocalBrowserService,
  type CreateControlledLocalBrowserServiceOptions,
} from '../tool-registry/create-b7-browser-registry';
import {
  createAgentLoopComposition,
  type CreateAgentLoopCompositionInput,
} from './create-agent-loop';
import { AgentLoopEvidencePersistence } from './agent-loop.persistence';
import type { AgentLoopService } from './agent-loop.service';
import type { ToolExecutor } from '../tool-registry/tool-executor';
import type { ToolPolicyGate } from '../tool-registry/tool-policy';
import type { ToolRegistry } from '../tool-registry/tool-registry';

export interface ProductionAgentLoopSourceFiles {
  listSourcePaths(): Promise<readonly string[]>;
  readSourceFile(logicalPath: string): Promise<string>;
}

export interface CreateProductionAgentLoopInput {
  readonly projectId: string;
  readonly projectRoot: string;
  readonly stateRoot: string;
  readonly security: WorkspaceSecurityConfiguration;
  readonly sourceFiles: ProductionAgentLoopSourceFiles;
  readonly prepareFromResponsePackage: EditProposalPreparePort['prepareFromResponsePackage'];
  readonly readiness: {
    project(input: { readonly projectRoot: string }): Promise<ExternalTargetReadiness>;
  };
  readonly pathProtection?: WorkspacePathProtectionPolicy;
  readonly builderAiRoot?: string;
  readonly browserOptions?: CreateControlledLocalBrowserServiceOptions;
  readonly ids: { generate(): string };
  readonly clock: { now(): Date };
}

/**
 * Production B8 composition: AgentLoop + createB7BrowserRegistry (B1–B7).
 * Does not invent a second execution engine or capability class.
 */
export function createProductionAgentLoopComposition(input: CreateProductionAgentLoopInput): {
  readonly registry: ToolRegistry;
  readonly policy: ToolPolicyGate;
  readonly executor: ToolExecutor;
  readonly loop: AgentLoopService;
  readonly persistence: AgentLoopEvidencePersistence;
} {
  const authorization = new WorkspaceAuthorizationService(input.security);
  const source = {
    listSourcePaths: () => input.sourceFiles.listSourcePaths(),
    readSourceFile: (logicalPath: string) => input.sourceFiles.readSourceFile(logicalPath),
  };
  const editProposals = new EditProposalService({
    changePlanner: new ChangePlannerService(),
    preparePort: {
      prepareFromResponsePackage: input.prepareFromResponsePackage,
    },
    clock: input.clock,
    ids: input.ids,
    ...(input.pathProtection === undefined ? {} : { pathProtection: input.pathProtection }),
  });
  const controlledTerminal = createControlledTerminalService({
    ...(input.builderAiRoot === undefined ? {} : { builderAiRoot: input.builderAiRoot }),
  });
  const controlledGit = createControlledGitService({
    appliedBindings: new InMemoryAppliedFileApplyBindingStore(),
    ...(input.builderAiRoot === undefined ? {} : { builderAiRoot: input.builderAiRoot }),
  });
  const controlledBrowser = createControlledLocalBrowserService(input.browserOptions ?? {});
  const persistence = new AgentLoopEvidencePersistence(input.stateRoot, input.projectId);

  const compositionInput: CreateAgentLoopCompositionInput = {
    projectId: input.projectId,
    authorization,
    search: source,
    read: { readSourceFile: source.readSourceFile },
    readiness: input.readiness,
    related: source,
    relevantContext: source,
    outline: { readSourceFile: source.readSourceFile },
    imports: source,
    editProposals,
    controlledTerminal,
    controlledGit,
    controlledBrowser,
    persistence,
    clock: input.clock,
  };

  const composed = createAgentLoopComposition(compositionInput);
  return { ...composed, persistence };
}
