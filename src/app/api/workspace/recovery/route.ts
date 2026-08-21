import { NextResponse } from 'next/server';

import {
  FilesystemWorkflowLedgerStore,
  StartupRecoveryInspector,
  DEFAULT_WORKFLOW_STATE_ROOT_CONFIGURATION,
} from '../../../../infrastructure/workflow-ledger';
import { DurableApplyCheckpointStore } from '../../../../infrastructure/workflow-ledger/durable-apply-checkpoint.store';
import {
  assertTrustedLocalRequest,
  LocalRequestRejectedError,
} from '../../../../infrastructure/workspace';
import { loadLocalWorkspaceRuntimeConfiguration } from '../../../../infrastructure/workspace/local-runtime-configuration';
import { readWorkspaceProjectId } from '../../../../core/target-project';
import { WorkflowLedgerError } from '../../../../core/workflow-ledger';
import type { StartupRecoveryInspection } from '../../../../infrastructure/workflow-ledger/startup-recovery-inspector.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  try {
    assertTrustedLocalRequest(request);
    const configuration = loadLocalWorkspaceRuntimeConfiguration();
    const projectId = readWorkspaceProjectId(
      configuration.projectRoot,
      configuration.projectProfile,
    );
    const ledger = new FilesystemWorkflowLedgerStore(DEFAULT_WORKFLOW_STATE_ROOT_CONFIGURATION);
    const checkpointStore = new DurableApplyCheckpointStore(
      DEFAULT_WORKFLOW_STATE_ROOT_CONFIGURATION.stateRoot,
      projectId,
    );
    const inspections = await new StartupRecoveryInspector(ledger).inspectProject(
      projectId,
      new Date(),
    );
    const workflows = [];
    for (const inspection of inspections) {
      workflows.push(await mapInspection(inspection, checkpointStore));
    }
    return NextResponse.json(
      {
        projectId,
        workflows,
      },
      {
        headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
      },
    );
  } catch (error: unknown) {
    if (error instanceof LocalRequestRejectedError) {
      return NextResponse.json(
        { code: error.code, message: error.message },
        {
          status: 403,
          headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
        },
      );
    }
    if (error instanceof WorkflowLedgerError && error.code === 'CORRUPT_STATE') {
      return NextResponse.json(
        {
          code: 'CORRUPT_STATE',
          message: 'Durable workflow state is corrupt and requires operator recovery.',
          workflows: [],
          corruptionDetected: true,
        },
        {
          status: 409,
          headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
        },
      );
    }
    return NextResponse.json(
      {
        code: 'RECOVERY_INSPECTION_FAILED',
        message: 'Recovery inspection failed.',
        workflows: [],
      },
      {
        status: 500,
        headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
      },
    );
  }
}

async function mapInspection(
  inspection: StartupRecoveryInspection,
  checkpointStore: DurableApplyCheckpointStore,
): Promise<Record<string, unknown>> {
  let durableCheckpointStatus: string | null = null;
  let durableRecoveryClassification: string | null = null;
  let checkpointCorrupt = false;
  try {
    const checkpoint = await checkpointStore.load(inspection.workflowId);
    durableCheckpointStatus = checkpoint?.status ?? null;
    durableRecoveryClassification = checkpoint?.recoveryClassification ?? null;
    if (
      checkpoint !== undefined &&
      (checkpoint.status === 'IN_PROGRESS' ||
        checkpoint.recoveryClassification === 'RECOVERY_REQUIRED' ||
        checkpoint.recoveryClassification === 'MANUAL_RECOVERY_REQUIRED')
    ) {
      // incomplete durable checkpoint forces recovery visibility
    }
  } catch (error: unknown) {
    if (error instanceof WorkflowLedgerError && error.code === 'CORRUPT_STATE') {
      checkpointCorrupt = true;
    } else {
      throw error;
    }
  }

  const recoveryRequired =
    inspection.classification === 'RECOVERY_REQUIRED' ||
    inspection.hasIncompleteApply ||
    inspection.hasBaselineDriftEvent ||
    durableCheckpointStatus === 'IN_PROGRESS' ||
    durableRecoveryClassification === 'RECOVERY_REQUIRED' ||
    durableRecoveryClassification === 'MANUAL_RECOVERY_REQUIRED' ||
    checkpointCorrupt;

  return {
    workflowId: inspection.workflowId,
    classification: checkpointCorrupt ? 'RECOVERY_REQUIRED' : inspection.classification,
    workflowState: inspection.manifest.workflowState,
    baselineDigest: inspection.manifest.baselineDigest ?? null,
    recoveryRequired,
    waitingForApproval: inspection.classification === 'WAITING_FOR_APPROVAL',
    staleApproval: inspection.hasStaleApproval,
    hasIncompleteApply: inspection.hasIncompleteApply,
    durableCheckpointStatus,
    durableRecoveryClassification,
    ...(checkpointCorrupt ? { corruptionDetected: true } : {}),
  };
}
