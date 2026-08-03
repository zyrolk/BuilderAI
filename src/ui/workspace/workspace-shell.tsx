'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { isVerificationEligibleFileApplyResult, type FileApplyResult } from '../../core/file-apply';
import type { VerificationReport } from '../../core/verification';
import { buildIterationFeedbackFromCompletion } from '../../application/workspace/iteration-feedback.service';
import type { WorkspaceActivity } from '../../application/workspace/activity-history.types';
import type { FeaturePlan, FeatureTask } from '../../application/workspace/feature-plan.types';
import { ActivityHistoryPanel } from './activity-history-panel';
import { FeatureWorkflowPanel } from './feature-workflow-panel';
import { HttpFeatureWorkflow } from './http-feature-workflow';
import { ResultPanel } from './result-panel';
import { HttpWorkspaceWorkflow } from './http-workspace-workflow';
import styles from './workspace.module.css';
import {
  WorkspaceWorkflowError,
  isCorrectionEligible,
  type WorkspaceCompletionSnapshot,
} from './workspace.types';
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
  PROCESSING_REQUEST: 'Preparing response and change plan',
  AWAITING_APPROVAL: 'Waiting for explicit approval',
  APPLYING_CHANGES: 'Applying approved changes',
  VERIFYING_PROJECT: 'Verifying project',
  COMPLETED: 'Workflow complete',
  FAILED: 'Workflow stopped',
};

interface WorkspaceShellProps {
  readonly project: WorkspaceProjectView;
  readonly workflow?: WorkspaceWorkflowPort;
  readonly runtimeAvailable?: boolean;
}

export function WorkspaceShell({
  project,
  workflow: injectedWorkflow,
  runtimeAvailable = false,
}: WorkspaceShellProps) {
  const runtimeWorkflow = useMemo(
    () => (runtimeAvailable ? new HttpWorkspaceWorkflow() : undefined),
    [runtimeAvailable],
  );
  const workflow = injectedWorkflow ?? runtimeWorkflow;
  const requestId = useId();
  const approvalId = useId();
  const [request, setRequest] = useState('');
  const [phase, setPhase] = useState<WorkspacePhase>('READY');
  const [progressIndex, setProgressIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<ResultPanelTab>('RESPONSE_PACKAGE');
  const [prepared, setPrepared] = useState<PreparedWorkspaceChange>();
  const [applyResult, setApplyResult] = useState<FileApplyResult>();
  const [verificationReport, setVerificationReport] = useState<VerificationReport>();
  const [completionSnapshot, setCompletionSnapshot] = useState<WorkspaceCompletionSnapshot>();
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
  const historyLoadedRef = useRef(false);
  const featureApi = useMemo(
    () => (runtimeAvailable ? new HttpFeatureWorkflow() : undefined),
    [runtimeAvailable],
  );
  const isBusy = ['PROCESSING_REQUEST', 'APPLYING_CHANGES', 'VERIFYING_PROJECT'].includes(phase);
  const historySupported =
    runtimeAvailable && workflow !== undefined && workflow.loadActivityHistory !== undefined;

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

  async function handleCorrectionPrepare(): Promise<void> {
    if (!workflow || !completionSnapshot || isBusy) return;
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

  async function runPrepare(
    normalizedRequest: string,
    correctionSnapshot?: WorkspaceCompletionSnapshot,
    featureOptions: PrepareWorkspaceOptions = {},
  ): Promise<void> {
    if (!workflow || normalizedRequest.length === 0 || isBusy) return;

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
        correctionSnapshot === undefined
          ? undefined
          : buildIterationFeedbackFromCompletion(
              {
                applyResult: correctionSnapshot.applyResult,
                ...(correctionSnapshot.verificationReport === undefined
                  ? {}
                  : { verificationReport: correctionSnapshot.verificationReport }),
              },
              {
                ...(correctionSnapshot.sourcePreparationId === undefined
                  ? {}
                  : { sourcePreparationId: correctionSnapshot.sourcePreparationId }),
                ...(correctionSnapshot.priorRequestSummary === undefined
                  ? {}
                  : { priorRequestSummary: correctionSnapshot.priorRequestSummary }),
              },
            );
      const nextPrepared =
        iterationFeedback === undefined && featureOptions.featurePlanId === undefined
          ? await workflow.prepare(normalizedRequest)
          : await workflow.prepare(normalizedRequest, {
              ...(iterationFeedback === undefined ? {} : { iterationFeedback }),
              ...featureOptions,
            });
      setPrepared(nextPrepared);
      setLastPreparedRequest(normalizedRequest);
      if (featureOptions.taskId !== undefined) {
        setActiveFeatureTaskId(featureOptions.taskId);
      }
      if (nextPrepared.featurePlan !== undefined) {
        setFeaturePlan(nextPrepared.featurePlan);
      }
      setPhase('AWAITING_APPROVAL');
      setProgressIndex(3);
      setActiveTab('CHANGE_PLAN');
      setConversation((entries) => [
        ...entries,
        {
          id: nextConversationId(entries),
          author: 'BUILDER_AI',
          message: `Prepared ${nextPrepared.changePlan.summary.totalOperations} operation${nextPrepared.changePlan.summary.totalOperations === 1 ? '' : 's'} for review. No files have been changed.`,
        },
      ]);
      void refreshActivityHistory();
    } catch (workflowError: unknown) {
      stopWorkflow(
        workflowError instanceof WorkspaceWorkflowError
          ? `${workflowError.message} No project changes were made.`
          : 'The request could not be prepared. No project changes were made.',
        1,
      );
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
    } catch {
      stopWorkflow(
        'The approved workflow could not complete. Review the available result evidence.',
        completedSteps,
      );
    }
  }

  function completeWorkflow(report: VerificationReport, appliedResult: FileApplyResult): void {
    setVerificationReport(report);
    setCompletionSnapshot(
      createCompletionSnapshot(
        appliedResult,
        report,
        lastPreparedRequest,
        readFeatureBinding(featurePlan, activeFeatureTaskId, activeFeatureDependencyOverrides),
      ),
    );
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
          {workflow ? 'Runtime connected' : 'Review mode'}
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
              <button type="submit" disabled={!workflow || request.trim().length === 0 || isBusy}>
                {phase === 'PROCESSING_REQUEST' ? 'Preparing request…' : 'Prepare change plan'}
              </button>
            </div>
          </form>

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
                <p>
                  {prepared.changePlan.summary.totalOperations} planned operation
                  {prepared.changePlan.summary.totalOperations === 1 ? '' : 's'}. Review paths,
                  risks, and warnings in the Change Plan tab.
                </p>
              </div>
              <label className={styles.approvalCheck} htmlFor={approvalId}>
                <input
                  id={approvalId}
                  type="checkbox"
                  checked={approved}
                  onChange={(event) => setApproved(event.target.checked)}
                />
                I reviewed this plan and explicitly approve these file operations.
              </label>
              <button
                type="button"
                className={styles.approveButton}
                disabled={!approved}
                onClick={handleApproval}
              >
                Approve and apply changes
              </button>
            </section>
          )}

          {isCorrectionEligible(completionSnapshot) &&
            (phase === 'COMPLETED' || phase === 'FAILED') && (
              <section className={styles.approvalCard} aria-labelledby="correction-title">
                <div>
                  <p className={styles.eyebrow}>Explicit correction</p>
                  <h3 id="correction-title">Fix verification failures</h3>
                  <p>
                    Start a new correction prepare with bounded evidence from the immediately
                    previous iteration. Approval is still required before any file changes apply.
                  </p>
                </div>
                <button
                  type="button"
                  className={styles.approveButton}
                  disabled={!workflow || isBusy}
                  onClick={handleCorrectionPrepare}
                >
                  Fix verification failures
                </button>
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
            applyResult={applyResult}
            verificationReport={verificationReport}
          />

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

function statusClass(phase: WorkspacePhase): string {
  if (phase === 'COMPLETED') return styles.phaseComplete ?? '';
  if (phase === 'FAILED') return styles.phaseFailed ?? '';
  if (phase === 'READY') return styles.phaseReady ?? '';
  return styles.phaseActive ?? '';
}
