import type { WorkspaceAuthorizationService } from '../workspace-authorization.service';
import {
  createB1ProofToolRegistry,
  type B1ProofToolRegistryDeps,
} from './create-b1-proof-registry';
import type { ToolExecutor } from './tool-executor';
import type { ToolPolicyGate } from './tool-policy';
import type { ToolRegistry } from './tool-registry';
import {
  createFindRelatedFilesTool,
  type FindRelatedFilesToolDeps,
} from './tools/find-related-files.tool';
import {
  createInspectFileOutlineTool,
  type InspectFileOutlineToolDeps,
} from './tools/inspect-file-outline.tool';
import {
  createInspectImportsTool,
  type InspectImportsToolDeps,
} from './tools/inspect-imports.tool';
import {
  createRetrieveRelevantContextTool,
  type RetrieveRelevantContextToolDeps,
} from './tools/retrieve-relevant-context.tool';

export interface B2IntelligenceToolRegistryDeps extends B1ProofToolRegistryDeps {
  readonly related: FindRelatedFilesToolDeps;
  readonly relevantContext: RetrieveRelevantContextToolDeps;
  readonly outline: InspectFileOutlineToolDeps;
  readonly imports: InspectImportsToolDeps;
}

/**
 * Additive B2 registry: frozen B1 proof tools + Codebase Intelligence tools (ADR-038).
 * Does not wire FileApply, terminal, Git write, MCP, browser, or provider tool execution.
 */
export function createB2IntelligenceRegistry(deps: B2IntelligenceToolRegistryDeps): {
  readonly registry: ToolRegistry;
  readonly policy: ToolPolicyGate;
  readonly executor: ToolExecutor;
} {
  const { registry, policy, executor } = createB1ProofToolRegistry({
    authorization: deps.authorization,
    search: deps.search,
    read: deps.read,
    readiness: deps.readiness,
  });

  registry.register(createFindRelatedFilesTool(deps.related));
  registry.register(createRetrieveRelevantContextTool(deps.relevantContext));
  registry.register(createInspectFileOutlineTool(deps.outline));
  registry.register(createInspectImportsTool(deps.imports));

  return { registry, policy, executor };
}

/** Convenience when authorization is shared and FS deps are identical across tools. */
export function createB2IntelligenceRegistryFromSource(input: {
  readonly authorization: WorkspaceAuthorizationService;
  readonly listSourcePaths: () => Promise<readonly string[]>;
  readonly readSourceFile: (logicalPath: string) => Promise<string>;
  readonly readiness: B1ProofToolRegistryDeps['readiness'];
}): {
  readonly registry: ToolRegistry;
  readonly policy: ToolPolicyGate;
  readonly executor: ToolExecutor;
} {
  const source = {
    listSourcePaths: input.listSourcePaths,
    readSourceFile: input.readSourceFile,
  };
  return createB2IntelligenceRegistry({
    authorization: input.authorization,
    search: source,
    read: { readSourceFile: input.readSourceFile },
    readiness: input.readiness,
    related: source,
    relevantContext: source,
    outline: { readSourceFile: input.readSourceFile },
    imports: source,
  });
}
