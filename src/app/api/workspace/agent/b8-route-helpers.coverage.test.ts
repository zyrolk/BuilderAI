/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

import { AgentLoopError } from '../../../../application/workspace/agent-loop';
import { AgentRunError } from '../../../../application/workspace/agent-operating';
import { WorkspaceRuntimeError } from '../../../../application/workspace';
import {
  assertNoToolTurnAuthorityFields,
  mapAgentRouteError,
  readToolTurnIntents,
  toBoundedToolEvidenceHttpView,
} from './agent-route-helpers';
import { BOUNDED_VERIFICATION_EVIDENCE_SCHEMA_VERSION } from '../../../../application/workspace/agent-loop/agent-loop.types';

describe('B8 agent-route-helpers coverage', () => {
  it('maps AgentLoopError and AgentRunError statuses', async () => {
    const concurrent = mapAgentRouteError(
      new AgentLoopError('CONCURRENT_EXECUTION_REJECTED', 'busy'),
    );
    expect(concurrent.status).toBe(409);
    const other = mapAgentRouteError(new AgentLoopError('INVALID_INTENT_SCHEMA', 'bad'));
    expect(other.status).toBe(400);
    const notFound = mapAgentRouteError(new AgentRunError('NOT_FOUND', 'missing'));
    expect(notFound.status).toBe(404);
    const corrupt = mapAgentRouteError(new AgentRunError('CORRUPT_STATE', 'bad'));
    expect(corrupt.status).toBe(500);
  });

  it('rejects empty/oversized intents and projects digests', () => {
    expect(() => readToolTurnIntents({ intents: [] })).toThrow(WorkspaceRuntimeError);
    expect(() =>
      readToolTurnIntents({
        intents: Array.from({ length: 13 }, (_, i) => ({ toolId: 'x', intentId: `i${i}` })),
      }),
    ).toThrow(WorkspaceRuntimeError);
    expect(() => assertNoToolTurnAuthorityFields({ shell: true })).toThrow(WorkspaceRuntimeError);
    expect(() => assertNoToolTurnAuthorityFields({ verificationEvidence: {} })).toThrow(
      WorkspaceRuntimeError,
    );
    expect(
      toBoundedToolEvidenceHttpView({
        schemaVersion: 1,
        runId: 'r',
        projectId: 'p',
        phase: 'UNDERSTANDING',
        toolId: 'search_repository',
        intentId: 'i1',
        status: 'FAILED',
        recordedAt: 't',
        summaryDigest: 'abc',
        errorCode: 'X',
      }),
    ).toEqual(
      expect.objectContaining({
        toolId: 'search_repository',
        errorCode: 'X',
        summaryDigest: 'abc',
      }),
    );
  });

  it('projects durable verificationEvidence without prose or streams', () => {
    const view = toBoundedToolEvidenceHttpView({
      schemaVersion: 3,
      runId: 'r',
      projectId: 'p',
      phase: 'UNDERSTANDING',
      toolId: 'run_verification_command',
      intentId: 'i-v',
      status: 'FAILED',
      recordedAt: 't',
      summaryDigest: 'abc',
      verificationEvidence: {
        evidenceSchemaVersion: BOUNDED_VERIFICATION_EVIDENCE_SCHEMA_VERSION,
        commandId: 'npm-run-build',
        stage: 'BUILD_VALIDATION',
        executionStatus: 'FAILED',
        exitCode: 1,
        timedOut: false,
        cancelled: false,
        policyBlocked: false,
        outputLimited: false,
      },
    });
    expect(view.verificationEvidence).toEqual(
      expect.objectContaining({
        commandId: 'npm-run-build',
        executionStatus: 'FAILED',
        exitCode: 1,
      }),
    );
    expect(view).not.toHaveProperty('diagnosticSummary');
    expect(JSON.stringify(view)).not.toContain('stdout');
    expect(JSON.stringify(view)).not.toContain('stderr');
  });
});
