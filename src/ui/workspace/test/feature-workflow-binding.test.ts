import { describe, expect, it, vi } from 'vitest';

import type { FileApplyResult } from '../../../core/file-apply';
import type { VerificationReport } from '../../../core/verification';
import { HttpWorkspaceWorkflow } from '../http-workspace-workflow';
import { CHANGE_PLAN, RESPONSE_PACKAGE } from './workspace.fixture';

const APPLIED_RESULT: FileApplyResult = {
  schemaVersion: 1,
  status: 'APPLIED',
  createdFiles: [],
  updatedFiles: ['src/example.ts'],
  deletedFiles: [],
  skippedFiles: [],
  warnings: [],
  errors: [],
  durationMs: 1,
  metadata: {},
};

const FAILED_VERIFICATION: VerificationReport = {
  schemaVersion: 1,
  status: 'FAILED',
  stages: [],
  warnings: [],
  errors: [{ code: 'TEST_FAILED', message: 'Verification failed.', stage: 'BUILD_VALIDATION' }],
  durationMs: 1,
  metadata: {},
};

describe('HttpWorkspaceWorkflow feature binding', () => {
  it('preserves feature task binding during correction prepare', async () => {
    const workflow = new HttpWorkspaceWorkflow();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          preparationId: 'prep-feature-001',
          responsePackage: RESPONSE_PACKAGE,
          changePlan: CHANGE_PLAN,
          featurePlan: {
            schemaVersion: 1,
            featurePlanId: 'plan-bind-001',
            sourceRequest: 'Feature',
            title: 'Feature',
            summary: 'Summary',
            status: 'IN_PROGRESS',
            createdAt: '2026-08-01T00:00:00.000Z',
            updatedAt: '2026-08-01T00:00:00.000Z',
            tasks: [
              {
                taskId: 'task-03',
                title: 'Task',
                objective: 'Objective',
                scope: 'scope',
                dependencyIds: [],
                expectedAreas: ['src/core'],
                acceptanceCriteria: [],
                order: 1,
                status: 'IN_PROGRESS',
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const snapshot = {
      applyResult: APPLIED_RESULT,
      verificationReport: FAILED_VERIFICATION,
      featurePlanId: 'plan-bind-001',
      taskId: 'task-03',
      dependencyOverrides: ['task-02'],
    };
    await workflow.prepareCorrection('Fix verification failures', snapshot);

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body.featurePlanId).toBe('plan-bind-001');
    expect(body.taskId).toBe('task-03');
    expect(body.dependencyOverrides).toEqual(['task-02']);
    expect(body.iterationFeedback).toBeDefined();
    fetchMock.mockRestore();
  });

  it('does not attach feature binding to ordinary prepare', async () => {
    const workflow = new HttpWorkspaceWorkflow();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          preparationId: 'prep-ordinary-001',
          responsePackage: RESPONSE_PACKAGE,
          changePlan: CHANGE_PLAN,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await workflow.prepare('Ordinary request');
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body.featurePlanId).toBeUndefined();
    expect(body.taskId).toBeUndefined();
    fetchMock.mockRestore();
  });
});
