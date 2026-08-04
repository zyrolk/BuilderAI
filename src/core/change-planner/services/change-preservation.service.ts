import type { ChangePlannerConfiguration } from '../config';
import type { WorkspaceBaselinePort } from '../ports';
import type {
  ProjectChangeOperation,
  ProjectChangeRisk,
  ProjectChangeWarning,
  UpdateFileOperation,
  UpdatePreservationAssessment,
  UpdatePreservationFinding,
} from '../types';
import { compareText } from '../validators/validation-helpers';
import { UpdatePreservationAnalysisService } from './update-preservation-analysis.service';

const HTML_SCRIPT_SRC_PATTERN = /<script[^>]+src=["'](assets\/[^"']+\.js)["']/gi;

export interface PreservationEnrichmentResult {
  readonly operations: readonly ProjectChangeOperation[];
  readonly warnings: readonly ProjectChangeWarning[];
  readonly risks: readonly ProjectChangeRisk[];
}

export class ChangePreservationService {
  constructor(
    private readonly configuration: ChangePlannerConfiguration,
    private readonly analysisService: UpdatePreservationAnalysisService = new UpdatePreservationAnalysisService(),
  ) {}

  enrichOperations(
    operations: readonly ProjectChangeOperation[],
    baselinePort: WorkspaceBaselinePort,
  ): PreservationEnrichmentResult {
    const warnings: ProjectChangeWarning[] = [];
    const risks: ProjectChangeRisk[] = [];
    const enrichedOperations = operations.map((operation) => {
      if (operation.kind !== 'UPDATE_FILE') return operation;
      return this.enrichUpdateOperation(operation, operations, baselinePort, warnings, risks);
    });
    return {
      operations: enrichedOperations,
      warnings: warnings.sort(
        (left, right) =>
          compareText(left.code, right.code) || compareText(left.message, right.message),
      ),
      risks: risks.sort((left, right) => compareText(left.code, right.code)),
    };
  }

  private enrichUpdateOperation(
    operation: UpdateFileOperation,
    allOperations: readonly ProjectChangeOperation[],
    baselinePort: WorkspaceBaselinePort,
    warnings: ProjectChangeWarning[],
    risks: ProjectChangeRisk[],
  ): UpdateFileOperation {
    const baseline = baselinePort.readTextBaseline(operation.logicalPath);
    if (baseline === null) {
      warnings.push({
        code: 'PRESERVATION_BASELINE_UNAVAILABLE',
        message: `Baseline content for '${operation.logicalPath}' is unavailable; preservation analysis was skipped.`,
        operationIds: [operation.operationId],
      });
      return operation;
    }

    const siblingJsContents = this.collectSiblingJsContents(
      operation,
      baseline.content,
      allOperations,
      baselinePort,
    );
    const analysis = this.analysisService.analyzeSynchronously({
      logicalPath: operation.logicalPath,
      baselineContent: baseline.content,
      proposedContent: operation.content,
      siblingJsContents,
      baselineContentChecksum: baseline.checksum,
    });
    const findings = this.buildFindings(analysis);
    const preservation: UpdatePreservationAssessment = {
      baselineContentChecksum: analysis.baselineContentChecksum,
      baselineBytes: analysis.baselineBytes,
      proposedBytes: analysis.proposedBytes,
      baselineLines: analysis.baselineLines,
      proposedLines: analysis.proposedLines,
      linesAdded: analysis.linesAdded,
      linesDeleted: analysis.linesDeleted,
      linesUnchanged: analysis.linesUnchanged,
      churnRatio: analysis.churnRatio,
      similarityRatio: analysis.similarityRatio,
      removedHtmlIds: analysis.removedHtmlIds,
      addedHtmlIds: analysis.addedHtmlIds,
      removedAccessibilityAttributes: analysis.removedAccessibilityAttributes,
      crossFileReferenceRisks: analysis.crossFileReferenceRisks,
      findings,
    };

    this.appendPlanSignals(operation.operationId, analysis, findings, warnings, risks);

    return {
      ...operation,
      baselineContentChecksum: analysis.baselineContentChecksum,
      preservation,
    };
  }

  private collectSiblingJsContents(
    operation: UpdateFileOperation,
    baselineContent: string,
    allOperations: readonly ProjectChangeOperation[],
    baselinePort: WorkspaceBaselinePort,
  ): readonly { readonly logicalPath: string; readonly content: string }[] {
    if (!operation.logicalPath.toLowerCase().endsWith('.html')) return [];

    const mutatedPaths = new Set(
      allOperations
        .filter(({ kind }) => kind === 'UPDATE_FILE' || kind === 'DELETE_FILE')
        .map(({ logicalPath }) => logicalPath),
    );

    const candidates = new Set<string>();
    for (const match of baselineContent.matchAll(HTML_SCRIPT_SRC_PATTERN)) {
      const scriptPath = match[1];
      if (
        scriptPath !== undefined &&
        scriptPath.startsWith('assets/') &&
        scriptPath.endsWith('.js')
      ) {
        candidates.add(scriptPath);
      }
    }

    const siblings: { readonly logicalPath: string; readonly content: string }[] = [];
    for (const logicalPath of [...candidates].sort(compareText)) {
      if (mutatedPaths.has(logicalPath)) continue;
      const snapshot = baselinePort.readTextBaseline(logicalPath);
      if (snapshot === null) continue;
      siblings.push({ logicalPath, content: snapshot.content });
      if (siblings.length >= this.configuration.preservation.maximumCrossFileChecks) break;
    }
    return siblings;
  }

  private buildFindings(
    analysis: ReturnType<UpdatePreservationAnalysisService['analyzeSynchronously']>,
  ): readonly UpdatePreservationFinding[] {
    const findings: UpdatePreservationFinding[] = [];
    const { preservation } = this.configuration;

    if (analysis.churnRatio >= preservation.highChurnThreshold) {
      findings.push({
        code: 'PRESERVATION_HIGH_CHURN_REWRITE',
        severity: 'HIGH',
        message: `Update churn ratio ${analysis.churnRatio.toFixed(4)} exceeds the high threshold (${preservation.highChurnThreshold}).`,
      });
    } else if (analysis.churnRatio >= preservation.elevatedChurnThreshold) {
      findings.push({
        code: 'PRESERVATION_ELEVATED_CHURN',
        severity: 'MEDIUM',
        message: `Update churn ratio ${analysis.churnRatio.toFixed(4)} is elevated (${preservation.elevatedChurnThreshold}–${preservation.highChurnThreshold}).`,
      });
    }

    if (analysis.removedHtmlIds.length > 0) {
      const listedIds = analysis.removedHtmlIds.slice(0, preservation.maximumListedHtmlIds);
      findings.push({
        code: 'PRESERVATION_REMOVED_HTML_ID',
        severity: 'MEDIUM',
        message: `Removed HTML ids: ${listedIds.join(', ')}.`,
      });
    }

    if (analysis.removedAccessibilityAttributes.length > 0) {
      findings.push({
        code: 'PRESERVATION_REMOVED_ARIA_ATTRIBUTE',
        severity: 'MEDIUM',
        message: `Removed accessibility attributes: ${analysis.removedAccessibilityAttributes.join(', ')}.`,
      });
    }

    if (analysis.crossFileReferenceRisks.length > 0) {
      const summary = analysis.crossFileReferenceRisks
        .map(({ removedId, referencingLogicalPath }) => `${removedId} in ${referencingLogicalPath}`)
        .join('; ');
      findings.push({
        code: 'PRESERVATION_CROSS_FILE_REFERENCE_RISK',
        severity: 'CRITICAL',
        message: `Removed HTML ids are still referenced by unchanged sibling files: ${summary}.`,
      });
    }

    if (analysis.largeDeletionSignal.isSuspicious) {
      findings.push({
        code: 'PRESERVATION_LARGE_DELETION',
        severity: 'MEDIUM',
        message: `Large deletion detected (${analysis.largeDeletionSignal.linesDeletedRatio.toFixed(4)} of baseline lines removed with limited replacement).`,
      });
    }

    return findings.sort(
      (left, right) =>
        compareText(left.code, right.code) || compareText(left.message, right.message),
    );
  }

  private appendPlanSignals(
    operationId: string,
    analysis: ReturnType<UpdatePreservationAnalysisService['analyzeSynchronously']>,
    findings: readonly UpdatePreservationFinding[],
    warnings: ProjectChangeWarning[],
    risks: ProjectChangeRisk[],
  ): void {
    const operationIds = [operationId];

    for (const finding of findings) {
      warnings.push({
        code: finding.code,
        message: finding.message,
        operationIds,
      });
    }

    if (analysis.churnRatio >= this.configuration.preservation.highChurnThreshold) {
      risks.push({
        code: 'HIGH_CHURN_REWRITE',
        severity: 'MEDIUM',
        message: 'An update operation proposes a high-churn rewrite that requires explicit review.',
        operationIds,
      });
    }

    if (analysis.crossFileReferenceRisks.length > 0) {
      risks.push({
        code: 'PRESERVATION_CROSS_FILE_REFERENCE_RISK',
        severity: 'HIGH',
        message:
          'An HTML update removes identifiers still referenced by unchanged sibling JavaScript files.',
        operationIds,
      });
    }
  }
}
