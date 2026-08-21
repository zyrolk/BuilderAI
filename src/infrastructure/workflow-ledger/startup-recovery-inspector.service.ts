import {
  classifyWorkflow,
  type WorkflowClassification,
  type WorkflowEvent,
  type WorkflowLedgerPort,
  type WorkflowManifest,
} from '../../core/workflow-ledger';

export interface StartupRecoveryInspection {
  readonly workflowId: string;
  readonly manifest: WorkflowManifest;
  readonly classification: WorkflowClassification;
  readonly eventCount: number;
  readonly hasIncompleteApply: boolean;
  readonly hasIncompleteVerification: boolean;
  readonly hasIncompleteCorrection: boolean;
  readonly hasStaleApproval: boolean;
  readonly hasBaselineDriftEvent: boolean;
}

export class StartupRecoveryInspector {
  constructor(private readonly ledger: WorkflowLedgerPort) {}

  async inspectProject(
    projectId: string,
    now: Date,
  ): Promise<readonly StartupRecoveryInspection[]> {
    const manifests = await this.ledger.listWorkflows(projectId);
    const inspections: StartupRecoveryInspection[] = [];
    for (const manifest of manifests) {
      inspections.push(await this.inspectWorkflow(manifest, now));
    }
    return inspections;
  }

  async inspectWorkflow(manifest: WorkflowManifest, now: Date): Promise<StartupRecoveryInspection> {
    const events = await this.ledger.readEvents(manifest.workflowId);
    const classification = classifyWorkflow(manifest, events, now);
    return {
      workflowId: manifest.workflowId,
      manifest,
      classification,
      eventCount: events.length,
      hasIncompleteApply: hasEvent(events, 'APPLY_STARTED') && !hasTerminalApply(events),
      hasIncompleteVerification:
        hasEvent(events, 'VERIFICATION_STARTED') && !hasEvent(events, 'VERIFICATION_COMPLETED'),
      hasIncompleteCorrection:
        hasEvent(events, 'CORRECTION_STARTED') &&
        !hasAnyEvent(events, ['CORRECTION_VERIFIED', 'WORKFLOW_FAILED', 'WORKFLOW_CANCELLED']),
      hasStaleApproval:
        manifest.approvalProvenance !== undefined &&
        now.getTime() > Date.parse(manifest.approvalProvenance.expiresAt),
      hasBaselineDriftEvent: hasAnyEvent(events, [
        'BASELINE_DRIFT_DETECTED',
        'APPROVAL_INVALIDATED',
      ]),
    };
  }
}

function hasEvent(
  events: readonly WorkflowEvent[],
  eventType: WorkflowEvent['eventType'],
): boolean {
  return events.some((event) => event.eventType === eventType);
}

function hasAnyEvent(
  events: readonly WorkflowEvent[],
  eventTypes: readonly WorkflowEvent['eventType'][],
): boolean {
  return events.some((event) => eventTypes.includes(event.eventType));
}

function hasTerminalApply(events: readonly WorkflowEvent[]): boolean {
  return hasAnyEvent(events, [
    'APPLY_FAILED',
    'VERIFICATION_STARTED',
    'VERIFICATION_COMPLETED',
    'WORKFLOW_COMPLETED',
    'WORKFLOW_FAILED',
    'WORKFLOW_CANCELLED',
    'RECOVERY_REQUIRED',
    'ROLLBACK_COMPLETED',
  ]);
}
