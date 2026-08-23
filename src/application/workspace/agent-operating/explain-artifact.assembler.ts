import type { CorrectionLoopSession } from '../correction-loop';
import type { Gate2ReviewProjection } from '../gate2-review';
import type { WorkspaceCompletion } from '../workspace-runtime.types';
import type {
  AgentLoopBudgetSnapshot,
  BoundedToolEvidenceRecord,
} from '../agent-loop/agent-loop.types';
import type { AgentRun } from './agent-run.types';
import {
  EXPLAIN_ARTIFACT_SCHEMA_VERSION,
  type ExplainArtifact,
  type ExplainAvailability,
  type ExplainEvidenceAvailability,
  type ExplainFailureItem,
  type ExplainToolLoopSection,
} from './explain-artifact.types';

const SUMMARY_MAX = 1_200;
const MESSAGE_MAX = 240;
const PATH_LIST_MAX = 40;
const FINDING_CODE_MAX = 40;
const TOOL_LOOP_ITEMS_MAX = 40;

export interface AssembleExplainArtifactInput {
  readonly run: AgentRun;
  readonly generatedAt: string;
  readonly preparationOutcome?: string;
  readonly gate2Review?: Gate2ReviewProjection;
  readonly completion?: WorkspaceCompletion;
  readonly correctionSession?: CorrectionLoopSession;
  readonly correctionCanPrepare?: boolean;
  readonly gate2CyclesObserved?: number;
  readonly toolEvidence?: readonly BoundedToolEvidenceRecord[];
  readonly toolBudget?: AgentLoopBudgetSnapshot;
}

/** Pure deterministic assembly — no I/O, no provider calls. */
export function assembleExplainArtifact(input: AssembleExplainArtifactInput): ExplainArtifact {
  const { run, generatedAt } = input;
  const apply = input.completion?.applyResult;
  const verification = input.completion?.verificationReport;
  const browser = input.completion?.runtimeBrowserVerificationReport;
  const session = input.correctionSession;

  const understood = {
    availability: availableIf(
      run.references.investigationId !== undefined,
      'AVAILABLE',
      'PARTIAL',
      'Investigation id not recorded on AgentRun.',
    ),
    goal: run.goal,
    ...(run.references.investigationId === undefined
      ? {}
      : { investigationId: run.references.investigationId }),
  };

  const hasPlanEvidence =
    run.references.preparationId !== undefined ||
    input.preparationOutcome !== undefined ||
    input.gate2Review !== undefined;
  const plan = {
    availability: availableIf(
      hasPlanEvidence,
      input.gate2Review !== undefined || input.preparationOutcome !== undefined
        ? 'AVAILABLE'
        : 'PARTIAL',
      'UNAVAILABLE',
      'Preparation / Gate 2 evidence is not available (may be ephemeral after restart).',
    ),
    ...(run.references.preparationId === undefined
      ? {}
      : { preparationId: run.references.preparationId }),
    ...(input.preparationOutcome === undefined
      ? {}
      : { preparationOutcome: input.preparationOutcome }),
    ...(input.gate2Review === undefined
      ? {}
      : {
          plannedOperationCount: input.gate2Review.operationDiffs.length,
          gate2CharacterCount: input.gate2Review.totalCharacterCount,
          gate2Truncated: input.gate2Review.truncated,
        }),
  };

  const pathProjection = apply === undefined ? undefined : projectPaths(apply);
  const changes = {
    availability: availableIf(
      apply !== undefined,
      'AVAILABLE',
      'UNAVAILABLE',
      'Apply result is not available for this AgentRun.',
    ),
    ...(apply === undefined ? {} : { applyStatus: apply.status }),
    ...(pathProjection === undefined
      ? {}
      : {
          createdFiles: pathProjection.createdFiles,
          updatedFiles: pathProjection.updatedFiles,
          deletedFiles: pathProjection.deletedFiles,
          skippedFiles: pathProjection.skippedFiles,
          ...(pathProjection.truncatedPathLists ? { truncatedPathLists: true } : {}),
        }),
    ...(apply === undefined
      ? {}
      : {
          errorCodes: uniqueBounded(
            apply.errors.map((error) => error.code),
            FINDING_CODE_MAX,
          ),
        }),
  };

  const verificationSection = {
    availability: availableIf(
      verification !== undefined,
      'AVAILABLE',
      'UNAVAILABLE',
      'Verification report was not present on the completion evidence.',
    ),
    ...(verification === undefined
      ? {}
      : {
          overallStatus: verification.status,
          stages: verification.stages.map((stage) => ({
            stage: stage.stage,
            status: stage.status,
          })),
          findingCodes: uniqueBounded(
            [
              ...verification.errors.map((finding) => finding.code),
              ...verification.warnings.map((finding) => finding.code),
            ],
            FINDING_CODE_MAX,
          ),
        }),
  };

  const browserSection = {
    availability:
      browser === undefined
        ? ({
            status: 'UNAVAILABLE',
            reason: 'Browser/runtime verification was not performed or evidence is unavailable.',
          } satisfies ExplainAvailability)
        : ({ status: 'AVAILABLE' } satisfies ExplainAvailability),
    ...(browser === undefined
      ? {}
      : {
          overallStatus: browser.status,
          serverStatus: browser.server.status,
          browserStatus: browser.browser.status,
          routeCount: browser.browser.routes.length,
          consoleErrorCount: browser.browser.consoleErrorCount,
          pageExceptionCount: browser.browser.pageExceptionCount,
          failedRequestCount: browser.browser.failedRequestCount,
        }),
  };

  const corrections = buildCorrectionsSection(run, session, input.correctionCanPrepare);
  const approvals = buildApprovalsSection(input.gate2CyclesObserved);
  const toolLoop = buildToolLoopSection(input.toolEvidence, input.toolBudget);
  const failures = collectFailures(run, apply, verification, browser, session);

  const finalResult = {
    runPhase: run.phase,
    runStatus: run.status,
    ...(apply === undefined ? {} : { applyStatus: apply.status }),
    ...(verification === undefined ? {} : { verificationStatus: verification.status }),
    ...(browser === undefined ? {} : { browserVerificationStatus: browser.status }),
  };

  const evidence = {
    ...(run.references.investigationId === undefined
      ? {}
      : { investigationId: run.references.investigationId }),
    ...(run.references.featurePlanId === undefined
      ? {}
      : { featurePlanId: run.references.featurePlanId }),
    ...(run.references.preparationId === undefined
      ? {}
      : { preparationId: run.references.preparationId }),
    ...(run.references.workflowId === undefined ? {} : { workflowId: run.references.workflowId }),
    ...(run.references.correctionWorkflowId === undefined
      ? {}
      : { correctionWorkflowId: run.references.correctionWorkflowId }),
  };

  const artifact: ExplainArtifact = {
    schemaVersion: EXPLAIN_ARTIFACT_SCHEMA_VERSION,
    runId: run.runId,
    projectId: run.projectId,
    goal: run.goal,
    generatedAt,
    understood,
    plan,
    changes,
    verification: verificationSection,
    browserVerification: browserSection,
    failures,
    corrections,
    approvals,
    toolLoop,
    finalResult,
    evidence,
    summary: buildSummary({
      run,
      preparationOutcome: input.preparationOutcome,
      applyStatus: apply?.status,
      verificationStatus: verification?.status,
      browserStatus: browser?.status,
      correctionState: session?.state ?? corrections.state,
      gate2Cycles: input.gate2CyclesObserved,
      failureCount: failures.length,
      toolEvidenceCount: toolLoop.evidenceCount,
    }),
  };

  assertNoForbiddenPayload(artifact);
  return artifact;
}

function buildCorrectionsSection(
  run: AgentRun,
  session: CorrectionLoopSession | undefined,
  canPrepare: boolean | undefined,
): ExplainArtifact['corrections'] {
  const correctionId = run.references.correctionWorkflowId;
  if (correctionId === undefined && session === undefined) {
    return {
      availability: {
        status: 'UNAVAILABLE',
        reason: 'No correction session was started for this AgentRun.',
      },
    };
  }
  if (session === undefined) {
    return {
      availability: {
        status: 'PARTIAL',
        reason: 'Correction workflow referenced, but session details are not loaded.',
      },
      correctionWorkflowId: correctionId,
      state: 'CORRECTION_REFERENCED',
      ...(canPrepare === undefined ? {} : { canPrepare }),
    };
  }
  return {
    availability: { status: 'AVAILABLE' },
    correctionWorkflowId: session.workflowId,
    state: session.state,
    attempt: session.attempt,
    maximumAttempts: session.maximumAttempts,
    attemptHistoryCount: session.attemptHistory.length,
    ...(canPrepare === undefined ? {} : { canPrepare }),
    ...(session.currentDiagnostic === undefined
      ? {}
      : { failureCategory: session.currentDiagnostic.failureCategory }),
  };
}

function buildApprovalsSection(
  gate2CyclesObserved: number | undefined,
): ExplainArtifact['approvals'] {
  if (gate2CyclesObserved === undefined) {
    return {
      availability: {
        status: 'UNAVAILABLE',
        reason: 'Gate 2 cycle count was not recorded for this AgentRun.',
      },
    };
  }
  return {
    availability: { status: 'AVAILABLE' },
    gate2CyclesObserved,
  };
}

function buildToolLoopSection(
  toolEvidence: readonly BoundedToolEvidenceRecord[] | undefined,
  toolBudget: AgentLoopBudgetSnapshot | undefined,
): ExplainToolLoopSection {
  if ((toolEvidence === undefined || toolEvidence.length === 0) && toolBudget === undefined) {
    return {
      availability: {
        status: 'UNAVAILABLE',
        reason: 'No bounded AgentLoop tool evidence is available for this AgentRun.',
      },
    };
  }
  const items = (toolEvidence ?? []).slice(-TOOL_LOOP_ITEMS_MAX).map((item) => ({
    toolId: item.toolId,
    intentId: item.intentId,
    phase: item.phase,
    status: item.status,
    recordedAt: item.recordedAt,
    summaryDigest: item.summaryDigest,
    ...(item.errorCode === undefined ? {} : { errorCode: item.errorCode }),
  }));
  return {
    availability: { status: 'AVAILABLE' },
    evidenceCount: toolEvidence?.length ?? 0,
    ...(toolBudget === undefined
      ? {}
      : { toolCalls: toolBudget.toolCalls, providerTurns: toolBudget.providerTurns }),
    ...(items.length === 0 ? {} : { items }),
  };
}

function collectFailures(
  run: AgentRun,
  apply: WorkspaceCompletion['applyResult'] | undefined,
  verification: WorkspaceCompletion['verificationReport'] | undefined,
  browser: WorkspaceCompletion['runtimeBrowserVerificationReport'] | undefined,
  session: CorrectionLoopSession | undefined,
): readonly ExplainFailureItem[] {
  const failures: ExplainFailureItem[] = [];
  if (run.phase === 'FAILED' || run.status === 'FAILED') {
    failures.push({
      source: 'RUN',
      code: 'AGENT_RUN_FAILED',
      message: 'AgentRun ended in FAILED status.',
    });
  }
  if (apply !== undefined) {
    for (const error of apply.errors.slice(0, FINDING_CODE_MAX)) {
      failures.push({
        source: 'APPLY',
        code: error.code,
        message: sanitizeMessage(error.message),
      });
    }
    if (
      (apply.status === 'FAILED' || apply.status === 'PARTIALLY_APPLIED') &&
      apply.errors.length === 0
    ) {
      failures.push({
        source: 'APPLY',
        code: apply.status,
        message: `Apply status: ${apply.status}.`,
      });
    }
  }
  if (verification !== undefined && verification.status !== 'PASSED') {
    for (const finding of verification.errors.slice(0, FINDING_CODE_MAX)) {
      failures.push({
        source: 'VERIFICATION',
        code: finding.code,
        message: sanitizeMessage(finding.message),
      });
    }
    if (verification.errors.length === 0) {
      failures.push({
        source: 'VERIFICATION',
        code: verification.status,
        message: `Verification status: ${verification.status}.`,
      });
    }
  }
  if (browser !== undefined && browser.status !== 'PASSED') {
    failures.push({
      source: 'BROWSER',
      code: browser.server.policyBlockCode ?? browser.status,
      message: `Browser/runtime verification status: ${browser.status}.`,
    });
  }
  if (session?.currentDiagnostic !== undefined) {
    failures.push({
      source: 'CORRECTION',
      code: session.currentDiagnostic.failureCategory,
      message: sanitizeMessage(session.currentDiagnostic.summary),
    });
  }
  if (session?.blockCode !== undefined) {
    failures.push({
      source: 'CORRECTION',
      code: session.blockCode,
      message: sanitizeMessage(session.blockMessage ?? session.blockCode),
    });
  }
  return failures;
}

function projectPaths(apply: NonNullable<WorkspaceCompletion['applyResult']>): {
  readonly createdFiles: readonly string[];
  readonly updatedFiles: readonly string[];
  readonly deletedFiles: readonly string[];
  readonly skippedFiles: readonly string[];
  readonly truncatedPathLists: boolean;
} {
  const created = apply.createdFiles.slice(0, PATH_LIST_MAX);
  const updated = apply.updatedFiles.slice(0, PATH_LIST_MAX);
  const deleted = apply.deletedFiles.slice(0, PATH_LIST_MAX);
  const skipped = apply.skippedFiles.slice(0, PATH_LIST_MAX);
  return {
    createdFiles: created,
    updatedFiles: updated,
    deletedFiles: deleted,
    skippedFiles: skipped,
    truncatedPathLists:
      apply.createdFiles.length > PATH_LIST_MAX ||
      apply.updatedFiles.length > PATH_LIST_MAX ||
      apply.deletedFiles.length > PATH_LIST_MAX ||
      apply.skippedFiles.length > PATH_LIST_MAX,
  };
}

function buildSummary(input: {
  readonly run: AgentRun;
  readonly preparationOutcome?: string;
  readonly applyStatus?: string;
  readonly verificationStatus?: string;
  readonly browserStatus?: string;
  readonly correctionState?: string;
  readonly gate2Cycles?: number;
  readonly failureCount: number;
  readonly toolEvidenceCount?: number;
}): string {
  const parts = [
    `Agent run ${input.run.runId} status ${input.run.status} (phase ${input.run.phase}).`,
    `Goal: ${truncate(input.run.goal, 200)}.`,
    input.preparationOutcome !== undefined
      ? `Preparation outcome: ${input.preparationOutcome}.`
      : undefined,
    input.applyStatus !== undefined ? `Apply: ${input.applyStatus}.` : undefined,
    input.verificationStatus !== undefined
      ? `Verification: ${input.verificationStatus}.`
      : undefined,
    input.browserStatus !== undefined
      ? `Browser verification: ${input.browserStatus}.`
      : 'Browser verification: unavailable.',
    input.correctionState !== undefined ? `Correction: ${input.correctionState}.` : undefined,
    input.gate2Cycles !== undefined ? `Gate 2 cycles observed: ${input.gate2Cycles}.` : undefined,
    input.toolEvidenceCount !== undefined && input.toolEvidenceCount > 0
      ? `Tool-loop digests: ${input.toolEvidenceCount}.`
      : undefined,
    input.failureCount > 0 ? `Failures recorded: ${input.failureCount}.` : 'No failures recorded.',
    input.run.references.preparationId !== undefined
      ? `Preparation: ${input.run.references.preparationId}.`
      : undefined,
    input.run.references.workflowId !== undefined
      ? `Workflow: ${input.run.references.workflowId}.`
      : undefined,
    input.run.references.investigationId !== undefined
      ? `Investigation: ${input.run.references.investigationId}.`
      : undefined,
  ].filter((part): part is string => part !== undefined);
  return truncate(parts.join(' '), SUMMARY_MAX);
}

function availableIf(
  present: boolean,
  whenPresent: ExplainEvidenceAvailability,
  whenAbsent: ExplainEvidenceAvailability,
  absentReason: string,
): ExplainAvailability {
  if (present) return { status: whenPresent };
  return { status: whenAbsent, reason: absentReason };
}

function uniqueBounded(values: readonly string[], max: number): readonly string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].slice(0, max);
}

function sanitizeMessage(value: string): string {
  return truncate(
    value
      .replace(/api[_-]?key\s*[=:]\s*\S+/gi, 'api_key=[redacted]')
      .replace(/bearer\s+[a-z0-9._-]+/gi, 'bearer [redacted]')
      .replace(/password\s*[=:]\s*\S+/gi, 'password=[redacted]'),
    MESSAGE_MAX,
  );
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

/** Fail closed if assembly accidentally embeds forbidden payloads. */
function assertNoForbiddenPayload(artifact: ExplainArtifact): void {
  const serialized = JSON.stringify(artifact);
  const forbidden = [
    'fileContents',
    'promptPackage',
    'stdoutExcerpt',
    'stderrExcerpt',
    'unifiedDiff',
    'screenshotArtifactId',
    'providerResponse',
  ];
  for (const key of forbidden) {
    if (serialized.includes(`"${key}"`)) {
      throw new Error(`ExplainArtifact must not include ${key}.`);
    }
  }
}
