import { randomUUID } from 'node:crypto';

import type { WorkspaceProjectProfile } from '../../../core/target-project';
import type { WorkspacePathProtectionPolicy } from '../../../core/target-project/workspace-path-protection';
import { DEFAULT_WORKSPACE_PATH_PROTECTION } from '../../../core/target-project/workspace-path-protection';
import type { InvestigationReport } from '../investigation/investigation.types';
import {
  DEFAULT_PROJECT_MEMORY_CONFIGURATION,
  type ProjectMemoryConfiguration,
} from './project-memory-configuration';
import { ProjectMemoryPersistence } from './project-memory.persistence';
import {
  buildMemoryAugmentedRequest,
  ProjectMemoryRelevanceService,
} from './project-memory-relevance.service';
import {
  containsSecretLikeContent,
  sanitizeMemoryPaths,
  sanitizeMemorySummary,
} from './project-memory-sanitize';
import { pruneProjectMemory, validateProjectMemoryRecordInput } from './project-memory.validator';
import {
  ProjectMemoryPersistenceError,
  ProjectMemoryValidationError,
  type ExternalTargetProjectMemory,
  type ProjectMemoryContextSelection,
  type ProjectMemoryRecord,
  type ProjectMemoryRecordCategory,
} from './project-memory.types';

export interface ProjectMemoryServiceOptions {
  readonly projectRoot: string;
  readonly projectId: string;
  readonly profile: WorkspaceProjectProfile;
  readonly configuration?: ProjectMemoryConfiguration;
  readonly pathProtection?: WorkspacePathProtectionPolicy;
  readonly clock?: () => Date;
  readonly ids?: { generate(): string };
}

export interface SaveInvestigationMemoryInput {
  readonly investigationId: string;
  readonly requestSummary: string;
  readonly report: Pick<
    InvestigationReport,
    | 'summary'
    | 'confidence'
    | 'likelyRootCause'
    | 'affectedAreas'
    | 'recommendedNextSteps'
    | 'suggestedFixScope'
  >;
}

export interface SaveOperatorMemoryInput {
  readonly category: Extract<ProjectMemoryRecordCategory, 'DECISION' | 'FINDING'>;
  readonly summary: string;
  readonly supportingPaths?: readonly string[];
  readonly tags?: readonly string[];
}

export interface SaveVerifiedCompletedWorkInput {
  readonly preparationId: string;
  readonly summary: string;
  readonly supportingPaths: readonly string[];
  readonly source?: 'VERIFIED_APPLY' | 'FEATURE_TASK';
}

export class ProjectMemoryService {
  private readonly persistence: ProjectMemoryPersistence;
  private readonly relevance: ProjectMemoryRelevanceService;
  private readonly configuration: ProjectMemoryConfiguration;
  private readonly pathProtection: WorkspacePathProtectionPolicy;
  private readonly clock: () => Date;
  private readonly ids: { generate(): string };

  constructor(private readonly options: ProjectMemoryServiceOptions) {
    this.configuration = options.configuration ?? DEFAULT_PROJECT_MEMORY_CONFIGURATION;
    this.pathProtection = options.pathProtection ?? DEFAULT_WORKSPACE_PATH_PROTECTION;
    this.persistence = new ProjectMemoryPersistence(
      options.projectRoot,
      this.configuration,
      this.pathProtection,
    );
    this.relevance = new ProjectMemoryRelevanceService(this.configuration);
    this.clock = options.clock ?? (() => new Date());
    this.ids = options.ids ?? { generate: () => randomUUID() };
  }

  isEnabled(): boolean {
    return this.options.profile === 'EXTERNAL_TARGET';
  }

  async read(): Promise<ExternalTargetProjectMemory> {
    this.assertExternalTarget();
    return this.persistence.read(this.options.projectId);
  }

  async saveOperatorRecord(input: SaveOperatorMemoryInput): Promise<ExternalTargetProjectMemory> {
    this.assertExternalTarget();
    const record = validateProjectMemoryRecordInput(
      {
        id: this.ids.generate(),
        summary: input.summary,
        supportingPaths: input.supportingPaths ?? [],
        tags: input.tags,
        source: 'OPERATOR',
        status: 'ACTIVE',
      },
      input.category,
      this.configuration,
      this.pathProtection,
    );
    return this.appendRecord({
      ...record,
      updatedAt: this.clock().toISOString(),
    });
  }

  async saveInvestigationMemory(
    input: SaveInvestigationMemoryInput,
  ): Promise<ExternalTargetProjectMemory> {
    this.assertExternalTarget();
    const recommendedNextStepSummary = input.report.recommendedNextSteps[0];
    const supportingPaths = sanitizeMemoryPaths(
      [...input.report.affectedAreas, input.report.suggestedFixScope ?? ''].flatMap((value) =>
        value
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean),
      ),
      this.configuration.maximumSupportingPathsPerRecord,
      this.pathProtection,
    );
    const record = validateProjectMemoryRecordInput(
      {
        id: this.ids.generate(),
        investigationId: input.investigationId,
        summary: sanitizeMemorySummary(
          input.report.summary,
          this.configuration.maximumSummaryCharacters,
        ),
        confidence: input.report.confidence,
        likelyRootCause: input.report.likelyRootCause,
        affectedAreas: input.report.affectedAreas,
        recommendedNextStepSummary,
        supportingPaths,
        source: 'INVESTIGATION_SAVE',
        status: 'ACTIVE',
      },
      'INVESTIGATION',
      this.configuration,
      this.pathProtection,
    );
    return this.appendRecord({
      ...record,
      updatedAt: this.clock().toISOString(),
    });
  }

  async saveVerifiedCompletedWork(
    input: SaveVerifiedCompletedWorkInput,
  ): Promise<ExternalTargetProjectMemory | undefined> {
    this.assertExternalTarget();
    const memory = await this.read();
    if (
      memory.completedWork.some(
        ({ preparationId }) => preparationId !== undefined && preparationId === input.preparationId,
      )
    ) {
      return undefined;
    }
    const record = validateProjectMemoryRecordInput(
      {
        id: this.ids.generate(),
        summary: input.summary,
        supportingPaths: input.supportingPaths,
        preparationId: input.preparationId,
        verificationStatus: 'PASSED',
        source: input.source ?? 'VERIFIED_APPLY',
        status: 'ACTIVE',
      },
      'COMPLETED_WORK',
      this.configuration,
      this.pathProtection,
    );
    return this.appendRecord({
      ...record,
      updatedAt: this.clock().toISOString(),
    });
  }

  selectRelevantContext(input: {
    readonly request: string;
    readonly existingSourcePaths: readonly string[];
    readonly explicitPathHints?: readonly string[];
    readonly memoryBudget?: Pick<
      ProjectMemoryConfiguration,
      'maximumContextCharacters' | 'maximumRelevantRecords'
    >;
  }): Promise<ProjectMemoryContextSelection> {
    if (!this.isEnabled()) {
      return Promise.resolve({ records: [], renderedText: '', truncated: false });
    }
    const configuration =
      input.memoryBudget === undefined
        ? this.configuration
        : { ...this.configuration, ...input.memoryBudget };
    return this.read().then((memory) =>
      new ProjectMemoryRelevanceService(configuration).selectRelevant({
        request: input.request,
        memory,
        existingSourcePaths: input.existingSourcePaths,
        explicitPathHints: input.explicitPathHints,
        now: this.clock(),
      }),
    );
  }

  async augmentRequestWithMemory(input: {
    readonly request: string;
    readonly existingSourcePaths: readonly string[];
    readonly explicitPathHints?: readonly string[];
    readonly memoryBudget?: Pick<
      ProjectMemoryConfiguration,
      'maximumContextCharacters' | 'maximumRelevantRecords'
    >;
  }): Promise<{ readonly request: string; readonly memoryContext: ProjectMemoryContextSelection }> {
    const memoryContext = await this.selectRelevantContext(input);
    return {
      request: buildMemoryAugmentedRequest(input.request, memoryContext),
      memoryContext,
    };
  }

  private async appendRecord(record: ProjectMemoryRecord): Promise<ExternalTargetProjectMemory> {
    if (containsSecretLikeContent(JSON.stringify(record))) {
      throw new ProjectMemoryPersistenceError(
        'SECRET_CONTENT',
        'Project memory record contains suspicious secret-like content.',
      );
    }
    const current = await this.read();
    const updatedAt = record.updatedAt;
    const next = appendToCategory(current, record, updatedAt);
    const pruned = pruneProjectMemory(next, this.configuration);
    return this.persistence.write({ ...pruned, updatedAt });
  }

  private assertExternalTarget(): void {
    if (this.isEnabled()) return;
    throw new ProjectMemoryPersistenceError(
      'UNSUPPORTED_PROFILE',
      'Project memory is only available for EXTERNAL_TARGET projects.',
    );
  }
}

function appendToCategory(
  memory: ExternalTargetProjectMemory,
  record: ProjectMemoryRecord,
  updatedAt: string,
): ExternalTargetProjectMemory {
  switch (record.category) {
    case 'DECISION':
      return { ...memory, updatedAt, decisions: [...memory.decisions, record] };
    case 'COMPLETED_WORK':
      return { ...memory, updatedAt, completedWork: [...memory.completedWork, record] };
    case 'INVESTIGATION':
      return { ...memory, updatedAt, investigations: [...memory.investigations, record] };
    case 'FINDING':
      return { ...memory, updatedAt, findings: [...memory.findings, record] };
    default:
      throw new ProjectMemoryValidationError([
        { path: 'category', message: 'Unsupported project memory category.' },
      ]);
  }
}

export { ProjectMemoryPersistenceError, ProjectMemoryValidationError, buildMemoryAugmentedRequest };
