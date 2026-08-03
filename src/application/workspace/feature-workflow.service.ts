import { parseProjectBrain, type ProjectBrain, type ProjectTask } from '../../core/project-brain';
import {
  applyReadiness,
  buildFeatureTaskRequest,
  createFeatureTransientTask,
  createShadowDependencyTasks,
  invalidateApproval,
  markTaskInProgress,
  markTaskOutcome,
  restoreTaskStatus,
  reopenTaskForCorrection,
  normalizeFeaturePlan,
  normalizeTaskOutcome,
  validateTaskExecutable,
} from './feature-plan.service';
import { assertFeatureTaskCompletionAllowed } from './feature-task-completion';
import type { FeaturePlanPersistence } from './feature-plan.persistence';
import type { FeaturePlan, FeatureTaskExecutionBinding } from './feature-plan.types';
import {
  extractIterationPathHints,
  normalizeIterationFeedback,
} from './iteration-feedback.service';
import type { WorkspaceRuntimeService } from './workspace-runtime.service';
import { WorkspaceRuntimeError, type WorkspaceRuntimeClock } from './workspace-runtime.types';

export interface FeatureWorkflowDependencies {
  readonly runtime: WorkspaceRuntimeService;
  readonly persistence: FeaturePlanPersistence;
  readonly loadProjectBrain: () => ProjectBrain;
  readonly clock: WorkspaceRuntimeClock;
}

export class FeatureWorkflowService {
  private cache?: FeaturePlan;

  constructor(private readonly dependencies: FeatureWorkflowDependencies) {}

  async getActivePlan(): Promise<FeaturePlan | undefined> {
    if (this.cache !== undefined) return this.cache;
    this.cache = await this.dependencies.persistence.loadActive();
    return this.cache;
  }

  async loadPlan(featurePlanId: string): Promise<FeaturePlan> {
    const plan = await this.dependencies.persistence.load(featurePlanId);
    this.cache = plan;
    return plan;
  }

  async saveDraft(plan: unknown): Promise<FeaturePlan> {
    const normalized = normalizeFeaturePlan(plan, { forceStatus: 'DRAFT' });
    const saved = await this.dependencies.persistence.save(normalized);
    this.cache = saved;
    return saved;
  }

  async approvePlan(featurePlanId: string): Promise<FeaturePlan> {
    const plan = await this.loadPlan(featurePlanId);
    if (plan.status !== 'DRAFT') {
      throw new WorkspaceRuntimeError('INVALID_FEATURE_PLAN', 'Only draft plans can be approved.');
    }
    const now = this.dependencies.clock.now().toISOString();
    const approved = applyReadiness({
      ...plan,
      status: 'APPROVED',
      updatedAt: now,
    });
    const saved = await this.dependencies.persistence.save(approved);
    this.cache = saved;
    return saved;
  }

  async prepareTask(
    binding: FeatureTaskExecutionBinding,
    request: string,
    iterationFeedbackInput?: unknown,
  ) {
    let plan = await this.loadPlan(binding.featurePlanId);
    const task = validateTaskExecutable(plan, binding.taskId, binding.dependencyOverrides ?? []);
    const previousStatus = task.status;
    const now = this.dependencies.clock.now().toISOString();
    plan = markTaskInProgress(plan, binding.taskId, now);
    plan = await this.dependencies.persistence.save(plan);
    this.cache = plan;

    const normalizedFeedback =
      iterationFeedbackInput === undefined
        ? undefined
        : normalizeIterationFeedback(iterationFeedbackInput);
    const iterationPathHints =
      normalizedFeedback === undefined
        ? task.expectedAreas
        : extractIterationPathHints(normalizedFeedback);

    try {
      const preparation = await this.dependencies.runtime.prepareFeatureTask({
        request,
        plan,
        task,
        dependencyOverrides: binding.dependencyOverrides ?? [],
        iterationFeedback: normalizedFeedback,
        iterationPathHints,
      });
      return { plan, preparation };
    } catch (error: unknown) {
      if (previousStatus === 'READY') {
        const rolledBack = restoreTaskStatus(plan, binding.taskId, 'READY', now);
        this.cache = await this.dependencies.persistence.save(rolledBack);
      }
      throw error;
    }
  }

  async reopenTaskForCorrection(featurePlanId: string, taskId: string): Promise<FeaturePlan> {
    const plan = await this.loadPlan(featurePlanId);
    const now = this.dependencies.clock.now().toISOString();
    const reopened = reopenTaskForCorrection(plan, taskId, now);
    const saved = await this.dependencies.persistence.save(reopened);
    this.cache = saved;
    return saved;
  }

  async completeTask(
    featurePlanId: string,
    taskId: string,
    outcomeInput: unknown,
    options: { readonly acknowledgePartialPass?: boolean } = {},
  ): Promise<FeaturePlan> {
    const plan = await this.loadPlan(featurePlanId);
    const task = plan.tasks.find(({ taskId: id }) => id === taskId);
    if (task === undefined) {
      throw new WorkspaceRuntimeError('INVALID_FEATURE_PLAN', `Unknown task '${taskId}'.`);
    }
    const outcome = normalizeTaskOutcome(outcomeInput);
    assertFeatureTaskCompletionAllowed(outcome, options);
    const now = this.dependencies.clock.now().toISOString();
    const updated = markTaskOutcome(plan, taskId, 'COMPLETED', outcome, now);
    const saved = await this.dependencies.persistence.save(updated);
    this.cache = saved;
    return saved;
  }

  async failTask(
    featurePlanId: string,
    taskId: string,
    outcomeInput: unknown,
  ): Promise<FeaturePlan> {
    const plan = await this.loadPlan(featurePlanId);
    const now = this.dependencies.clock.now().toISOString();
    const updated = markTaskOutcome(
      plan,
      taskId,
      'FAILED',
      normalizeTaskOutcome(outcomeInput),
      now,
    );
    const saved = await this.dependencies.persistence.save(updated);
    this.cache = saved;
    return saved;
  }

  async skipTask(featurePlanId: string, taskId: string, summary: string): Promise<FeaturePlan> {
    const plan = await this.loadPlan(featurePlanId);
    const now = this.dependencies.clock.now().toISOString();
    const updated = markTaskOutcome(
      plan,
      taskId,
      'SKIPPED',
      { summary: summary.slice(0, 500), completedAt: now },
      now,
    );
    const saved = await this.dependencies.persistence.save(updated);
    this.cache = saved;
    return saved;
  }

  async updateDraftPlan(planInput: unknown): Promise<FeaturePlan> {
    const normalized = normalizeFeaturePlan(planInput, { forceStatus: 'DRAFT' });
    const saved = await this.dependencies.persistence.save(normalized);
    this.cache = saved;
    return saved;
  }

  async editApprovedPlan(planInput: unknown): Promise<FeaturePlan> {
    const normalized = normalizeFeaturePlan(planInput);
    const now = this.dependencies.clock.now().toISOString();
    const invalidated = invalidateApproval(normalized, now);
    const saved = await this.dependencies.persistence.save(invalidated);
    this.cache = saved;
    return saved;
  }

  buildExecutionBrain(
    plan: FeaturePlan,
    task: FeaturePlan['tasks'][number],
    preparationId: string,
  ): {
    readonly brain: ProjectBrain;
    readonly transientTask: ProjectTask;
  } {
    const timestamp = this.dependencies.clock.now().toISOString();
    const canonical = this.dependencies.loadProjectBrain();
    const shadowTasks = createShadowDependencyTasks(plan, task, timestamp);
    const transientTask = createFeatureTransientTask(
      plan,
      task,
      buildFeatureTaskRequest(task),
      preparationId,
      timestamp,
      shadowTasks,
    );
    const brain = parseProjectBrain({
      ...canonical,
      tasks: [...canonical.tasks, ...shadowTasks, transientTask],
    });
    return { brain, transientTask };
  }
}
