import type { ProjectFileSource } from '../../../core/context-builder';
import type { WorkspacePathProtectionPolicy } from '../../../core/target-project/workspace-path-protection';
import { DEFAULT_WORKSPACE_PATH_PROTECTION } from '../../../core/target-project/workspace-path-protection';
import type { WorkspaceProjectProfile } from '../../../core/target-project/workspace-project-profile.types';
import { assertExternalTargetWorkflowAllowed } from '../external-target-readiness';
import type { ExternalTargetReadiness } from '../external-target-readiness';
import type { ProjectMemoryService } from '../project-memory/project-memory.service';
import type {
  WorkspaceRuntimeClock,
  WorkspaceRuntimeIdGenerator,
  WorkspaceRuntimeLogger,
} from '../workspace-runtime.types';
import { WorkspaceRuntimeError } from '../workspace-runtime.types';
import {
  DeterministicInvestigationAnalyzer,
  type InvestigationAnalysisPort,
} from './investigation-analysis.service';
import {
  buildInvestigationRankingContext,
  mergeRepositoryEvidence,
} from './investigation-path-ranking';
import {
  DEFAULT_INVESTIGATION_CONFIGURATION,
  type InvestigationConfiguration,
} from './investigation-configuration';
import { EvidenceExpansionService } from './evidence-expansion.service';
import { InvestigationReportValidator } from './investigation-report.validator';
import { RepositorySearchService } from './repository-search.service';
import { extractSearchQueries } from './search-query-extraction';
import type { WorkspaceInvestigation } from './investigation.types';
import { InvestigationValidationError } from './investigation.types';
import {
  buildInvestigationHandoffFeedback,
  type InvestigationHandoffFeedback,
} from './investigation-handoff';
import type { InvestigationHandoffStore } from './investigation-continuity';

export interface InvestigationServiceDependencies {
  readonly sourceFiles: ProjectFileSource;
  readonly analyzer: InvestigationAnalysisPort;
  readonly clock: WorkspaceRuntimeClock;
  readonly ids: WorkspaceRuntimeIdGenerator;
  readonly logger: WorkspaceRuntimeLogger;
  readonly configuration?: InvestigationConfiguration;
  readonly providerTimeoutMs?: number;
  readonly projectMemory?: ProjectMemoryService;
  readonly pathProtection?: WorkspacePathProtectionPolicy;
  readonly projectProfile?: WorkspaceProjectProfile;
  readonly evaluateExternalTargetReadiness?: () => Promise<ExternalTargetReadiness | undefined>;
  readonly handoffStore?: InvestigationHandoffStore;
}

export class InvestigationService {
  private readonly configuration: InvestigationConfiguration;
  private readonly repositorySearch: RepositorySearchService;
  private readonly evidenceExpansion: EvidenceExpansionService;
  private readonly reportValidator: InvestigationReportValidator;

  constructor(private readonly dependencies: InvestigationServiceDependencies) {
    this.configuration = dependencies.configuration ?? DEFAULT_INVESTIGATION_CONFIGURATION;
    const pathProtection = dependencies.pathProtection ?? DEFAULT_WORKSPACE_PATH_PROTECTION;
    this.repositorySearch = new RepositorySearchService(this.configuration, pathProtection);
    this.evidenceExpansion = new EvidenceExpansionService(this.configuration, pathProtection);
    this.reportValidator = new InvestigationReportValidator(this.configuration);
  }

  async investigate(request: string): Promise<WorkspaceInvestigation> {
    if (this.dependencies.projectProfile === 'EXTERNAL_TARGET') {
      const readiness = this.dependencies.evaluateExternalTargetReadiness
        ? await this.dependencies.evaluateExternalTargetReadiness()
        : undefined;
      assertExternalTargetWorkflowAllowed(
        this.dependencies.projectProfile,
        readiness,
        'INVESTIGATE',
      );
    }
    const normalizedRequest = request.trim();
    if (normalizedRequest.length === 0 || normalizedRequest.length > 4_000) {
      throw new WorkspaceRuntimeError('INVALID_REQUEST', 'Investigation request is invalid.');
    }

    const investigationId = this.dependencies.ids.generate();
    const startedAt = this.dependencies.clock.now();
    this.log(investigationId, 'INVESTIGATE', 'STARTED');

    try {
      const sourcePaths = await this.dependencies.sourceFiles.listSourcePaths();
      let requestForAnalysis = normalizedRequest;
      if (this.dependencies.projectMemory?.isEnabled()) {
        const augmented = await this.dependencies.projectMemory.augmentRequestWithMemory({
          request: normalizedRequest,
          existingSourcePaths: sourcePaths,
        });
        requestForAnalysis = augmented.request;
      }
      const queries = extractSearchQueries(
        requestForAnalysis,
        this.configuration.maximumSearchQueries,
      );
      const readFile = (logicalPath: string) =>
        this.dependencies.sourceFiles.readSourceFile(logicalPath);
      const searchResult = await this.repositorySearch.search(
        sourcePaths,
        queries,
        readFile,
        requestForAnalysis,
      );

      const matchedPaths = [...new Set(searchResult.matches.map(({ logicalPath }) => logicalPath))];
      const fileContents: Record<string, string> = {};
      for (const logicalPath of matchedPaths) {
        try {
          fileContents[logicalPath] = await readFile(logicalPath);
        } catch {
          continue;
        }
      }

      const expansionCandidates = this.evidenceExpansion.collectCandidatePaths(
        searchResult.matches,
        sourcePaths,
        fileContents,
        queries,
      );
      for (const logicalPath of expansionCandidates) {
        if (fileContents[logicalPath] !== undefined) continue;
        try {
          fileContents[logicalPath] = await readFile(logicalPath);
        } catch {
          continue;
        }
      }

      const evidence = this.evidenceExpansion.expandFromMatches(
        searchResult.matches,
        sourcePaths,
        fileContents,
        requestForAnalysis,
        queries,
      );

      const rankingContext = buildInvestigationRankingContext({
        requestText: requestForAnalysis,
        queries,
      });
      const analyzed = await this.dependencies.analyzer.analyze({
        investigationId,
        request: requestForAnalysis,
        searchResult,
        evidence,
        correlationId: investigationId,
        requestedAt: startedAt.toISOString(),
        timeoutMs: this.dependencies.providerTimeoutMs ?? 120_000,
      });
      const report = this.reportValidator.validate(
        {
          ...analyzed,
          evidence: mergeRepositoryEvidence(
            analyzed.evidence,
            evidence,
            rankingContext,
            searchResult.matches,
            this.configuration.maximumEvidenceFiles,
          ),
        },
        investigationId,
      );

      const handoff = buildInvestigationHandoffFeedback({
        sourceInvestigationId: investigationId,
        priorRequestSummary: normalizedRequest,
        investigationSummary: report.summary,
        ...(report.suggestedFixScope === undefined
          ? {}
          : { suggestedFixScope: report.suggestedFixScope }),
        sourcePaths,
        requestText: requestForAnalysis,
        queries,
        evidence: report.evidence,
        searchMatches: searchResult.matches,
        hypotheses: report.hypotheses,
        affectedAreas: report.affectedAreas,
        ...(report.likelyRootCause === undefined
          ? {}
          : { likelyRootCause: report.likelyRootCause }),
      });
      this.dependencies.handoffStore?.save(handoff);

      this.log(investigationId, 'INVESTIGATE', 'SUCCEEDED', startedAt);
      return {
        investigationId,
        request: normalizedRequest,
        report,
        searchResult,
        repositorySourcePaths: sourcePaths,
        bounded: searchResult.truncated,
      };
    } catch (error: unknown) {
      this.log(investigationId, 'INVESTIGATE', 'FAILED', startedAt, safeCode(error));
      if (error instanceof WorkspaceRuntimeError) throw error;
      if (error instanceof InvestigationValidationError) {
        throw new WorkspaceRuntimeError('WORKFLOW_FAILED', error.message);
      }
      throw new WorkspaceRuntimeError(
        'WORKFLOW_FAILED',
        error instanceof Error ? error.message : 'Investigation failed.',
      );
    }
  }

  resolveInvestigationHandoff(investigationId: string): InvestigationHandoffFeedback | undefined {
    if (!/^[A-Za-z0-9-]{1,128}$/u.test(investigationId)) return undefined;
    return this.dependencies.handoffStore?.resolve(investigationId);
  }

  private log(
    correlationId: string,
    stage: string,
    outcome: 'STARTED' | 'SUCCEEDED' | 'FAILED',
    startedAt?: Date,
    code?: string,
  ): void {
    this.dependencies.logger.record({
      correlationId,
      stage,
      outcome,
      ...(startedAt === undefined
        ? {}
        : {
            durationMs: Math.max(0, this.dependencies.clock.now().getTime() - startedAt.getTime()),
          }),
      ...(code === undefined ? {} : { code }),
    });
  }
}

export function createDefaultInvestigationService(
  dependencies: Omit<InvestigationServiceDependencies, 'analyzer'> & {
    readonly analyzer?: InvestigationAnalysisPort;
  },
): InvestigationService {
  return new InvestigationService({
    ...dependencies,
    analyzer: dependencies.analyzer ?? new DeterministicInvestigationAnalyzer(),
  });
}

function safeCode(error: unknown): string {
  return error instanceof Error ? error.name : 'UNKNOWN';
}
