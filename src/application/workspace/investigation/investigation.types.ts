import type { ResponseMetadata } from '../../../core/response-processor';

export const INVESTIGATION_REPORT_SCHEMA_VERSION = 1 as const;

export const INVESTIGATION_CONFIDENCE_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type InvestigationConfidence = (typeof INVESTIGATION_CONFIDENCE_LEVELS)[number];

export const INVESTIGATION_CLAIM_KINDS = ['FACT', 'INFERENCE', 'UNKNOWN'] as const;
export type InvestigationClaimKind = (typeof INVESTIGATION_CLAIM_KINDS)[number];

export interface InvestigationEvidence {
  readonly logicalPath: string;
  readonly lineStart?: number;
  readonly lineEnd?: number;
  readonly reason: string;
  readonly excerpt?: string;
  readonly claimKind: InvestigationClaimKind;
}

export interface InvestigationHypothesis {
  readonly summary: string;
  readonly claimKind: InvestigationClaimKind;
  readonly supportingEvidencePaths: readonly string[];
}

export interface InvestigationReport {
  readonly schemaVersion: typeof INVESTIGATION_REPORT_SCHEMA_VERSION;
  readonly investigationId: string;
  readonly summary: string;
  readonly confidence: InvestigationConfidence;
  readonly hypotheses: readonly InvestigationHypothesis[];
  readonly evidence: readonly InvestigationEvidence[];
  readonly likelyRootCause?: string;
  readonly affectedAreas: readonly string[];
  readonly recommendedNextSteps: readonly string[];
  readonly suggestedFixScope?: string;
  readonly limitations: readonly string[];
  readonly metadata?: ResponseMetadata;
}

export interface RepositorySearchMatch {
  readonly logicalPath: string;
  readonly lineNumber: number;
  readonly lineText: string;
  readonly query: string;
  readonly excerpt: string;
}

export interface RepositorySearchResult {
  readonly queries: readonly string[];
  readonly matches: readonly RepositorySearchMatch[];
  readonly filesScanned: number;
  readonly truncated: boolean;
  readonly limitationMessages: readonly string[];
}

export interface WorkspaceInvestigation {
  readonly investigationId: string;
  readonly request: string;
  readonly report: InvestigationReport;
  readonly searchResult: RepositorySearchResult;
  readonly repositorySourcePaths: readonly string[];
  readonly bounded: boolean;
}

export class InvestigationValidationError extends Error {
  constructor(readonly issues: readonly { readonly path: string; readonly message: string }[]) {
    super(
      issues.map(({ path, message }) => `${path}: ${message}`).join('; ') ||
        'Investigation report validation failed.',
    );
    this.name = 'InvestigationValidationError';
  }
}
