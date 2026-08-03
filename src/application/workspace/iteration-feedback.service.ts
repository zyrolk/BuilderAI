import { FILE_APPLY_STATUSES, type FileApplyResult } from '../../core/file-apply';
import type { ResponseMetadata } from '../../core/response-processor';
import {
  VERIFICATION_STAGES,
  VERIFICATION_STAGE_STATUSES,
  VERIFICATION_STATUSES,
  type VerificationReport,
  type VerificationStage,
} from '../../core/verification';
import type { WorkspaceCompletion } from './workspace-runtime.types';
import { WorkspaceRuntimeError } from './workspace-runtime.types';
import {
  ITERATION_FEEDBACK_KIND,
  ITERATION_FEEDBACK_LIMITS,
  ITERATION_FEEDBACK_SCHEMA_VERSION,
  type IterationFeedback,
  type IterationFeedbackApply,
  type IterationFeedbackFinding,
  type IterationFeedbackVerification,
  type IterationFeedbackVerificationStage,
} from './iteration-feedback.types';

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

export interface IterationFeedbackBuildOptions {
  readonly sourcePreparationId?: string;
  readonly priorRequestSummary?: string;
}

export function buildIterationFeedbackFromCompletion(
  completion: WorkspaceCompletion,
  options: IterationFeedbackBuildOptions = {},
): IterationFeedback {
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

  let feedback: IterationFeedback = {
    schemaVersion: ITERATION_FEEDBACK_SCHEMA_VERSION,
    kind: ITERATION_FEEDBACK_KIND,
    ...(sourcePreparationId === undefined ? {} : { sourcePreparationId }),
    ...(priorRequestSummary === undefined ? {} : { priorRequestSummary }),
    apply,
    ...(verification === undefined ? {} : { verification }),
  };
  feedback = shrinkToCharacterLimit(feedback);
  if (serializedLength(feedback) > ITERATION_FEEDBACK_LIMITS.MAX_SERIALIZED_CHARACTERS) {
    throw invalidFeedback(
      'iteration feedback exceeds the 4,000 character limit after normalization',
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

function shrinkToCharacterLimit(feedback: IterationFeedback): IterationFeedback {
  let current = feedback;
  if (serializedLength(current) <= ITERATION_FEEDBACK_LIMITS.MAX_SERIALIZED_CHARACTERS) {
    return current;
  }

  const shrinkPaths = (apply: IterationFeedbackApply): IterationFeedbackApply => ({
    ...apply,
    createdPaths: apply.createdPaths.slice(0, 8),
    updatedPaths: apply.updatedPaths.slice(0, 8),
    deletedPaths: apply.deletedPaths.slice(0, 8),
    skippedPaths: apply.skippedPaths.slice(0, 8),
  });

  current = { ...current, apply: shrinkPaths(current.apply) };
  if (serializedLength(current) <= ITERATION_FEEDBACK_LIMITS.MAX_SERIALIZED_CHARACTERS) {
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
