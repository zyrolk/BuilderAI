'use client';

import {
  buildIterationFeedbackFromCompletion,
  buildIterationFeedbackFromGate2Rejection,
} from '../../application/workspace/iteration-feedback.service';
import type { FeaturePlan } from '../../application/workspace/feature-plan.types';
import type { ActivityHistory } from '../../application/workspace/activity-history.types';
import { parseWorkspaceActivity } from '../../application/workspace/activity-history.schemas';
import { ProjectChangePlanValidator, type ProjectChangePlan } from '../../core/change-planner';
import {
  FileApplyResultValidator,
  isVerificationEligibleFileApplyResult,
  type FileApplyResult,
} from '../../core/file-apply';
import { ResponsePackageValidator, type ResponsePackage } from '../../core/response-processor';
import { VerificationReportValidator, type VerificationReport } from '../../core/verification';
import {
  WorkspaceWorkflowError,
  type PrepareWorkspaceOptions,
  type PreparedWorkspaceChange,
  type WorkspaceCompletionSnapshot,
  type WorkspaceWorkflowPort,
} from './workspace.types';

interface PreparationWireResponse {
  readonly preparationId: string;
  readonly responsePackage: ResponsePackage;
  readonly changePlan: ProjectChangePlan;
  readonly featurePlan?: FeaturePlan;
}

interface CompletionWireResponse {
  readonly applyResult: FileApplyResult;
  readonly verificationReport?: VerificationReport;
}

export class HttpWorkspaceWorkflow implements WorkspaceWorkflowPort {
  private preparationId?: string;
  private preparedExecutionId?: string;
  private verificationReport?: VerificationReport;
  private lastRequest?: string;
  private lastCompletionSnapshot?: WorkspaceCompletionSnapshot;
  private activeFeatureBinding?: {
    readonly featurePlanId: string;
    readonly taskId: string;
    readonly dependencyOverrides?: readonly string[];
  };

  getCompletionSnapshot(): WorkspaceCompletionSnapshot | undefined {
    return this.lastCompletionSnapshot === undefined
      ? undefined
      : structuredClone(this.lastCompletionSnapshot);
  }

  async prepare(
    request: string,
    options: PrepareWorkspaceOptions = {},
  ): Promise<PreparedWorkspaceChange> {
    const body: Record<string, unknown> = { request };
    if (options.iterationFeedback !== undefined) body.iterationFeedback = options.iterationFeedback;
    if (options.featurePlanId !== undefined) body.featurePlanId = options.featurePlanId;
    if (options.taskId !== undefined) body.taskId = options.taskId;
    if (options.dependencyOverrides !== undefined) {
      body.dependencyOverrides = options.dependencyOverrides;
    }
    const value = await post('/api/workspace/prepare', body);
    const response = parsePreparation(value);
    this.preparationId = response.preparationId;
    this.preparedExecutionId = response.changePlan.source.executionId;
    this.lastRequest = request;
    this.verificationReport = undefined;
    if (options.featurePlanId !== undefined && options.taskId !== undefined) {
      this.activeFeatureBinding = {
        featurePlanId: options.featurePlanId,
        taskId: options.taskId,
        ...(options.dependencyOverrides === undefined
          ? {}
          : { dependencyOverrides: options.dependencyOverrides }),
      };
    } else if (options.iterationFeedback === undefined) {
      this.activeFeatureBinding = undefined;
    }
    if (options.iterationFeedback === undefined) {
      this.lastCompletionSnapshot = undefined;
    }
    return {
      responsePackage: structuredClone(response.responsePackage),
      changePlan: structuredClone(response.changePlan),
      ...(response.featurePlan === undefined
        ? {}
        : { featurePlan: structuredClone(response.featurePlan) }),
    };
  }

  async prepareGate2PreservationCorrection(
    request: string,
    changePlan: ProjectChangePlan,
    preparationId: string,
    operatorReason?: string,
  ): Promise<PreparedWorkspaceChange> {
    const iterationFeedback = buildIterationFeedbackFromGate2Rejection(changePlan, {
      rejectedPreparationId: preparationId,
      sourcePreparationId: preparationId,
      ...(operatorReason === undefined ? {} : { operatorReason }),
      ...(this.lastRequest === undefined ? {} : { priorRequestSummary: this.lastRequest }),
    });
    return this.prepare(request, { iterationFeedback });
  }

  async prepareCorrection(
    request: string,
    snapshot: WorkspaceCompletionSnapshot,
  ): Promise<PreparedWorkspaceChange> {
    const iterationFeedback = buildIterationFeedbackFromCompletion(
      {
        applyResult: snapshot.applyResult,
        ...(snapshot.verificationReport === undefined
          ? {}
          : { verificationReport: snapshot.verificationReport }),
      },
      {
        ...(snapshot.sourcePreparationId === undefined
          ? {}
          : { sourcePreparationId: snapshot.sourcePreparationId }),
        ...(snapshot.priorRequestSummary === undefined
          ? {}
          : { priorRequestSummary: snapshot.priorRequestSummary }),
      },
    );
    return this.prepare(request, {
      iterationFeedback,
      ...(snapshot.featurePlanId === undefined ? {} : { featurePlanId: snapshot.featurePlanId }),
      ...(snapshot.taskId === undefined ? {} : { taskId: snapshot.taskId }),
      ...(snapshot.dependencyOverrides === undefined
        ? {}
        : { dependencyOverrides: snapshot.dependencyOverrides }),
    });
  }

  async apply(changePlan: ProjectChangePlan): Promise<FileApplyResult> {
    if (
      this.preparationId === undefined ||
      this.preparedExecutionId === undefined ||
      changePlan.source.executionId !== this.preparedExecutionId
    ) {
      throw new Error('No matching server preparation is available.');
    }
    const value = await post('/api/workspace/apply', {
      preparationId: this.preparationId,
      approved: true,
    });
    const completion = parseCompletion(value);
    this.verificationReport = completion.verificationReport;
    this.lastCompletionSnapshot = {
      applyResult: completion.applyResult,
      ...(completion.verificationReport === undefined
        ? {}
        : { verificationReport: completion.verificationReport }),
      ...(this.preparationId === undefined ? {} : { sourcePreparationId: this.preparationId }),
      ...(this.lastRequest === undefined ? {} : { priorRequestSummary: this.lastRequest }),
      ...(this.activeFeatureBinding ?? {}),
    };
    return structuredClone(completion.applyResult);
  }

  async verify(applyResult: FileApplyResult): Promise<VerificationReport> {
    if (
      !isVerificationEligibleFileApplyResult(applyResult) ||
      this.verificationReport === undefined ||
      this.preparedExecutionId === undefined
    ) {
      throw new Error('No matching verification report is available.');
    }
    return structuredClone(this.verificationReport);
  }

  async loadActivityHistory(): Promise<ActivityHistory> {
    const response = await fetch('/api/workspace/activity-history', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    const value = (await response.json()) as unknown;
    if (!response.ok) throw workspaceError(value);
    return parseActivityHistoryResponse(value);
  }
}

async function post(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const value = (await response.json()) as unknown;
  if (!response.ok) throw workspaceError(value);
  return value;
}

function parsePreparation(value: unknown): PreparationWireResponse {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid preparation response.');
  const preparationId = Reflect.get(value, 'preparationId');
  const responsePackage = Reflect.get(value, 'responsePackage');
  const changePlan = Reflect.get(value, 'changePlan');
  if (typeof preparationId !== 'string' || !/^[A-Za-z0-9-]{8,128}$/u.test(preparationId)) {
    throw new Error('Invalid preparation identifier.');
  }
  const responseValidator: ResponsePackageValidator = new ResponsePackageValidator();
  const planValidator: ProjectChangePlanValidator = new ProjectChangePlanValidator();
  responseValidator.validate(responsePackage);
  planValidator.validate(changePlan);
  const featurePlan = readFeaturePlan(value);
  return {
    preparationId,
    responsePackage,
    changePlan,
    ...(featurePlan === undefined ? {} : { featurePlan }),
  };
}

function readFeaturePlan(value: unknown): FeaturePlan | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = Reflect.get(value, 'featurePlan');
  if (typeof candidate !== 'object' || candidate === null) return undefined;
  const featurePlanId = Reflect.get(candidate, 'featurePlanId');
  const schemaVersion = Reflect.get(candidate, 'schemaVersion');
  if (schemaVersion !== 1 || typeof featurePlanId !== 'string') return undefined;
  return candidate as FeaturePlan;
}

function parseCompletion(value: unknown): CompletionWireResponse {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid completion response.');
  const applyResult = Reflect.get(value, 'applyResult');
  const verificationReport = Reflect.get(value, 'verificationReport');
  const applyValidator: FileApplyResultValidator = new FileApplyResultValidator();
  const verificationValidator: VerificationReportValidator = new VerificationReportValidator();
  applyValidator.validate(applyResult);
  if (verificationReport !== undefined) verificationValidator.validate(verificationReport);
  return {
    applyResult,
    ...(verificationReport === undefined ? {} : { verificationReport }),
  };
}

function workspaceError(value: unknown): WorkspaceWorkflowError {
  if (typeof value !== 'object' || value === null) {
    return new WorkspaceWorkflowError('WORKSPACE_REQUEST_FAILED', 'Workspace request failed.');
  }
  const code = Reflect.get(value, 'code');
  const message = Reflect.get(value, 'message');
  return new WorkspaceWorkflowError(
    typeof code === 'string' && /^[A-Z0-9_]{1,80}$/u.test(code) ? code : 'WORKSPACE_REQUEST_FAILED',
    typeof message === 'string' && message.length <= 2_000 ? message : 'Workspace request failed.',
  );
}

function parseActivityHistoryResponse(value: unknown): ActivityHistory {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Invalid activity history response.');
  }
  const schemaVersion = Reflect.get(value, 'schemaVersion');
  const activities = Reflect.get(value, 'activities');
  if (schemaVersion !== 1 || !Array.isArray(activities)) {
    throw new Error('Invalid activity history response.');
  }
  const parsedActivities = activities.map((entry) => parseWorkspaceActivity(entry));
  return { schemaVersion: 1, activities: parsedActivities };
}
