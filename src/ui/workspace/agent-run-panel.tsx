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
  type AgentToolLoopStatus,
  type ExplainArtifact,
} from './http-agent-workflow';
import styles from './workspace.module.css';

const POLL_INTERVAL_MS = 2_000;

/** Client UX hint only — server AgentOperating/AgentLoop remain authoritative (ADR-045). */
const TOOL_TURN_UI_PHASES = new Set([
  'UNDERSTANDING',
  'PLANNING',
  'AWAITING_GATE2',
  'VERIFYING',
  'DIAGNOSING',
  'CORRECTING',
]);

const TOOL_PRESETS = [
  {
    id: 'search_repository',
    label: 'Search repository (read-only)',
    needsQuery: true,
    needsBrowserApproval: false,
    phases: ['UNDERSTANDING', 'PLANNING', 'AWAITING_GATE2', 'DIAGNOSING', 'CORRECTING'],
  },
  {
    id: 'inspect_readiness',
    label: 'Inspect readiness (read-only)',
    needsQuery: false,
    needsBrowserApproval: false,
    phases: ['UNDERSTANDING', 'PLANNING', 'AWAITING_GATE2', 'DIAGNOSING', 'CORRECTING'],
  },
  {
    id: 'inspect_browser_verification_catalog',
    label: 'Inspect browser catalog (read-only)',
    needsQuery: false,
    needsBrowserApproval: false,
    phases: ['VERIFYING', 'DIAGNOSING'],
  },
  {
    id: 'run_local_browser_observation',
    label: 'Local browser observation (requires distinct browser approval)',
    needsQuery: false,
    needsBrowserApproval: true,
    phases: ['VERIFYING', 'DIAGNOSING'],
  },
] as const;

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

function canOfferToolTurn(phase: string): boolean {
  // Server rejects by AgentRun phase (not HTTP status). EXECUTING / terminal / EXPLAINING stay tool-free.
  if (phase === 'EXECUTING' || phase === 'EXPLAINING') return false;
  if (phase === 'COMPLETED' || phase === 'FAILED' || phase === 'CANCELLED') return false;
  return TOOL_TURN_UI_PHASES.has(phase);
}

function presetsForPhase(phase: string): readonly (typeof TOOL_PRESETS)[number][] {
  return TOOL_PRESETS.filter((preset) => (preset.phases as readonly string[]).includes(phase));
}

function createIntentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `ui-${crypto.randomUUID()}`;
  }
  return `ui-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function AgentRunPanel({ agentApi: injectedApi, disabled = false }: AgentRunPanelProps) {
  const agentApi = useMemo(() => injectedApi ?? new HttpAgentWorkflow(), [injectedApi]);
  const goalId = useId();
  const approvalId = useId();
  const toolPresetId = useId();
  const toolQueryId = useId();
  const browserApprovalId = useId();
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState(false);
  const [toolTurnBusy, setToolTurnBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [run, setRun] = useState<AgentRunHttpView>();
  const [gate2Summary, setGate2Summary] = useState<AgentGate2Summary>();
  const [applyAuthorizationToken, setApplyAuthorizationToken] = useState<string>();
  const [approved, setApproved] = useState(false);
  const [approveResult, setApproveResult] = useState<AgentApproveSuccessResponse>();
  const [explain, setExplain] = useState<ExplainArtifact>();
  const [toolLoop, setToolLoop] = useState<AgentToolLoopStatus>();
  const [toolPreset, setToolPreset] =
    useState<(typeof TOOL_PRESETS)[number]['id']>('search_repository');
  const [toolQuery, setToolQuery] = useState('');
  const [browserObservationApproved, setBrowserObservationApproved] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const toolTurnInFlight = useRef(false);

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
      if (status.toolLoop !== undefined) {
        setToolLoop(status.toolLoop);
      }
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
    if (normalized.length === 0 || disabled || busy || toolTurnBusy) return;
    setBusy(true);
    setError(undefined);
    setApproveResult(undefined);
    setApproved(false);
    setGate2Summary(undefined);
    setApplyAuthorizationToken(undefined);
    setExplain(undefined);
    setToolLoop(undefined);
    setBrowserObservationApproved(false);
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
    if (run === undefined || !approved || disabled || busy || toolTurnBusy || !run.awaitingGate2) {
      return;
    }
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
    if (run === undefined || disabled || busy || toolTurnBusy) return;
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
    if (run === undefined || busy || toolTurnBusy) return;
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

  async function handleToolTurn(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (run === undefined || disabled || busy || toolTurnBusy) return;
    if (!canOfferToolTurn(run.phase)) {
      setError('Tool turns are not available in this phase (server remains authoritative).');
      return;
    }
    if (toolTurnInFlight.current) {
      setError('A tool turn is already in progress for this run.');
      return;
    }
    const preset =
      presetsForPhase(run.phase).find((entry) => entry.id === toolPreset) ??
      presetsForPhase(run.phase)[0];
    if (preset === undefined) {
      setError('No bounded tools are available in this phase.');
      return;
    }
    if (preset.needsQuery && toolQuery.trim().length === 0) {
      setError('A search query is required for this tool.');
      return;
    }
    if (preset.needsBrowserApproval && !browserObservationApproved) {
      setError(
        'Local browser observation requires explicit browser OPERATOR approval (distinct from Gate 2 and Git).',
      );
      return;
    }

    const intent = {
      toolId: preset.id,
      intentId: createIntentId(),
      arguments: preset.needsQuery
        ? { query: toolQuery.trim() }
        : preset.id === 'run_local_browser_observation'
          ? { routeIds: ['home'] }
          : {},
    };

    toolTurnInFlight.current = true;
    setToolTurnBusy(true);
    setError(undefined);
    try {
      const result = await agentApi.toolTurn(run.runId, {
        intent,
        ...(preset.needsBrowserApproval && browserObservationApproved
          ? { browserObservationApproved: true }
          : {}),
      });
      setRun(result.run);
      setToolLoop({
        evidence: result.evidence,
        budget: result.budget,
      });
      // Never auto-continue: operator must explicitly request another turn.
      setBrowserObservationApproved(false);
    } catch (toolError: unknown) {
      setError(toolError instanceof Error ? toolError.message : 'Tool turn failed.');
      try {
        await refreshStatus(run.runId);
      } catch {
        // Keep prior snapshot if refresh fails.
      }
    } finally {
      toolTurnInFlight.current = false;
      setToolTurnBusy(false);
    }
  }

  async function handleProviderAssistedToolTurn(): Promise<void> {
    if (run === undefined || disabled || busy || toolTurnBusy) return;
    if (!canOfferToolTurn(run.phase)) {
      setError('Tool turns are not available in this phase (server remains authoritative).');
      return;
    }
    if (toolTurnInFlight.current) {
      setError('A tool turn is already in progress for this run.');
      return;
    }
    toolTurnInFlight.current = true;
    setToolTurnBusy(true);
    setError(undefined);
    try {
      const result = await agentApi.providerToolTurn(run.runId, {
        ...(browserObservationApproved ? { browserObservationApproved: true } : {}),
      });
      setRun(result.run);
      setToolLoop({
        evidence: result.evidence,
        budget: result.budget,
      });
      // Never auto-continue: operator must explicitly request another turn.
      setBrowserObservationApproved(false);
    } catch (toolError: unknown) {
      setError(
        toolError instanceof Error ? toolError.message : 'Provider-assisted tool turn failed.',
      );
      try {
        await refreshStatus(run.runId);
      } catch {
        // Keep prior snapshot if refresh fails.
      }
    } finally {
      toolTurnInFlight.current = false;
      setToolTurnBusy(false);
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

  const canApprove = Boolean(run?.awaitingGate2) && approved && !disabled && !busy && !toolTurnBusy;
  const canCancel =
    run !== undefined &&
    isAgentRunCancellable(run.phase, run.status) &&
    !disabled &&
    !busy &&
    !toolTurnBusy;
  const showToolTurn = run !== undefined && canOfferToolTurn(run.phase) && !disabled;
  const availablePresets = useMemo(
    () => (run !== undefined ? presetsForPhase(run.phase) : TOOL_PRESETS),
    [run],
  );
  const selectedPreset =
    availablePresets.find((entry) => entry.id === toolPreset) ??
    availablePresets[0] ??
    TOOL_PRESETS[0];

  return (
    <section className={styles.featurePanel} aria-labelledby="agent-run-title">
      <header>
        <h2 id="agent-run-title">Agent run</h2>
        <p>
          Gated agent workflow over existing prepare / Gate 2 / apply. The server remains
          authoritative — no automatic approval or mutation. Tool turns use the existing B8
          tool-turn API only.
        </p>
      </header>

      <form className={styles.agentGoalForm} onSubmit={(event) => void handleStart(event)}>
        <label htmlFor={goalId}>Agent goal</label>
        <textarea
          id={goalId}
          value={goal}
          maxLength={4_000}
          rows={3}
          disabled={disabled || busy || toolTurnBusy}
          placeholder="Describe the outcome you want BuilderAI to understand, plan, and execute…"
          onChange={(event) => setGoal(event.target.value)}
        />
        <div className={styles.formFooter}>
          <span>{goal.length.toLocaleString()} / 4,000</span>
          <button
            type="submit"
            disabled={disabled || busy || toolTurnBusy || goal.trim().length === 0}
          >
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
              disabled={busy || toolTurnBusy}
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

          {showToolTurn && (
            <section className={styles.agentToolTurnCard} aria-labelledby="agent-tool-turn-title">
              <h3 id="agent-tool-turn-title">Bounded tool turn</h3>
              <p>
                Explicit operator action only. Calls the existing authenticated B8 tool-turn API.
                Does not approve Gate 2, apply files, write Git, or invent browser approval.
              </p>
              <form
                className={styles.agentToolTurnForm}
                onSubmit={(event) => void handleToolTurn(event)}
              >
                <label htmlFor={toolPresetId}>Tool</label>
                <select
                  id={toolPresetId}
                  value={selectedPreset.id}
                  disabled={busy || toolTurnBusy || availablePresets.length === 0}
                  onChange={(event) => {
                    setToolPreset(event.target.value as (typeof TOOL_PRESETS)[number]['id']);
                    setBrowserObservationApproved(false);
                  }}
                >
                  {availablePresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>

                {selectedPreset.needsQuery && (
                  <>
                    <label htmlFor={toolQueryId}>Search query</label>
                    <input
                      id={toolQueryId}
                      type="text"
                      value={toolQuery}
                      maxLength={200}
                      disabled={busy || toolTurnBusy}
                      onChange={(event) => setToolQuery(event.target.value)}
                      placeholder="Bounded repository search…"
                    />
                  </>
                )}

                {selectedPreset.needsBrowserApproval && (
                  <label className={styles.approvalCheck} htmlFor={browserApprovalId}>
                    <input
                      id={browserApprovalId}
                      type="checkbox"
                      checked={browserObservationApproved}
                      disabled={busy || toolTurnBusy}
                      onChange={(event) => setBrowserObservationApproved(event.target.checked)}
                    />
                    I explicitly approve localhost browser observation for this turn (distinct from
                    Gate 2 and Git approval)
                  </label>
                )}

                <button
                  type="submit"
                  className={styles.secondaryButton}
                  disabled={busy || toolTurnBusy}
                >
                  {toolTurnBusy ? 'Running tool turn…' : 'Run tool turn'}
                </button>
              </form>
              <p className={styles.agentToolTurnHint}>
                Provider-assisted turn (ADR-046): provider may propose soft intents with
                toolCalling:false; server validates and executes via the same AgentLoop. Explicit
                only — no auto-continue.
              </p>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={busy || toolTurnBusy}
                onClick={() => void handleProviderAssistedToolTurn()}
              >
                {toolTurnBusy
                  ? 'Running provider-assisted turn…'
                  : 'Run provider-assisted tool turn'}
              </button>
              {(run.phase === 'VERIFYING' || run.phase === 'DIAGNOSING') &&
                !selectedPreset.needsBrowserApproval && (
                  <label className={styles.approvalCheck} htmlFor={`${browserApprovalId}-provider`}>
                    <input
                      id={`${browserApprovalId}-provider`}
                      type="checkbox"
                      checked={browserObservationApproved}
                      disabled={busy || toolTurnBusy}
                      onChange={(event) => setBrowserObservationApproved(event.target.checked)}
                    />
                    Optional: approve localhost browser observation for provider-assisted turn
                    (distinct from Gate 2 and Git; never inferred from provider output)
                  </label>
                )}
            </section>
          )}

          {toolLoop !== undefined && (
            <section
              className={styles.agentToolEvidence}
              aria-labelledby="agent-tool-evidence-title"
            >
              <h3 id="agent-tool-evidence-title">Tool evidence (bounded digests)</h3>
              {toolLoop.budget !== undefined && (
                <p>
                  Budget: {toolLoop.budget.toolCalls} tool calls · {toolLoop.budget.providerTurns}{' '}
                  provider turns · {toolLoop.budget.b4VerificationCalls} verification ·{' '}
                  {toolLoop.budget.browserObservationCalls} browser
                </p>
              )}
              {toolLoop.evidence.length === 0 ? (
                <p>No digests yet.</p>
              ) : (
                <ul>
                  {toolLoop.evidence.map((item) => (
                    <li key={`${item.intentId}-${item.toolId}-${item.recordedAt}`}>
                      <strong>{item.toolId}</strong> · {item.status} · {item.phase} ·{' '}
                      {item.summaryDigest.slice(0, 16)}…
                      {item.errorCode !== undefined ? ` · ${item.errorCode}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

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
                  disabled={disabled || busy || toolTurnBusy}
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
