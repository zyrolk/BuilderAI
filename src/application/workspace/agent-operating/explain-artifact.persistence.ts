import path from 'node:path';

import {
  assertSafeStatePath,
  readJsonFile,
  writeJsonAtomically,
} from '../../../infrastructure/workflow-ledger/filesystem-safe-write';
import { WorkflowLedgerError } from '../../../core/workflow-ledger';
import { AgentRunError } from './agent-run.types';
import { EXPLAIN_ARTIFACT_SCHEMA_VERSION, type ExplainArtifact } from './explain-artifact.types';

const EXPLAIN_ARTIFACT_FILE = 'explain-artifact.json';

/**
 * Durable ExplainArtifact beside AgentRun metadata.
 * Path: {stateRoot}/workflows/{projectId}/agent-runs/{runId}/explain-artifact.json
 */
export class ExplainArtifactPersistence {
  readonly stateRoot: string;
  readonly projectId: string;

  constructor(stateRoot: string, projectId: string) {
    this.stateRoot = path.resolve(stateRoot);
    this.projectId = projectId;
  }

  artifactPath(runId: string): string {
    return path.join(
      this.stateRoot,
      'workflows',
      this.projectId,
      'agent-runs',
      runId,
      EXPLAIN_ARTIFACT_FILE,
    );
  }

  async save(artifact: ExplainArtifact): Promise<void> {
    if (artifact.projectId !== this.projectId) {
      throw new AgentRunError(
        'INVALID_REFERENCE',
        'ExplainArtifact projectId does not match persistence projectId.',
      );
    }
    const filePath = this.artifactPath(artifact.runId);
    try {
      await writeJsonAtomically(this.stateRoot, filePath, artifact);
    } catch (error: unknown) {
      if (error instanceof WorkflowLedgerError && error.code === 'INVALID_PATH') {
        throw new AgentRunError('INVALID_REFERENCE', error.message);
      }
      throw new AgentRunError(
        'PERSISTENCE_FAILED',
        error instanceof Error ? error.message : 'ExplainArtifact persistence failed.',
      );
    }
  }

  async load(runId: string): Promise<ExplainArtifact | undefined> {
    const filePath = this.artifactPath(runId);
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
        throw new AgentRunError('CORRUPT_STATE', 'ExplainArtifact file is corrupt.');
      }
      throw error;
    }
    if (raw === undefined) return undefined;
    return parsePersistedExplainArtifact(raw, this.projectId, runId);
  }
}

export function parsePersistedExplainArtifact(
  raw: unknown,
  projectId: string,
  runId: string,
): ExplainArtifact {
  if (typeof raw !== 'object' || raw === null) {
    throw new AgentRunError('CORRUPT_STATE', 'ExplainArtifact must be an object.');
  }
  const schemaVersion = Reflect.get(raw, 'schemaVersion');
  if (schemaVersion !== EXPLAIN_ARTIFACT_SCHEMA_VERSION) {
    throw new AgentRunError('CORRUPT_STATE', 'Unsupported ExplainArtifact schemaVersion.');
  }
  const artifact = raw as ExplainArtifact;
  if (artifact.projectId !== projectId || artifact.runId !== runId) {
    throw new AgentRunError('CORRUPT_STATE', 'ExplainArtifact identity mismatch.');
  }
  if (artifact.toolLoop === undefined) {
    return {
      ...artifact,
      toolLoop: {
        availability: {
          status: 'UNAVAILABLE',
          reason: 'No bounded AgentLoop tool evidence is available for this AgentRun.',
        },
      },
    };
  }
  return artifact;
}
