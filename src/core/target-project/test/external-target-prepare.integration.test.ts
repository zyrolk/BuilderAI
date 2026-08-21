import path from 'node:path';

import { ChangePlannerService } from '../../change-planner';
import { ContextBuilderService } from '../../context-builder';
import { FileApplyEngineService } from '../../file-apply';
import { InMemoryFileSystemPort } from '../../file-apply/test/file-apply.fixture';
import { PromptOrchestratorService } from '../../prompt-orchestrator';
import { ResponseProcessorService } from '../../response-processor';
import { VerificationEngineService } from '../../verification';
import { createPortHarness } from '../../verification/test/verification.fixture';
import { NullWorkspaceBaselinePort } from '../../update-scope/test/workspace-baseline.fixture';
import { NodeFileSystemDocumentSource } from '../../../infrastructure/blueprint-reader';
import { NodeProjectFileSource } from '../../../infrastructure/project';
import { NodeProjectValidator } from '../../../infrastructure/verification';
import {
  OpenAIExecutionService,
  OpenAIProvider,
  type OpenAIProviderConfiguration,
} from '../../../providers/openai';
import { WorkspaceRuntimeService } from '../../../application/workspace/workspace-runtime.service';
import { createProjectContextReader, loadWorkspaceProjectBrain } from '../index';
import { ZYRO_STYLE_FIXTURE_ROOT } from './external-target.fixture';

const configuration: OpenAIProviderConfiguration = {
  model: 'integration-model',
  defaultTimeoutMs: 30_000,
  maximumTimeoutMs: 120_000,
  maximumInputCharacters: 1_000_000,
  maximumOutputCharacters: 100_000,
  maximumOutputTokens: 10_000,
};

describe('external target workspace prepare integration', () => {
  it('reaches the mocked provider boundary for the synthetic Zyro-style fixture', async () => {
    const documentSource = new NodeFileSystemDocumentSource(ZYRO_STYLE_FIXTURE_ROOT);
    const blueprintReader = createProjectContextReader({
      profile: 'EXTERNAL_TARGET',
      projectRoot: ZYRO_STYLE_FIXTURE_ROOT,
      source: documentSource,
    });
    const projectValidator = new NodeProjectValidator(blueprintReader);
    const verification = createPortHarness();
    const provider = new OpenAIProvider(
      configuration,
      {
        create: async () => ({
          id: 'response-external-target',
          model: 'integration-model',
          status: 'completed',
          output_text: JSON.stringify({
            summary: 'Created an external-target artifact.',
            artifacts: [
              {
                logicalPath: 'src/external-output.ts',
                type: 'SOURCE_FILE',
                content: 'export const external = true;\n',
                metadata: {
                  description: 'Create the external artifact',
                  'change-operation': 'CREATE_FILE',
                },
              },
            ],
            diagnostics: [],
          }),
          error: null,
          usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
        }),
      },
      () => '2026-08-04T12:00:00.000Z',
    );
    const service = new WorkspaceRuntimeService({
      loadProjectBrain: () => loadWorkspaceProjectBrain(ZYRO_STYLE_FIXTURE_ROOT, 'EXTERNAL_TARGET'),
      blueprintReader,
      sourceFiles: new NodeProjectFileSource(ZYRO_STYLE_FIXTURE_ROOT),
      contextBuilder: new ContextBuilderService(),
      promptOrchestrator: new PromptOrchestratorService(),
      workspaceBaseline: new NullWorkspaceBaselinePort(),
      providerExecution: new OpenAIExecutionService(provider, configuration),
      responseProcessor: new ResponseProcessorService(),
      changePlanner: new ChangePlannerService(),
      fileApply: new FileApplyEngineService(new InMemoryFileSystemPort()),
      verification: new VerificationEngineService({
        ...verification.ports,
        projectValidator,
      }),
      clock: { now: () => new Date('2026-08-04T12:00:00.000Z') },
      ids: { generate: () => '123e4567-e89b-12d3-a456-426614174000' },
      logger: { record: () => undefined },
      projectRoot: ZYRO_STYLE_FIXTURE_ROOT,
    });

    const preparation = await service.prepare('Add an external-target integration artifact.');

    expect(preparation.changePlan.changeSet.operations).toHaveLength(1);
    expect(preparation.changePlan.changeSet.operations[0]?.logicalPath).toBe(
      'src/external-output.ts',
    );
    expect(path.isAbsolute(ZYRO_STYLE_FIXTURE_ROOT)).toBe(true);
  }, 30_000);
});
