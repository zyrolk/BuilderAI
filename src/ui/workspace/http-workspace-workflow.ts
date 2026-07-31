'use client';

import { ProjectChangePlanValidator, type ProjectChangePlan } from '../../core/change-planner';
import { FileApplyResultValidator, type FileApplyResult } from '../../core/file-apply';
import { ResponsePackageValidator, type ResponsePackage } from '../../core/response-processor';
import { VerificationReportValidator, type VerificationReport } from '../../core/verification';
import {
  WorkspaceWorkflowError,
  type PreparedWorkspaceChange,
  type WorkspaceWorkflowPort,
} from './workspace.types';

interface PreparationWireResponse {
  readonly preparationId: string;
  readonly responsePackage: ResponsePackage;
  readonly changePlan: ProjectChangePlan;
}

interface CompletionWireResponse {
  readonly applyResult: FileApplyResult;
  readonly verificationReport?: VerificationReport;
}

export class HttpWorkspaceWorkflow implements WorkspaceWorkflowPort {
  private preparationId?: string;
  private preparedExecutionId?: string;
  private verificationReport?: VerificationReport;

  async prepare(request: string): Promise<PreparedWorkspaceChange> {
    const value = await post('/api/workspace/prepare', { request });
    const response = parsePreparation(value);
    this.preparationId = response.preparationId;
    this.preparedExecutionId = response.changePlan.source.executionId;
    this.verificationReport = undefined;
    return {
      responsePackage: structuredClone(response.responsePackage),
      changePlan: structuredClone(response.changePlan),
    };
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
    return structuredClone(completion.applyResult);
  }

  async verify(applyResult: FileApplyResult): Promise<VerificationReport> {
    if (
      applyResult.status !== 'APPLIED' ||
      this.verificationReport === undefined ||
      this.preparedExecutionId === undefined
    ) {
      throw new Error('No matching verification report is available.');
    }
    return structuredClone(this.verificationReport);
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
  return { preparationId, responsePackage, changePlan };
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
