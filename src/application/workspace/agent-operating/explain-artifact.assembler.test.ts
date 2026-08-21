import { describe, expect, it } from 'vitest';

import { createAppliedResult } from '../../../core/verification/test/verification.fixture';
import type { CorrectionLoopSession } from '../correction-loop';
import type { AgentRun } from './agent-run.types';
import { assembleExplainArtifact } from './explain-artifact.assembler';

const NOW = '2026-08-21T12:00:00.000Z';

function baseRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    schemaVersion: 1,
    runId: 'run-1',
    projectId: 'project-a',
    goal: 'Add health endpoint',
    phase: 'COMPLETED',
    status: 'COMPLETED',
    references: {
      investigationId: 'inv-1',
      preparationId: 'prep-1',
      workflowId: 'prep-1',
    },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('assembleExplainArtifact', () => {
  it('builds a successful run explanation from completion evidence', () => {
    const explain = assembleExplainArtifact({
      run: baseRun(),
      generatedAt: NOW,
      preparationOutcome: 'READY_FOR_REVIEW',
      gate2Review: {
        schemaVersion: 1,
        operationDiffs: [
          {
            operationId: 'op-1',
            kind: 'UPDATE_FILE',
            logicalPath: 'src/a.ts',
            label: 'UPDATE FILE',
            format: 'UNIFIED',
            truncated: false,
            lineCount: 2,
            characterCount: 20,
          },
        ],
        totalCharacterCount: 20,
        truncated: false,
      },
      completion: {
        applyResult: createAppliedResult({ updatedFiles: ['src/a.ts'] }),
        verificationReport: {
          schemaVersion: 1,
          status: 'PASSED',
          stages: [
            {
              stage: 'TEST_VALIDATION',
              status: 'PASSED',
              warnings: [],
              errors: [],
              metadata: { generatedAt: NOW, source: 'test' },
              durationMs: 10,
            },
          ],
          warnings: [],
          errors: [],
          durationMs: 10,
          metadata: { generatedAt: NOW, source: 'test' },
        },
      },
      gate2CyclesObserved: 1,
    });

    expect(explain.schemaVersion).toBe(1);
    expect(explain.changes.applyStatus).toBe('APPLIED');
    expect(explain.verification.overallStatus).toBe('PASSED');
    expect(explain.browserVerification.availability.status).toBe('UNAVAILABLE');
    expect(explain.approvals.gate2CyclesObserved).toBe(1);
    expect(explain.failures).toEqual([]);
    expect(JSON.stringify(explain)).not.toMatch(
      /unifiedDiff|stdout|stderr|fileContents|promptPackage/,
    );
  });

  it('records failed verification without inventing browser evidence', () => {
    const explain = assembleExplainArtifact({
      run: baseRun({
        phase: 'CORRECTING',
        status: 'FAILED',
        references: {
          investigationId: 'inv-1',
          preparationId: 'prep-1',
          workflowId: 'prep-1',
          correctionWorkflowId: 'prep-1',
        },
      }),
      generatedAt: NOW,
      completion: {
        applyResult: createAppliedResult({ updatedFiles: ['src/a.ts'] }),
        verificationReport: {
          schemaVersion: 1,
          status: 'FAILED',
          stages: [
            {
              stage: 'TEST_VALIDATION',
              status: 'FAILED',
              warnings: [],
              errors: [{ code: 'TEST_FAILED', message: 'fail' }],
              metadata: { generatedAt: NOW, source: 'test' },
              durationMs: 5,
            },
          ],
          warnings: [],
          errors: [{ code: 'TEST_FAILED', message: 'fail', stage: 'TEST_VALIDATION' }],
          durationMs: 5,
          metadata: { generatedAt: NOW, source: 'test' },
        },
      },
      gate2CyclesObserved: 1,
    });

    expect(explain.verification.overallStatus).toBe('FAILED');
    expect(explain.browserVerification.availability.status).toBe('UNAVAILABLE');
    expect(explain.failures.some((failure) => failure.source === 'VERIFICATION')).toBe(true);
  });

  it('includes correction session details when present', () => {
    const session: CorrectionLoopSession = {
      schemaVersion: 1,
      workflowId: 'prep-1',
      state: 'CORRECTION_READY_FOR_REVIEW',
      attempt: 1,
      maximumAttempts: 2,
      startedAt: NOW,
      deadlineAt: NOW,
      attemptHistory: [],
      currentDiagnostic: {
        schemaVersion: 1,
        workflowId: 'prep-1',
        attempt: 1,
        failureStage: 'TEST_VALIDATION',
        failureCategory: 'TEST_FAILURE',
        summary: 'Tests failed',
        affectedRoutes: [],
        affectedFiles: ['src/a.ts'],
        diagnostics: [],
        evidenceReferences: [],
        diagnosticDigest: 'digest',
        sufficientEvidence: true,
        metadata: { generatedAt: NOW, source: 'test' },
      },
    };
    const explain = assembleExplainArtifact({
      run: baseRun({
        phase: 'CORRECTING',
        status: 'FAILED',
        references: { correctionWorkflowId: 'prep-1', preparationId: 'prep-1' },
      }),
      generatedAt: NOW,
      correctionSession: session,
      correctionCanPrepare: true,
      gate2CyclesObserved: 2,
    });
    expect(explain.corrections.state).toBe('CORRECTION_READY_FOR_REVIEW');
    expect(explain.corrections.failureCategory).toBe('TEST_FAILURE');
    expect(explain.approvals.gate2CyclesObserved).toBe(2);
  });

  it('includes browser verification counts without console bodies', () => {
    const explain = assembleExplainArtifact({
      run: baseRun(),
      generatedAt: NOW,
      completion: {
        applyResult: createAppliedResult({ updatedFiles: ['src/a.ts'] }),
        verificationReport: {
          schemaVersion: 1,
          status: 'PASSED',
          stages: [],
          warnings: [],
          errors: [],
          durationMs: 1,
          metadata: { generatedAt: NOW, source: 'test' },
        },
        runtimeBrowserVerificationReport: {
          schemaVersion: 1,
          status: 'PASSED',
          server: {
            descriptorId: 'next',
            status: 'READY',
            startupDurationMs: 1,
          },
          browser: {
            status: 'PASSED',
            durationMs: 1,
            routes: [
              {
                path: '/',
                status: 'PASSED',
                durationMs: 1,
                consoleErrors: [],
                pageExceptions: [],
                failedRequests: [],
              },
            ],
            consoleErrorCount: 0,
            pageExceptionCount: 0,
            failedRequestCount: 0,
          },
          durationMs: 1,
          metadata: { generatedAt: NOW, source: 'test' },
        },
      },
      gate2CyclesObserved: 1,
    });
    expect(explain.browserVerification.availability.status).toBe('AVAILABLE');
    expect(explain.browserVerification.routeCount).toBe(1);
    expect(JSON.stringify(explain)).not.toMatch(/consoleErrors|screenshotArtifactId/);
  });

  it('marks ephemeral plan evidence unavailable when missing', () => {
    const explain = assembleExplainArtifact({
      run: baseRun({
        phase: 'FAILED',
        status: 'FAILED',
        references: { investigationId: 'inv-1' },
      }),
      generatedAt: NOW,
    });
    expect(explain.plan.availability.status).toBe('UNAVAILABLE');
    expect(explain.changes.availability.status).toBe('UNAVAILABLE');
    expect(explain.approvals.availability.status).toBe('UNAVAILABLE');
    expect(explain.summary).toMatch(/Browser verification: unavailable/);
  });

  it('redacts secret-like fragments in failure messages', () => {
    const explain = assembleExplainArtifact({
      run: baseRun({ phase: 'FAILED', status: 'FAILED' }),
      generatedAt: NOW,
      completion: {
        applyResult: {
          ...createAppliedResult({ updatedFiles: [] }),
          status: 'FAILED',
          errors: [
            {
              code: 'FILESYSTEM_OPERATION_FAILED',
              message: 'write failed api_key=super-secret bearer abc.def password=leak',
            },
          ],
        },
      },
    });
    const serialized = JSON.stringify(explain);
    expect(serialized).not.toMatch(/super-secret|abc\.def|password=leak/);
    expect(serialized).toMatch(/\[redacted\]/);
  });
});
