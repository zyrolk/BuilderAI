import { describe, expect, it } from 'vitest';

import { createAppliedResult } from '../../../core/verification/test/verification.fixture';
import { CHANGE_PLAN, VERIFICATION_REPORT } from '../../../ui/workspace/test/workspace.fixture';
import {
  CorrectionLoopService,
  classifyCorrectionFailure,
  completionToBeginInput,
  detectCorrectionLoop,
  buildCorrectionDiagnostic,
  digestChangePlan,
  buildCorrectionRequest,
} from '../correction-loop';
import type { CorrectionLoopBeginInput } from '../correction-loop/correction-loop.types';

function failedBuildInput(): CorrectionLoopBeginInput {
  return {
    workflowId: 'wf-1',
    applyStatus: 'APPLIED',
    createdPaths: [],
    updatedPaths: ['src/example.ts'],
    deletedPaths: [],
    verificationReport: {
      status: 'FAILED',
      stages: [
        {
          stage: 'BUILD_VALIDATION',
          status: 'FAILED',
          errors: [{ code: 'BUILD_FAILED', message: 'Type error in example.ts' }],
        },
      ],
      errors: [],
    },
  };
}

function browserConsoleFailureInput(): CorrectionLoopBeginInput {
  return {
    workflowId: 'wf-browser',
    applyStatus: 'APPLIED',
    createdPaths: [],
    updatedPaths: ['src/page.tsx'],
    deletedPaths: [],
    verificationReport: { status: 'PASSED', stages: [], errors: [] },
    runtimeBrowserVerificationReport: {
      status: 'FAILED',
      server: { status: 'READY' },
      browser: {
        status: 'FAILED',
        routes: [
          {
            path: '/',
            status: 'CONSOLE_ERROR',
            consoleErrors: [{ message: 'ReferenceError: handler is not defined' }],
            pageExceptions: [],
            failedRequests: [],
          },
        ],
      },
    },
  };
}

function samplePlan() {
  return CHANGE_PLAN;
}

async function runFailedCorrectionCycle(
  service: CorrectionLoopService,
  workflowId = 'wf-1',
  plan = samplePlan(),
): Promise<Awaited<ReturnType<CorrectionLoopService['recordVerificationComplete']>>> {
  await service.recordPrepared(
    workflowId,
    `prep-${service.getSession(workflowId)?.attempt ?? 0}`,
    plan,
  );
  await service.recordApplying(workflowId);
  return service.recordVerificationComplete(workflowId, {
    applyResult: createAppliedResult(),
    verificationReport: {
      ...VERIFICATION_REPORT,
      status: 'FAILED',
    },
  });
}

describe('P0-9 bounded correction loop', () => {
  it('starts correction only from supported verification failures', () => {
    const classification = classifyCorrectionFailure(failedBuildInput());
    expect(classification.correctable).toBe(true);
    expect(classification.category).toBe('BUILD_FAILURE');
  });

  it('blocks policy and recovery failures from correction', () => {
    const policy = classifyCorrectionFailure({
      ...failedBuildInput(),
      verificationReport: {
        status: 'FAILED',
        stages: [{ stage: 'BUILD_VALIDATION', status: 'POLICY_BLOCKED', errors: [] }],
        errors: [],
      },
    });
    expect(policy.correctable).toBe(false);
    expect(policy.category).toBe('POLICY_BLOCKED');

    const partial = classifyCorrectionFailure({
      ...failedBuildInput(),
      applyStatus: 'PARTIALLY_APPLIED',
    });
    expect(partial.correctable).toBe(false);
    expect(partial.category).toBe('RECOVERY_REQUIRED');
  });

  it('enforces correction attempt limit and hard ceiling', async () => {
    const service = new CorrectionLoopService({
      maximumCorrectionAttempts: 2,
      hardMaximumCorrectionAttempts: 3,
      workflowDeadlineMs: 300_000,
    });
    await service.beginCorrection(failedBuildInput());
    await runFailedCorrectionCycle(service, 'wf-1', CHANGE_PLAN);
    await service.beginCorrection({
      ...failedBuildInput(),
      verificationReport: {
        status: 'FAILED',
        stages: [
          {
            stage: 'TEST_VALIDATION',
            status: 'FAILED',
            errors: [{ code: 'TEST_FAILED', message: 'Assertion failed' }],
          },
        ],
        errors: [],
      },
      workflowId: 'wf-1',
    });
    const exhausted = await runFailedCorrectionCycle(service, 'wf-1', {
      ...CHANGE_PLAN,
      changeSet: {
        operations: [
          {
            ...CHANGE_PLAN.changeSet.operations[0]!,
            logicalPath: 'src/example.test.ts',
            operationId: 'op-update-src-example-test-ts',
          },
        ],
      },
    });
    expect(exhausted.state).toBe('CORRECTION_EXHAUSTED');
    const blocked = await service.beginCorrection({
      ...failedBuildInput(),
      workflowId: 'wf-1',
    });
    expect(blocked.session.state).toBe('CORRECTION_EXHAUSTED');
    expect(blocked.canPrepare).toBe(false);
  });

  it('builds bounded sanitized diagnostics', () => {
    const classification = classifyCorrectionFailure(browserConsoleFailureInput());
    const diagnostic = buildCorrectionDiagnostic({
      workflowId: 'wf-browser',
      attempt: 1,
      classification,
      beginInput: browserConsoleFailureInput(),
    });
    expect(diagnostic.affectedFiles).toContain('src/page.tsx');
    expect(diagnostic.diagnostics.some(({ code }) => code === 'BROWSER_CONSOLE_ERROR')).toBe(true);
    expect(diagnostic.summary.length).toBeLessThanOrEqual(500);
    expect(JSON.stringify(diagnostic)).not.toMatch(/api[_-]?key/i);
  });

  it('detects identical change plans and repeated failures', () => {
    const plan = samplePlan();
    const digest = digestChangePlan(plan);
    const loop = detectCorrectionLoop({
      diagnostic: buildCorrectionDiagnostic({
        workflowId: 'wf-1',
        attempt: 2,
        classification: classifyCorrectionFailure(failedBuildInput()),
        beginInput: failedBuildInput(),
      }),
      changePlan: plan,
      attemptHistory: [
        {
          attempt: 1,
          failureCategory: 'BUILD_FAILURE',
          diagnosticDigest: 'abc',
          changePlanDigest: digest,
          changedPaths: ['src/example.ts'],
          completedAt: new Date().toISOString(),
        },
      ],
    });
    expect(loop.kind).toBe('LOOP_DETECTED');
  });

  it('requires explicit approval path and rejects correction safely', async () => {
    const service = new CorrectionLoopService();
    const began = await service.beginCorrection(failedBuildInput());
    expect(began.canPrepare).toBe(true);
    const waiting = await service.recordPrepared('wf-1', 'prep-1', samplePlan());
    expect(waiting.state).toBe('CORRECTION_WAITING_FOR_APPROVAL');
    const rejected = await service.rejectCorrection('wf-1');
    expect(rejected.state).toBe('CORRECTION_CANCELLED');
  });

  it('classifies browser console and network failures for diagnosis', () => {
    const consoleFailure = classifyCorrectionFailure(browserConsoleFailureInput());
    expect(consoleFailure.category).toBe('BROWSER_CONSOLE_ERROR');

    const networkFailure = classifyCorrectionFailure({
      ...browserConsoleFailureInput(),
      runtimeBrowserVerificationReport: {
        status: 'FAILED',
        server: { status: 'READY' },
        browser: {
          status: 'FAILED',
          routes: [
            {
              path: '/',
              status: 'NETWORK_ERROR',
              consoleErrors: [],
              pageExceptions: [],
              failedRequests: [{ url: 'http://127.0.0.1/missing.js' }],
            },
          ],
        },
      },
    });
    expect(networkFailure.category).toBe('BROWSER_NETWORK_ERROR');
  });

  it('maps completion snapshots into correction input', () => {
    const input = completionToBeginInput(
      {
        applyResult: createAppliedResult({ updatedFiles: ['src/a.ts'] }),
        verificationReport: {
          ...VERIFICATION_REPORT,
          status: 'FAILED',
        },
      },
      'wf-complete',
    );
    expect(input.updatedPaths).toContain('src/a.ts');
  });

  it('blocks credential and security failures from correction', () => {
    const credential = classifyCorrectionFailure({
      ...failedBuildInput(),
      verificationReport: {
        status: 'FAILED',
        stages: [
          {
            stage: 'BUILD_VALIDATION',
            status: 'FAILED',
            errors: [{ code: 'MISSING_API_KEY', message: 'API key required' }],
          },
        ],
        errors: [],
      },
    });
    expect(credential.correctable).toBe(false);
    expect(credential.category).toBe('CREDENTIAL_FAILURE');
  });

  it('includes original task and attempt metadata in correction request', () => {
    const classification = classifyCorrectionFailure(failedBuildInput());
    const diagnostic = buildCorrectionDiagnostic({
      workflowId: 'wf-1',
      attempt: 1,
      classification,
      beginInput: failedBuildInput(),
    });
    const request = buildCorrectionRequest({
      diagnostic,
      originalTaskSummary: 'Fix checkout button',
      attempt: 1,
      maximumAttempts: 2,
    });
    expect(request).toContain('Correction attempt 1/2');
    expect(request).toContain('Original task: Fix checkout button');
    expect(request).toContain('bounded correction');
  });

  it('stops correction after partial apply', async () => {
    const service = new CorrectionLoopService();
    await service.beginCorrection(failedBuildInput());
    await service.recordPrepared('wf-1', 'prep-1', samplePlan());
    await service.recordApplying('wf-1');
    const blocked = await service.recordVerificationComplete('wf-1', {
      applyResult: { ...createAppliedResult(), status: 'PARTIALLY_APPLIED' },
      verificationReport: { ...VERIFICATION_REPORT, status: 'FAILED' },
    });
    expect(blocked.state).toBe('CORRECTION_BLOCKED');
    expect(blocked.blockCode).toBe('RECOVERY_REQUIRED');
  });

  it('terminates successfully when verification passes after correction', async () => {
    const service = new CorrectionLoopService();
    await service.beginCorrection(failedBuildInput());
    await service.recordPrepared('wf-1', 'prep-1', samplePlan());
    await service.recordApplying('wf-1');
    const passed = await service.recordVerificationComplete('wf-1', {
      applyResult: createAppliedResult(),
      verificationReport: { ...VERIFICATION_REPORT, status: 'PASSED' },
    });
    expect(passed.state).toBe('CORRECTION_PASSED');
  });

  it('enforces global correction deadline', async () => {
    let current = Date.now();
    const service = new CorrectionLoopService(
      { maximumCorrectionAttempts: 2, hardMaximumCorrectionAttempts: 3, workflowDeadlineMs: 1 },
      () => new Date(current),
    );
    await service.beginCorrection(failedBuildInput());
    current += 5;
    const expired = service.getSession('wf-1');
    expect(expired?.state).toBe('CORRECTION_FAILED');
    expect(expired?.blockCode).toBe('CORRECTION_DEADLINE_EXCEEDED');
  });

  it('classifies test, lint, and runtime startup failures', () => {
    expect(
      classifyCorrectionFailure({
        ...failedBuildInput(),
        verificationReport: {
          status: 'FAILED',
          stages: [{ stage: 'TEST_VALIDATION', status: 'FAILED', errors: [] }],
          errors: [],
        },
      }).category,
    ).toBe('TEST_FAILURE');

    expect(
      classifyCorrectionFailure({
        ...failedBuildInput(),
        verificationReport: {
          status: 'FAILED',
          stages: [{ stage: 'LINT_VALIDATION', status: 'FAILED', errors: [] }],
          errors: [],
        },
      }).category,
    ).toBe('LINT_FAILURE');

    expect(
      classifyCorrectionFailure({
        ...failedBuildInput(),
        verificationReport: { status: 'PASSED', stages: [], errors: [] },
        runtimeBrowserVerificationReport: {
          status: 'FAILED',
          server: { status: 'PROCESS_FAILED' },
          browser: { status: 'UNAVAILABLE', routes: [] },
        },
      }).category,
    ).toBe('RUNTIME_START_FAILURE');
  });

  it('allows same diagnostic when a different ChangePlan is prepared', () => {
    const classification = classifyCorrectionFailure(failedBuildInput());
    const diagnostic = buildCorrectionDiagnostic({
      workflowId: 'wf-1',
      attempt: 2,
      classification,
      beginInput: failedBuildInput(),
    });
    const atBegin = detectCorrectionLoop({
      diagnostic,
      attemptHistory: [
        {
          attempt: 1,
          failureCategory: diagnostic.failureCategory,
          diagnosticDigest: diagnostic.diagnosticDigest,
          changePlanDigest: digestChangePlan(CHANGE_PLAN),
          changedPaths: ['src/example.ts'],
          completedAt: new Date().toISOString(),
        },
      ],
    });
    expect(atBegin.kind).toBe('CONTINUE');

    const duplicatePlan = detectCorrectionLoop({
      diagnostic,
      changePlan: CHANGE_PLAN,
      attemptHistory: [
        {
          attempt: 1,
          failureCategory: diagnostic.failureCategory,
          diagnosticDigest: diagnostic.diagnosticDigest,
          changePlanDigest: digestChangePlan(CHANGE_PLAN),
          changedPaths: ['src/example.ts'],
          completedAt: new Date().toISOString(),
        },
      ],
    });
    expect(duplicatePlan.kind).toBe('LOOP_DETECTED');
    if (duplicatePlan.kind === 'LOOP_DETECTED') {
      expect(duplicatePlan.classification).toBe('SAME_PLAN');
    }
  });

  it('rejects invalid correction state transitions', async () => {
    const service = new CorrectionLoopService();
    await service.beginCorrection(failedBuildInput());
    await expect(service.recordApplying('wf-1')).rejects.toThrow(/Invalid correction transition/);
  });
});
