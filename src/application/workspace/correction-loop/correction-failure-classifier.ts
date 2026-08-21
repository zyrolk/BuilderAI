import type { WorkspaceCompletion } from '../workspace-runtime.types';
import type {
  CorrectionFailureCategory,
  CorrectionLoopBeginInput,
  NonCorrectableFailureCategory,
} from './correction-loop.types';

export interface CorrectionFailureClassification {
  readonly category: CorrectionFailureCategory;
  readonly correctable: boolean;
  readonly failureStage: string;
  readonly summary: string;
}

export function classifyCorrectionFailure(
  input: CorrectionLoopBeginInput,
): CorrectionFailureClassification {
  const blocked = classifyNonCorrectable(input);
  if (blocked !== undefined) {
    return {
      category: blocked.category,
      correctable: false,
      failureStage: blocked.failureStage,
      summary: blocked.summary,
    };
  }
  return classifyCorrectable(input);
}

export function isCorrectionEligibleCompletion(completion: WorkspaceCompletion): boolean {
  const input = completionToBeginInput(completion, 'workflow-eligibility');
  const classification = classifyCorrectionFailure(input);
  return classification.correctable;
}

export function completionToBeginInput(
  completion: WorkspaceCompletion,
  workflowId: string,
): CorrectionLoopBeginInput {
  const { applyResult, verificationReport, runtimeBrowserVerificationReport } = completion;
  return {
    workflowId,
    applyStatus: applyResult.status,
    createdPaths: applyResult.createdFiles,
    updatedPaths: applyResult.updatedFiles,
    deletedPaths: applyResult.deletedFiles,
    ...(verificationReport === undefined
      ? {}
      : {
          verificationReport: {
            status: verificationReport.status,
            stages: verificationReport.stages.map(({ stage, status, errors }) => ({
              stage,
              status,
              errors: errors.map(({ code, message }) => ({ code, message })),
            })),
            errors: verificationReport.errors.map(({ code, message }) => ({ code, message })),
          },
        }),
    ...(runtimeBrowserVerificationReport === undefined ? {} : { runtimeBrowserVerificationReport }),
  };
}

function classifyNonCorrectable(input: CorrectionLoopBeginInput):
  | {
      readonly category: NonCorrectableFailureCategory;
      readonly failureStage: string;
      readonly summary: string;
    }
  | undefined {
  if (input.applyStatus === 'PARTIALLY_APPLIED') {
    return {
      category: 'RECOVERY_REQUIRED',
      failureStage: 'APPLY',
      summary: 'Partial apply requires manual recovery before correction.',
    };
  }
  if (input.applyStatus === 'REJECTED') {
    return {
      category: 'USER_REJECTION',
      failureStage: 'APPLY',
      summary: 'Apply was rejected; correction is not available.',
    };
  }
  const verification = input.verificationReport;
  if (verification !== undefined) {
    for (const stage of verification.stages) {
      if (stage.status === 'POLICY_BLOCKED' || stage.status === 'CANCELLED') {
        return {
          category: stage.status === 'CANCELLED' ? 'CANCELLATION' : 'POLICY_BLOCKED',
          failureStage: stage.stage,
          summary: `Verification stage ${stage.stage} is ${stage.status.toLowerCase()}.`,
        };
      }
      for (const error of stage.errors) {
        if (error.code.includes('NEVER_EXPOSE') || error.code.includes('PROTECTED')) {
          return {
            category: 'PROTECTED_PATH',
            failureStage: stage.stage,
            summary: 'Protected path policy blocked verification.',
          };
        }
        if (
          error.code.includes('CREDENTIAL') ||
          error.code.includes('API_KEY') ||
          error.code.includes('SECRET')
        ) {
          return {
            category: 'CREDENTIAL_FAILURE',
            failureStage: stage.stage,
            summary: 'Credential or secret failure cannot trigger automatic correction.',
          };
        }
        if (error.code.includes('SECURITY')) {
          return {
            category: 'SECURITY_VIOLATION',
            failureStage: stage.stage,
            summary: 'Security violation cannot trigger automatic correction.',
          };
        }
      }
    }
  }
  const runtime = input.runtimeBrowserVerificationReport;
  if (runtime !== undefined) {
    if (runtime.status === 'POLICY_BLOCKED' || runtime.server.status === 'POLICY_BLOCKED') {
      return {
        category: 'POLICY_BLOCKED',
        failureStage: 'RUNTIME_BROWSER',
        summary: 'Runtime browser verification was policy blocked.',
      };
    }
    if (runtime.status === 'CANCELLED') {
      return {
        category: 'CANCELLATION',
        failureStage: 'RUNTIME_BROWSER',
        summary: 'Runtime browser verification was cancelled.',
      };
    }
    if (runtime.browser.status === 'POLICY_BLOCKED') {
      return {
        category: 'POLICY_BLOCKED',
        failureStage: 'BROWSER',
        summary: 'Browser verification was policy blocked.',
      };
    }
  }
  if (
    input.applyStatus === 'FAILED' &&
    input.verificationReport === undefined &&
    input.runtimeBrowserVerificationReport === undefined
  ) {
    return {
      category: 'RECOVERY_REQUIRED',
      failureStage: 'APPLY',
      summary: 'Apply failed without verification evidence.',
    };
  }
  return undefined;
}

function classifyCorrectable(input: CorrectionLoopBeginInput): CorrectionFailureClassification {
  const runtime = input.runtimeBrowserVerificationReport;
  if (runtime !== undefined && runtime.status !== 'PASSED') {
    if (runtime.server.status === 'PROCESS_FAILED' || runtime.server.status === 'TIMEOUT') {
      return {
        category: 'RUNTIME_START_FAILURE',
        correctable: true,
        failureStage: 'RUNTIME_SERVER',
        summary: `Dev server ${runtime.server.status.toLowerCase().replace('_', ' ')}.`,
      };
    }
    if (runtime.server.status === 'NOT_READY') {
      return {
        category: 'RUNTIME_HTTP_FAILURE',
        correctable: true,
        failureStage: 'RUNTIME_SERVER',
        summary: 'Dev server did not become ready.',
      };
    }
    for (const route of runtime.browser.routes) {
      if (route.pageExceptions.length > 0) {
        return {
          category: 'BROWSER_PAGE_ERROR',
          correctable: true,
          failureStage: `BROWSER${route.path}`,
          summary: `Page exception on ${route.path}.`,
        };
      }
      if (route.consoleErrors.some(({ message }) => message.length > 0)) {
        return {
          category: 'BROWSER_CONSOLE_ERROR',
          correctable: true,
          failureStage: `BROWSER${route.path}`,
          summary: `Console error on ${route.path}.`,
        };
      }
      if (route.failedRequests.length > 0) {
        return {
          category: 'BROWSER_NETWORK_ERROR',
          correctable: true,
          failureStage: `BROWSER${route.path}`,
          summary: `Failed network resource on ${route.path}.`,
        };
      }
    }
    if (runtime.browser.status === 'TIMEOUT' || runtime.status === 'TIMEOUT') {
      return {
        category: 'BROWSER_TIMEOUT',
        correctable: true,
        failureStage: 'BROWSER',
        summary: 'Browser verification timed out.',
      };
    }
    if (runtime.status === 'FAILED' || runtime.status === 'PARTIAL') {
      return {
        category: 'BROWSER_CONSOLE_ERROR',
        correctable: true,
        failureStage: 'BROWSER',
        summary: 'Browser verification failed.',
      };
    }
  }

  const verification = input.verificationReport;
  if (verification !== undefined && verification.status !== 'PASSED') {
    const failedStage = verification.stages.find(
      ({ status }) =>
        status === 'FAILED' ||
        status === 'TIMEOUT' ||
        status === 'PROCESS_FAILED' ||
        status === 'OUTPUT_LIMIT_EXCEEDED',
    );
    if (failedStage !== undefined) {
      const category = stageToCategory(failedStage.stage);
      return {
        category,
        correctable: true,
        failureStage: failedStage.stage,
        summary: `${failedStage.stage.replace('_VALIDATION', '').toLowerCase()} verification failed.`,
      };
    }
  }

  if (input.applyStatus === 'APPLIED') {
    return {
      category: 'UNKNOWN_VERIFICATION_FAILURE',
      correctable: true,
      failureStage: 'VERIFICATION',
      summary: 'Applied changes did not pass verification.',
    };
  }

  return {
    category: 'UNKNOWN_VERIFICATION_FAILURE',
    correctable: true,
    failureStage: 'APPLY',
    summary: 'Workflow failure may be correctable.',
  };
}

function stageToCategory(stage: string): CorrectionFailureClassification['category'] {
  if (stage === 'BUILD_VALIDATION') return 'BUILD_FAILURE';
  if (stage === 'TEST_VALIDATION') return 'TEST_FAILURE';
  if (stage === 'LINT_VALIDATION') return 'LINT_FAILURE';
  if (stage === 'TYPECHECK_VALIDATION') return 'TYPECHECK_FAILURE';
  if (stage === 'FORMAT_VALIDATION') return 'FORMAT_FAILURE';
  return 'UNKNOWN_VERIFICATION_FAILURE';
}
