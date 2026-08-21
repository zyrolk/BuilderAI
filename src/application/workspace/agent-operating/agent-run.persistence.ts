import path from 'node:path';

import {
  assertSafeStatePath,
  readJsonFile,
  writeJsonAtomically,
} from '../../../infrastructure/workflow-ledger/filesystem-safe-write';
import { WorkflowLedgerError } from '../../../core/workflow-ledger';
import { AGENT_RUN_SCHEMA_VERSION, AgentRunError, type AgentRun } from './agent-run.types';
import { parsePersistedAgentRun } from './agent-run.validator';

const AGENT_RUN_FILE = 'agent-run.json';

/**
 * Durable AgentRun metadata under the existing workflow state root.
 * Path: {stateRoot}/workflows/{projectId}/agent-runs/{runId}/agent-run.json
 */
export class AgentRunPersistence {
  readonly stateRoot: string;
  readonly projectId: string;

  constructor(stateRoot: string, projectId: string) {
    this.stateRoot = path.resolve(stateRoot);
    this.projectId = projectId;
  }

  runPath(runId: string): string {
    return path.join(
      this.stateRoot,
      'workflows',
      this.projectId,
      'agent-runs',
      runId,
      AGENT_RUN_FILE,
    );
  }

  async save(run: AgentRun): Promise<void> {
    if (run.projectId !== this.projectId) {
      throw new AgentRunError(
        'INVALID_REFERENCE',
        'AgentRun projectId does not match persistence projectId.',
      );
    }
    const filePath = this.runPath(run.runId);
    try {
      await writeJsonAtomically(this.stateRoot, filePath, run);
    } catch (error: unknown) {
      if (error instanceof WorkflowLedgerError && error.code === 'INVALID_PATH') {
        throw new AgentRunError('INVALID_REFERENCE', error.message);
      }
      throw new AgentRunError(
        'PERSISTENCE_FAILED',
        error instanceof Error ? error.message : 'AgentRun persistence failed.',
      );
    }
  }

  async load(runId: string): Promise<AgentRun | undefined> {
    const filePath = this.runPath(runId);
    try {
      await assertSafeStatePath(this.stateRoot, filePath);
    } catch (error: unknown) {
      if (error instanceof WorkflowLedgerError && error.code === 'INVALID_PATH') {
        throw new AgentRunError('INVALID_REFERENCE', error.message);
      }
      throw error;
    }
    let raw: unknown;
    try {
      raw = await readJsonFile<unknown>(filePath);
    } catch (error: unknown) {
      if (error instanceof WorkflowLedgerError && error.code === 'CORRUPT_STATE') {
        throw new AgentRunError('CORRUPT_STATE', 'AgentRun file is corrupt.');
      }
      throw error;
    }
    if (raw === undefined) return undefined;
    return parsePersistedAgentRun(raw, this.projectId);
  }

  async list(): Promise<readonly AgentRun[]> {
    const directory = path.join(this.stateRoot, 'workflows', this.projectId, 'agent-runs');
    let runIds: string[];
    try {
      const { readdir } = await import('node:fs/promises');
      runIds = await readdir(directory);
    } catch {
      return [];
    }
    const runs: AgentRun[] = [];
    for (const runId of runIds) {
      const run = await this.load(runId);
      if (run !== undefined) runs.push(run);
    }
    return runs;
  }
}

export function isAgentRunSchemaVersion(value: unknown): value is typeof AGENT_RUN_SCHEMA_VERSION {
  return value === AGENT_RUN_SCHEMA_VERSION;
}
