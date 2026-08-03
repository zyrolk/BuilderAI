import type { FileApplyStatus } from '../../core/file-apply';
import type { ResponseMetadata } from '../../core/response-processor';
import type {
  VerificationStage,
  VerificationStageStatus,
  VerificationStatus,
} from '../../core/verification';

export const ITERATION_FEEDBACK_SCHEMA_VERSION = 1 as const;
export const ITERATION_FEEDBACK_KIND = 'CORRECTION' as const;

export const ITERATION_FEEDBACK_LIMITS = {
  MAX_SERIALIZED_CHARACTERS: 4_000,
  MAX_PRIOR_REQUEST_SUMMARY: 500,
  MAX_FINDING_MESSAGE: 240,
  MAX_CODE_LENGTH: 80,
  MAX_PATHS_PER_CATEGORY: 20,
  MAX_APPLY_ERRORS: 8,
  MAX_APPLY_WARNINGS: 4,
  MAX_STAGE_ERRORS: 4,
  MAX_STAGE_WARNINGS: 2,
  MAX_TOP_VERIFICATION_ERRORS: 8,
  MAX_PATH_HINTS: 8,
  MAX_STAGE_METADATA_ENTRIES: 8,
  MAX_STAGE_METADATA_STRING: 240,
} as const;

export interface IterationFeedbackFinding {
  readonly code: string;
  readonly message: string;
  readonly logicalPath?: string;
  readonly stage?: VerificationStage;
}

export interface IterationFeedbackApply {
  readonly status: FileApplyStatus;
  readonly createdPaths: readonly string[];
  readonly updatedPaths: readonly string[];
  readonly deletedPaths: readonly string[];
  readonly skippedPaths: readonly string[];
  readonly errors: readonly IterationFeedbackFinding[];
  readonly warnings: readonly IterationFeedbackFinding[];
}

export interface IterationFeedbackVerificationStage {
  readonly stage: VerificationStage;
  readonly status: VerificationStageStatus;
  readonly errors: readonly IterationFeedbackFinding[];
  readonly warnings: readonly IterationFeedbackFinding[];
  readonly metadata: ResponseMetadata;
}

export interface IterationFeedbackVerification {
  readonly status: VerificationStatus;
  readonly stages: readonly IterationFeedbackVerificationStage[];
  readonly topErrors: readonly IterationFeedbackFinding[];
}

export interface IterationFeedback {
  readonly schemaVersion: typeof ITERATION_FEEDBACK_SCHEMA_VERSION;
  readonly kind: typeof ITERATION_FEEDBACK_KIND;
  readonly sourcePreparationId?: string;
  readonly priorRequestSummary?: string;
  readonly apply: IterationFeedbackApply;
  readonly verification?: IterationFeedbackVerification;
}
