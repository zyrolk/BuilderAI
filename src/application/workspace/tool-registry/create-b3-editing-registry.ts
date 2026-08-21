import type { EditProposalService } from '../edit-proposal/edit-proposal.service';
import {
  createB2IntelligenceRegistry,
  type B2IntelligenceToolRegistryDeps,
} from './create-b2-intelligence-registry';
import type { ToolExecutor } from './tool-executor';
import type { ToolPolicyGate } from './tool-policy';
import type { ToolRegistry } from './tool-registry';
import { createCommitEditProposalTool } from './tools/commit-edit-proposal.tool';
import { createDraftEditProposalTool } from './tools/draft-edit-proposal.tool';
import { createInspectEditProposalTool } from './tools/inspect-edit-proposal.tool';

export interface B3EditingToolRegistryDeps extends B2IntelligenceToolRegistryDeps {
  readonly editProposals: EditProposalService;
}

/**
 * Additive B3 registry: B2 tools + proposal-only edit tools (ADR-039).
 * Must not wire FileApply, approveAndApply, terminal, Git write, MCP, or browser.
 */
export function createB3EditingRegistry(deps: B3EditingToolRegistryDeps): {
  readonly registry: ToolRegistry;
  readonly policy: ToolPolicyGate;
  readonly executor: ToolExecutor;
} {
  const { registry, policy, executor } = createB2IntelligenceRegistry(deps);
  registry.register(createDraftEditProposalTool({ editProposals: deps.editProposals }));
  registry.register(createInspectEditProposalTool({ editProposals: deps.editProposals }));
  registry.register(createCommitEditProposalTool({ editProposals: deps.editProposals }));
  return { registry, policy, executor };
}
