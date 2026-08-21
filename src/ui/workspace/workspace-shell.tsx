'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { isVerificationEligibleFileApplyResult, type FileApplyResult } from '../../core/file-apply';
import type { VerificationReport } from '../../core/verification';
import type { CorrectionLoopSession } from '../../application/workspace/correction-loop';
import { buildIterationFeedbackFromCompletion } from '../../application/workspace/iteration-feedback.service';
import { isInvestigationHandoffFeedback } from '../../application/workspace/investigation/investigation-handoff';
import { buildVerificationFailureInvestigationRequest } from '../../application/workspace/verification-failure-investigation';
import type { WorkspaceInvestigation } from '../../application/workspace/investigation';
import type { ExternalTargetProjectMemory } from '../../application/workspace/project-memory';
import type { WorkspaceActivity } from '../../application/workspace/activity-history.types';
import type { FeaturePlan, FeatureTask } from '../../application/workspace/feature-plan.types';
import type { ExternalTargetReadiness } from '../../application/workspace/external-target-readiness';
import type { WorkspaceProjectProfile } from '../../core/target-project/workspace-project-profile.types';
import { ActivityHistoryPanel } from './activity-history-panel';
import { ProjectReadinessPanel } from './project-readiness-panel';
import { ProjectMemoryPanel } from './project-memory-panel';
import { FeatureWorkflowPanel } from './feature-workflow-panel';
import { AgentRunPanel } from './agent-run-panel';
import { HttpFeatureWorkflow } from './http-feature-workflow';
import { ResultPanel } from './result-panel';
import { HttpWorkspaceWorkflow } from './http-workspace-workflow';
import styles from './workspace.module.css';
import {
  WorkspaceWorkflowError,
  isCorrectionEligible,
  isPartialApplyRecovery,
  supportsGate2Correction,
  type WorkspaceCompletionSnapshot,
} from './workspace.types';
import {
  appliedWithVerificationFailureHeadline,
  freshPrepareRequiredNotice,
  verificationFailureCorrectionHint,
} from './operator-recovery-guidance';
import { correctionSessionHeadline, isCorrectionTerminal } from './correction-loop-display';
import { isAppliedWithVerificationFailure } from './verification-outcome-display';
import type {
  PreparedWorkspaceChange,
  PrepareWorkspaceOptions,
  ResultPanelTab,
  WorkspaceConversationEntry,
  WorkspacePhase,
  WorkspaceProjectView,
  WorkspaceWorkflowPort,
} from './workspace.types';

const DEFAULT_CORRECTION_REQUEST = 'Fix the verification failures from the previous change.';

const PROGRESS_STEPS = [
  'Request received',
  'Response packaged',
  'Change plan ready',
  'Approval recorded',
  'Changes applied',
  'Project verified',
] as const;

const PHASE_LABELS: Readonly<Record<WorkspacePhase, string>> = {
  READY: 'Ready for request',
  INVESTIGATING: 'Investigating repository evidence',
  INVESTIGATION_COMPLETE: 'Investigation complete',
  PROCESSING_REQUEST: 'Preparing response and change plan',
  AWAITING_APPROVAL: 'Waiting for explicit approval',
  APPLYING_CHANGES: 'Applying approved changes',
  VERIFYING_PROJECT: 'Verifying project',
  COMPLETED: 'Workflow complete',
  FAILED: 'Workflow stopped',
  PROVIDER_RATE_LIMITED: 'Provider rate limited — retry later',
  PROVIDER_UNAVAILABLE: 'Provider temporarily unavailable',
  PROVIDER_TIMEOUT: 'Provider request timed out',
  PROVIDER_CANCELLED: 'Request cancelled',
  OUTPUT_TRUNCATED: 'Provider output was truncated',
  INVALID_PROVIDER_RESPONSE: 'Invalid provider response',
  INSUFFICIENT_EVIDENCE: 'Insufficient evidence for a safe change',
  NO_CHANGE: 'No change needed',
  RECOVERY_REQUIRED: 'Recovery required',
  BASELINE_CHANGED: 'Baseline changed — fresh prepare required',
  RESUMING_WORKFLOW: 'Resuming workflow',
  WAITING_FOR_APPROVAL: 'Waiting for approval',
  WORKFLOW_CANCELLED: 'Workflow cancelled',
};

interface WorkspaceShellProps {
  readonly project: WorkspaceProjectView;
  readonly workflow?: WorkspaceWorkflowPort;
  readonly runtimeAvailable?: boolean;
  readonly projectProfile?: WorkspaceProjectProfile;
  readonly readiness?: ExternalTargetReadiness;
}

interface PreparationTrace {
  readonly preparationId?: string;
  readonly sourcePreparationId?: string;
  readonly isCorrection?: boolean;
}

export function WorkspaceShell({
  project,
  workflow: injectedWorkflow,
  runtimeAvailable = false,
  projectProfile = 'BUILDERAI_SELF',
  readiness,
}: WorkspaceShellProps) {
  const workflowBlocked = readiness?.status === 'BLOCKED';
  const runtimeWorkflow = useMemo(
    () => (runtimeAvailable ? new HttpWorkspaceWorkflow() : undefined),
    [runtimeAvailable],
  );
  const workflow = injectedWorkflow ?? runtimeWorkflow;
  const requestId = useId();
  const approvalId = useId();
  const gate2RejectReasonId = useId();
  const [request, setRequest] = useState('');
  const [phase, setPhase] = useState<WorkspacePhase>('READY');
  const [progressIndex, setProgressIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<ResultPanelTab>('RESPONSE_PACKAGE');
  const [prepared, setPrepared] = useState<PreparedWorkspaceChange>();
  const [preparationTrace, setPreparationTrace] = useState<PreparationTrace>();
  const [rejectedPreparedSnapshot, setRejectedPreparedSnapshot] =
    useState<PreparedWorkspaceChange>();
  const [showGate2RejectForm, setShowGate2RejectForm] = useState(false);
  const [gate2RejectionReason, setGate2RejectionReason] = useState('');
  const [gate2CorrectionInFlight, setGate2CorrectionInFlight] = useState(false);
  const [investigation, setInvestigation] = useState<WorkspaceInvestigation>();
  const [lastInvestigationRequest, setLastInvestigationRequest] = useState<string>();
  const [applyResult, setApplyResult] = useState<FileApplyResult>();
  const [verificationReport, setVerificationReport] = useState<VerificationReport>();
  const [completionSnapshot, setCompletionSnapshot] = useState<WorkspaceCompletionSnapshot>();
  const [correctionSession, setCorrectionSession] = useState<CorrectionLoopSession>();
  const [correctionWorkflowId, setCorrectionWorkflowId] = useState<string>();
  const [lastPreparedRequest, setLastPreparedRequest] = useState<string>();
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState<string>();
  const [conversation, setConversation] = useState<readonly WorkspaceConversationEntry[]>([]);
  const [featurePlan, setFeaturePlan] = useState<FeaturePlan>();
  const [activeFeatureTaskId, setActiveFeatureTaskId] = useState<string>();
  const [activeFeatureDependencyOverrides, setActiveFeatureDependencyOverrides] = useState<
    readonly string[]
  >([]);
  const [activityHistory, setActivityHistory] = useState<readonly WorkspaceActivity[]>([]);
  const [historyRefreshing, setHistoryRefreshing] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyError, setHistoryError] = useState<string>();
  const [projectMemory, setProjectMemory] = useState<ExternalTargetProjectMemory>();
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryLoaded, setMemoryLoaded] = useState(false);
  const [memoryError, setMemoryError] = useState<string>();
  const [investigationMemorySaveState, setInvestigationMemorySaveState] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const historyLoadedRef = useRef(false);
  const featureApi = useMemo(
    () => (runtimeAvailable ? new HttpFeatureWorkflow() : undefined),
    [runtimeAvailable],
  );
  const isBusy =
    gate2CorrectionInFlight ||
    ['INVESTIGATING', 'PROCESSING_REQUEST', 'APPLYING_CHANGES', 'VERIFYING_PROJECT'].includes(
      phase,
    );
  const supportsInvestigation = workflow?.investigate !== undefined;
  const historySupported =
    runtimeAvailable && workflow !== undefined && workflow.loadActivityHistory !== undefined;
  const memorySupported =
    runtimeAvailable && workflow !== undefined && workflow.loadProjectMemory !== undefined;

  const loadProjectMemoryFromWorkflow = useCallback(async (): Promise<void> => {
    if (workflow?.loadProjectMemory === undefined) return;
    const memory = await workflow.loadProjectMemory();
    setProjectMemory(memory);
    setMemoryError(undefined);
    setMemoryLoaded(true);
  }, [workflow]);

  const refreshProjectMemory = useCallback(async (): Promise<void> => {
    if (!memorySupported || workflow?.loadProjectMemory === undefined) return;
    setMemoryLoading(true);
    try {
      await loadProjectMemoryFromWorkflow();
    } catch {
      setMemoryError('Project memory could not be loaded.');
    } finally {
      setMemoryLoading(false);
    }
  }, [loadProjectMemoryFromWorkflow, memorySupported, workflow]);

  const loadActivityHistoryFromWorkflow = useCallback(async (): Promise<void> => {
    if (workflow?.loadActivityHistory === undefined) return;
    const history = await workflow.loadActivityHistory();
    setActivityHistory(history.activities);
    setHistoryError(undefined);
    historyLoadedRef.current = true;
    setHistoryLoaded(true);
  }, [workflow]);

  const refreshActivityHistory = useCallback(async (): Promise<void> => {
    if (!historySupported || workflow?.loadActivityHistory === undefined) return;
    const isRefresh = historyLoadedRef.current;
    if (isRefresh) setHistoryRefreshing(true);
    try {
      await loadActivityHistoryFromWorkflow();
    } catch {
      if (!historyLoadedRef.current) {
        setHistoryError('Activity history could not be loaded.');
      }
    } finally {
      if (isRefresh) setHistoryRefreshing(false);
    }
  }, [historySupported, loadActivityHistoryFromWorkflow, workflow]);

  useEffect(() => {
    if (!historySupported) return;
    let cancelled = false;
    void (async () => {
      try {
        await loadActivityHistoryFromWorkflow();
      } catch {
        if (!cancelled && !historyLoadedRef.current) {
          setHistoryError('Activity history could not be loaded.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [historySupported, loadActivityHistoryFromWorkflow]);

  useEffect(() => {
    if (!memorySupported) return;
    void refreshProjectMemory();
  }, [memorySupported, refreshProjectMemory]);

  async function handleSaveInvestigationMemory(): Promise<void> {
    if (investigation === undefined || workflow?.saveInvestigationMemory === undefined || isBusy) {
      return;
    }
    setInvestigationMemorySaveState('saving');
    try {
      const memory = await workflow.saveInvestigationMemory({
        investigationId: investigation.investigationId,
        requestSummary: lastInvestigationRequest ?? request,
        summary: investigation.report.summary,
        confidence: investigation.report.confidence,
        likelyRootCause: investigation.report.likelyRootCause,
        affectedAreas: investigation.report.affectedAreas,
        recommendedNextSteps: investigation.report.recommendedNextSteps,
        suggestedFixScope: investigation.report.suggestedFixScope,
      });
      setProjectMemory(memory);
      setInvestigationMemorySaveState('saved');
      setMemoryLoaded(true);
    } catch {
      setInvestigationMemorySaveState('error');
    }
  }

  useEffect(() => {
    if (featureApi === undefined) return;
    void (async () => {
      try {
        const active = await featureApi.loadActivePlan();
        if (active !== undefined) setFeaturePlan(active);
      } catch {
        // Active plan reload is best-effort on mount.
      }
    })();
  }, [featureApi]);

  const showHistoryInitialLoading =
    historySupported && !historyLoaded && historyError === undefined;

  async function handleFeatureTaskExecute(
    task: FeatureTask,
    _plan: FeaturePlan,
    options: PrepareWorkspaceOptions,
  ): Promise<void> {
    const taskRequest = `${task.objective}\n\nScope: ${task.scope}`.trim();
    setRequest(taskRequest);
    await runPrepare(taskRequest, undefined, options);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await runPrepare(request.trim());
  }

  async function handleInvestigate(): Promise<void> {
    if (!workflow?.investigate || request.trim().length === 0 || isBusy || workflowBlocked) return;
    const normalizedRequest = request.trim();
    setError(undefined);
    setPrepared(undefined);
    setApplyResult(undefined);
    setVerificationReport(undefined);
    setApproved(false);
    setPhase('INVESTIGATING');
    setActiveTab('INVESTIGATION');
    setConversation((entries) => [
      ...entries,
      { id: nextConversationId(entries), author: 'USER', message: normalizedRequest },
    ]);
    try {
      const result = await workflow.investigate(normalizedRequest);
      setInvestigation(result);
      setLastInvestigationRequest(normalizedRequest);
      setPhase('INVESTIGATION_COMPLETE');
      setConversation((entries) => [
        ...entries,
        {
          id: nextConversationId(entries),
          author: 'BUILDER_AI',
          message: `Investigation complete (${result.report.confidence} confidence). No files were changed.`,
        },
      ]);
    } catch (workflowError: unknown) {
      stopWorkflow(
        workflowError instanceof WorkspaceWorkflowError
          ? `${workflowError.message} No project changes were made.`
          : 'Investigation could not be completed. No project changes were made.',
        0,
      );
    }
  }

  async function handlePrepareFixFromInvestigation(): Promise<void> {
    if (investigation === undefined || !workflow || isBusy) return;
    const originalRequest = (lastInvestigationRequest ?? request).trim();
    if (originalRequest.length === 0) return;
    const enrichedRequest = [
      originalRequest,
      '',
      'Investigation summary:',
      investigation.report.summary,
      investigation.report.suggestedFixScope === undefined
        ? ''
        : `Suggested fix scope: ${investigation.report.suggestedFixScope}`,
      'Prepare the smallest safe fix using investigation evidence as hints only.',
    ]
      .filter((line) => line.length > 0)
      .join('\n');
    setRequest(enrichedRequest);
    await runPrepare(enrichedRequest, undefined, {
      investigationId: investigation.investigationId,
    });
  }

  async function handleFreshPrepare(): Promise<void> {
    if (!workflow || isBusy) return;
    setCompletionSnapshot(undefined);
    setApplyResult(undefined);
    setVerificationReport(undefined);
    setPrepared(undefined);
    setApproved(false);
    setPhase('READY');
    setProgressIndex(0);
    setError(undefined);
    setPreparationTrace(undefined);
    setConversation((entries) => [
      ...entries,
      {
        id: nextConversationId(entries),
        author: 'BUILDER_AI',
        message:
          'Previous partial apply requires a fresh prepare from the current filesystem state. Enter a new request when ready.',
      },
    ]);
  }

  async function handleInvestigateFailure(): Promise<void> {
    if (!workflow?.investigate || completionSnapshot?.verificationReport === undefined || isBusy) {
      return;
    }
    const investigationRequest = buildVerificationFailureInvestigationRequest({
      report: completionSnapshot.verificationReport,
      priorRequestSummary: completionSnapshot.priorRequestSummary ?? request.trim(),
    });
    setRequest(investigationRequest);
    setError(undefined);
    setPrepared(undefined);
    setApplyResult(undefined);
    setVerificationReport(undefined);
    setApproved(false);
    setPhase('INVESTIGATING');
    setActiveTab('INVESTIGATION');
    setConversation((entries) => [
      ...entries,
      { id: nextConversationId(entries), author: 'USER', message: investigationRequest },
    ]);
    try {
      const result = await workflow.investigate(investigationRequest);
      setInvestigation(result);
      setLastInvestigationRequest(investigationRequest);
      setPhase('INVESTIGATION_COMPLETE');
      setConversation((entries) => [
        ...entries,
        {
          id: nextConversationId(entries),
          author: 'BUILDER_AI',
          message: `Investigation complete (${result.report.confidence} confidence). No files were changed.`,
        },
      ]);
    } catch (workflowError: unknown) {
      stopWorkflow(
        workflowError instanceof WorkspaceWorkflowError
          ? `${workflowError.message} No project changes were made.`
          : 'Investigation could not be completed. No project changes were made.',
        0,
      );
    }
  }

  async function handleCorrectionPrepare(): Promise<void> {
    if (!workflow || !completionSnapshot || isBusy) return;
    if (workflow.startCorrection !== undefined) {
      await handleBoundedCorrectionStart();
      return;
    }
    const correctionRequest =
      request.trim().length > 0 ? request.trim() : DEFAULT_CORRECTION_REQUEST;
    setRequest(correctionRequest);
    const featureOptions: PrepareWorkspaceOptions =
      completionSnapshot.featurePlanId !== undefined && completionSnapshot.taskId !== undefined
        ? {
            featurePlanId: completionSnapshot.featurePlanId,
            taskId: completionSnapshot.taskId,
            ...(completionSnapshot.dependencyOverrides === undefined ||
            completionSnapshot.dependencyOverrides.length === 0
              ? {}
              : { dependencyOverrides: completionSnapshot.dependencyOverrides }),
          }
        : {};
    await runPrepare(correctionRequest, completionSnapshot, featureOptions);
  }

  async function handleBoundedCorrectionStart(): Promise<void> {
    if (!workflow?.startCorrection || !completionSnapshot) return;
    const workflowId =
      completionSnapshot.sourcePreparationId ?? correctionWorkflowId ?? crypto.randomUUID();
    setCorrectionWorkflowId(workflowId);
    setError(undefined);
    setPhase('PROCESSING_REQUEST');
    setProgressIndex(1);
    try {
      const started = await workflow.startCorrection(
        completionSnapshot,
        workflowId,
        lastPreparedRequest ?? request,
      );
      setCorrectionSession(started.session);
      if (!started.canPrepare || started.iterationFeedback === undefined) {
        stopWorkflow(
          started.session.blockMessage ??
            'Correction could not be prepared from the available evidence.',
          0,
        );
        return;
      }
      const featureOptions: PrepareWorkspaceOptions = {
        iterationFeedback: started.iterationFeedback,
        ...(completionSnapshot.featurePlanId === undefined ||
        completionSnapshot.taskId === undefined
          ? {}
          : {
              featurePlanId: completionSnapshot.featurePlanId,
              taskId: completionSnapshot.taskId,
              ...(completionSnapshot.dependencyOverrides === undefined
                ? {}
                : { dependencyOverrides: completionSnapshot.dependencyOverrides }),
            }),
      };
      await runPrepare(started.correctionRequest, completionSnapshot, featureOptions, workflowId);
    } catch {
      stopWorkflow('Bounded correction could not be started.', 0);
    }
  }

  async function handleRejectCorrection(): Promise<void> {
    if (!workflow?.rejectCorrection || correctionWorkflowId === undefined) return;
    workflow.abortInFlight?.();
    const session = await workflow.rejectCorrection(correctionWorkflowId);
    setCorrectionSession(session);
    setApproved(false);
    setPrepared(undefined);
    setError('Correction was rejected. Manual intervention may be required.');
    setPhase('COMPLETED');
  }

  async function handleCancelInFlight(): Promise<void> {
    workflow?.abortInFlight?.();
    if (workflow?.rejectCorrection !== undefined && correctionWorkflowId !== undefined) {
      try {
        const session = await workflow.rejectCorrection(correctionWorkflowId);
        setCorrectionSession(session);
      } catch {
        // Session cancel is best-effort after the in-flight request is aborted.
      }
    }
  }

  async function runPrepare(
    normalizedRequest: string,
    correctionSnapshot?: WorkspaceCompletionSnapshot,
    featureOptions: PrepareWorkspaceOptions = {},
    activeCorrectionWorkflowId?: string,
  ): Promise<void> {
    if (!workflow || normalizedRequest.length === 0 || isBusy || workflowBlocked) return;

    setError(undefined);
    setPrepared(undefined);
    setApplyResult(undefined);
    setVerificationReport(undefined);
    setApproved(false);
    setPhase('PROCESSING_REQUEST');
    setProgressIndex(1);
    setActiveTab('RESPONSE_PACKAGE');
    setConversation((entries) => [
      ...entries,
      { id: nextConversationId(entries), author: 'USER', message: normalizedRequest },
    ]);

    try {
      const iterationFeedback =
        featureOptions.iterationFeedback ??
        (correctionSnapshot === undefined
          ? undefined
          : buildIterationFeedbackFromCompletion(
              {
                applyResult: correctionSnapshot.applyResult,
                ...(correctionSnapshot.verificationReport === undefined
                  ? {}
                  : { verificationReport: correctionSnapshot.verificationReport }),
                ...(correctionSnapshot.runtimeBrowserVerificationReport === undefined
                  ? {}
                  : {
                      runtimeBrowserVerificationReport:
                        correctionSnapshot.runtimeBrowserVerificationReport,
                    }),
              },
              {
                ...(correctionSnapshot.sourcePreparationId === undefined
                  ? {}
                  : { sourcePreparationId: correctionSnapshot.sourcePreparationId }),
                ...(correctionSnapshot.priorRequestSummary === undefined
                  ? {}
                  : { priorRequestSummary: correctionSnapshot.priorRequestSummary }),
              },
            ));
      const prepareOptions: PrepareWorkspaceOptions = {
        ...featureOptions,
        ...(iterationFeedback === undefined ? {} : { iterationFeedback }),
        ...((activeCorrectionWorkflowId ?? correctionWorkflowId) === undefined
          ? {}
          : { correctionWorkflowId: activeCorrectionWorkflowId ?? correctionWorkflowId }),
      };
      const nextPrepared =
        Object.keys(prepareOptions).length === 0
          ? await workflow.prepare(normalizedRequest)
          : await workflow.prepare(normalizedRequest, prepareOptions);
      setPrepared(nextPrepared);
      setPreparationTrace({
        preparationId: nextPrepared.preparationId,
        ...(nextPrepared.sourcePreparationId === undefined
          ? {}
          : { sourcePreparationId: nextPrepared.sourcePreparationId }),
        ...(nextPrepared.isCorrection === undefined
          ? {}
          : { isCorrection: nextPrepared.isCorrection }),
      });
      if (workflow.recordCorrectionPrepared !== undefined && nextPrepared.isCorrection === true) {
        const workflowId = activeCorrectionWorkflowId ?? correctionWorkflowId;
        const preparationId = nextPrepared.preparationId;
        if (workflowId !== undefined && preparationId !== undefined) {
          const session = await workflow.recordCorrectionPrepared(
            workflowId,
            preparationId,
            nextPrepared.changePlan,
          );
          setCorrectionSession(session);
        }
      }
      if (!nextPrepared.isCorrection) {
        setRejectedPreparedSnapshot(undefined);
        setShowGate2RejectForm(false);
        setGate2RejectionReason('');
      }
      setLastPreparedRequest(normalizedRequest);
      if (featureOptions.taskId !== undefined) {
        setActiveFeatureTaskId(featureOptions.taskId);
      }
      if (nextPrepared.featurePlan !== undefined) {
        setFeaturePlan(nextPrepared.featurePlan);
      }
      setPhase('AWAITING_APPROVAL');
      setProgressIndex(3);
      setActiveTab('DIFF');
      setConversation((entries) => [
        ...entries,
        {
          id: nextConversationId(entries),
          author: 'BUILDER_AI',
          message:
            nextPrepared.changePlan.summary.totalOperations === 0 &&
            (featureOptions.investigationId !== undefined ||
              (featureOptions.iterationFeedback !== undefined &&
                isInvestigationHandoffFeedback(featureOptions.iterationFeedback)))
              ? 'No safe filesystem changes were proposed from the investigation evidence. Refine the investigation or provide clearer reproduction details before preparing again. No files have been changed.'
              : `Prepared ${nextPrepared.changePlan.summary.totalOperations} operation${nextPrepared.changePlan.summary.totalOperations === 1 ? '' : 's'} for review. No files have been changed.`,
        },
      ]);
      void refreshActivityHistory();
    } catch (workflowError: unknown) {
      if (isCancelledWorkflowError(workflowError)) {
        await markCorrectionCancelled();
        stopWorkflow('Correction was cancelled. No project changes were made.', 1);
        return;
      }
      stopWorkflow(
        workflowError instanceof WorkspaceWorkflowError
          ? `${workflowError.message} No project changes were made.`
          : 'The request could not be prepared. No project changes were made.',
        1,
      );
    }
  }

  async function handleGate2RejectCorrection(): Promise<void> {
    if (
      !workflow ||
      !prepared ||
      preparationTrace?.preparationId === undefined ||
      gate2CorrectionInFlight ||
      !supportsGate2Correction(workflow)
    ) {
      return;
    }

    const originalRequest = (lastPreparedRequest ?? request).trim();
    if (originalRequest.length === 0) return;

    setGate2CorrectionInFlight(true);
    setError(undefined);
    const rejectedPlan = prepared;
    setRejectedPreparedSnapshot(rejectedPlan);
    setApproved(false);
    setConversation((entries) => [
      ...entries,
      {
        id: nextConversationId(entries),
        author: 'USER',
        message:
          gate2RejectionReason.trim().length > 0
            ? `Rejected plan for correction: ${gate2RejectionReason.trim()}`
            : 'Rejected plan for correction at Gate 2.',
      },
    ]);

    try {
      const corrected = await workflow.prepareGate2PreservationCorrection(
        originalRequest,
        prepared.changePlan,
        preparationTrace.preparationId,
        gate2RejectionReason.trim().length > 0 ? gate2RejectionReason.trim() : undefined,
      );
      setPrepared(corrected);
      setPreparationTrace({
        preparationId: corrected.preparationId,
        sourcePreparationId: corrected.sourcePreparationId ?? preparationTrace.preparationId,
        isCorrection: true,
      });
      setPhase('AWAITING_APPROVAL');
      setProgressIndex(3);
      setActiveTab('DIFF');
      setShowGate2RejectForm(false);
      setGate2RejectionReason('');
      setConversation((entries) => [
        ...entries,
        {
          id: nextConversationId(entries),
          author: 'BUILDER_AI',
          message: `Prepared corrected plan with ${corrected.changePlan.summary.totalOperations} operation${corrected.changePlan.summary.totalOperations === 1 ? '' : 's'} for Gate 2 review. Approval is required before apply.`,
        },
      ]);
      void refreshActivityHistory();
    } catch (workflowError: unknown) {
      setPrepared(rejectedPlan);
      setPhase('AWAITING_APPROVAL');
      setProgressIndex(3);
      setError(
        workflowError instanceof WorkspaceWorkflowError
          ? `${workflowError.message} The rejected plan was not applied.`
          : 'Correction could not be prepared. The rejected plan was not applied.',
      );
      setConversation((entries) => [
        ...entries,
        {
          id: nextConversationId(entries),
          author: 'BUILDER_AI',
          message:
            workflowError instanceof WorkspaceWorkflowError
              ? workflowError.message
              : 'Correction could not be prepared.',
        },
      ]);
    } finally {
      setGate2CorrectionInFlight(false);
    }
  }

  async function handleApproval(): Promise<void> {
    if (!workflow || !prepared || !approved || phase !== 'AWAITING_APPROVAL') return;
    setError(undefined);
    setPhase('APPLYING_CHANGES');
    setProgressIndex(4);
    setActiveTab('APPLY_RESULT');

    let completedSteps = 4;
    try {
      if (
        workflow.recordCorrectionApplying !== undefined &&
        correctionWorkflowId !== undefined &&
        preparationTrace?.isCorrection === true
      ) {
        const session = await workflow.recordCorrectionApplying(correctionWorkflowId);
        setCorrectionSession(session);
      }
      const nextApplyResult = await workflow.apply(prepared.changePlan);
      setApplyResult(nextApplyResult);
      if (!isVerificationEligibleFileApplyResult(nextApplyResult)) {
        setCompletionSnapshot(
          createCompletionSnapshot(
            nextApplyResult,
            undefined,
            lastPreparedRequest,
            readFeatureBinding(featurePlan, activeFeatureTaskId, activeFeatureDependencyOverrides),
          ),
        );
        stopWorkflow(
          `Apply finished with status ${formatLabel(nextApplyResult.status)}. Verification was not started.`,
          4,
        );
        void refreshActivityHistory();
        return;
      }

      setPhase('VERIFYING_PROJECT');
      setProgressIndex(5);
      completedSteps = 5;
      setActiveTab('VERIFICATION_REPORT');
      const nextVerificationReport = await workflow.verify(nextApplyResult);
      completeWorkflow(nextVerificationReport, nextApplyResult);
    } catch (workflowError: unknown) {
      if (isCancelledWorkflowError(workflowError)) {
        await markCorrectionCancelled();
        stopWorkflow('Correction was cancelled. No additional apply was started.', completedSteps);
        return;
      }
      stopWorkflow(
        'The approved workflow could not complete. Review the available result evidence.',
        completedSteps,
      );
    }
  }

  async function markCorrectionCancelled(): Promise<void> {
    if (workflow?.rejectCorrection === undefined || correctionWorkflowId === undefined) return;
    try {
      const session = await workflow.rejectCorrection(correctionWorkflowId);
      setCorrectionSession(session);
    } catch {
      // Best-effort session update after abort.
    }
  }

  async function completeWorkflow(
    report: VerificationReport,
    appliedResult: FileApplyResult,
  ): Promise<void> {
    setVerificationReport(report);
    const snapshot =
      workflow?.getCompletionSnapshot?.() ??
      createCompletionSnapshot(
        appliedResult,
        report,
        lastPreparedRequest,
        readFeatureBinding(featurePlan, activeFeatureTaskId, activeFeatureDependencyOverrides),
      );
    setCompletionSnapshot(snapshot);
    if (
      workflow?.recordCorrectionVerified !== undefined &&
      correctionWorkflowId !== undefined &&
      preparationTrace?.isCorrection === true
    ) {
      try {
        const session = await workflow.recordCorrectionVerified(correctionWorkflowId, snapshot);
        setCorrectionSession(session);
      } catch {
        // Correction session recording must not block operator review of verification evidence.
      }
    }
    setPhase('COMPLETED');
    setProgressIndex(6);
    setConversation((entries) => [
      ...entries,
      {
        id: nextConversationId(entries),
        author: 'BUILDER_AI',
        message: `Verification completed with status ${formatLabel(report.status)}. Review the final report before any further action.`,
      },
    ]);
    void refreshActivityHistory();
  }

  function stopWorkflow(message: string, completedSteps: number): void {
    setError(message);
    setPhase('FAILED');
    setProgressIndex(completedSteps);
    setConversation((entries) => [
      ...entries,
      { id: nextConversationId(entries), author: 'BUILDER_AI', message },
    ]);
    void refreshActivityHistory();
  }

  return (
    <main className={styles.workspace}>
      <header className={styles.topBar}>
        <Link className={styles.brand} href="/" aria-label="BuilderAI dashboard">
          <span aria-hidden="true">B</span>
          BuilderAI
        </Link>
        <div className={styles.projectCrumb}>
          <span>Project workspace</span>
          <strong>{project.name}</strong>
        </div>
        <span className={workflow ? styles.runtimeReady : styles.runtimeOffline}>
          <span aria-hidden="true" />
          {workflow
            ? projectProfile === 'EXTERNAL_TARGET'
              ? 'External target connected'
              : 'Runtime connected'
            : 'Review mode'}
        </span>
      </header>

      <div className={styles.workspaceGrid}>
        <aside className={styles.sidebar} aria-labelledby="project-details-title">
          <div className={styles.sidebarBlock}>
            <p className={styles.eyebrow}>Project</p>
            <h1 id="project-details-title">{project.name}</h1>
            <p className={styles.projectId}>{project.id}</p>
            <p className={styles.vision}>{project.vision}</p>
          </div>

          <div className={styles.sidebarBlock}>
            <p className={styles.sidebarLabel}>Architecture status</p>
            <strong>{project.architectureStatus}</strong>
            <dl className={styles.projectStats}>
              <div>
                <dt>Modules</dt>
                <dd>{project.moduleCount}</dd>
              </div>
              <div>
                <dt>Sprints</dt>
                <dd>{project.completedSprintCount}</dd>
              </div>
            </dl>
          </div>

          <div className={styles.sidebarBlock}>
            <p className={styles.sidebarLabel}>Current milestone</p>
            <p>{project.currentMilestone}</p>
          </div>

          <div className={styles.sidebarBlock}>
            <p className={styles.sidebarLabel}>Current workflow stage</p>
            <p className={statusClass(phase)} aria-live="polite">
              {PHASE_LABELS[phase]}
            </p>
          </div>

          {readiness !== undefined ? <ProjectReadinessPanel readiness={readiness} /> : null}
        </aside>

        <section className={styles.centerPanel} aria-labelledby="request-title">
          <div className={styles.centerHeader}>
            <div>
              <p className={styles.eyebrow}>Request workspace</p>
              <h2 id="request-title">What should BuilderAI change?</h2>
            </div>
            <span className={styles.safetyNote}>Approval required before apply</span>
          </div>

          {!workflow && (
            <div className={styles.runtimeNotice} role="note">
              <strong>Interface review mode</strong>
              <p>
                Runtime execution is disabled. Configure the documented local-only server runtime
                before this interface can prepare or apply a project change.
              </p>
            </div>
          )}

          {workflow && workflowBlocked && (
            <div className={styles.readinessBlockedNotice} role="alert">
              <strong>External target blocked</strong>
              <p>
                Investigate, prepare, and apply are disabled until onboarding blockers are resolved.
                Review the connected project diagnostics in the sidebar.
              </p>
            </div>
          )}

          {workflow && (
            <FeatureWorkflowPanel
              plan={featurePlan}
              onPlanUpdated={setFeaturePlan}
              onDependencyOverridesChange={setActiveFeatureDependencyOverrides}
              featureApi={featureApi}
              disabled={isBusy}
              onExecuteTask={handleFeatureTaskExecute}
              applyResult={applyResult}
              verificationReport={verificationReport}
              activeTaskId={activeFeatureTaskId}
            />
          )}

          {workflow && <AgentRunPanel disabled={isBusy || workflowBlocked} />}

          <form className={styles.requestForm} onSubmit={handleSubmit}>
            <label htmlFor={requestId}>Project request</label>
            <textarea
              id={requestId}
              value={request}
              maxLength={4_000}
              rows={5}
              disabled={isBusy}
              placeholder="Describe the outcome, constraints, and acceptance criteria…"
              onChange={(event) => setRequest(event.target.value)}
            />
            <div className={styles.formFooter}>
              <span>{request.length.toLocaleString()} / 4,000</span>
              <div className={styles.formActions}>
                {supportsInvestigation && (
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    disabled={!workflow || request.trim().length === 0 || isBusy || workflowBlocked}
                    onClick={() => void handleInvestigate()}
                  >
                    {phase === 'INVESTIGATING' ? 'Investigating…' : 'Investigate'}
                  </button>
                )}
                <button
                  type="submit"
                  disabled={!workflow || request.trim().length === 0 || isBusy || workflowBlocked}
                >
                  {phase === 'PROCESSING_REQUEST' ? 'Preparing request…' : 'Prepare change plan'}
                </button>
                {isBusy &&
                  ['PROCESSING_REQUEST', 'APPLYING_CHANGES', 'VERIFYING_PROJECT'].includes(
                    phase,
                  ) && (
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => void handleCancelInFlight()}
                    >
                      Cancel
                    </button>
                  )}
              </div>
            </div>
          </form>

          {phase === 'INVESTIGATION_COMPLETE' && investigation !== undefined && workflow && (
            <section className={styles.approvalCard} aria-labelledby="investigation-actions-title">
              <div>
                <p className={styles.eyebrow}>Investigation complete</p>
                <h3 id="investigation-actions-title">Next action</h3>
                <p>
                  Review the investigation report. When ready, start a normal Gate 2 change plan
                  from the investigation evidence.
                </p>
              </div>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={isBusy}
                onClick={() => void handlePrepareFixFromInvestigation()}
              >
                Prepare fix
              </button>
            </section>
          )}

          <section className={styles.progressSection} aria-labelledby="progress-title">
            <div className={styles.sectionHeading}>
              <h3 id="progress-title">Workflow progress</h3>
              <span aria-live="polite">{PHASE_LABELS[phase]}</span>
            </div>
            <ol className={styles.progressList}>
              {PROGRESS_STEPS.map((step, index) => {
                const stepNumber = index + 1;
                const state =
                  stepNumber <= progressIndex
                    ? 'complete'
                    : stepNumber === progressIndex + 1 && isBusy
                      ? 'current'
                      : 'pending';
                return (
                  <li key={step} data-state={state}>
                    <span aria-hidden="true">{state === 'complete' ? '✓' : stepNumber}</span>
                    <div>
                      <strong>{step}</strong>
                      <small>{formatLabel(state)}</small>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          {prepared && phase === 'AWAITING_APPROVAL' && (
            <section className={styles.approvalCard} aria-labelledby="approval-title">
              <div>
                <p className={styles.eyebrow}>Human checkpoint</p>
                <h3 id="approval-title">Review before applying</h3>
                {preparationTrace?.isCorrection &&
                  preparationTrace.sourcePreparationId !== undefined && (
                    <p className={styles.correctionTrace} role="status">
                      Correction plan linked to source preparation{' '}
                      <code>{preparationTrace.sourcePreparationId}</code>
                      {preparationTrace.preparationId !== undefined && (
                        <>
                          {' '}
                          · current preparation <code>{preparationTrace.preparationId}</code>
                        </>
                      )}
                    </p>
                  )}
                <p>
                  {prepared.changePlan.summary.totalOperations} planned operation
                  {prepared.changePlan.summary.totalOperations === 1 ? '' : 's'}. Review paths,
                  risks, and warnings in the Change Plan tab.
                </p>
                {gate2CorrectionInFlight && (
                  <p className={styles.correctionStatus} role="status" aria-live="polite">
                    Preparing correction — the rejected plan will not be applied.
                  </p>
                )}
              </div>
              <label className={styles.approvalCheck} htmlFor={approvalId}>
                <input
                  id={approvalId}
                  type="checkbox"
                  checked={approved}
                  disabled={gate2CorrectionInFlight}
                  onChange={(event) => setApproved(event.target.checked)}
                />
                I reviewed this plan and explicitly approve these file operations.
              </label>
              <div className={styles.approvalActions}>
                <button
                  type="button"
                  className={styles.approveButton}
                  disabled={!approved || gate2CorrectionInFlight}
                  onClick={() => void handleApproval()}
                >
                  Approve and apply changes
                </button>
                {workflow !== undefined && supportsGate2Correction(workflow) && (
                  <>
                    {!showGate2RejectForm ? (
                      <button
                        type="button"
                        className={styles.rejectButton}
                        disabled={gate2CorrectionInFlight}
                        onClick={() => {
                          setShowGate2RejectForm(true);
                          setApproved(false);
                        }}
                      >
                        Reject / Request correction
                      </button>
                    ) : (
                      <div className={styles.gate2RejectForm}>
                        <label htmlFor={gate2RejectReasonId}>
                          Optional correction guidance (concise)
                        </label>
                        <textarea
                          id={gate2RejectReasonId}
                          value={gate2RejectionReason}
                          maxLength={500}
                          rows={3}
                          disabled={gate2CorrectionInFlight}
                          placeholder="Describe the smallest safe correction you expect…"
                          onChange={(event) => setGate2RejectionReason(event.target.value)}
                        />
                        <div className={styles.approvalActions}>
                          <button
                            type="button"
                            className={styles.rejectButton}
                            disabled={gate2CorrectionInFlight}
                            onClick={() => void handleGate2RejectCorrection()}
                          >
                            {gate2CorrectionInFlight
                              ? 'Preparing correction…'
                              : 'Submit rejection for correction'}
                          </button>
                          <button
                            type="button"
                            className={styles.secondaryButton}
                            disabled={gate2CorrectionInFlight}
                            onClick={() => {
                              setShowGate2RejectForm(false);
                              setGate2RejectionReason('');
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
              {rejectedPreparedSnapshot !== undefined && preparationTrace?.isCorrection && (
                <details className={styles.rejectedPlanInspect}>
                  <summary>Inspect rejected plan summary</summary>
                  <p>
                    {rejectedPreparedSnapshot.changePlan.summary.totalOperations} operation
                    {rejectedPreparedSnapshot.changePlan.summary.totalOperations === 1
                      ? ''
                      : 's'}{' '}
                    in the rejected preparation (not applied).
                  </p>
                </details>
              )}
            </section>
          )}

          {isPartialApplyRecovery(completionSnapshot) &&
            (phase === 'COMPLETED' || phase === 'FAILED') && (
              <section className={styles.approvalCard} aria-labelledby="partial-recovery-title">
                <div>
                  <p className={styles.eyebrow}>Partial apply recovery</p>
                  <h3 id="partial-recovery-title">Manual recovery required</h3>
                  <p>{freshPrepareRequiredNotice()}</p>
                  <p>
                    Review applied, failed, and skipped operations in the Apply Result tab before
                    continuing. Automatic AI correction from the previous prepare baseline is not
                    offered for partial apply.
                  </p>
                </div>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  disabled={!workflow || isBusy}
                  onClick={() => void handleFreshPrepare()}
                >
                  Start fresh prepare
                </button>
              </section>
            )}

          {isCorrectionEligible(completionSnapshot) &&
            (phase === 'COMPLETED' || phase === 'FAILED') && (
              <section className={styles.approvalCard} aria-labelledby="correction-title">
                <div>
                  <p className={styles.eyebrow}>Bounded correction</p>
                  <h3 id="correction-title">
                    {correctionSession === undefined
                      ? 'Fix verification failures'
                      : correctionSessionHeadline(correctionSession)}
                  </h3>
                  {correctionSession?.currentDiagnostic !== undefined && (
                    <p role="status">Failure: {correctionSession.currentDiagnostic.summary}</p>
                  )}
                  {correctionSession !== undefined && isCorrectionTerminal(correctionSession) && (
                    <p role="status">{correctionSession.blockMessage ?? 'Correction ended.'}</p>
                  )}
                  {isAppliedWithVerificationFailure(
                    completionSnapshot?.applyResult,
                    completionSnapshot?.verificationReport,
                  ) ? (
                    <p role="status">{appliedWithVerificationFailureHeadline()}</p>
                  ) : null}
                  <p>{verificationFailureCorrectionHint()}</p>
                </div>
                <button
                  type="button"
                  className={styles.approveButton}
                  disabled={
                    !workflow ||
                    isBusy ||
                    (correctionSession !== undefined && isCorrectionTerminal(correctionSession))
                  }
                  onClick={() => void handleCorrectionPrepare()}
                >
                  {correctionSession === undefined
                    ? 'Start correction'
                    : 'Retry correction prepare'}
                </button>
                {correctionSession?.state === 'CORRECTION_WAITING_FOR_APPROVAL' && (
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    disabled={!workflow || isBusy}
                    onClick={() => void handleRejectCorrection()}
                  >
                    Reject correction
                  </button>
                )}
                {workflow?.investigate !== undefined && (
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    disabled={!workflow || isBusy}
                    onClick={() => void handleInvestigateFailure()}
                  >
                    Investigate failure
                  </button>
                )}
              </section>
            )}

          {error && (
            <div className={styles.errorNotice} role="alert">
              <strong>Workflow stopped</strong>
              <p>{error}</p>
            </div>
          )}

          <section className={styles.conversation} aria-labelledby="conversation-title">
            <div className={styles.sectionHeading}>
              <h3 id="conversation-title">Conversation history</h3>
              <span>{conversation.length} messages</span>
            </div>
            <div className={styles.conversationLog} role="log" aria-live="polite">
              {conversation.length === 0 ? (
                <div className={styles.emptyConversation}>
                  <span aria-hidden="true">✦</span>
                  <p>Your requests and BuilderAI workflow updates will appear here.</p>
                </div>
              ) : (
                conversation.map((entry) => (
                  <article
                    key={entry.id}
                    className={entry.author === 'USER' ? styles.userMessage : styles.systemMessage}
                  >
                    <p>{entry.author === 'USER' ? 'You' : 'BuilderAI'}</p>
                    <div>{entry.message}</div>
                  </article>
                ))
              )}
            </div>
          </section>
        </section>

        <div className={styles.resultsColumn}>
          <ResultPanel
            activeTab={activeTab}
            onTabChange={setActiveTab}
            responsePackage={prepared?.responsePackage}
            changePlan={prepared?.changePlan}
            gate2Review={prepared?.gate2Review}
            investigation={investigation}
            onSaveInvestigationMemory={
              memorySupported && workflow?.saveInvestigationMemory !== undefined
                ? () => void handleSaveInvestigationMemory()
                : undefined
            }
            investigationMemorySaveState={investigationMemorySaveState}
            applyResult={applyResult}
            verificationReport={verificationReport}
            runtimeBrowserVerificationReport={completionSnapshot?.runtimeBrowserVerificationReport}
          />

          {memorySupported && (
            <div className={styles.activityHistorySection}>
              <ProjectMemoryPanel
                memory={projectMemory}
                loading={memoryLoading && !memoryLoaded}
                error={memoryError}
              />
            </div>
          )}

          {historySupported && (
            <div className={styles.activityHistorySection}>
              {showHistoryInitialLoading && (
                <div className={styles.emptyResult} role="status">
                  <span aria-hidden="true">◇</span>
                  <p>Loading activity history…</p>
                </div>
              )}
              {!showHistoryInitialLoading && historyError !== undefined && !historyLoaded && (
                <div className={styles.errorNotice} role="alert">
                  <strong>Activity history unavailable</strong>
                  <p>{historyError}</p>
                </div>
              )}
              {historyRefreshing && historyLoaded && (
                <p className={styles.historyRefreshing} role="status" aria-live="polite">
                  Refreshing activity history…
                </p>
              )}
              {!showHistoryInitialLoading && historyLoaded && (
                <ActivityHistoryPanel activities={activityHistory} />
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function createCompletionSnapshot(
  applyResult: FileApplyResult,
  verificationReport?: VerificationReport,
  priorRequestSummary?: string,
  featureBinding?: {
    readonly featurePlanId: string;
    readonly taskId: string;
    readonly dependencyOverrides?: readonly string[];
  },
): WorkspaceCompletionSnapshot {
  return {
    applyResult,
    ...(verificationReport === undefined ? {} : { verificationReport }),
    ...(priorRequestSummary === undefined ? {} : { priorRequestSummary }),
    ...(featureBinding === undefined ? {} : featureBinding),
  };
}

function readFeatureBinding(
  plan: FeaturePlan | undefined,
  taskId: string | undefined,
  dependencyOverrides: readonly string[],
): { featurePlanId: string; taskId: string; dependencyOverrides?: readonly string[] } | undefined {
  if (plan === undefined || taskId === undefined) return undefined;
  return {
    featurePlanId: plan.featurePlanId,
    taskId,
    ...(dependencyOverrides.length === 0 ? {} : { dependencyOverrides }),
  };
}

function nextConversationId(entries: readonly WorkspaceConversationEntry[]): number {
  return (entries.at(-1)?.id ?? 0) + 1;
}

function formatLabel(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function isCancelledWorkflowError(error: unknown): boolean {
  return error instanceof WorkspaceWorkflowError && error.code === 'PROVIDER_CANCELLED';
}

function statusClass(phase: WorkspacePhase): string {
  if (phase === 'COMPLETED') return styles.phaseComplete ?? '';
  if (phase === 'FAILED') return styles.phaseFailed ?? '';
  if (phase === 'READY') return styles.phaseReady ?? '';
  return styles.phaseActive ?? '';
}
