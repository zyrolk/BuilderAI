import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ChangePlannerService } from '../../core/change-planner';
import { ContextBuilderService } from '../../core/context-builder';
import { FileApplyEngineService } from '../../core/file-apply';
import { InMemoryFileSystemPort } from '../../core/file-apply/test/file-apply.fixture';
import { PromptOrchestratorService } from '../../core/prompt-orchestrator';
import { ResponseProcessorService } from '../../core/response-processor';
import {
  VerificationEngineService,
  type VerificationStagePortResult,
} from '../../core/verification';
import { createPortHarness } from '../../core/verification/test/verification.fixture';
import { NullWorkspaceBaselinePort } from '../../core/update-scope/test/workspace-baseline.fixture';
import { createProjectContextReader, loadWorkspaceProjectBrain } from '../../core/target-project';
import { ZYRO_STYLE_FIXTURE_ROOT } from '../../core/target-project/test/external-target.fixture';
import { NodeFileSystemDocumentSource } from '../../infrastructure/blueprint-reader';
import { NodeProjectFileSource } from '../../infrastructure/project';
import { NodeProjectValidator } from '../../infrastructure/verification';
import {
  OpenAIExecutionService,
  OpenAIProvider,
  type OpenAIProviderConfiguration,
} from '../../providers/openai';
import { ProjectMemoryService } from './project-memory/project-memory.service';
import { WorkspaceRuntimeService } from './workspace-runtime.service';

const configuration: OpenAIProviderConfiguration = {
  model: 'integration-model',
  defaultTimeoutMs: 30_000,
  maximumTimeoutMs: 30_000,
  maximumInputCharacters: 1_000_000,
  maximumOutputCharacters: 100_000,
  maximumOutputTokens: 10_000,
};

const FAILED_STAGE_RESULT: VerificationStagePortResult = {
  status: 'FAILED',
  warnings: [],
  errors: [{ code: 'TEST_FAILED', message: 'Simulated test failure.' }],
  metadata: { 'exit-code': 1 },
};

class ThrowingFileApplyEngineService extends FileApplyEngineService {
  override async apply(): Promise<never> {
    throw new Error('apply failed before FileApplyResult');
  }
}

function createExternalTargetFixture(): { readonly root: string; readonly cleanup: () => void } {
  const root = mkdtempSync(path.join(tmpdir(), 'builderai-runtime-memory-'));
  cpSync(ZYRO_STYLE_FIXTURE_ROOT, root, { recursive: true });
  writeFileSync(
    path.join(root, '.builderai', 'target-project.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        projectId: 'zyro-style-fixture',
        name: 'Memory Runtime Fixture',
        vision: 'Fixture for runtime memory regression.',
        currentMilestone: 'CP9',
        protectedAreas: ['server/secrets/'],
        folderOwnership: [],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function createExternalTargetRuntimeService(input: {
  readonly root: string;
  readonly verificationPorts: ConstructorParameters<typeof VerificationEngineService>[0];
  readonly fileApply: FileApplyEngineService;
  readonly providerResponse?: unknown;
}): WorkspaceRuntimeService {
  const documentSource = new NodeFileSystemDocumentSource(input.root);
  const blueprintReader = createProjectContextReader({
    profile: 'EXTERNAL_TARGET',
    projectRoot: input.root,
    source: documentSource,
  });
  const provider = new OpenAIProvider(
    configuration,
    {
      create: async () =>
        (input.providerResponse as object | undefined) ?? {
          id: 'response-integration',
          model: 'integration-model',
          status: 'completed',
          output_text: JSON.stringify({
            summary: 'Created an integration artifact.',
            artifacts: [
              {
                logicalPath: 'src/integration-output.ts',
                type: 'SOURCE_FILE',
                content: 'export const integrated = true;\n',
                metadata: {
                  description: 'Create the integration artifact',
                  'change-operation': 'CREATE_FILE',
                },
              },
            ],
            diagnostics: [],
          }),
          error: null,
          usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
        },
    },
    () => '2026-08-05T12:00:00.000Z',
  );
  return new WorkspaceRuntimeService({
    loadProjectBrain: () => loadWorkspaceProjectBrain(input.root, 'EXTERNAL_TARGET'),
    blueprintReader,
    sourceFiles: new NodeProjectFileSource(input.root),
    contextBuilder: new ContextBuilderService(),
    promptOrchestrator: new PromptOrchestratorService(),
    workspaceBaseline: new NullWorkspaceBaselinePort(),
    providerExecution: new OpenAIExecutionService(provider, configuration),
    responseProcessor: new ResponseProcessorService(),
    changePlanner: new ChangePlannerService(),
    fileApply: input.fileApply,
    verification: new VerificationEngineService({
      ...input.verificationPorts,
      projectValidator: new NodeProjectValidator(blueprintReader),
    }),
    clock: { now: () => new Date('2026-08-05T12:00:00.000Z') },
    ids: { generate: () => '123e4567-e89b-12d3-a456-426614174000' },
    logger: { record: () => undefined },
    projectRoot: input.root,
    projectMemory: new ProjectMemoryService({
      projectRoot: input.root,
      projectId: 'zyro-style-fixture',
      profile: 'EXTERNAL_TARGET',
      ids: { generate: () => 'memory-record-00000001' },
    }),
  });
}

describe('CP8 completed-work memory runtime regression', () => {
  it('scenario 13 — apply FAILED does not create completed-work memory', async () => {
    const fixture = createExternalTargetFixture();
    try {
      const service = createExternalTargetRuntimeService({
        root: fixture.root,
        verificationPorts: createPortHarness().ports,
        fileApply: new ThrowingFileApplyEngineService(new InMemoryFileSystemPort()),
      });
      const preparation = await service.prepare('Create the approved integration artifact.');
      await expect(service.approveAndApply(preparation.preparationId, true)).rejects.toThrow(
        'apply failed before FileApplyResult',
      );
      const memory = new ProjectMemoryService({
        projectRoot: fixture.root,
        projectId: 'zyro-style-fixture',
        profile: 'EXTERNAL_TARGET',
      });
      expect((await memory.read()).completedWork).toHaveLength(0);
    } finally {
      fixture.cleanup();
    }
  }, 30_000);

  it('scenario 14 — PARTIALLY_APPLIED does not create completed-work memory', async () => {
    const fixture = createExternalTargetFixture();
    try {
      const fileSystem = new InMemoryFileSystemPort();
      fileSystem.failMutationPath = 'src/second-output.ts';
      const service = createExternalTargetRuntimeService({
        root: fixture.root,
        verificationPorts: createPortHarness().ports,
        fileApply: new FileApplyEngineService(fileSystem),
        providerResponse: {
          id: 'response-partial',
          model: 'integration-model',
          status: 'completed',
          output_text: JSON.stringify({
            summary: 'Creates two artifacts.',
            artifacts: [
              {
                logicalPath: 'src/first-output.ts',
                type: 'SOURCE_FILE',
                content: 'export const first = true;\n',
                metadata: {
                  description: 'Create the first artifact',
                  'change-operation': 'CREATE_FILE',
                },
              },
              {
                logicalPath: 'src/second-output.ts',
                type: 'SOURCE_FILE',
                content: 'export const second = true;\n',
                metadata: {
                  description: 'Create the second artifact',
                  'change-operation': 'CREATE_FILE',
                },
              },
            ],
            diagnostics: [],
          }),
          error: null,
          usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
        },
      });
      const preparation = await service.prepare('Create two approved integration artifacts.');
      const completion = await service.approveAndApply(preparation.preparationId, true);
      expect(completion.applyResult.status).toBe('PARTIALLY_APPLIED');
      const memory = new ProjectMemoryService({
        projectRoot: fixture.root,
        projectId: 'zyro-style-fixture',
        profile: 'EXTERNAL_TARGET',
      });
      expect((await memory.read()).completedWork).toHaveLength(0);
    } finally {
      fixture.cleanup();
    }
  }, 30_000);

  it('scenario 15 — APPLIED plus verification FAILED does not create completed-work memory', async () => {
    const fixture = createExternalTargetFixture();
    try {
      const verification = createPortHarness({ TEST_VALIDATION: FAILED_STAGE_RESULT });
      const service = createExternalTargetRuntimeService({
        root: fixture.root,
        verificationPorts: verification.ports,
        fileApply: new FileApplyEngineService(new InMemoryFileSystemPort()),
      });
      const preparation = await service.prepare('Create the approved integration artifact.');
      const completion = await service.approveAndApply(preparation.preparationId, true);
      expect(completion.applyResult.status).toBe('APPLIED');
      expect(completion.verificationReport?.status).toBe('PARTIALLY_PASSED');
      const memory = new ProjectMemoryService({
        projectRoot: fixture.root,
        projectId: 'zyro-style-fixture',
        profile: 'EXTERNAL_TARGET',
      });
      expect((await memory.read()).completedWork).toHaveLength(0);
    } finally {
      fixture.cleanup();
    }
  }, 30_000);

  it('scenario 16 — APPLIED plus PASSED creates one entry and replay does not duplicate', async () => {
    const fixture = createExternalTargetFixture();
    try {
      const service = createExternalTargetRuntimeService({
        root: fixture.root,
        verificationPorts: createPortHarness().ports,
        fileApply: new FileApplyEngineService(new InMemoryFileSystemPort()),
      });
      const preparation = await service.prepare('Create the approved integration artifact.');
      await service.approveAndApply(preparation.preparationId, true);
      await service.approveAndApply(preparation.preparationId, true);
      const memory = new ProjectMemoryService({
        projectRoot: fixture.root,
        projectId: 'zyro-style-fixture',
        profile: 'EXTERNAL_TARGET',
      });
      expect((await memory.read()).completedWork).toHaveLength(1);
    } finally {
      fixture.cleanup();
    }
  }, 30_000);
});
