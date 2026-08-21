'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import {
  agentPhaseHeadline,
  buildAgentLifecycleSteps,
  isAgentRunCancellable,
} from './agent-run-display';
import { AgentExplainView } from './agent-explain-view';
import {
  HttpAgentWorkflow,
  type AgentApproveSuccessResponse,
  type AgentGate2Summary,
  type AgentRunHttpView,
  type ExplainArtifact,
} from './http-agent-workflow';
import styles from './workspace.module.css';

const POLL_INTERVAL_MS = 2_000;

interface AgentRunPanelProps {
  readonly agentApi?: HttpAgentWorkflow;
  readonly disabled?: boolean;
}

function shouldLoadExplain(run: AgentRunHttpView): boolean {
  return (
    run.status === 'COMPLETED' ||
    run.status === 'FAILED' ||
    run.status === 'CANCELLED' ||
    run.phase === 'CORRECTING' ||
    run.phase === 'EXPLAINING'
  );
}

export function AgentRunPanel({ agentApi: injectedApi, disabled = false }: AgentRunPanelProps) {
  const agentApi = useMemo(() => injectedApi ?? new HttpAgentWorkflow(), [injectedApi]);
  const goalId = useId();
  const approvalId = useId();
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [run, setRun] = useState<AgentRunHttpView>();
  const [gate2Summary, setGate2Summary] = useState<AgentGate2Summary>();
  const [applyAuthorizationToken, setApplyAuthorizationToken] = useState<string>();
  const [approved, setApproved] = useState(false);
  const [approveResult, setApproveResult] = useState<AgentApproveSuccessResponse>();
  const [explain, setExplain] = useState<ExplainArtifact>();
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== undefined) {
      clearInterval(pollRef.current);
      pollRef.current = undefined;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const loadExplain = useCallback(
    async (runId: string): Promise<void> => {
      const response = await agentApi.getExplain(runId);
      setExplain(response.explain);
      setRun(response.run);
    },
    [agentApi],
  );

  const refreshStatus = useCallback(
    async (runId: string): Promise<AgentRunHttpView> => {
      const status = await agentApi.getStatus(runId);
      setRun(status.run);
      if (shouldLoadExplain(status.run)) {
        try {
          await loadExplain(runId);
        } catch {
          // Explain may be partial; status remains authoritative.
        }
      }
      return status.run;
    },
    [agentApi, loadExplain],
  );

  function startPolling(runId: string): void {
    stopPolling();
    pollRef.current = setInterval(() => {
      void refreshStatus(runId)
        .then((next) => {
          if (
            next.status === 'COMPLETED' ||
            next.status === 'FAILED' ||
            next.status === 'CANCELLED' ||
            next.awaitingGate2
          ) {
            stopPolling();
          }
        })
        .catch(() => {
          stopPolling();
        });
    }, POLL_INTERVAL_MS);
  }

  async function handleStart(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const normalized = goal.trim();
    if (normalized.length === 0 || disabled || busy) return;
    setBusy(true);
    setError(undefined);
    setApproveResult(undefined);
    setApproved(false);
    setGate2Summary(undefined);
    setApplyAuthorizationToken(undefined);
    setExplain(undefined);
    stopPolling();
    try {
      const started = await agentApi.start(normalized);
      setRun(started.run);
      const planned = await agentApi.plan(started.run.runId);
      setRun(planned.run);
      setGate2Summary(planned.gate2Review);
      setApplyAuthorizationToken(planned.applyAuthorizationToken);
    } catch (startError: unknown) {
      setError(startError instanceof Error ? startError.message : 'Agent run failed to start.');
    } finally {
      setBusy(false);
    }
  }

  async function handleApprove(): Promise<void> {
    if (run === undefined || !approved || disabled || busy || !run.awaitingGate2) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await agentApi.approve(run.runId, {
        approved: true,
        ...(applyAuthorizationToken === undefined ? {} : { applyAuthorizationToken }),
      });
      setApproveResult(result);
      setRun(result.run);
      setApproved(false);
      if (result.explain !== undefined) {
        setExplain(result.explain);
      } else if (shouldLoadExplain(result.run)) {
        await loadExplain(result.run.runId);
      }
      if (result.run.awaitingGate2 || result.awaitingCorrectionApproval) {
        stopPolling();
      } else if (result.run.status === 'RUNNING') {
        startPolling(result.run.runId);
      }
    } catch (approveError: unknown) {
      setError(approveError instanceof Error ? approveError.message : 'Approval failed.');
      try {
        await refreshStatus(run.runId);
      } catch {
        // Keep prior run snapshot if refresh fails.
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel(): Promise<void> {
    if (run === undefined || disabled || busy) return;
    if (!isAgentRunCancellable(run.phase, run.status)) return;
    setBusy(true);
    setError(undefined);
    stopPolling();
    try {
      const cancelled = await agentApi.cancel(run.runId, 'Cancelled from workspace Agent UI');
      setRun(cancelled.run);
      setApproved(false);
      try {
        await loadExplain(cancelled.run.runId);
      } catch {
        // Cancelled runs may have only partial explain evidence.
      }
    } catch (cancelError: unknown) {
      setError(cancelError instanceof Error ? cancelError.message : 'Cancel failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRefresh(): Promise<void> {
    if (run === undefined || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await refreshStatus(run.runId);
    } catch (refreshError: unknown) {
      setError(refreshError instanceof Error ? refreshError.message : 'Status refresh failed.');
    } finally {
      setBusy(false);
    }
  }

  const lifecycle = run
    ? buildAgentLifecycleSteps({
        phase: run.phase,
        status: run.status,
        awaitingGate2: run.awaitingGate2,
        hasCorrection: run.references.correctionWorkflowId !== undefined,
        verificationStatus: approveResult?.verificationStatus,
      })
    : [];

  const canApprove = Boolean(run?.awaitingGate2) && approved && !disabled && !busy;
  const canCancel =
    run !== undefined && isAgentRunCancellable(run.phase, run.status) && !disabled && !busy;

  return (
    <section className={styles.featurePanel} aria-labelledby="agent-run-title">
      <header>
        <h2 id="agent-run-title">Agent run</h2>
        <p>
          Gated agent workflow over existing prepare / Gate 2 / apply. The server remains
          authoritative — no automatic approval or mutation.
        </p>
      </header>

      <form className={styles.agentGoalForm} onSubmit={(event) => void handleStart(event)}>
        <label htmlFor={goalId}>Agent goal</label>
        <textarea
          id={goalId}
          value={goal}
          maxLength={4_000}
          rows={3}
          disabled={disabled || busy}
          placeholder="Describe the outcome you want BuilderAI to understand, plan, and execute…"
          onChange={(event) => setGoal(event.target.value)}
        />
        <div className={styles.formFooter}>
          <span>{goal.length.toLocaleString()} / 4,000</span>
          <button type="submit" disabled={disabled || busy || goal.trim().length === 0}>
            {busy && run === undefined ? 'Starting…' : 'Start agent run'}
          </button>
        </div>
      </form>

      {error !== undefined && (
        <p className={styles.agentError} role="alert">
          {error}
        </p>
      )}

      {run !== undefined && (
        <div className={styles.agentRunCard}>
          <div className={styles.agentRunMeta}>
            <p>
              <strong>Goal:</strong> {run.goal}
            </p>
            <p>
              <strong>Phase:</strong> {run.phase} · <strong>Status:</strong> {run.status}
            </p>
            <p className={styles.agentHeadline}>
              {agentPhaseHeadline(run.phase, run.awaitingGate2)}
            </p>
            <p className={styles.agentReferences}>
              {[
                run.references.investigationId !== undefined
                  ? `investigation: ${run.references.investigationId}`
                  : undefined,
                run.references.preparationId !== undefined
                  ? `preparation: ${run.references.preparationId}`
                  : undefined,
                run.references.workflowId !== undefined
                  ? `workflow: ${run.references.workflowId}`
                  : undefined,
                run.references.correctionWorkflowId !== undefined
                  ? `correction: ${run.references.correctionWorkflowId}`
                  : undefined,
              ]
                .filter((entry): entry is string => entry !== undefined)
                .join(' · ') || 'No workflow references yet.'}
            </p>
          </div>

          <ol className={styles.agentLifecycle} aria-label="Agent lifecycle progress">
            {lifecycle.map((step) => (
              <li key={step.label} data-state={step.state}>
                {step.label}
              </li>
            ))}
          </ol>

          <div className={styles.agentActions}>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={busy}
              onClick={() => void handleRefresh()}
            >
              Refresh status
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={!canCancel}
              onClick={() => void handleCancel()}
            >
              Cancel run
            </button>
          </div>

          {run.awaitingGate2 && (
            <section className={styles.approvalCard} aria-labelledby="agent-gate2-title">
              <h3 id="agent-gate2-title">Gate 2 — review before apply</h3>
              <p>
                The agent is paused. Explicit approval is required. Approval uses the existing
                server-authoritative apply path.
              </p>
              {gate2Summary !== undefined && (
                <ul className={styles.agentGate2Summary}>
                  <li>Planned operations: {gate2Summary.operationCount}</li>
                  <li>Diff characters: {gate2Summary.totalCharacterCount}</li>
                  {gate2Summary.truncated && (
                    <li>
                      Diff truncated
                      {gate2Summary.truncationMessage !== undefined
                        ? `: ${gate2Summary.truncationMessage}`
                        : ''}
                    </li>
                  )}
                  {run.references.preparationId !== undefined && (
                    <li>Preparation: {run.references.preparationId}</li>
                  )}
                </ul>
              )}
              <label className={styles.approvalCheck} htmlFor={approvalId}>
                <input
                  id={approvalId}
                  type="checkbox"
                  checked={approved}
                  disabled={disabled || busy}
                  onChange={(event) => setApproved(event.target.checked)}
                />
                I reviewed the planned changes and approve applying them
              </label>
              <button
                type="button"
                className={styles.approveButton}
                disabled={!canApprove}
                onClick={() => void handleApprove()}
              >
                Approve and execute
              </button>
            </section>
          )}

          {approveResult?.awaitingCorrectionApproval && (
            <section className={styles.approvalCard} aria-labelledby="agent-correction-title">
              <h3 id="agent-correction-title">Correction required</h3>
              <p>
                Verification failed after apply. A correction session was started
                {approveResult.correctionWorkflowId !== undefined
                  ? ` (${approveResult.correctionWorkflowId})`
                  : ''}
                . Further mutation still requires Gate 2 — nothing was auto-applied.
              </p>
              <p>
                Apply: {approveResult.applyStatus ?? 'unknown'} · Verification:{' '}
                {approveResult.verificationStatus ?? 'unknown'}
              </p>
            </section>
          )}

          {explain !== undefined && <AgentExplainView explain={explain} />}

          {(run.status === 'FAILED' || run.status === 'CANCELLED') && (
            <p className={styles.agentTerminalNotice} role="status">
              This run is {run.status.toLowerCase()}. It will not auto-restart or auto-approve.
              Start a new agent run if you want to continue.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
