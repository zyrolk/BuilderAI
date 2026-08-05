'use client';

import type { FeaturePlan } from '../../application/workspace/feature-plan.types';
import { WorkspaceWorkflowError } from './workspace.types';

interface FeaturePlanWireResponse {
  readonly plan: FeaturePlan | null;
}

interface FeaturePlanMutationResponse {
  readonly plan: FeaturePlan;
}

interface FeaturePrepareWireResponse {
  readonly featurePlan?: FeaturePlan;
}

export class HttpFeatureWorkflow {
  async loadActivePlan(): Promise<FeaturePlan | undefined> {
    const response = await get<FeaturePlanWireResponse>('/api/workspace/feature/plan');
    return response.plan ?? undefined;
  }

  async loadPlan(featurePlanId: string): Promise<FeaturePlan> {
    const response = await get<FeaturePlanWireResponse>(
      `/api/workspace/feature/plan?featurePlanId=${encodeURIComponent(featurePlanId)}`,
    );
    if (response.plan === null) {
      throw new WorkspaceWorkflowError('FEATURE_PLAN_NOT_FOUND', 'Feature plan was not found.');
    }
    return response.plan;
  }

  async decompose(request: string): Promise<FeaturePlan> {
    const response = await post<FeaturePlan>('/api/workspace/feature/decompose', { request });
    return response;
  }

  async saveDraft(plan: FeaturePlan): Promise<FeaturePlan> {
    const response = await put<FeaturePlanMutationResponse>('/api/workspace/feature/plan', {
      plan,
      mode: 'draft',
    });
    return response.plan;
  }

  async approvePlan(featurePlanId: string): Promise<FeaturePlan> {
    const response = await post<FeaturePlanMutationResponse>(
      '/api/workspace/feature/plan/approve',
      {
        featurePlanId,
      },
    );
    return response.plan;
  }

  async completeTask(
    featurePlanId: string,
    taskId: string,
    outcome: unknown,
    acknowledgePartialPass = false,
  ): Promise<FeaturePlan> {
    const response = await post<FeaturePlanMutationResponse>(
      '/api/workspace/feature/task/outcome',
      {
        featurePlanId,
        taskId,
        action: 'complete',
        outcome,
        acknowledgePartialPass,
      },
    );
    return response.plan;
  }

  async failTask(featurePlanId: string, taskId: string, outcome: unknown): Promise<FeaturePlan> {
    const response = await post<FeaturePlanMutationResponse>(
      '/api/workspace/feature/task/outcome',
      {
        featurePlanId,
        taskId,
        action: 'fail',
        outcome,
      },
    );
    return response.plan;
  }

  async skipTask(featurePlanId: string, taskId: string, summary: string): Promise<FeaturePlan> {
    const response = await post<FeaturePlanMutationResponse>(
      '/api/workspace/feature/task/outcome',
      {
        featurePlanId,
        taskId,
        action: 'skip',
        summary,
      },
    );
    return response.plan;
  }

  async reopenTask(featurePlanId: string, taskId: string): Promise<FeaturePlan> {
    const response = await post<FeaturePlanMutationResponse>(
      '/api/workspace/feature/task/outcome',
      {
        featurePlanId,
        taskId,
        action: 'reopen',
      },
    );
    return response.plan;
  }
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  return parseJson<T>(response);
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  return parseJson<T>(response);
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  return parseJson<T>(response);
}

async function parseJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as { code?: string; message?: string };
  if (!response.ok) {
    throw new WorkspaceWorkflowError(
      payload.code ?? 'WORKFLOW_FAILED',
      payload.message ?? 'Request failed.',
    );
  }
  return payload as T;
}

export type { FeaturePrepareWireResponse };
