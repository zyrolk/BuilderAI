import { readdir } from 'node:fs/promises';
import path from 'node:path';

import {
  WORKFLOW_LEDGER_SCHEMA_VERSION,
  WORKFLOW_LEASE_SCHEMA_VERSION,
  buildEventDigest,
  deriveWorkflowStateFromEvent,
  verifyEventDigest,
  type AppendWorkflowEventInput,
  type ApplyRecoveryJournal,
  type RepositoryBaseline,
  type WorkflowEvent,
  type WorkflowLedgerPort,
  type WorkflowLease,
  type WorkflowManifest,
  WorkflowLedgerError,
  GENESIS_EVENT_DIGEST,
} from '../../core/workflow-ledger';
import {
  appendJsonLineAtomically,
  readJsonFile,
  readJsonLines,
  writeJsonAtomically,
} from './filesystem-safe-write';
import {
  DEFAULT_WORKFLOW_STATE_ROOT_CONFIGURATION,
  workflowDirectory,
  type WorkflowStateRootConfiguration,
} from './workflow-state-root.configuration';

const MANIFEST_FILE = 'manifest.json';
const EVENTS_FILE = 'events.jsonl';
const BASELINE_FILE = 'baseline.json';
const APPLY_JOURNAL_FILE = 'apply-journal.json';
const LEASE_FILE = 'lease.json';

export class FilesystemWorkflowLedgerStore implements WorkflowLedgerPort {
  constructor(
    private readonly configuration: WorkflowStateRootConfiguration = DEFAULT_WORKFLOW_STATE_ROOT_CONFIGURATION,
  ) {}

  async createWorkflow(input: {
    readonly workflowId: string;
    readonly projectId: string;
    readonly repositoryRoot: string;
    readonly originalRequest: string;
    readonly normalizedRequest?: string;
    readonly acceptanceCriteria?: string;
    readonly timestamp: string;
  }): Promise<WorkflowManifest> {
    const directory = workflowDirectory(this.configuration, input.projectId, input.workflowId);
    const manifestPath = path.join(directory, MANIFEST_FILE);
    const existing = await readJsonFile<WorkflowManifest>(manifestPath);
    if (existing !== undefined) {
      return existing;
    }

    const manifest: WorkflowManifest = {
      schemaVersion: WORKFLOW_LEDGER_SCHEMA_VERSION,
      workflowId: input.workflowId,
      projectId: input.projectId,
      repositoryRoot: path.resolve(input.repositoryRoot),
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
      workflowState: 'CREATED',
      classification: 'RESUMABLE',
      requestProvenance: {
        originalRequest: input.originalRequest,
        ...(input.normalizedRequest === undefined
          ? {}
          : { normalizedRequest: input.normalizedRequest }),
        ...(input.acceptanceCriteria === undefined
          ? {}
          : { acceptanceCriteria: input.acceptanceCriteria }),
      },
      lastEventSequence: 0,
      lastEventDigest: GENESIS_EVENT_DIGEST,
    };

    await writeJsonAtomically(this.configuration.stateRoot, manifestPath, manifest);
    await this.appendEvent({
      workflowId: input.workflowId,
      eventType: 'WORKFLOW_CREATED',
      payload: {
        projectId: input.projectId,
        repositoryRoot: manifest.repositoryRoot,
      },
      eventId: `${input.workflowId}-created`,
      timestamp: input.timestamp,
    });
    const created = await this.findManifest(input.workflowId, input.projectId);
    if (created === undefined) {
      throw new WorkflowLedgerError('PERSISTENCE_FAILED', 'Workflow manifest was not persisted.');
    }
    return created;
  }

  async appendEvent(input: AppendWorkflowEventInput): Promise<WorkflowEvent> {
    const manifest = await this.requireManifestByWorkflowId(input.workflowId);
    const eventsPath = path.join(
      workflowDirectory(this.configuration, manifest.projectId, manifest.workflowId),
      EVENTS_FILE,
    );
    const events = await readJsonLines<WorkflowEvent>(eventsPath);
    const previous = events.at(-1);
    const sequence = (previous?.sequence ?? 0) + 1;
    const previousEventDigest = previous?.eventDigest ?? GENESIS_EVENT_DIGEST;

    const withoutDigest: Omit<WorkflowEvent, 'eventDigest'> = {
      eventId: input.eventId,
      workflowId: input.workflowId,
      sequence,
      eventType: input.eventType,
      timestamp: input.timestamp,
      payload: input.payload,
      previousEventDigest,
      schemaVersion: WORKFLOW_LEDGER_SCHEMA_VERSION,
    };
    const event: WorkflowEvent = {
      ...withoutDigest,
      eventDigest: buildEventDigest(withoutDigest),
    };

    await appendJsonLineAtomically(this.configuration.stateRoot, eventsPath, event);
    await this.updateManifestFromEvent(manifest, event);
    return event;
  }

  async readManifest(workflowId: string): Promise<WorkflowManifest | undefined> {
    return this.findManifest(workflowId);
  }

  private async findManifest(
    workflowId: string,
    projectId?: string,
  ): Promise<WorkflowManifest | undefined> {
    if (projectId !== undefined) {
      const manifestPath = path.join(
        workflowDirectory(this.configuration, projectId, workflowId),
        MANIFEST_FILE,
      );
      return readJsonFile<WorkflowManifest>(manifestPath);
    }
    const projectsRoot = path.join(
      this.configuration.stateRoot,
      this.configuration.workflowsDirectoryName,
    );
    let projectIds: string[];
    try {
      projectIds = await readdir(projectsRoot);
    } catch {
      return undefined;
    }
    for (const candidateProjectId of projectIds) {
      const manifestPath = path.join(
        workflowDirectory(this.configuration, candidateProjectId, workflowId),
        MANIFEST_FILE,
      );
      const manifest = await readJsonFile<WorkflowManifest>(manifestPath);
      if (manifest !== undefined) return manifest;
    }
    return undefined;
  }

  async listWorkflows(projectId: string): Promise<readonly WorkflowManifest[]> {
    const projectDirectory = path.join(
      this.configuration.stateRoot,
      this.configuration.workflowsDirectoryName,
      projectId,
    );
    let workflowIds: string[];
    try {
      workflowIds = await readdir(projectDirectory);
    } catch {
      return [];
    }
    const manifests: WorkflowManifest[] = [];
    for (const workflowId of workflowIds) {
      const manifest = await readJsonFile<WorkflowManifest>(
        path.join(projectDirectory, workflowId, MANIFEST_FILE),
      );
      if (manifest !== undefined) manifests.push(manifest);
    }
    return manifests;
  }

  async readEvents(workflowId: string): Promise<readonly WorkflowEvent[]> {
    const manifest = await this.requireManifestByWorkflowId(workflowId);
    const eventsPath = path.join(
      workflowDirectory(this.configuration, manifest.projectId, manifest.workflowId),
      EVENTS_FILE,
    );
    const events = await readJsonLines<WorkflowEvent>(eventsPath);
    this.validateEventChain(events);
    return events;
  }

  async saveBaseline(workflowId: string, baseline: RepositoryBaseline): Promise<void> {
    const manifest = await this.requireManifestByWorkflowId(workflowId);
    const baselinePath = path.join(
      workflowDirectory(this.configuration, manifest.projectId, manifest.workflowId),
      BASELINE_FILE,
    );
    await writeJsonAtomically(this.configuration.stateRoot, baselinePath, baseline);
    await this.appendEvent({
      workflowId,
      eventType: 'BASELINE_CAPTURED',
      payload: {
        baselineDigest: baseline.baselineDigest,
        gitAvailable: baseline.gitAvailable,
        headCommit: baseline.headCommit ?? null,
        branch: baseline.branch ?? null,
      },
      eventId: `${workflowId}-baseline-${baseline.capturedAt}`,
      timestamp: baseline.capturedAt,
    });
  }

  async readBaseline(workflowId: string): Promise<RepositoryBaseline | undefined> {
    const manifest = await this.requireManifestByWorkflowId(workflowId);
    const baselinePath = path.join(
      workflowDirectory(this.configuration, manifest.projectId, manifest.workflowId),
      BASELINE_FILE,
    );
    return readJsonFile<RepositoryBaseline>(baselinePath);
  }

  async saveApplyJournal(workflowId: string, journal: ApplyRecoveryJournal): Promise<void> {
    const manifest = await this.requireManifestByWorkflowId(workflowId);
    const journalPath = path.join(
      workflowDirectory(this.configuration, manifest.projectId, manifest.workflowId),
      APPLY_JOURNAL_FILE,
    );
    await writeJsonAtomically(this.configuration.stateRoot, journalPath, journal);
  }

  async readApplyJournal(workflowId: string): Promise<ApplyRecoveryJournal | undefined> {
    const manifest = await this.requireManifestByWorkflowId(workflowId);
    const journalPath = path.join(
      workflowDirectory(this.configuration, manifest.projectId, manifest.workflowId),
      APPLY_JOURNAL_FILE,
    );
    return readJsonFile<ApplyRecoveryJournal>(journalPath);
  }

  async acquireLease(input: {
    readonly workflowId: string;
    readonly ownerIdentity: string;
    readonly acquiredAt: string;
    readonly expiresAt: string;
  }): Promise<WorkflowLease> {
    const manifest = await this.requireManifestByWorkflowId(input.workflowId);
    const leasePath = path.join(
      workflowDirectory(this.configuration, manifest.projectId, manifest.workflowId),
      LEASE_FILE,
    );
    const existing = await readJsonFile<WorkflowLease>(leasePath);
    if (
      existing !== undefined &&
      existing.ownerIdentity !== input.ownerIdentity &&
      Date.parse(existing.expiresAt) > Date.parse(input.acquiredAt)
    ) {
      throw new WorkflowLedgerError(
        'LEASE_HELD',
        `Workflow lease is held by ${existing.ownerIdentity}.`,
      );
    }
    const lease: WorkflowLease = {
      schemaVersion: WORKFLOW_LEASE_SCHEMA_VERSION,
      workflowId: input.workflowId,
      ownerIdentity: input.ownerIdentity,
      acquiredAt: input.acquiredAt,
      expiresAt: input.expiresAt,
    };
    await writeJsonAtomically(this.configuration.stateRoot, leasePath, lease);
    return lease;
  }

  async readLease(workflowId: string): Promise<WorkflowLease | undefined> {
    const manifest = await this.requireManifestByWorkflowId(workflowId);
    const leasePath = path.join(
      workflowDirectory(this.configuration, manifest.projectId, manifest.workflowId),
      LEASE_FILE,
    );
    return readJsonFile<WorkflowLease>(leasePath);
  }

  async releaseLease(workflowId: string, ownerIdentity: string): Promise<void> {
    const manifest = await this.requireManifestByWorkflowId(workflowId);
    const leasePath = path.join(
      workflowDirectory(this.configuration, manifest.projectId, manifest.workflowId),
      LEASE_FILE,
    );
    const existing = await readJsonFile<WorkflowLease>(leasePath);
    if (existing === undefined) return;
    if (existing.ownerIdentity !== ownerIdentity) {
      throw new WorkflowLedgerError('LEASE_STALE', 'Workflow lease owner does not match release.');
    }
    await writeJsonAtomically(this.configuration.stateRoot, leasePath, {
      ...existing,
      expiresAt: new Date(0).toISOString(),
    });
  }

  validateEventChain(events: readonly WorkflowEvent[]): void {
    let previousDigest = GENESIS_EVENT_DIGEST;
    for (const event of events) {
      if (event.previousEventDigest !== previousDigest) {
        throw new WorkflowLedgerError(
          'EVENT_CHAIN_INVALID',
          `Event ${event.eventId} has invalid previous digest.`,
        );
      }
      if (!verifyEventDigest(event)) {
        throw new WorkflowLedgerError(
          'EVENT_TAMPERED',
          `Event ${event.eventId} digest does not match payload.`,
        );
      }
      previousDigest = event.eventDigest;
    }
  }

  private async requireManifestByWorkflowId(workflowId: string): Promise<WorkflowManifest> {
    const manifest = await this.readManifest(workflowId);
    if (manifest === undefined) {
      throw new WorkflowLedgerError('WORKFLOW_NOT_FOUND', `Workflow ${workflowId} was not found.`);
    }
    return manifest;
  }

  private async updateManifestFromEvent(
    manifest: WorkflowManifest,
    event: WorkflowEvent,
  ): Promise<void> {
    const updated: WorkflowManifest = {
      ...manifest,
      updatedAt: event.timestamp,
      workflowState: deriveWorkflowStateFromEvent(manifest.workflowState, event.eventType),
      lastEventSequence: event.sequence,
      lastEventDigest: event.eventDigest,
      ...(event.payload.baselineDigest !== undefined &&
      typeof event.payload.baselineDigest === 'string'
        ? { baselineDigest: event.payload.baselineDigest }
        : {}),
      ...(event.payload.preparationId !== undefined &&
      typeof event.payload.preparationId === 'string'
        ? { preparationId: event.payload.preparationId }
        : {}),
    };
    const manifestPath = path.join(
      workflowDirectory(this.configuration, manifest.projectId, manifest.workflowId),
      MANIFEST_FILE,
    );
    await writeJsonAtomically(this.configuration.stateRoot, manifestPath, updated);
  }
}
