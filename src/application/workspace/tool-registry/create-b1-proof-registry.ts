import type { WorkspaceAuthorizationService } from '../workspace-authorization.service';
import { ToolExecutor } from './tool-executor';
import { ToolPolicyGate } from './tool-policy';
import { ToolRegistry } from './tool-registry';
import {
  createInspectReadinessTool,
  type InspectReadinessToolDeps,
} from './tools/inspect-readiness.tool';
import {
  createReadSourceFileTool,
  type ReadSourceFileToolDeps,
} from './tools/read-source-file.tool';
import {
  createSearchRepositoryTool,
  type SearchRepositoryToolDeps,
} from './tools/search-repository.tool';

export interface B1ProofToolRegistryDeps {
  readonly authorization: WorkspaceAuthorizationService;
  readonly search: SearchRepositoryToolDeps;
  readonly read: ReadSourceFileToolDeps;
  readonly readiness: InspectReadinessToolDeps;
}

/**
 * Creates the B1 proof registry: SEARCH / READ / INSPECT only.
 * Composition must not wire FileApply, terminal, Git write, MCP, or browser tools.
 */
export function createB1ProofToolRegistry(deps: B1ProofToolRegistryDeps): {
  readonly registry: ToolRegistry;
  readonly policy: ToolPolicyGate;
  readonly executor: ToolExecutor;
} {
  const policy = new ToolPolicyGate(deps.authorization);
  const registry = new ToolRegistry(policy);
  registry.register(createSearchRepositoryTool(deps.search));
  registry.register(createReadSourceFileTool(deps.read));
  registry.register(createInspectReadinessTool(deps.readiness));
  const executor = new ToolExecutor(registry, policy);
  return { registry, policy, executor };
}
