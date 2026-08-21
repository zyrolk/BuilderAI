import {
  AGENT_RUN_SCHEMA_VERSION,
  AgentRunError,
  type AgentRun,
  type AgentRunPhase,
  type AgentRunReferences,
  type CreateAgentRunInput,
} from './agent-run.types';
import {
  assertCanTransitionAgentRunPhase,
  isAgentRunTerminalPhase,
  statusForAgentRunPhase,
} from './agent-run-transitions';
import type { AgentRunPersistence } from './agent-run.persistence';
import { validateGoal, validateId, validateReferences } from './agent-run.validator';

/**
 * In-memory + durable AgentRun store. Orchestration only — never mutates targets,
 * never approves Gate 2, never applies ChangePlans.
 */
export class AgentRunService {
  private readonly runs = new Map<string, AgentRun>();
  private hydratePromise: Promise<void> | undefined;

  constructor(
    private readonly persistence: AgentRunPersistence,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async whenReady(): Promise<void> {
    if (this.hydratePromise === undefined) {
      this.hydratePromise = this.hydratePersistedRuns();
    }
    await this.hydratePromise;
  }

  /**
   * Hydration is inspection-only: restores phase/status/references.
   * Never auto-approves Gate 2 and never auto-applies.
   */
  async hydratePersistedRuns(): Promise<void> {
    const listed = await this.persistence.list();
    for (const run of listed) {
      this.runs.set(run.runId, run);
    }
  }

  async create(input: CreateAgentRunInput): Promise<AgentRun> {
    await this.whenReady();
    const runId = validateId(input.runId, 'runId');
    const projectId = validateId(input.projectId, 'projectId');
    if (projectId !== this.persistence.projectId) {
      throw new AgentRunError(
        'INVALID_REFERENCE',
        'AgentRun projectId does not match persistence projectId.',
      );
    }
    if (this.runs.has(runId)) {
      throw new AgentRunError('INVALID_REFERENCE', `AgentRun ${runId} already exists.`);
    }
    const goal = validateGoal(input.goal);
    const references = validateReferences(input.references ?? {});
    const createdAt = input.createdAt;
    const run: AgentRun = {
      schemaVersion: AGENT_RUN_SCHEMA_VERSION,
      runId,
      projectId,
      goal,
      phase: 'UNDERSTANDING',
      status: statusForAgentRunPhase('UNDERSTANDING'),
      references,
      createdAt,
      updatedAt: createdAt,
    };
    return this.commit(run);
  }

  async get(runId: string): Promise<AgentRun | undefined> {
    await this.whenReady();
    return this.runs.get(runId);
  }

  async require(runId: string): Promise<AgentRun> {
    const run = await this.get(runId);
    if (run === undefined) {
      throw new AgentRunError('NOT_FOUND', `AgentRun ${runId} not found.`);
    }
    return run;
  }

  async transition(runId: string, toPhase: AgentRunPhase): Promise<AgentRun> {
    await this.whenReady();
    const current = await this.require(runId);
    assertCanTransitionAgentRunPhase(current.phase, toPhase);
    const updated: AgentRun = {
      ...current,
      phase: toPhase,
      status: statusForAgentRunPhase(toPhase),
      updatedAt: this.now().toISOString(),
    };
    return this.commit(updated);
  }

  async updateReferences(runId: string, patch: AgentRunReferences): Promise<AgentRun> {
    await this.whenReady();
    const current = await this.require(runId);
    if (isAgentRunTerminalPhase(current.phase)) {
      throw new AgentRunError(
        'TERMINAL_STATE',
        `AgentRun phase ${current.phase} is terminal and cannot update references.`,
      );
    }
    const merged = validateReferences({
      ...current.references,
      ...patch,
    });
    const updated: AgentRun = {
      ...current,
      references: merged,
      updatedAt: this.now().toISOString(),
    };
    return this.commit(updated);
  }

  async cancel(runId: string): Promise<AgentRun> {
    await this.whenReady();
    const current = await this.require(runId);
    if (current.phase === 'CANCELLED') return current;
    if (isAgentRunTerminalPhase(current.phase)) {
      throw new AgentRunError(
        'TERMINAL_STATE',
        `AgentRun phase ${current.phase} is terminal and cannot be cancelled.`,
      );
    }
    assertCanTransitionAgentRunPhase(current.phase, 'CANCELLED');
    const updated: AgentRun = {
      ...current,
      phase: 'CANCELLED',
      status: 'CANCELLED',
      updatedAt: this.now().toISOString(),
    };
    return this.commit(updated);
  }

  listCached(): readonly AgentRun[] {
    return [...this.runs.values()];
  }

  private async commit(run: AgentRun): Promise<AgentRun> {
    try {
      await this.persistence.save(run);
    } catch (error: unknown) {
      if (error instanceof AgentRunError) throw error;
      throw new AgentRunError(
        'PERSISTENCE_FAILED',
        error instanceof Error ? error.message : 'AgentRun persistence failed.',
      );
    }
    this.runs.set(run.runId, run);
    return run;
  }
}
