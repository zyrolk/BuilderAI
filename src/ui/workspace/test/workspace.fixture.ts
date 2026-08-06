import { createOperationId, type ProjectChangePlan } from '../../../core/change-planner';
import type { Gate2ReviewProjection } from '../../../application/workspace/gate2-review';
import type { WorkspaceInvestigation } from '../../../application/workspace/investigation';
import { projectGate2ReviewForPlan } from '../../../application/workspace/gate2-review/gate2-review.fixture';
import type { FileApplyResult } from '../../../core/file-apply';
import type { ResponsePackage } from '../../../core/response-processor';
import type { VerificationReport } from '../../../core/verification';
import type {
  Gate2CorrectionCapableWorkflow,
  WorkspaceProjectView,
  WorkspaceWorkflowPort,
} from '../workspace.types';

export const PROJECT_VIEW: WorkspaceProjectView = {
  id: 'builder-ai',
  name: 'BuilderAI',
  vision: 'Build trustworthy software through controlled project context.',
  currentMilestone: 'UI foundation under review',
  architectureStatus: 'Core boundaries validated',
  moduleCount: 12,
  completedSprintCount: 11,
};

export const RESPONSE_PACKAGE: ResponsePackage = {
  schemaVersion: 1,
  executionResult: {
    schemaVersion: 1,
    executionId: 'execution-ui-001',
    status: 'COMPLETED',
    diagnostics: [],
    timing: {
      createdAt: '2026-07-31T11:00:00.000Z',
      finishedAt: '2026-07-31T11:00:01.000Z',
      durationMs: 1_000,
    },
    usage: { promptCharacters: 100, outputCharacters: 200, estimated: false },
    artifacts: [{ id: 'artifact-001', name: 'src/example.ts', kind: 'FILE', state: 'PLACEHOLDER' }],
    errors: [],
    metadata: { sprint: 12 },
  },
  generatedArtifacts: [
    {
      logicalPath: 'src/example.ts',
      type: 'SOURCE_FILE',
      content: 'export const example = true;\n',
      metadata: {
        'change-operation': 'CREATE_FILE',
        description: 'Add an example source file',
      },
    },
  ],
  manifest: {
    schemaVersion: 1,
    checksumAlgorithm: 'sha256',
    entries: [
      {
        logicalPath: 'src/example.ts',
        type: 'SOURCE_FILE',
        checksum: { algorithm: 'sha256', value: 'a'.repeat(64) },
        sizeBytes: 29,
        metadata: {
          'change-operation': 'CREATE_FILE',
          description: 'Add an example source file',
        },
      },
    ],
    totalSizeBytes: 29,
  },
  diagnostics: [],
  warnings: [],
  metadata: { sprint: 12 },
};

export const CHANGE_PLAN: ProjectChangePlan = {
  schemaVersion: 1,
  source: { responsePackageSchemaVersion: 1, executionId: 'execution-ui-001' },
  changeSet: {
    operations: [
      {
        operationId: createOperationId('CREATE_FILE', 'src/example.ts'),
        kind: 'CREATE_FILE',
        logicalPath: 'src/example.ts',
        artifactType: 'SOURCE_FILE',
        description: 'Add an example source file',
        sourceChecksum: { algorithm: 'sha256', value: 'a'.repeat(64) },
        sourceSizeBytes: 29,
        content: 'export const example = true;\n',
      },
    ],
  },
  summary: {
    filesCreated: ['src/example.ts'],
    filesUpdated: [],
    filesDeleted: [],
    totalOperations: 1,
    warnings: [],
  },
  risks: [
    {
      code: 'CREATE_FILE',
      severity: 'LOW',
      message: 'Creates a new source file.',
      operationIds: [createOperationId('CREATE_FILE', 'src/example.ts')],
    },
  ],
  warnings: [],
  metadata: { sprint: 12 },
};

export const GATE2_REVIEW: Gate2ReviewProjection = projectGate2ReviewForPlan(CHANGE_PLAN);

export const APPLY_RESULT: FileApplyResult = {
  schemaVersion: 1,
  status: 'APPLIED',
  createdFiles: ['src/example.ts'],
  updatedFiles: [],
  deletedFiles: [],
  skippedFiles: [],
  warnings: [],
  errors: [],
  durationMs: 4,
  metadata: { sprint: 12 },
};

export const REJECTED_APPLY_RESULT: FileApplyResult = {
  schemaVersion: 1,
  status: 'REJECTED',
  createdFiles: [],
  updatedFiles: [],
  deletedFiles: [],
  skippedFiles: ['src/example.ts'],
  warnings: [],
  errors: [
    {
      code: 'PROTECTED_PATH',
      message: 'The target is protected.',
      logicalPath: 'src/example.ts',
      operationId: createOperationId('CREATE_FILE', 'src/example.ts'),
    },
  ],
  durationMs: 2,
  metadata: { sprint: 12 },
};

export const FAILED_APPLY_RESULT: FileApplyResult = {
  schemaVersion: 1,
  status: 'FAILED',
  createdFiles: [],
  updatedFiles: [],
  deletedFiles: [],
  skippedFiles: [],
  warnings: [],
  errors: [
    {
      code: 'FILESYSTEM_OPERATION_FAILED',
      message: 'The create operation failed.',
      logicalPath: 'src/example.ts',
      operationId: createOperationId('CREATE_FILE', 'src/example.ts'),
    },
  ],
  durationMs: 2,
  metadata: { sprint: 12 },
};

export const PARTIALLY_APPLIED_RESULT: FileApplyResult = {
  schemaVersion: 1,
  status: 'PARTIALLY_APPLIED',
  createdFiles: ['src/example.ts'],
  updatedFiles: [],
  deletedFiles: [],
  skippedFiles: ['src/obsolete.ts'],
  warnings: [],
  errors: [
    {
      code: 'FILESYSTEM_OPERATION_FAILED',
      message: 'The delete operation failed midway through the plan.',
      logicalPath: 'src/obsolete.ts',
      operationId: createOperationId('DELETE_FILE', 'src/obsolete.ts'),
    },
  ],
  durationMs: 3,
  metadata: { sprint: 12 },
};

export const VERIFICATION_REPORT: VerificationReport = {
  schemaVersion: 1,
  status: 'PASSED',
  // BUILD_VALIDATION and TEST_VALIDATION carry representative safe scalar stage metadata (P1-8): a
  // string, a number, and a boolean, matching the shape NodeBuildRunner/NodeTestRunner produce.
  stages: (
    [
      ['PROJECT_VALIDATION', {}],
      ['DEPENDENCY_VALIDATION', {}],
      ['BUILD_VALIDATION', { 'exit-code': 0, 'package-manager': 'npm' }],
      ['TEST_VALIDATION', { 'exit-code': 0, 'output-bytes': 482, 'output-truncated': false }],
      ['LINT_VALIDATION', { skipped: true }],
      ['TYPECHECK_VALIDATION', { skipped: true }],
    ] as const
  ).map(([stage, metadata]) => ({
    stage,
    status: 'PASSED' as const,
    warnings: [],
    errors: [],
    durationMs: 3,
    metadata,
  })),
  warnings: [],
  errors: [],
  durationMs: 12,
  metadata: { sprint: 12 },
};

export const CORRECTED_CHANGE_PLAN: ProjectChangePlan = {
  ...CHANGE_PLAN,
  source: { responsePackageSchemaVersion: 1, executionId: 'execution-ui-002' },
  summary: {
    ...CHANGE_PLAN.summary,
    filesCreated: ['src/example-corrected.ts'],
  },
  changeSet: {
    operations: [
      {
        ...CHANGE_PLAN.changeSet.operations[0]!,
        operationId: createOperationId('CREATE_FILE', 'src/example-corrected.ts'),
        logicalPath: 'src/example-corrected.ts',
      },
    ],
  },
};

export function createWorkflow(
  overrides: Partial<WorkspaceWorkflowPort> = {},
): WorkspaceWorkflowPort {
  return {
    prepare: async () => ({
      responsePackage: RESPONSE_PACKAGE,
      changePlan: CHANGE_PLAN,
      preparationId: 'prep-original-001',
      gate2Review: GATE2_REVIEW,
    }),
    investigate: async (request: string): Promise<WorkspaceInvestigation> => ({
      investigationId: 'investigation-fixture-001',
      request,
      bounded: false,
      searchResult: {
        queries: ['fixture'],
        matches: [],
        filesScanned: 0,
        truncated: false,
        limitationMessages: [],
      },
      report: {
        schemaVersion: 1,
        investigationId: 'investigation-fixture-001',
        summary: 'Fixture investigation summary.',
        confidence: 'LOW',
        hypotheses: [],
        evidence: [],
        affectedAreas: [],
        recommendedNextSteps: ['Prepare a focused fix through Gate 2.'],
        limitations: [],
      },
    }),
    apply: async () => APPLY_RESULT,
    verify: async () => VERIFICATION_REPORT,
    ...overrides,
  };
}

export function createGate2CorrectionWorkflow(
  overrides: Partial<Gate2CorrectionCapableWorkflow> = {},
): Gate2CorrectionCapableWorkflow & {
  readonly getLastAppliedPreparationId: () => string | undefined;
} {
  let currentPreparationId = 'prep-original-001';
  let lastAppliedPreparationId: string | undefined;

  const workflow: Gate2CorrectionCapableWorkflow & {
    getLastAppliedPreparationId: () => string | undefined;
  } = {
    prepare: async () => {
      currentPreparationId = 'prep-original-001';
      return {
        responsePackage: RESPONSE_PACKAGE,
        changePlan: CHANGE_PLAN,
        preparationId: currentPreparationId,
        gate2Review: GATE2_REVIEW,
      };
    },
    prepareGate2PreservationCorrection: async (_request, _changePlan, preparationId) => {
      currentPreparationId = 'prep-corrected-002';
      return {
        responsePackage: RESPONSE_PACKAGE,
        changePlan: CORRECTED_CHANGE_PLAN,
        preparationId: currentPreparationId,
        sourcePreparationId: preparationId,
        isCorrection: true,
        gate2Review: projectGate2ReviewForPlan(CORRECTED_CHANGE_PLAN),
      };
    },
    apply: async () => {
      lastAppliedPreparationId = currentPreparationId;
      return APPLY_RESULT;
    },
    verify: async () => VERIFICATION_REPORT,
    getLastAppliedPreparationId: () => lastAppliedPreparationId,
    ...overrides,
  };

  return workflow;
}
