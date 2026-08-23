import type { B7BrowserToolRegistryDeps } from '../tool-registry/create-b7-browser-registry';
import { createB7BrowserRegistry } from '../tool-registry/create-b7-browser-registry';
import type { ToolExecutor } from '../tool-registry/tool-executor';
import type { ToolPolicyGate } from '../tool-registry/tool-policy';
import type { ToolRegistry } from '../tool-registry/tool-registry';
import { AgentLoopService, type AgentLoopServiceDeps } from './agent-loop.service';
import type { AgentLoopBudgets, AgentLoopPersistedState } from './agent-loop.types';
import type { AgentLoopEvidenceStore } from './agent-loop.persistence';

export interface CreateAgentLoopCompositionInput extends B7BrowserToolRegistryDeps {
  readonly projectId: string;
  readonly persistence: AgentLoopEvidenceStore;
  readonly budgets?: Partial<AgentLoopBudgets>;
  readonly clock?: { now(): Date };
}

/**
 * Production B6/B7 composition: B1–B7 registry (via createB7BrowserRegistry) + AgentLoopService.
 * Providers remain toolCalling:false; loop never executes GIT_WRITE autonomously.
 * BROWSER observation requires distinct browserObservationApproved evidence (ADR-043).
 */
export function createAgentLoopComposition(input: CreateAgentLoopCompositionInput): {
  readonly registry: ToolRegistry;
  readonly policy: ToolPolicyGate;
  readonly executor: ToolExecutor;
  readonly loop: AgentLoopService;
} {
  const { registry, policy, executor } = createB7BrowserRegistry(input);
  assertNoForbiddenToolsRegistered(registry);
  const loop = new AgentLoopService({
    projectId: input.projectId,
    registry,
    executor,
    persistence: input.persistence,
    budgets: input.budgets,
    clock: input.clock,
  });
  return { registry, policy, executor, loop };
}

export function createAgentLoopService(deps: AgentLoopServiceDeps): AgentLoopService {
  assertNoForbiddenToolsRegistered(deps.registry);
  return new AgentLoopService(deps);
}

function assertNoForbiddenToolsRegistered(registry: ToolRegistry): void {
  const ids = registry.listDefinitions().map((definition) => definition.toolId);
  for (const forbidden of [
    'file_apply',
    'approve_and_apply',
    'approveAndApply',
    'git_push',
    'run_shell',
    'mcp_call',
    'open_web',
    'http_fetch',
  ]) {
    if (ids.includes(forbidden)) {
      throw new Error(`Forbidden tool "${forbidden}" must not be registered for AgentLoop.`);
    }
  }
  if (ids.some((id) => id.startsWith('mcp_'))) {
    throw new Error('MCP tools must not be registered for AgentLoop.');
  }
}

/** In-memory evidence store for composition tests. */
export class InMemoryAgentLoopEvidencePersistence {
  readonly stateRoot = ':memory:';
  readonly projectId: string;
  private readonly byRun = new Map<string, AgentLoopPersistedState>();

  constructor(projectId: string) {
    this.projectId = projectId;
  }

  evidencePath(runId: string): string {
    return `:memory:/${this.projectId}/${runId}`;
  }

  async save(state: AgentLoopPersistedState): Promise<void> {
    if (state.projectId !== this.projectId) {
      throw new Error('project mismatch');
    }
    this.byRun.set(state.runId, structuredClone(state));
  }

  async load(runId: string): Promise<AgentLoopPersistedState | undefined> {
    const value = this.byRun.get(runId);
    return value === undefined ? undefined : structuredClone(value);
  }
}
