import type { FileApplyStatus } from '../../core/file-apply';
import type { ResponseMetadata } from '../../core/response-processor';
import type { SurgicalityBasis, SurgicalityClassification } from '../../core/change-planner';
import type {
  VerificationStage,
  VerificationStageStatus,
  VerificationStatus,
} from '../../core/verification';

export const ITERATION_FEEDBACK_SCHEMA_VERSION = 1 as const;
export const ITERATION_FEEDBACK_KIND = 'CORRECTION' as const;

export const ITERATION_FEEDBACK_LIMITS = {
  MAX_SERIALIZED_CHARACTERS: 4_000,
  MAX_SERIALIZED_CHARACTERS_WITH_PRESERVATION: 4_800,
  MAX_PRESERVATION_REJECTION_RENDERED_CHARACTERS: 800,
  MAX_PRESERVATION_OPERATIONS: 8,
  MAX_PRESERVATION_FINDING_CODES: 4,
  MAX_PRESERVATION_REMOVED_IDS: 8,
  MAX_PRESERVATION_REMOVED_ARIA: 8,
  MAX_PRESERVATION_CROSS_FILE_RISKS: 2,
  MAX_PRESERVATION_UNREQUESTED_PATHS: 8,
  MAX_OPERATOR_REASON: 240,
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
  MAX_DIAGNOSTIC_STDOUT: 400,
  MAX_DIAGNOSTIC_STDERR: 400,
  MAX_DIAGNOSTIC_COMBINED: 720,
} as const;

export interface IterationPreservationRejectionOperation {
  readonly logicalPath: string;
  readonly churnRatio?: number;
  readonly similarityRatio?: number;
  readonly findingCodes: readonly string[];
  readonly removedHtmlIds?: readonly string[];
  readonly removedAccessibilityAttributes?: readonly string[];
  readonly crossFileReferenceRisks?: readonly string[];
  readonly surgicalityClassification?: SurgicalityClassification;
  readonly surgicalityBasis?: SurgicalityBasis;
  readonly structuredAttributeChanges?: number;
  readonly structuredTextChanges?: number;
  readonly structuredStructuralChanges?: number;
}

export interface IterationPreservationRejection {
  readonly rejectedPreparationId?: string;
  readonly operatorReason?: string;
  readonly operations: readonly IterationPreservationRejectionOperation[];
  readonly unrequestedPaths?: readonly string[];
}

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

export interface IterationFeedbackVerificationDiagnostic {
  readonly commandLabel?: string;
  readonly exitCode?: number;
  readonly stdoutExcerpt?: string;
  readonly stderrExcerpt?: string;
  readonly truncated: boolean;
}

export interface IterationFeedbackVerificationStage {
  readonly stage: VerificationStage;
  readonly status: VerificationStageStatus;
  readonly errors: readonly IterationFeedbackFinding[];
  readonly warnings: readonly IterationFeedbackFinding[];
  readonly metadata: ResponseMetadata;
  readonly diagnostic?: IterationFeedbackVerificationDiagnostic;
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
  readonly runtimeBrowser?: IterationFeedbackRuntimeBrowser;
  readonly preservationRejection?: IterationPreservationRejection;
}

export interface IterationFeedbackRuntimeBrowserRoute {
  readonly path: string;
  readonly status: string;
  readonly consoleErrorCount: number;
  readonly pageExceptionCount: number;
  readonly failedRequestCount: number;
  readonly topConsoleError?: string;
}

export interface IterationFeedbackRuntimeBrowser {
  readonly status: string;
  readonly serverStatus: string;
  readonly browserStatus: string;
  readonly routes: readonly IterationFeedbackRuntimeBrowserRoute[];
}
