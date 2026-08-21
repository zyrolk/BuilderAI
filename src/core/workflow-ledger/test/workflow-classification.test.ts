import { describe, expect, it } from 'vitest';

import {
  classifyWorkflow,
  deriveApplyRecoveryState,
  deriveWorkflowStateFromEvent,
} from '../services/workflow-classification.service';
import type { WorkflowEvent } from '../types/workflow-event.types';
import type { WorkflowManifest } from '../types/workflow-ledger.types';

const NOW = new Date('2026-08-20T12:00:00.000Z');

function manifest(overrides: Partial<WorkflowManifest> = {}): WorkflowManifest {
  return {
    schemaVersion: 1,
    workflowId: 'wf-1',
    projectId: 'project-a',
    repositoryRoot: '/tmp/project',
    createdAt: '2026-08-20T10:00:00.000Z',
    updatedAt: '2026-08-20T10:00:00.000Z',
    workflowState: 'CREATED',
    classification: 'RESUMABLE',
    lastEventSequence: 1,
    lastEventDigest: 'abc',
    ...overrides,
  };
}

function event(
  eventType: WorkflowEvent['eventType'],
  overrides: Partial<WorkflowEvent> = {},
): WorkflowEvent {
  return {
    eventId: 'evt-1',
    workflowId: 'wf-1',
    sequence: 1,
    eventType,
    timestamp: '2026-08-20T10:00:00.000Z',
    payload: {},
    previousEventDigest: 'genesis',
    eventDigest: 'digest',
    schemaVersion: 1,
    ...overrides,
  };
}

describe('classifyWorkflow', () => {
  it('returns terminal states from manifest', () => {
    expect(classifyWorkflow(manifest({ workflowState: 'COMPLETED' }), [], NOW)).toBe('COMPLETED');
    expect(classifyWorkflow(manifest({ workflowState: 'CANCELLED' }), [], NOW)).toBe('CANCELLED');
    expect(classifyWorkflow(manifest({ workflowState: 'FAILED' }), [], NOW)).toBe('FAILED');
    expect(classifyWorkflow(manifest({ workflowState: 'RECOVERY_REQUIRED' }), [], NOW)).toBe(
      'RECOVERY_REQUIRED',
    );
  });

  it('classifies RECOVERY_REQUIRED from events', () => {
    expect(classifyWorkflow(manifest(), [event('RECOVERY_REQUIRED')], NOW)).toBe(
      'RECOVERY_REQUIRED',
    );
    expect(classifyWorkflow(manifest(), [event('BASELINE_DRIFT_DETECTED')], NOW)).toBe(
      'RECOVERY_REQUIRED',
    );
  });

  it('classifies EXPIRED when approval has expired', () => {
    const expired = manifest({
      workflowState: 'AWAITING_APPROVAL',
      approvalProvenance: {
        preparationId: 'prep-1',
        changePlanDigest: 'plan',
        diffDigest: 'diff',
        baselineDigest: 'base',
        approvedAt: '2026-08-20T10:00:00.000Z',
        expiresAt: '2026-08-20T11:00:00.000Z',
        approvalIdentity: 'operator',
      },
    });
    expect(classifyWorkflow(expired, [], NOW)).toBe('EXPIRED');
  });

  it('classifies WAITING_FOR_APPROVAL when Gate2 ready without approval', () => {
    expect(
      classifyWorkflow(
        manifest({ workflowState: 'AWAITING_APPROVAL' }),
        [event('GATE2_READY')],
        NOW,
      ),
    ).toBe('WAITING_FOR_APPROVAL');
  });

  it('classifies incomplete APPLY as RECOVERY_REQUIRED', () => {
    expect(classifyWorkflow(manifest({ workflowState: 'APPLYING' }), [], NOW)).toBe(
      'RECOVERY_REQUIRED',
    );
    expect(
      classifyWorkflow(manifest({ workflowState: 'PREPARING' }), [event('APPLY_STARTED')], NOW),
    ).toBe('RECOVERY_REQUIRED');
  });

  it('classifies RESUMABLE for non-APPLY in-progress workflow states', () => {
    for (const state of ['VERIFYING', 'CORRECTING', 'PREPARING'] as const) {
      expect(classifyWorkflow(manifest({ workflowState: state }), [], NOW)).toBe('RESUMABLE');
    }
  });

  it('classifies durable incomplete checkpoint as RECOVERY_REQUIRED', () => {
    expect(
      classifyWorkflow(manifest({ workflowState: 'AWAITING_APPROVAL' }), [], NOW, {
        status: 'IN_PROGRESS',
        recoveryClassification: 'RECOVERY_REQUIRED',
      }),
    ).toBe('RECOVERY_REQUIRED');
  });

  it('defaults to RESUMABLE for unknown intermediate state', () => {
    expect(classifyWorkflow(manifest({ workflowState: 'CREATED' }), [], NOW)).toBe('RESUMABLE');
  });
});

describe('deriveWorkflowStateFromEvent', () => {
  it('maps lifecycle events to workflow states', () => {
    expect(deriveWorkflowStateFromEvent('CREATED', 'WORKFLOW_CREATED')).toBe('CREATED');
    expect(deriveWorkflowStateFromEvent('CREATED', 'INVESTIGATION_COMPLETED')).toBe(
      'INVESTIGATING',
    );
    expect(deriveWorkflowStateFromEvent('INVESTIGATING', 'PREPARE_COMPLETED')).toBe(
      'AWAITING_APPROVAL',
    );
    expect(deriveWorkflowStateFromEvent('AWAITING_APPROVAL', 'GATE2_READY')).toBe(
      'AWAITING_APPROVAL',
    );
    expect(deriveWorkflowStateFromEvent('AWAITING_APPROVAL', 'APPLY_STARTED')).toBe('APPLYING');
    expect(deriveWorkflowStateFromEvent('APPLYING', 'VERIFICATION_STARTED')).toBe('VERIFYING');
    expect(deriveWorkflowStateFromEvent('VERIFYING', 'CORRECTION_STARTED')).toBe('CORRECTING');
    expect(deriveWorkflowStateFromEvent('CORRECTING', 'CORRECTION_PREPARED')).toBe('CORRECTING');
    expect(deriveWorkflowStateFromEvent('APPLYING', 'RECOVERY_REQUIRED')).toBe('RECOVERY_REQUIRED');
    expect(deriveWorkflowStateFromEvent('APPLYING', 'BASELINE_DRIFT_DETECTED')).toBe(
      'RECOVERY_REQUIRED',
    );
    expect(deriveWorkflowStateFromEvent('APPLYING', 'APPROVAL_INVALIDATED')).toBe(
      'RECOVERY_REQUIRED',
    );
    expect(deriveWorkflowStateFromEvent('VERIFYING', 'WORKFLOW_COMPLETED')).toBe('COMPLETED');
    expect(deriveWorkflowStateFromEvent('CORRECTING', 'WORKFLOW_FAILED')).toBe('FAILED');
    expect(deriveWorkflowStateFromEvent('APPLYING', 'WORKFLOW_CANCELLED')).toBe('CANCELLED');
    expect(deriveWorkflowStateFromEvent('CORRECTING', 'CORRECTION_VERIFIED')).toBe('COMPLETED');
  });

  it('preserves current state for unmapped events', () => {
    expect(deriveWorkflowStateFromEvent('APPLYING', 'APPLY_OPERATION_COMPLETED')).toBe('APPLYING');
  });
});

describe('deriveApplyRecoveryState', () => {
  it('covers all recovery state branches', () => {
    expect(deriveApplyRecoveryState([])).toBe('NO_MUTATION');
    expect(
      deriveApplyRecoveryState([
        { operationState: 'COMPLETED', rollbackState: 'NOT_STARTED' },
        { operationState: 'COMPLETED', rollbackState: 'NOT_STARTED' },
      ]),
    ).toBe('MUTATION_COMPLETED');
    expect(
      deriveApplyRecoveryState([{ operationState: 'FAILED', rollbackState: 'COMPLETED' }]),
    ).toBe('ROLLBACK_COMPLETED');
    expect(
      deriveApplyRecoveryState([{ operationState: 'FAILED', rollbackState: 'NOT_STARTED' }]),
    ).toBe('MUTATION_UNCERTAIN');
    expect(
      deriveApplyRecoveryState([{ operationState: 'UNCERTAIN', rollbackState: 'UNCERTAIN' }]),
    ).toBe('MANUAL_RECOVERY_REQUIRED');
    expect(
      deriveApplyRecoveryState([{ operationState: 'COMPLETED', rollbackState: 'FAILED' }]),
    ).toBe('MANUAL_RECOVERY_REQUIRED');
    expect(
      deriveApplyRecoveryState([
        { operationState: 'COMPLETED', rollbackState: 'NOT_STARTED' },
        { operationState: 'PENDING', rollbackState: 'NOT_STARTED' },
      ]),
    ).toBe('MUTATION_UNCERTAIN');
  });
});
