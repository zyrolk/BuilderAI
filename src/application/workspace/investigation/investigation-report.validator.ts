import {
  INVESTIGATION_CLAIM_KINDS,
  INVESTIGATION_CONFIDENCE_LEVELS,
  INVESTIGATION_REPORT_SCHEMA_VERSION,
  InvestigationValidationError,
  type InvestigationReport,
} from './investigation.types';
import {
  DEFAULT_INVESTIGATION_CONFIGURATION,
  type InvestigationConfiguration,
} from './investigation-configuration';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(
  value: unknown,
  path: string,
  issues: { path: string; message: string }[],
): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push({ path, message: 'must be a non-empty string' });
    return undefined;
  }
  return value.trim();
}

function readStringArray(
  value: unknown,
  path: string,
  maximum: number,
  issues: { path: string; message: string }[],
): readonly string[] {
  if (!Array.isArray(value)) {
    issues.push({ path, message: 'must be an array' });
    return [];
  }
  const items: string[] = [];
  for (const [index, entry] of value.entries()) {
    if (index >= maximum) break;
    const text = readString(entry, `${path}[${index}]`, issues);
    if (text !== undefined) items.push(text);
  }
  return items;
}

export class InvestigationReportValidator {
  constructor(
    private readonly configuration: InvestigationConfiguration = DEFAULT_INVESTIGATION_CONFIGURATION,
  ) {}

  validate(candidate: unknown, investigationId: string): InvestigationReport {
    const issues: { path: string; message: string }[] = [];
    if (!isRecord(candidate)) {
      throw new InvestigationValidationError([{ path: '$', message: 'must be an object' }]);
    }

    const schemaVersion = candidate.schemaVersion;
    if (schemaVersion !== INVESTIGATION_REPORT_SCHEMA_VERSION) {
      issues.push({ path: '$.schemaVersion', message: 'must be 1' });
    }

    const summary = readString(candidate.summary, '$.summary', issues) ?? '';
    const confidenceRaw = readString(candidate.confidence, '$.confidence', issues);
    const confidence =
      confidenceRaw !== undefined &&
      INVESTIGATION_CONFIDENCE_LEVELS.some((level) => level === confidenceRaw)
        ? (confidenceRaw as InvestigationReport['confidence'])
        : (issues.push({ path: '$.confidence', message: 'must be LOW, MEDIUM, or HIGH' }), 'LOW');

    const evidence = validateEvidence(candidate.evidence, issues);
    const hypotheses = validateHypotheses(candidate.hypotheses, issues);
    const likelyRootCause =
      candidate.likelyRootCause === undefined
        ? undefined
        : readString(candidate.likelyRootCause, '$.likelyRootCause', issues);
    const affectedAreas = readStringArray(
      candidate.affectedAreas,
      '$.affectedAreas',
      this.configuration.maximumEvidenceFiles,
      issues,
    );
    const recommendedNextSteps = readStringArray(
      candidate.recommendedNextSteps,
      '$.recommendedNextSteps',
      this.configuration.maximumRecommendedSteps,
      issues,
    );
    const suggestedFixScope =
      candidate.suggestedFixScope === undefined
        ? undefined
        : readString(candidate.suggestedFixScope, '$.suggestedFixScope', issues);
    const limitations = readStringArray(
      candidate.limitations,
      '$.limitations',
      this.configuration.maximumRecommendedSteps,
      issues,
    );

    if (issues.length > 0) throw new InvestigationValidationError(issues);

    return {
      schemaVersion: INVESTIGATION_REPORT_SCHEMA_VERSION,
      investigationId,
      summary,
      confidence,
      hypotheses,
      evidence,
      ...(likelyRootCause === undefined ? {} : { likelyRootCause }),
      affectedAreas,
      recommendedNextSteps,
      ...(suggestedFixScope === undefined ? {} : { suggestedFixScope }),
      limitations,
    };
  }
}

function validateEvidence(
  value: unknown,
  issues: { path: string; message: string }[],
): InvestigationReport['evidence'] {
  if (!Array.isArray(value)) {
    issues.push({ path: '$.evidence', message: 'must be an array' });
    return [];
  }
  const evidence: InvestigationReport['evidence'][number][] = [];
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry)) {
      issues.push({ path: `$.evidence[${index}]`, message: 'must be an object' });
      continue;
    }
    const logicalPath = readString(entry.logicalPath, `$.evidence[${index}].logicalPath`, issues);
    const reason = readString(entry.reason, `$.evidence[${index}].reason`, issues);
    const claimKindRaw = readString(entry.claimKind, `$.evidence[${index}].claimKind`, issues);
    const claimKind =
      claimKindRaw !== undefined && INVESTIGATION_CLAIM_KINDS.some((kind) => kind === claimKindRaw)
        ? (claimKindRaw as InvestigationReport['evidence'][number]['claimKind'])
        : (issues.push({ path: `$.evidence[${index}].claimKind`, message: 'invalid claim kind' }),
          'UNKNOWN');
    if (logicalPath === undefined || reason === undefined) continue;
    evidence.push({
      logicalPath,
      reason,
      claimKind,
      ...(typeof entry.lineStart === 'number' ? { lineStart: entry.lineStart } : {}),
      ...(typeof entry.lineEnd === 'number' ? { lineEnd: entry.lineEnd } : {}),
      ...(typeof entry.excerpt === 'string' ? { excerpt: entry.excerpt.slice(0, 240) } : {}),
    });
  }
  return evidence;
}

function validateHypotheses(
  value: unknown,
  issues: { path: string; message: string }[],
): InvestigationReport['hypotheses'] {
  if (!Array.isArray(value)) {
    issues.push({ path: '$.hypotheses', message: 'must be an array' });
    return [];
  }
  const hypotheses: InvestigationReport['hypotheses'][number][] = [];
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry)) {
      issues.push({ path: `$.hypotheses[${index}]`, message: 'must be an object' });
      continue;
    }
    const summary = readString(entry.summary, `$.hypotheses[${index}].summary`, issues);
    const claimKindRaw = readString(entry.claimKind, `$.hypotheses[${index}].claimKind`, issues);
    const claimKind =
      claimKindRaw !== undefined && INVESTIGATION_CLAIM_KINDS.some((kind) => kind === claimKindRaw)
        ? (claimKindRaw as InvestigationReport['hypotheses'][number]['claimKind'])
        : (issues.push({ path: `$.hypotheses[${index}].claimKind`, message: 'invalid claim kind' }),
          'UNKNOWN');
    const supportingEvidencePaths = readStringArray(
      entry.supportingEvidencePaths,
      `$.hypotheses[${index}].supportingEvidencePaths`,
      16,
      issues,
    );
    if (summary === undefined) continue;
    hypotheses.push({ summary, claimKind, supportingEvidencePaths });
  }
  return hypotheses;
}

export function parseInvestigationReportJson(
  raw: string,
  investigationId: string,
  validator: InvestigationReportValidator = new InvestigationReportValidator(),
): InvestigationReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new InvestigationValidationError([{ path: '$', message: 'must be valid JSON' }]);
  }
  return validator.validate(parsed, investigationId);
}
