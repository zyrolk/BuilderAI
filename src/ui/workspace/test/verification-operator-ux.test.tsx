import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createOperationId, type ProjectChangePlan } from '../../../core/change-planner';
import type { FileApplyResult } from '../../../core/file-apply';
import type { VerificationReport } from '../../../core/verification';
import { WorkspaceShell } from '../workspace-shell';
import {
  APPLY_RESULT,
  CHANGE_PLAN,
  createGate2CorrectionWorkflow,
  createWorkflow,
  PROJECT_VIEW,
  VERIFICATION_REPORT,
} from './workspace.fixture';

function failedReport(
  stage: VerificationReport['stages'][number]['stage'],
  code: string,
): VerificationReport {
  return {
    schemaVersion: 1,
    status: 'FAILED',
    stages: VERIFICATION_REPORT.stages.map((entry) =>
      entry.stage === stage
        ? {
            ...entry,
            status: 'FAILED' as const,
            errors: [{ code, message: `${code} message` }],
          }
        : entry,
    ),
    warnings: [],
    errors: [{ stage, code, message: `${code} message` }],
    durationMs: 12,
    metadata: {},
  };
}

const PARTIALLY_APPLIED: FileApplyResult = {
  schemaVersion: 1,
  status: 'PARTIALLY_APPLIED',
  createdFiles: ['src/example.ts'],
  updatedFiles: [],
  deletedFiles: [],
  skippedFiles: ['src/missing.ts'],
  warnings: [],
  errors: [
    {
      code: 'FILESYSTEM_OPERATION_FAILED',
      message: 'Delete failed.',
      logicalPath: 'src/missing.ts',
    },
  ],
  durationMs: 3,
  metadata: {},
};

const BASELINE_DRIFT_RESULT: FileApplyResult = {
  schemaVersion: 1,
  status: 'FAILED',
  createdFiles: [],
  updatedFiles: [],
  deletedFiles: [],
  skippedFiles: [],
  warnings: [],
  errors: [
    {
      code: 'BASELINE_CONTENT_DRIFT',
      message: 'Disk content changed after prepare.',
      logicalPath: 'src/example.ts',
    },
  ],
  durationMs: 2,
  metadata: {},
};

const PACKAGE_JSON_PLAN: ProjectChangePlan = {
  ...CHANGE_PLAN,
  changeSet: {
    operations: [
      {
        operationId: createOperationId('UPDATE_FILE', 'package.json'),
        kind: 'UPDATE_FILE',
        logicalPath: 'package.json',
        artifactType: 'SOURCE_FILE',
        description: 'Add dependency',
        sourceChecksum: { algorithm: 'sha256', value: 'a'.repeat(64) },
        sourceSizeBytes: 10,
        content: '{ "dependencies": { "left-pad": "1.0.0" } }',
      },
    ],
  },
  summary: {
    filesCreated: [],
    filesUpdated: ['package.json'],
    filesDeleted: [],
    totalOperations: 1,
    warnings: [],
  },
};

async function runHappyPath(verify: () => Promise<VerificationReport>): Promise<void> {
  render(
    <WorkspaceShell project={PROJECT_VIEW} workflow={createGate2CorrectionWorkflow({ verify })} />,
  );
  fireEvent.change(screen.getByLabelText('Project request'), {
    target: { value: 'Create a focused example module.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Prepare change plan' }));
  await screen.findByRole('heading', { name: 'Review before applying' });
  fireEvent.click(screen.getByLabelText(/explicitly approve/i));
  fireEvent.click(screen.getByRole('button', { name: /approve and apply/i }));
  await waitFor(() => expect(screen.getAllByText('Workflow complete').length).toBeGreaterThan(0));
}

describe('Checkpoint 4 verification operator UX', () => {
  it('scenario 1 — full success path remains clear', async () => {
    await runHappyPath(async () => VERIFICATION_REPORT);
    expect(screen.getAllByText('Passed').length).toBeGreaterThan(0);
  });

  it('scenario 2 — build failure shows applied guidance and correction', async () => {
    const verify = vi.fn(async () => failedReport('BUILD_VALIDATION', 'BUILD_FAILED'));
    render(
      <WorkspaceShell
        project={PROJECT_VIEW}
        workflow={createGate2CorrectionWorkflow({ verify, apply: async () => APPLY_RESULT })}
      />,
    );
    fireEvent.change(screen.getByLabelText('Project request'), {
      target: { value: 'Update module.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare change plan' }));
    await screen.findByRole('heading', { name: 'Review before applying' });
    fireEvent.click(screen.getByLabelText(/explicitly approve/i));
    fireEvent.click(screen.getByRole('button', { name: /approve and apply/i }));
    expect(
      await screen.findByRole('button', { name: 'Fix verification failures' }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/file changes were applied, but verification failed/i).length,
    ).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('tab', { name: 'Verification Report' }));
    expect(await screen.findByText(/build failed/i)).toBeInTheDocument();
  });

  it('scenario 8 — partial apply shows recovery checklist without correction CTA', async () => {
    render(
      <WorkspaceShell
        project={PROJECT_VIEW}
        workflow={createGate2CorrectionWorkflow({
          apply: async () => PARTIALLY_APPLIED,
          verify: async () => VERIFICATION_REPORT,
        })}
      />,
    );
    fireEvent.change(screen.getByLabelText('Project request'), {
      target: { value: 'Update module.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare change plan' }));
    await screen.findByRole('heading', { name: 'Review before applying' });
    fireEvent.click(screen.getByLabelText(/explicitly approve/i));
    fireEvent.click(screen.getByRole('button', { name: /approve and apply/i }));
    expect(await screen.findByRole('button', { name: 'Start fresh prepare' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Apply Result' }));
    expect(await screen.findByText(/partial apply warning/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Fix verification failures' }),
    ).not.toBeInTheDocument();
  });

  it('scenario 9 — verification correction returns to Gate 2', async () => {
    const prepare = vi.fn(async (request: string, options?: { iterationFeedback?: unknown }) => {
      void request;
      void options;
      return {
        responsePackage: (await createWorkflow().prepare('x')).responsePackage,
        changePlan: CHANGE_PLAN,
        preparationId: 'prep-corrected-003',
        sourcePreparationId: 'prep-original-001',
        isCorrection: true,
      };
    });
    const workflow = createGate2CorrectionWorkflow({
      prepare,
      apply: async () => APPLY_RESULT,
      verify: async () => failedReport('TEST_VALIDATION', 'TEST_FAILED'),
    });

    render(<WorkspaceShell project={PROJECT_VIEW} workflow={workflow} />);
    fireEvent.change(screen.getByLabelText('Project request'), {
      target: { value: 'Fix tests.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare change plan' }));
    await screen.findByRole('heading', { name: 'Review before applying' });
    fireEvent.click(screen.getByLabelText(/explicitly approve/i));
    fireEvent.click(screen.getByRole('button', { name: /approve and apply/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Fix verification failures' }));
    await screen.findByRole('heading', { name: 'Review before applying' });
    expect(prepare).toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: /explicitly approve/i })).not.toBeChecked();
  });

  it('scenario 10 — baseline drift shows fresh-prepare guidance without correction', async () => {
    render(
      <WorkspaceShell
        project={PROJECT_VIEW}
        workflow={createGate2CorrectionWorkflow({ apply: async () => BASELINE_DRIFT_RESULT })}
      />,
    );
    fireEvent.change(screen.getByLabelText('Project request'), {
      target: { value: 'Update module.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare change plan' }));
    await screen.findByRole('heading', { name: 'Review before applying' });
    fireEvent.click(screen.getByLabelText(/explicitly approve/i));
    fireEvent.click(screen.getByRole('button', { name: /approve and apply/i }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Apply Result' }));
    expect(screen.getAllByText(/baseline drift/i).length).toBeGreaterThan(0);
    expect(
      screen.queryByRole('button', { name: 'Fix verification failures' }),
    ).not.toBeInTheDocument();
  });

  it('scenario 11 — package.json changes show dependency guidance at Gate 2', async () => {
    render(
      <WorkspaceShell
        project={PROJECT_VIEW}
        workflow={createGate2CorrectionWorkflow({
          prepare: async () => ({
            responsePackage: (await createWorkflow().prepare('x')).responsePackage,
            changePlan: PACKAGE_JSON_PLAN,
            preparationId: 'prep-deps-001',
          }),
        })}
      />,
    );
    fireEvent.change(screen.getByLabelText('Project request'), {
      target: { value: 'Add dependency.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare change plan' }));
    await screen.findByRole('heading', { name: 'Review before applying' });
    fireEvent.click(screen.getByRole('tab', { name: 'Change Plan' }));
    expect(await screen.findByText(/dependency change/i)).toBeInTheDocument();
    expect(screen.getByText(/npm install manually/i)).toBeInTheDocument();
  });
});
