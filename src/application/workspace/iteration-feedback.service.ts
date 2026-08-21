import { FILE_APPLY_STATUSES } from '../../core/file-apply';
import type { ProjectChangePlan } from '../../core/change-planner';
import type { FileApplyResult } from '../../core/file-apply';
import type { ResponseMetadata } from '../../core/response-processor';
import {
  VERIFICATION_STAGES,
  VERIFICATION_STAGE_STATUSES,
  VERIFICATION_STATUSES,
  type VerificationReport,
  type VerificationStage,
} from '../../core/verification';
import {
  buildPreservationRejectionFromChangePlan,
  type PreservationRejectionBuildOptions,
} from './preservation-rejection-builder.service';
import { WorkspaceRuntimeError } from './workspace-runtime.types';
import {
  ITERATION_FEEDBACK_KIND,
  ITERATION_FEEDBACK_LIMITS,
  ITERATION_FEEDBACK_SCHEMA_VERSION,
  type IterationFeedback,
  type IterationFeedbackApply,
  type IterationFeedbackFinding,
  type IterationFeedbackVerification,
  type IterationFeedbackVerificationDiagnostic,
  type IterationFeedbackVerificationStage,
  type IterationFeedbackRuntimeBrowser,
  type IterationFeedbackRuntimeBrowserRoute,
  type IterationPreservationRejection,
  type IterationPreservationRejectionOperation,
} from './iteration-feedback.types';
import type { SurgicalityBasis, SurgicalityClassification } from '../../core/change-planner';
import type { WorkspaceCompletion } from './workspace-runtime.types';
import { redactVerificationOutput } from '../../infrastructure/verification/verification-output-sanitize';
import type { RuntimeBrowserVerificationReport } from '../../core/runtime-verification';

const CODE_PATTERN = /^[A-Z0-9_]{1,80}$/u;
const PREPARATION_ID_PATTERN = /^[A-Za-z0-9-]{8,128}$/u;
const FORBIDDEN_MESSAGE_PATTERNS = [
  /\bat\s+[A-Za-z0-9_.$]+\(/u,
  /node_modules/u,
  /^npm ERR!/u,
  /\/Users\//u,
  /[A-Z]:\\/u,
  /\/tmp\//u,
  /stdout|stderr/u,
] as const;

export interface IterationFeedbackBuildOptions extends PreservationRejectionBuildOptions {
  readonly sourcePreparationId?: string;
  readonly priorRequestSummary?: string;
  readonly rejectedChangePlan?: ProjectChangePlan;
}

export function buildIterationFeedbackFromGate2Rejection(
  changePlan: ProjectChangePlan,
  options: IterationFeedbackBuildOptions = {},
): IterationFeedback {
  const updatedPaths = changePlan.changeSet.operations
    .filter((operation) => operation.kind === 'UPDATE_FILE')
    .map(({ logicalPath }) => logicalPath)
    .sort((left, right) => left.localeCompare(right));

  return normalizeIterationFeedback(
    {
      schemaVersion: ITERATION_FEEDBACK_SCHEMA_VERSION,
      kind: ITERATION_FEEDBACK_KIND,
      ...(options.sourcePreparationId === undefined && options.rejectedPreparationId === undefined
        ? {}
        : {
            sourcePreparationId: options.sourcePreparationId ?? options.rejectedPreparationId,
          }),
      ...(options.priorRequestSummary === undefined
        ? {}
        : { priorRequestSummary: options.priorRequestSummary }),
      apply: {
        status: 'REJECTED',
        createdPaths: [],
        updatedPaths,
        deletedPaths: [],
        skippedPaths: [],
        errors: [
          {
            code: 'INVALID_CHANGE_PLAN',
            message: 'Operator rejected the change plan at Gate 2 review.',
          },
        ],
        warnings: [],
      },
      preservationRejection: buildPreservationRejectionFromChangePlan(changePlan, options),
    },
    options,
  );
}

export function buildIterationFeedbackFromCompletion(
  completion: WorkspaceCompletion,
  options: IterationFeedbackBuildOptions = {},
): IterationFeedback {
  const preservationRejection =
    options.rejectedChangePlan === undefined
      ? undefined
      : buildPreservationRejectionFromChangePlan(options.rejectedChangePlan, options);

  return normalizeIterationFeedback(
    {
      schemaVersion: ITERATION_FEEDBACK_SCHEMA_VERSION,
      kind: ITERATION_FEEDBACK_KIND,
      ...(options.sourcePreparationId === undefined
        ? {}
        : { sourcePreparationId: options.sourcePreparationId }),
      ...(options.priorRequestSummary === undefined
        ? {}
        : { priorRequestSummary: options.priorRequestSummary }),
      apply: completion.applyResult,
      ...(completion.verificationReport === undefined
        ? {}
        : { verification: completion.verificationReport }),
      ...(completion.runtimeBrowserVerificationReport === undefined
        ? {}
        : {
            runtimeBrowser: summarizeRuntimeBrowserForIteration(
              completion.runtimeBrowserVerificationReport,
            ),
          }),
      ...(preservationRejection === undefined ? {} : { preservationRejection }),
    },
    options,
  );
}

export function normalizeIterationFeedback(
  value: unknown,
  options: IterationFeedbackBuildOptions = {},
): IterationFeedback {
  if (!isRecord(value)) {
    throw invalidFeedback('iteration feedback must be an object');
  }
  if (Reflect.get(value, 'schemaVersion') !== ITERATION_FEEDBACK_SCHEMA_VERSION) {
    throw invalidFeedback('iteration feedback schemaVersion must be 1');
  }
  if (Reflect.get(value, 'kind') !== ITERATION_FEEDBACK_KIND) {
    throw invalidFeedback("iteration feedback kind must be 'CORRECTION'");
  }

  const sourcePreparationId = normalizeOptionalPreparationId(
    options.sourcePreparationId ?? Reflect.get(value, 'sourcePreparationId'),
  );
  const priorRequestSummary = normalizeOptionalSummary(
    options.priorRequestSummary ?? Reflect.get(value, 'priorRequestSummary'),
  );
  const apply = normalizeApply(Reflect.get(value, 'apply') ?? Reflect.get(value, 'applyResult'));
  const verification = normalizeVerification(Reflect.get(value, 'verification'));
  const runtimeBrowser = normalizeRuntimeBrowser(Reflect.get(value, 'runtimeBrowser'));
  const preservationRejection = normalizePreservationRejection(
    Reflect.get(value, 'preservationRejection'),
  );

  let feedback: IterationFeedback = {
    schemaVersion: ITERATION_FEEDBACK_SCHEMA_VERSION,
    kind: ITERATION_FEEDBACK_KIND,
    ...(sourcePreparationId === undefined ? {} : { sourcePreparationId }),
    ...(priorRequestSummary === undefined ? {} : { priorRequestSummary }),
    apply,
    ...(verification === undefined ? {} : { verification }),
    ...(runtimeBrowser === undefined ? {} : { runtimeBrowser }),
    ...(preservationRejection === undefined ? {} : { preservationRejection }),
  };
  feedback = shrinkToCharacterLimit(feedback);
  const maxCharacters = feedbackCharacterLimit(feedback);
  if (serializedLength(feedback) > maxCharacters) {
    throw invalidFeedback(
      `iteration feedback exceeds the ${maxCharacters} character limit after normalization`,
    );
  }
  return feedback;
}

export function extractIterationPathHints(feedback: IterationFeedback): readonly string[] {
  const candidates = [
    ...feedback.apply.updatedPaths,
    ...feedback.apply.createdPaths,
    ...feedback.apply.errors
      .map(({ logicalPath }) => logicalPath)
      .filter((path): path is string => path !== undefined),
    ...feedback.apply.deletedPaths,
    ...feedback.apply.skippedPaths,
  ];
  const hints: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const normalized = normalizeSafePath(candidate);
    if (normalized === undefined || seen.has(normalized)) continue;
    seen.add(normalized);
    hints.push(normalized);
    if (hints.length >= ITERATION_FEEDBACK_LIMITS.MAX_PATH_HINTS) break;
  }
  return hints;
}

export function serializedIterationFeedbackLength(feedback: IterationFeedback): number {
  return serializedLength(feedback);
}

function normalizeApply(value: unknown): IterationFeedbackApply {
  const source = isApplyResult(value) ? value : isRecord(value) ? value : undefined;
  if (source === undefined) throw invalidFeedback('apply evidence is required');

  const status = Reflect.get(source, 'status');
  if (typeof status !== 'string' || !FILE_APPLY_STATUSES.includes(status as never)) {
    throw invalidFeedback('apply.status is invalid');
  }

  return {
    status: status as IterationFeedbackApply['status'],
    createdPaths: normalizePathList(
      Reflect.get(source, 'createdPaths') ?? Reflect.get(source, 'createdFiles'),
    ),
    updatedPaths: normalizePathList(
      Reflect.get(source, 'updatedPaths') ?? Reflect.get(source, 'updatedFiles'),
    ),
    deletedPaths: normalizePathList(
      Reflect.get(source, 'deletedPaths') ?? Reflect.get(source, 'deletedFiles'),
    ),
    skippedPaths: normalizePathList(
      Reflect.get(source, 'skippedPaths') ?? Reflect.get(source, 'skippedFiles'),
    ),
    errors: normalizeFindings(
      Reflect.get(source, 'errors'),
      ITERATION_FEEDBACK_LIMITS.MAX_APPLY_ERRORS,
      true,
    ),
    warnings: normalizeFindings(
      Reflect.get(source, 'warnings'),
      ITERATION_FEEDBACK_LIMITS.MAX_APPLY_WARNINGS,
      false,
    ),
  };
}

function normalizeVerification(value: unknown): IterationFeedbackVerification | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) throw invalidFeedback('verification must be an object');

  const status = Reflect.get(value, 'status');
  if (typeof status !== 'string' || !VERIFICATION_STATUSES.includes(status as never)) {
    throw invalidFeedback('verification.status is invalid');
  }

  const rawStages = Reflect.get(value, 'stages');
  const stages =
    rawStages === undefined
      ? []
      : normalizeVerificationStages(rawStages, isVerificationReport(value) ? value : undefined);

  const topErrors = normalizeFindings(
    Reflect.get(value, 'topErrors') ?? (isVerificationReport(value) ? value.errors : undefined),
    ITERATION_FEEDBACK_LIMITS.MAX_TOP_VERIFICATION_ERRORS,
    false,
    true,
  );

  return { status: status as IterationFeedbackVerification['status'], stages, topErrors };
}

function normalizeVerificationStages(
  value: unknown,
  report: VerificationReport | undefined,
): readonly IterationFeedbackVerificationStage[] {
  if (!Array.isArray(value) && report === undefined) {
    throw invalidFeedback('verification.stages must be an array');
  }
  const sourceStages = Array.isArray(value) ? value : (report?.stages ?? []);
  const byStage = new Map<VerificationStage, IterationFeedbackVerificationStage>();

  for (const rawStage of sourceStages) {
    if (!isRecord(rawStage)) continue;
    const stage = Reflect.get(rawStage, 'stage');
    if (typeof stage !== 'string' || !VERIFICATION_STAGES.includes(stage as VerificationStage)) {
      continue;
    }
    const stageStatus = Reflect.get(rawStage, 'status');
    if (
      typeof stageStatus !== 'string' ||
      !VERIFICATION_STAGE_STATUSES.includes(stageStatus as never)
    ) {
      continue;
    }
    byStage.set(stage as VerificationStage, {
      stage: stage as VerificationStage,
      status: stageStatus as IterationFeedbackVerificationStage['status'],
      errors: normalizeFindings(
        Reflect.get(rawStage, 'errors'),
        ITERATION_FEEDBACK_LIMITS.MAX_STAGE_ERRORS,
        false,
        true,
        stage as VerificationStage,
      ),
      warnings: normalizeFindings(
        Reflect.get(rawStage, 'warnings'),
        ITERATION_FEEDBACK_LIMITS.MAX_STAGE_WARNINGS,
        false,
        false,
        stage as VerificationStage,
      ),
      metadata: normalizeStageMetadata(Reflect.get(rawStage, 'metadata')),
      ...(normalizeVerificationDiagnostic(Reflect.get(rawStage, 'diagnostic'), stageStatus) ===
      undefined
        ? {}
        : {
            diagnostic: normalizeVerificationDiagnostic(
              Reflect.get(rawStage, 'diagnostic'),
              stageStatus,
            ),
          }),
    });
  }

  return VERIFICATION_STAGES.map((stage) => byStage.get(stage)).filter(
    (stage): stage is IterationFeedbackVerificationStage => stage !== undefined,
  );
}

function normalizeStageMetadata(value: unknown): ResponseMetadata {
  if (!isRecord(value)) return {};
  const entries = Object.entries(value).slice(
    0,
    ITERATION_FEEDBACK_LIMITS.MAX_STAGE_METADATA_ENTRIES,
  );
  const metadata: Record<string, string | number | boolean> = {};
  for (const [key, item] of entries) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(key)) continue;
    if (typeof item === 'number' && Number.isFinite(item)) {
      metadata[key] = item;
      continue;
    }
    if (typeof item === 'boolean') {
      metadata[key] = item;
      continue;
    }
    if (typeof item === 'string') {
      metadata[key] = truncateText(item, ITERATION_FEEDBACK_LIMITS.MAX_STAGE_METADATA_STRING);
    }
  }
  return metadata;
}

function normalizeVerificationDiagnostic(
  value: unknown,
  stageStatus: unknown,
): IterationFeedbackVerificationDiagnostic | undefined {
  if (stageStatus !== 'FAILED') return undefined;
  if (!isRecord(value)) return undefined;
  const truncated = Reflect.get(value, 'truncated');
  if (typeof truncated !== 'boolean') return undefined;
  const rawCommandLabel = Reflect.get(value, 'commandLabel');
  const commandLabel = readOptionalBoundedDiagnosticText(
    typeof rawCommandLabel === 'string' ? rawCommandLabel : undefined,
    120,
  );
  const exitCode = Reflect.get(value, 'exitCode');
  const stdoutExcerpt = readOptionalBoundedDiagnosticText(
    redactVerificationOutput(readOptionalDiagnosticStream(Reflect.get(value, 'stdoutExcerpt'))),
    ITERATION_FEEDBACK_LIMITS.MAX_DIAGNOSTIC_STDOUT,
  );
  const stderrExcerpt = readOptionalBoundedDiagnosticText(
    redactVerificationOutput(readOptionalDiagnosticStream(Reflect.get(value, 'stderrExcerpt'))),
    ITERATION_FEEDBACK_LIMITS.MAX_DIAGNOSTIC_STDERR,
  );
  const combinedLength = (stdoutExcerpt?.length ?? 0) + (stderrExcerpt?.length ?? 0);
  if (combinedLength > ITERATION_FEEDBACK_LIMITS.MAX_DIAGNOSTIC_COMBINED) {
    return {
      ...(commandLabel === undefined ? {} : { commandLabel }),
      ...(typeof exitCode === 'number' && Number.isFinite(exitCode) ? { exitCode } : {}),
      truncated: true,
    };
  }
  if (
    commandLabel === undefined &&
    stdoutExcerpt === undefined &&
    stderrExcerpt === undefined &&
    !(typeof exitCode === 'number' && Number.isFinite(exitCode))
  ) {
    return undefined;
  }
  return {
    ...(commandLabel === undefined ? {} : { commandLabel }),
    ...(typeof exitCode === 'number' && Number.isFinite(exitCode) ? { exitCode } : {}),
    ...(stdoutExcerpt === undefined ? {} : { stdoutExcerpt }),
    ...(stderrExcerpt === undefined ? {} : { stderrExcerpt }),
    truncated,
  };
}

function readOptionalDiagnosticStream(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readOptionalBoundedDiagnosticText(
  value: string | undefined,
  maximumCharacters: number,
): string | undefined {
  if (value === undefined || value.trim().length === 0) return undefined;
  return truncateText(value.trim(), maximumCharacters);
}

function normalizeFindings(
  value: unknown,
  limit: number,
  allowLogicalPath: boolean,
  includeStage = false,
  stage?: VerificationStage,
): readonly IterationFeedbackFinding[] {
  if (!Array.isArray(value)) return [];
  const findings: IterationFeedbackFinding[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const code = normalizeCode(Reflect.get(item, 'code'));
    const message = normalizeMessage(Reflect.get(item, 'message'));
    if (code === undefined || message === undefined) continue;
    const logicalPath = allowLogicalPath
      ? normalizeOptionalPath(Reflect.get(item, 'logicalPath'))
      : undefined;
    const findingStage =
      includeStage && typeof Reflect.get(item, 'stage') === 'string'
        ? VERIFICATION_STAGES.includes(Reflect.get(item, 'stage') as VerificationStage)
          ? (Reflect.get(item, 'stage') as VerificationStage)
          : stage
        : stage;
    findings.push({
      code,
      message,
      ...(logicalPath === undefined ? {} : { logicalPath }),
      ...(findingStage === undefined ? {} : { stage: findingStage }),
    });
    if (findings.length >= limit) break;
  }
  return findings;
}

function normalizePathList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const normalized = normalizeSafePath(item);
    if (normalized === undefined || seen.has(normalized)) continue;
    seen.add(normalized);
    paths.push(normalized);
    if (paths.length >= ITERATION_FEEDBACK_LIMITS.MAX_PATHS_PER_CATEGORY) break;
  }
  return paths;
}

function normalizeSafePath(value: string): string | undefined {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '').trim();
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    /^[a-z]:\//i.test(normalized) ||
    normalized.split('/').includes('..')
  ) {
    return undefined;
  }
  return normalized;
}

function normalizeOptionalPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return normalizeSafePath(value);
}

function normalizeCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toUpperCase().slice(0, ITERATION_FEEDBACK_LIMITS.MAX_CODE_LENGTH);
  return CODE_PATTERN.test(normalized) ? normalized : undefined;
}

function normalizeMessage(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const sanitized = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (sanitized.length === 0) return undefined;
  if (FORBIDDEN_MESSAGE_PATTERNS.some((pattern) => pattern.test(sanitized))) {
    return undefined;
  }
  return truncateText(sanitized, ITERATION_FEEDBACK_LIMITS.MAX_FINDING_MESSAGE);
}

function normalizeOptionalPreparationId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return PREPARATION_ID_PATTERN.test(trimmed) ? trimmed : undefined;
}

function normalizeOptionalSummary(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const sanitized = value
    .replace(/[\u0000-\u001F\u007F]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (sanitized.length === 0) return undefined;
  return truncateText(sanitized, ITERATION_FEEDBACK_LIMITS.MAX_PRIOR_REQUEST_SUMMARY);
}

function normalizePreservationRejection(
  value: unknown,
): IterationPreservationRejection | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) throw invalidFeedback('preservationRejection must be an object');

  const rejectedPreparationId = normalizeOptionalPreparationId(
    Reflect.get(value, 'rejectedPreparationId'),
  );
  const operatorReason = normalizeOperatorReason(Reflect.get(value, 'operatorReason'));
  const operations = normalizePreservationOperations(Reflect.get(value, 'operations'));
  const unrequestedPaths = normalizePathList(Reflect.get(value, 'unrequestedPaths')).slice(
    0,
    ITERATION_FEEDBACK_LIMITS.MAX_PRESERVATION_UNREQUESTED_PATHS,
  );

  if (operations.length === 0 && unrequestedPaths.length === 0 && operatorReason === undefined) {
    return undefined;
  }

  return {
    ...(rejectedPreparationId === undefined ? {} : { rejectedPreparationId }),
    ...(operatorReason === undefined ? {} : { operatorReason }),
    operations,
    ...(unrequestedPaths.length === 0 ? {} : { unrequestedPaths }),
  };
}

function normalizePreservationOperations(
  value: unknown,
): readonly IterationPreservationRejectionOperation[] {
  if (!Array.isArray(value)) return [];
  const operations: IterationPreservationRejectionOperation[] = [];
  const seenPaths = new Set<string>();

  const records = value.filter(isRecord).sort((left, right) => {
    const leftPath = normalizeOptionalPath(Reflect.get(left, 'logicalPath')) ?? '';
    const rightPath = normalizeOptionalPath(Reflect.get(right, 'logicalPath')) ?? '';
    return leftPath.localeCompare(rightPath);
  });

  for (const item of records) {
    const logicalPath = normalizeOptionalPath(Reflect.get(item, 'logicalPath'));
    if (logicalPath === undefined || seenPaths.has(logicalPath)) continue;
    seenPaths.add(logicalPath);

    const churnRatio = normalizeRatio(Reflect.get(item, 'churnRatio'));
    const similarityRatio = normalizeRatio(Reflect.get(item, 'similarityRatio'));
    const findingCodes = normalizeFindingCodes(Reflect.get(item, 'findingCodes'));
    const removedHtmlIds = normalizeStringList(
      Reflect.get(item, 'removedHtmlIds'),
      ITERATION_FEEDBACK_LIMITS.MAX_PRESERVATION_REMOVED_IDS,
    );
    const removedAccessibilityAttributes = normalizeStringList(
      Reflect.get(item, 'removedAccessibilityAttributes'),
      ITERATION_FEEDBACK_LIMITS.MAX_PRESERVATION_REMOVED_ARIA,
    );
    const crossFileReferenceRisks = normalizeStringList(
      Reflect.get(item, 'crossFileReferenceRisks'),
      ITERATION_FEEDBACK_LIMITS.MAX_PRESERVATION_CROSS_FILE_RISKS,
    );
    const surgicalityClassification = normalizeSurgicalityClassification(
      Reflect.get(item, 'surgicalityClassification'),
    );
    const surgicalityBasis = normalizeSurgicalityBasis(Reflect.get(item, 'surgicalityBasis'));
    const structuredAttributeChanges = normalizeNonNegativeInteger(
      Reflect.get(item, 'structuredAttributeChanges'),
    );
    const structuredTextChanges = normalizeNonNegativeInteger(
      Reflect.get(item, 'structuredTextChanges'),
    );
    const structuredStructuralChanges = normalizeNonNegativeInteger(
      Reflect.get(item, 'structuredStructuralChanges'),
    );

    operations.push({
      logicalPath,
      ...(churnRatio === undefined ? {} : { churnRatio }),
      ...(similarityRatio === undefined ? {} : { similarityRatio }),
      findingCodes,
      ...(removedHtmlIds.length === 0 ? {} : { removedHtmlIds }),
      ...(removedAccessibilityAttributes.length === 0 ? {} : { removedAccessibilityAttributes }),
      ...(crossFileReferenceRisks.length === 0 ? {} : { crossFileReferenceRisks }),
      ...(surgicalityClassification === undefined ? {} : { surgicalityClassification }),
      ...(surgicalityBasis === undefined ? {} : { surgicalityBasis }),
      ...(structuredAttributeChanges === undefined ? {} : { structuredAttributeChanges }),
      ...(structuredTextChanges === undefined ? {} : { structuredTextChanges }),
      ...(structuredStructuralChanges === undefined ? {} : { structuredStructuralChanges }),
    });
    if (operations.length >= ITERATION_FEEDBACK_LIMITS.MAX_PRESERVATION_OPERATIONS) break;
  }

  return operations;
}

function normalizeFindingCodes(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const codes = new Set<string>();
  for (const item of value) {
    const code = normalizeCode(item);
    if (code === undefined) continue;
    codes.add(code);
  }
  return [...codes]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, ITERATION_FEEDBACK_LIMITS.MAX_PRESERVATION_FINDING_CODES);
}

function normalizeStringList(value: unknown, limit: number): readonly string[] {
  if (!Array.isArray(value)) return [];
  const items = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const normalized = item.trim();
    if (normalized.length === 0) continue;
    items.add(normalized);
  }
  return [...items].sort((left, right) => left.localeCompare(right)).slice(0, limit);
}

function normalizeRatio(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (value < 0 || value > 1) return undefined;
  return value;
}

function normalizeNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return undefined;
  return value;
}

function normalizeSurgicalityClassification(value: unknown): SurgicalityClassification | undefined {
  if (typeof value !== 'string') return undefined;
  if (
    value === 'EXCELLENT' ||
    value === 'GOOD' ||
    value === 'MARGINAL' ||
    value === 'POOR' ||
    value === 'UNAVAILABLE'
  ) {
    return value;
  }
  return undefined;
}

function normalizeSurgicalityBasis(value: unknown): SurgicalityBasis | undefined {
  if (typeof value !== 'string') return undefined;
  if (value === 'STRUCTURED_HTML' || value === 'GENERIC_LINE_LCS' || value === 'UNAVAILABLE') {
    return value;
  }
  return undefined;
}

function normalizeOperatorReason(value: unknown): string | undefined {
  return normalizeMessage(value);
}

function feedbackCharacterLimit(feedback: IterationFeedback): number {
  return feedback.preservationRejection === undefined
    ? ITERATION_FEEDBACK_LIMITS.MAX_SERIALIZED_CHARACTERS
    : ITERATION_FEEDBACK_LIMITS.MAX_SERIALIZED_CHARACTERS_WITH_PRESERVATION;
}

function shrinkToCharacterLimit(feedback: IterationFeedback): IterationFeedback {
  let current = feedback;
  const maxCharacters = feedbackCharacterLimit(current);
  if (serializedLength(current) <= maxCharacters) {
    return current;
  }

  if (current.preservationRejection !== undefined) {
    current = shrinkPreservationRejection(current);
    if (serializedLength(current) <= maxCharacters) return current;
  }

  const shrinkPaths = (apply: IterationFeedbackApply): IterationFeedbackApply => ({
    ...apply,
    createdPaths: apply.createdPaths.slice(0, 8),
    updatedPaths: apply.updatedPaths.slice(0, 8),
    deletedPaths: apply.deletedPaths.slice(0, 8),
    skippedPaths: apply.skippedPaths.slice(0, 8),
  });

  current = { ...current, apply: shrinkPaths(current.apply) };
  if (serializedLength(current) <= maxCharacters) {
    return current;
  }

  if (current.verification !== undefined) {
    current = {
      ...current,
      verification: {
        ...current.verification,
        topErrors: current.verification.topErrors.slice(0, 4),
        stages: current.verification.stages.map((stage) => ({
          ...stage,
          errors: stage.errors.slice(0, 2),
          warnings: stage.warnings.slice(0, 1),
        })),
      },
    };
  }
  return current;
}

function shrinkPreservationRejection(feedback: IterationFeedback): IterationFeedback {
  const rejection = feedback.preservationRejection;
  if (rejection === undefined) return feedback;

  let operations = rejection.operations;
  let currentRejection: IterationPreservationRejection = { ...rejection, operations };
  let currentFeedback: IterationFeedback = { ...feedback, preservationRejection: currentRejection };
  const limit = feedbackCharacterLimit(feedback);

  while (operations.length > 1 && serializedLength(currentFeedback) > limit) {
    operations = operations.slice(0, operations.length - 1);
    currentRejection = { ...rejection, operations };
    currentFeedback = { ...feedback, preservationRejection: currentRejection };
  }

  while (serializedLength(currentFeedback) > limit) {
    const nextOperations = currentRejection.operations.map((operation, index) => {
      if (index > 0) return operation;
      return {
        ...operation,
        findingCodes: operation.findingCodes.slice(
          0,
          Math.max(1, operation.findingCodes.length - 1),
        ),
        ...(operation.removedHtmlIds === undefined
          ? {}
          : {
              removedHtmlIds: operation.removedHtmlIds.slice(
                0,
                Math.max(0, operation.removedHtmlIds.length - 1),
              ),
            }),
        ...(operation.removedAccessibilityAttributes === undefined
          ? {}
          : {
              removedAccessibilityAttributes: operation.removedAccessibilityAttributes.slice(
                0,
                Math.max(0, operation.removedAccessibilityAttributes.length - 1),
              ),
            }),
        ...(operation.crossFileReferenceRisks === undefined
          ? {}
          : {
              crossFileReferenceRisks: operation.crossFileReferenceRisks.slice(
                0,
                Math.max(0, operation.crossFileReferenceRisks.length - 1),
              ),
            }),
      };
    });

    const allEmpty = nextOperations.every(
      (operation) =>
        operation.findingCodes.length <= 1 &&
        (operation.removedHtmlIds?.length ?? 0) === 0 &&
        (operation.removedAccessibilityAttributes?.length ?? 0) === 0 &&
        (operation.crossFileReferenceRisks?.length ?? 0) === 0,
    );

    if (
      allEmpty &&
      currentRejection.operatorReason !== undefined &&
      currentRejection.operatorReason.length > 32
    ) {
      currentRejection = {
        ...currentRejection,
        operatorReason: currentRejection.operatorReason.slice(
          0,
          currentRejection.operatorReason.length - 32,
        ),
      };
    } else if (allEmpty) {
      break;
    } else {
      currentRejection = { ...currentRejection, operations: nextOperations };
    }

    currentFeedback = { ...feedback, preservationRejection: currentRejection };
    if (allEmpty && (currentRejection.operatorReason?.length ?? 0) <= 32) break;
  }

  return currentFeedback;
}

function serializedLength(feedback: IterationFeedback): number {
  return JSON.stringify(feedback).length;
}

function invalidFeedback(message: string): WorkspaceRuntimeError {
  return new WorkspaceRuntimeError('INVALID_ITERATION_FEEDBACK', message);
}

function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isApplyResult(value: unknown): value is FileApplyResult {
  return isRecord(value) && typeof Reflect.get(value, 'status') === 'string';
}

function isVerificationReport(value: unknown): value is VerificationReport {
  return isRecord(value) && typeof Reflect.get(value, 'status') === 'string';
}

function summarizeRuntimeBrowserForIteration(
  report: RuntimeBrowserVerificationReport,
): IterationFeedbackRuntimeBrowser {
  const routes: IterationFeedbackRuntimeBrowserRoute[] = report.browser.routes
    .slice(0, 4)
    .map((route) => ({
      path: route.path.slice(0, 120),
      status: route.status,
      consoleErrorCount: route.consoleErrors.length,
      pageExceptionCount: route.pageExceptions.length,
      failedRequestCount: route.failedRequests.length,
      ...(route.consoleErrors.length === 0
        ? {}
        : {
            topConsoleError: sanitizeRuntimeBrowserMessage(route.consoleErrors[0]?.message ?? ''),
          }),
    }));
  return {
    status: report.status,
    serverStatus: report.server.status,
    browserStatus: report.browser.status,
    routes,
  };
}

function normalizeRuntimeBrowser(value: unknown): IterationFeedbackRuntimeBrowser | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) throw invalidFeedback('runtimeBrowser must be an object');
  const status = readBoundedString(Reflect.get(value, 'status'), 40);
  const serverStatus = readBoundedString(Reflect.get(value, 'serverStatus'), 40);
  const browserStatus = readBoundedString(Reflect.get(value, 'browserStatus'), 40);
  if (status === undefined || serverStatus === undefined || browserStatus === undefined) {
    throw invalidFeedback('runtimeBrowser status fields are required');
  }
  const rawRoutes = Reflect.get(value, 'routes');
  const routes = Array.isArray(rawRoutes)
    ? rawRoutes
        .slice(0, 4)
        .map((route) => normalizeRuntimeBrowserRoute(route))
        .filter((route): route is IterationFeedbackRuntimeBrowserRoute => route !== undefined)
    : [];
  return { status, serverStatus, browserStatus, routes };
}

function normalizeRuntimeBrowserRoute(
  value: unknown,
): IterationFeedbackRuntimeBrowserRoute | undefined {
  if (!isRecord(value)) return undefined;
  const path = readBoundedString(Reflect.get(value, 'path'), 120);
  const status = readBoundedString(Reflect.get(value, 'status'), 40);
  if (path === undefined || status === undefined) return undefined;
  const consoleErrorCount = readBoundedCount(Reflect.get(value, 'consoleErrorCount'));
  const pageExceptionCount = readBoundedCount(Reflect.get(value, 'pageExceptionCount'));
  const failedRequestCount = readBoundedCount(Reflect.get(value, 'failedRequestCount'));
  const topConsoleError = readBoundedString(Reflect.get(value, 'topConsoleError'), 240);
  return {
    path,
    status,
    consoleErrorCount,
    pageExceptionCount,
    failedRequestCount,
    ...(topConsoleError === undefined ? {} : { topConsoleError }),
  };
}

function sanitizeRuntimeBrowserMessage(message: string): string {
  return message
    .replace(/api[_-]?key[=:]\S+/giu, 'api_key=[redacted]')
    .replace(/Bearer\s+\S+/giu, 'Bearer [redacted]')
    .slice(0, 240);
}

function readBoundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  return value.trim().slice(0, maxLength);
}

function readBoundedCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(Math.trunc(value), 99)
    : 0;
}
