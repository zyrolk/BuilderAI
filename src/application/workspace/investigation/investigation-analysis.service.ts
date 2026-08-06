import type { ProviderExecutionPort } from '../workspace-runtime.types';
import { buildInvestigationExecutionRequest } from './investigation-prompt-package';
import { parseInvestigationReportJson } from './investigation-report.validator';
import type {
  InvestigationEvidence,
  InvestigationReport,
  RepositorySearchResult,
} from './investigation.types';

export interface InvestigationAnalysisInput {
  readonly investigationId: string;
  readonly request: string;
  readonly searchResult: RepositorySearchResult;
  readonly evidence: readonly InvestigationEvidence[];
  readonly correlationId: string;
  readonly requestedAt: string;
  readonly timeoutMs: number;
}

export interface InvestigationAnalysisPort {
  analyze(input: InvestigationAnalysisInput): Promise<InvestigationReport>;
}

export class DeterministicInvestigationAnalyzer implements InvestigationAnalysisPort {
  async analyze(input: InvestigationAnalysisInput): Promise<InvestigationReport> {
    const factEvidence = input.evidence.filter(({ claimKind }) => claimKind === 'FACT');
    const affectedAreas = [...new Set(input.evidence.map(({ logicalPath }) => logicalPath))].sort();
    const hasStrongEvidence = factEvidence.length >= 2;
    const limitations = [...input.searchResult.limitationMessages];

    if (input.evidence.length === 0) {
      limitations.push('Root cause not established with available evidence.');
      return {
        schemaVersion: 1,
        investigationId: input.investigationId,
        summary:
          'Insufficient repository evidence was found to establish a root cause for the reported problem.',
        confidence: 'LOW',
        hypotheses: [
          {
            summary:
              'The reported problem may involve code not matched by bounded repository search.',
            claimKind: 'UNKNOWN',
            supportingEvidencePaths: [],
          },
        ],
        evidence: [],
        affectedAreas: [],
        recommendedNextSteps: [
          'Provide explicit file paths, error messages, or reproduction steps.',
          'Prepare a focused fix only after evidence is sufficient.',
        ],
        limitations,
      };
    }

    const topPaths = affectedAreas.slice(0, 4);
    const summary = hasStrongEvidence
      ? `Repository search found relevant evidence in ${topPaths.join(', ')} related to the reported problem.`
      : 'Some related repository evidence was found, but a definitive root cause is not established.';

    return {
      schemaVersion: 1,
      investigationId: input.investigationId,
      summary,
      confidence: hasStrongEvidence ? 'MEDIUM' : 'LOW',
      hypotheses: [
        {
          summary: hasStrongEvidence
            ? 'The matched files likely participate in the reported behavior and should be reviewed together.'
            : 'Additional evidence is required before a reliable diagnosis can be made.',
          claimKind: hasStrongEvidence ? 'INFERENCE' : 'UNKNOWN',
          supportingEvidencePaths: topPaths,
        },
      ],
      evidence: input.evidence,
      ...(hasStrongEvidence
        ? {
            likelyRootCause:
              'Behavior likely originates in the matched implementation and its adjacent route/service/test files.',
          }
        : {}),
      affectedAreas: topPaths,
      recommendedNextSteps: [
        'Review cited evidence paths before preparing a fix.',
        'Use Prepare Fix to start a normal Gate 2 change plan when ready.',
      ],
      suggestedFixScope: topPaths.slice(0, 3).join(', '),
      limitations,
    };
  }
}

export class ProviderInvestigationAnalyzer implements InvestigationAnalysisPort {
  constructor(private readonly providerExecution: ProviderExecutionPort) {}

  async analyze(input: InvestigationAnalysisInput): Promise<InvestigationReport> {
    const executionRequest = buildInvestigationExecutionRequest({
      executionId: input.correlationId,
      request: input.request,
      searchResult: input.searchResult,
      evidence: input.evidence,
      requestedAt: input.requestedAt,
      timeoutMs: input.timeoutMs,
    });
    const providerOutput = await this.providerExecution.execute(executionRequest);
    const structured = providerOutput.providerResponse.artifacts.find(
      (artifact) => artifact.kind === 'STRUCTURED_DATA',
    );
    if (structured?.kind === 'STRUCTURED_DATA') {
      return parseInvestigationReportJson(JSON.stringify(structured.data), input.investigationId);
    }
    const textArtifact = providerOutput.providerResponse.artifacts.find(
      (artifact) => artifact.kind === 'TEXT',
    );
    if (textArtifact?.kind === 'TEXT') {
      return parseInvestigationReportJson(textArtifact.content, input.investigationId);
    }
    throw new Error('Provider response did not include investigation report content.');
  }
}
