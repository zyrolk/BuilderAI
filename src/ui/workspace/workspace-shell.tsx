'use client';

import Link from 'next/link';
import { useId, useMemo, useState } from 'react';
import type { FormEvent } from 'react';

import type { FileApplyResult } from '../../core/file-apply';
import type { VerificationReport } from '../../core/verification';
import { ResultPanel } from './result-panel';
import { HttpWorkspaceWorkflow } from './http-workspace-workflow';
import styles from './workspace.module.css';
import { WorkspaceWorkflowError } from './workspace.types';
import type {
  PreparedWorkspaceChange,
  ResultPanelTab,
  WorkspaceConversationEntry,
  WorkspacePhase,
  WorkspaceProjectView,
  WorkspaceWorkflowPort,
} from './workspace.types';

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
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState<string>();
  const [conversation, setConversation] = useState<readonly WorkspaceConversationEntry[]>([]);
  const isBusy = ['PROCESSING_REQUEST', 'APPLYING_CHANGES', 'VERIFYING_PROJECT'].includes(phase);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const normalizedRequest = request.trim();
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
      const nextPrepared = await workflow.prepare(normalizedRequest);
      setPrepared(nextPrepared);
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
      if (nextApplyResult.status !== 'APPLIED') {
        stopWorkflow(
          `Apply finished with status ${formatLabel(nextApplyResult.status)}. Verification was not started.`,
          4,
        );
        return;
      }

      setPhase('VERIFYING_PROJECT');
      setProgressIndex(5);
      completedSteps = 5;
      setActiveTab('VERIFICATION_REPORT');
      const nextVerificationReport = await workflow.verify(nextApplyResult);
      completeWorkflow(nextVerificationReport);
    } catch {
      stopWorkflow(
        'The approved workflow could not complete. Review the available result evidence.',
        completedSteps,
      );
    }
  }

  function completeWorkflow(report: VerificationReport): void {
    setVerificationReport(report);
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
  }

  function stopWorkflow(message: string, completedSteps: number): void {
    setError(message);
    setPhase('FAILED');
    setProgressIndex(completedSteps);
    setConversation((entries) => [
      ...entries,
      { id: nextConversationId(entries), author: 'BUILDER_AI', message },
    ]);
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

        <ResultPanel
          activeTab={activeTab}
          onTabChange={setActiveTab}
          responsePackage={prepared?.responsePackage}
          changePlan={prepared?.changePlan}
          applyResult={applyResult}
          verificationReport={verificationReport}
        />
      </div>
    </main>
  );
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
