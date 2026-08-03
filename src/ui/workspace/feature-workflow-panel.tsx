'use client';

import { useId, useMemo, useState } from 'react';
import type { FormEvent } from 'react';

import type { FeaturePlan, FeatureTask } from '../../application/workspace/feature-plan.types';
import type { VerificationReport } from '../../core/verification';
import type { FileApplyResult } from '../../core/file-apply';
import { HttpFeatureWorkflow } from './http-feature-workflow';
import styles from './workspace.module.css';
import type { PrepareWorkspaceOptions } from './workspace.types';

interface FeatureWorkflowPanelProps {
  readonly plan?: FeaturePlan;
  readonly onPlanUpdated: (plan: FeaturePlan) => void;
  readonly onDependencyOverridesChange?: (overrides: readonly string[]) => void;
  readonly featureApi?: HttpFeatureWorkflow;
  readonly disabled?: boolean;
  readonly onExecuteTask: (
    task: FeatureTask,
    plan: FeaturePlan,
    options: PrepareWorkspaceOptions,
  ) => Promise<void>;
  readonly applyResult?: FileApplyResult;
  readonly verificationReport?: VerificationReport;
  readonly activeTaskId?: string;
}

export function FeatureWorkflowPanel({
  plan,
  onPlanUpdated,
  onDependencyOverridesChange,
  featureApi: injectedFeatureApi,
  disabled = false,
  onExecuteTask,
  applyResult,
  verificationReport,
  activeTaskId,
}: FeatureWorkflowPanelProps) {
  const featureApi = useMemo(
    () => injectedFeatureApi ?? new HttpFeatureWorkflow(),
    [injectedFeatureApi],
  );
  const featureRequestId = useId();
  const [featureRequest, setFeatureRequest] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [dependencyOverrides, setDependencyOverrides] = useState<readonly string[]>([]);
  const [acknowledgePartialPass, setAcknowledgePartialPass] = useState(false);

  function updateDependencyOverrides(overrides: readonly string[]): void {
    setDependencyOverrides(overrides);
    onDependencyOverridesChange?.(overrides);
  }

  async function handleDecompose(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const normalized = featureRequest.trim();
    if (normalized.length === 0 || disabled || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const draft = await featureApi.decompose(normalized);
      onPlanUpdated(draft);
    } catch (decomposeError: unknown) {
      setError(decomposeError instanceof Error ? decomposeError.message : 'Decomposition failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleApprovePlan(): Promise<void> {
    if (plan === undefined || disabled || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const approved = await featureApi.approvePlan(plan.featurePlanId);
      onPlanUpdated(approved);
    } catch (approveError: unknown) {
      setError(approveError instanceof Error ? approveError.message : 'Plan approval failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleExecuteTask(task: FeatureTask): Promise<void> {
    if (plan === undefined || disabled || busy) return;
    setBusy(true);
    setError(undefined);
    const options: PrepareWorkspaceOptions = {
      featurePlanId: plan.featurePlanId,
      taskId: task.taskId,
      ...(dependencyOverrides.length === 0 ? {} : { dependencyOverrides }),
    };
    updateDependencyOverrides(dependencyOverrides);
    try {
      await onExecuteTask(task, plan, options);
    } catch (executeError: unknown) {
      setError(executeError instanceof Error ? executeError.message : 'Task execution failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCompleteTask(task: FeatureTask): Promise<void> {
    if (plan === undefined || disabled || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const outcome = buildTaskOutcome(applyResult, verificationReport, acknowledgePartialPass);
      const updated = await featureApi.completeTask(
        plan.featurePlanId,
        task.taskId,
        outcome,
        acknowledgePartialPass,
      );
      onPlanUpdated(updated);
      setAcknowledgePartialPass(false);
    } catch (completeError: unknown) {
      setError(completeError instanceof Error ? completeError.message : 'Task completion failed.');
    } finally {
      setBusy(false);
    }
  }

  function toggleDependencyOverride(taskId: string): void {
    updateDependencyOverrides(
      dependencyOverrides.includes(taskId)
        ? dependencyOverrides.filter((id) => id !== taskId)
        : [...dependencyOverrides, taskId],
    );
  }

  return (
    <section className={styles.featurePanel} aria-labelledby="feature-workflow-title">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.eyebrow}>Feature decomposition</p>
          <h3 id="feature-workflow-title">Human-controlled feature workflow</h3>
        </div>
        {plan && <span>{plan.status}</span>}
      </div>

      {!plan && (
        <form className={styles.requestForm} onSubmit={handleDecompose}>
          <label htmlFor={featureRequestId}>High-level feature request</label>
          <textarea
            id={featureRequestId}
            value={featureRequest}
            maxLength={4_000}
            rows={4}
            disabled={disabled || busy}
            placeholder="Describe the feature outcome at a planning level…"
            onChange={(event) => setFeatureRequest(event.target.value)}
          />
          <div className={styles.formFooter}>
            <span>{featureRequest.length.toLocaleString()} / 4,000</span>
            <button type="submit" disabled={disabled || busy || featureRequest.trim().length === 0}>
              {busy ? 'Decomposing…' : 'Decompose feature'}
            </button>
          </div>
        </form>
      )}

      {plan && (
        <div className={styles.featurePlanCard}>
          <header>
            <strong>{plan.title}</strong>
            <p>{plan.summary}</p>
          </header>

          {plan.status === 'DRAFT' && (
            <button type="button" disabled={disabled || busy} onClick={handleApprovePlan}>
              Approve feature plan (Gate 1)
            </button>
          )}

          <ol className={styles.featureTaskList}>
            {plan.tasks.map((task) => (
              <li key={task.taskId} data-status={task.status}>
                <div>
                  <strong>{task.title}</strong>
                  <small>
                    {task.status}
                    {task.dependencyIds.length > 0
                      ? ` · depends on ${task.dependencyIds.join(', ')}`
                      : ''}
                  </small>
                  <p>{task.objective}</p>
                </div>
                <div className={styles.featureTaskActions}>
                  {task.status === 'READY' && (
                    <button
                      type="button"
                      disabled={disabled || busy}
                      onClick={() => void handleExecuteTask(task)}
                    >
                      Execute task
                    </button>
                  )}
                  {task.status === 'IN_PROGRESS' &&
                    activeTaskId === task.taskId &&
                    verificationReport?.status === 'PASSED' && (
                      <button
                        type="button"
                        disabled={disabled || busy}
                        onClick={() => void handleCompleteTask(task)}
                      >
                        Complete task
                      </button>
                    )}
                  {task.status === 'IN_PROGRESS' &&
                    activeTaskId === task.taskId &&
                    verificationReport?.status === 'PARTIALLY_PASSED' && (
                      <label className={styles.approvalCheck}>
                        <input
                          type="checkbox"
                          checked={acknowledgePartialPass}
                          onChange={(event) => setAcknowledgePartialPass(event.target.checked)}
                        />
                        Acknowledge partial verification pass
                        <button
                          type="button"
                          disabled={disabled || busy || !acknowledgePartialPass}
                          onClick={() => void handleCompleteTask(task)}
                        >
                          Complete with override
                        </button>
                      </label>
                    )}
                  {blockedBySkippedDependency(plan, task) && (
                    <label className={styles.approvalCheck}>
                      <input
                        type="checkbox"
                        checked={task.dependencyIds.every((id) => dependencyOverrides.includes(id))}
                        onChange={() => {
                          for (const dependencyId of task.dependencyIds) {
                            if (
                              plan.tasks.find(({ taskId }) => taskId === dependencyId)?.status ===
                              'SKIPPED'
                            ) {
                              toggleDependencyOverride(dependencyId);
                            }
                          }
                        }}
                      />
                      Override skipped dependency prerequisite
                    </label>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {error && (
        <div className={styles.errorNotice} role="alert">
          <strong>Feature workflow error</strong>
          <p>{error}</p>
        </div>
      )}
    </section>
  );
}

function blockedBySkippedDependency(plan: FeaturePlan, task: FeatureTask): boolean {
  if (task.status !== 'READY' && task.status !== 'PENDING') return false;
  return task.dependencyIds.some((dependencyId) => {
    const dependency = plan.tasks.find(({ taskId }) => taskId === dependencyId);
    return dependency?.status === 'SKIPPED';
  });
}

function buildTaskOutcome(
  applyResult: FileApplyResult | undefined,
  verificationReport: VerificationReport | undefined,
  acknowledgePartialPass: boolean,
): Record<string, unknown> {
  const summary =
    verificationReport === undefined
      ? `Apply finished with status ${applyResult?.status ?? 'UNKNOWN'}.`
      : `Verification ${verificationReport.status.toLowerCase()} completed.`;
  return {
    summary: summary.slice(0, 500),
    completedAt: new Date().toISOString(),
    ...(verificationReport === undefined
      ? {}
      : {
          verificationStatus: verificationReport.status,
          verificationStages: verificationReport.stages.map(({ stage, status }) => ({
            stage,
            status,
          })),
          ...(acknowledgePartialPass ? { acknowledgedPartialPass: true } : {}),
        }),
    ...(applyResult === undefined ? {} : { applyStatus: applyResult.status }),
  };
}
