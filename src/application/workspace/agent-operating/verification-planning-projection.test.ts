/**
 * @vitest-environment node
 *
 * ADR-051 — VerificationPlanningProjection deriver unit tests.
 */
import { describe, expect, it } from 'vitest';

import { AGENT_LOOP_SCHEMA_VERSION } from '../agent-loop/agent-loop.types';
import type { BoundedToolEvidenceRecord } from '../agent-loop/agent-loop.types';
import { BOUNDED_VERIFICATION_EVIDENCE_SCHEMA_VERSION } from '../agent-loop/agent-loop.types';
import {
  deriveVerificationPlanningProjection,
  serializeVerificationPlanningForPrompt,
} from './verification-planning-projection';

function baseRecord(
  overrides: Partial<BoundedToolEvidenceRecord> &
    Pick<BoundedToolEvidenceRecord, 'intentId' | 'phase' | 'toolId'>,
): BoundedToolEvidenceRecord {
  return {
    schemaVersion: AGENT_LOOP_SCHEMA_VERSION,
    runId: 'run-1',
    projectId: 'builder-ai',
    status: 'SUCCEEDED',
    recordedAt: '2026-08-29T12:00:00.000Z',
    summaryDigest: 'digest',
    ...overrides,
  };
}

function verification(
  commandId: 'npm-run-build' | 'npm-run-test' | 'npm-run-lint' | 'npm-run-typecheck',
  executionStatus: 'SUCCEEDED' | 'FAILED' | 'TIMEOUT' | 'CANCELLED' | 'REJECTED_BY_POLICY',
) {
  return {
    evidenceSchemaVersion: BOUNDED_VERIFICATION_EVIDENCE_SCHEMA_VERSION,
    commandId,
    stage:
      commandId === 'npm-run-build'
        ? 'BUILD_VALIDATION'
        : commandId === 'npm-run-test'
          ? 'TEST_VALIDATION'
          : commandId === 'npm-run-lint'
            ? 'LINT_VALIDATION'
            : 'TYPECHECK_VALIDATION',
    executionStatus,
    exitCode: executionStatus === 'FAILED' ? 1 : executionStatus === 'SUCCEEDED' ? 0 : null,
    timedOut: executionStatus === 'TIMEOUT',
    cancelled: executionStatus === 'CANCELLED',
    policyBlocked: executionStatus === 'REJECTED_BY_POLICY',
    ...(executionStatus === 'REJECTED_BY_POLICY'
      ? { policyBlockCode: 'SCRIPT_UNAVAILABLE' as const }
      : {}),
    outputLimited: false,
  };
}

describe('deriveVerificationPlanningProjection (ADR-051)', () => {
  it('returns undefined when no evidence', () => {
    expect(deriveVerificationPlanningProjection([])).toBeUndefined();
  });

  it('derives PASS from UNDERSTANDING SUCCEEDED evidence', () => {
    const projection = deriveVerificationPlanningProjection([
      baseRecord({
        intentId: 'v1',
        phase: 'UNDERSTANDING',
        toolId: 'run_verification_command',
        verificationEvidence: verification('npm-run-build', 'SUCCEEDED'),
      }),
    ]);
    expect(projection).toEqual(
      expect.objectContaining({
        baselineStatus: 'PASS',
        consideredCommandIds: ['npm-run-build'],
        succeededCommandIds: ['npm-run-build'],
        failedCommandIds: [],
      }),
    );
  });

  it('derives FAIL from FAILED evidence', () => {
    const projection = deriveVerificationPlanningProjection([
      baseRecord({
        intentId: 'v1',
        phase: 'UNDERSTANDING',
        toolId: 'run_verification_command',
        verificationEvidence: verification('npm-run-build', 'FAILED'),
      }),
    ]);
    expect(projection?.baselineStatus).toBe('FAIL');
    expect(projection?.failedCommandIds).toEqual(['npm-run-build']);
  });

  it('derives BLOCKED / TIMEOUT / CANCELLED / MIXED', () => {
    expect(
      deriveVerificationPlanningProjection([
        baseRecord({
          intentId: 'b1',
          phase: 'UNDERSTANDING',
          toolId: 'run_verification_command',
          verificationEvidence: verification('npm-run-lint', 'REJECTED_BY_POLICY'),
        }),
      ])?.baselineStatus,
    ).toBe('BLOCKED');

    expect(
      deriveVerificationPlanningProjection([
        baseRecord({
          intentId: 't1',
          phase: 'UNDERSTANDING',
          toolId: 'run_verification_command',
          verificationEvidence: verification('npm-run-test', 'TIMEOUT'),
        }),
      ])?.baselineStatus,
    ).toBe('TIMEOUT');

    expect(
      deriveVerificationPlanningProjection([
        baseRecord({
          intentId: 'c1',
          phase: 'UNDERSTANDING',
          toolId: 'run_verification_command',
          verificationEvidence: {
            ...verification('npm-run-lint', 'CANCELLED'),
            commandId: 'npm-run-format',
            stage: 'FORMAT_VALIDATION',
          },
        }),
      ])?.baselineStatus,
    ).toBe('MIXED');

    expect(
      deriveVerificationPlanningProjection([
        baseRecord({
          intentId: 'a',
          phase: 'UNDERSTANDING',
          toolId: 'run_verification_command',
          verificationEvidence: verification('npm-run-build', 'SUCCEEDED'),
        }),
        baseRecord({
          intentId: 'b',
          phase: 'UNDERSTANDING',
          toolId: 'run_verification_command',
          recordedAt: '2026-08-29T12:01:00.000Z',
          verificationEvidence: verification('npm-run-lint', 'TIMEOUT'),
        }),
      ])?.baselineStatus,
    ).toBe('MIXED');
  });

  it('ignores VERIFYING / DIAGNOSING / CORRECTING / PLANNING / EXECUTING phases', () => {
    for (const phase of [
      'VERIFYING',
      'DIAGNOSING',
      'CORRECTING',
      'PLANNING',
      'EXECUTING',
    ] as const) {
      expect(
        deriveVerificationPlanningProjection([
          baseRecord({
            intentId: `x-${phase}`,
            phase,
            toolId: 'run_verification_command',
            verificationEvidence: verification('npm-run-build', 'FAILED'),
          }),
        ]),
      ).toBeUndefined();
    }
  });

  it('ignores non-B4 tools', () => {
    expect(
      deriveVerificationPlanningProjection([
        baseRecord({
          intentId: 's1',
          phase: 'UNDERSTANDING',
          toolId: 'search_repository',
          verificationEvidence: verification('npm-run-build', 'FAILED'),
        }),
      ]),
    ).toBeUndefined();
  });

  it('keeps latest result per commandId (recordedAt then intentId)', () => {
    const olderFail = baseRecord({
      intentId: 'a',
      phase: 'UNDERSTANDING',
      toolId: 'run_verification_command',
      recordedAt: '2026-08-29T12:00:00.000Z',
      verificationEvidence: verification('npm-run-build', 'FAILED'),
    });
    const newerPass = baseRecord({
      intentId: 'b',
      phase: 'UNDERSTANDING',
      toolId: 'run_verification_command',
      recordedAt: '2026-08-29T12:05:00.000Z',
      verificationEvidence: verification('npm-run-build', 'SUCCEEDED'),
    });
    expect(deriveVerificationPlanningProjection([olderFail, newerPass])?.baselineStatus).toBe(
      'PASS',
    );

    const olderPass = baseRecord({
      intentId: 'a',
      phase: 'UNDERSTANDING',
      toolId: 'run_verification_command',
      recordedAt: '2026-08-29T12:00:00.000Z',
      verificationEvidence: verification('npm-run-build', 'SUCCEEDED'),
    });
    const newerFail = baseRecord({
      intentId: 'b',
      phase: 'UNDERSTANDING',
      toolId: 'run_verification_command',
      recordedAt: '2026-08-29T12:05:00.000Z',
      verificationEvidence: verification('npm-run-build', 'FAILED'),
    });
    expect(deriveVerificationPlanningProjection([newerFail, olderPass])?.baselineStatus).toBe(
      'FAIL',
    );

    const tieA = baseRecord({
      intentId: 'intent-a',
      phase: 'UNDERSTANDING',
      toolId: 'run_verification_command',
      recordedAt: '2026-08-29T12:00:00.000Z',
      verificationEvidence: verification('npm-run-build', 'FAILED'),
    });
    const tieB = baseRecord({
      intentId: 'intent-b',
      phase: 'UNDERSTANDING',
      toolId: 'run_verification_command',
      recordedAt: '2026-08-29T12:00:00.000Z',
      verificationEvidence: verification('npm-run-build', 'SUCCEEDED'),
    });
    expect(deriveVerificationPlanningProjection([tieA, tieB])?.baselineStatus).toBe('PASS');
  });

  it('orders command arrays by catalog and rejects malformed evidence', () => {
    const projection = deriveVerificationPlanningProjection([
      baseRecord({
        intentId: 't',
        phase: 'UNDERSTANDING',
        toolId: 'run_verification_command',
        verificationEvidence: verification('npm-run-typecheck', 'SUCCEEDED'),
      }),
      baseRecord({
        intentId: 'b',
        phase: 'UNDERSTANDING',
        toolId: 'run_verification_command',
        verificationEvidence: verification('npm-run-build', 'FAILED'),
      }),
    ]);
    expect(projection?.consideredCommandIds).toEqual(['npm-run-build', 'npm-run-typecheck']);
    expect(projection?.failedCommandIds).toEqual(['npm-run-build']);
    expect(projection?.succeededCommandIds).toEqual(['npm-run-typecheck']);

    expect(
      deriveVerificationPlanningProjection([
        baseRecord({
          intentId: 'bad',
          phase: 'UNDERSTANDING',
          toolId: 'run_verification_command',
          verificationEvidence: {
            ...verification('npm-run-build', 'FAILED'),
            commandId: 'not-a-command' as 'npm-run-build',
          },
        }),
      ]),
    ).toBeUndefined();
  });

  it('serializes prompt DATA without diagnostic prose keys', () => {
    const projection = deriveVerificationPlanningProjection([
      baseRecord({
        intentId: 'v1',
        phase: 'UNDERSTANDING',
        toolId: 'run_verification_command',
        verificationEvidence: verification('npm-run-build', 'FAILED'),
      }),
    ])!;
    const text = serializeVerificationPlanningForPrompt(projection);
    expect(text).toContain('baselineStatus: FAIL');
    expect(text).toContain('failedCommands: npm-run-build');
    expect(text).not.toContain('diagnosticSummary');
    expect(text).not.toContain('stdout');
    expect(text).not.toContain('Ignore previous');
  });
});
