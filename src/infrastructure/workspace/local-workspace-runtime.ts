import 'server-only';

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { WorkspaceRuntimeService } from '../../application/workspace';
import { BlueprintReaderService } from '../../core/blueprint-reader';
import { ChangePlannerService } from '../../core/change-planner';
import { ContextBuilderService } from '../../core/context-builder';
import { FileApplyEngineService } from '../../core/file-apply';
import { parseProjectBrain } from '../../core/project-brain';
import { PromptOrchestratorService } from '../../core/prompt-orchestrator';
import { ResponseProcessorService } from '../../core/response-processor';
import { VerificationEngineService } from '../../core/verification';
import { createGeminiProvider, GeminiExecutionService } from '../../providers/gemini';
import { createOpenAIProvider, OpenAIExecutionService } from '../../providers/openai';
import { NodeFileSystemDocumentSource } from '../blueprint-reader';
import { NodeProjectFileSystem } from '../file-system';
import { NodeProjectFileSource } from '../project';
import {
  BoundedNpmCommandRunner,
  NodeBuildRunner,
  NodeDependencyValidator,
  NodeProjectValidator,
  NodeTestRunner,
} from '../verification';
import { loadLocalWorkspaceRuntimeConfiguration } from './local-runtime-configuration';
import { StructuredRuntimeLogger } from './structured-runtime-logger';

let singleton: WorkspaceRuntimeService | undefined;

export function getLocalWorkspaceRuntime(): WorkspaceRuntimeService {
  singleton ??= createLocalWorkspaceRuntime();
  return singleton;
}

function createLocalWorkspaceRuntime(): WorkspaceRuntimeService {
  const configuration = loadLocalWorkspaceRuntimeConfiguration();
  const documentSource = new NodeFileSystemDocumentSource(configuration.projectRoot);
  const blueprintReader = new BlueprintReaderService(documentSource);
  const providerExecution =
    configuration.provider.kind === 'openai'
      ? new OpenAIExecutionService(
          createOpenAIProvider(configuration.provider.settings, {
            apiKey: configuration.provider.apiKey,
          }),
          configuration.provider.settings,
        )
      : new GeminiExecutionService(
          createGeminiProvider(configuration.provider.settings, {
            apiKey: configuration.provider.apiKey,
          }),
          configuration.provider.settings,
        );
  const commandRunner = new BoundedNpmCommandRunner({
    projectRoot: configuration.projectRoot,
    commandTimeoutMs: configuration.verificationCommandTimeoutMs,
    maximumOutputBytes: configuration.verificationMaximumOutputBytes,
  });
  const projectValidator = new NodeProjectValidator(blueprintReader);
  return new WorkspaceRuntimeService({
    loadProjectBrain: () =>
      parseProjectBrain(
        JSON.parse(
          readFileSync(path.join(configuration.projectRoot, 'project-brain.json'), 'utf8'),
        ) as unknown,
      ),
    blueprintReader,
    sourceFiles: new NodeProjectFileSource(configuration.projectRoot),
    contextBuilder: new ContextBuilderService(),
    promptOrchestrator: new PromptOrchestratorService(),
    providerExecution,
    responseProcessor: new ResponseProcessorService(),
    changePlanner: new ChangePlannerService(),
    fileApply: new FileApplyEngineService(new NodeProjectFileSystem(configuration.projectRoot)),
    verification: new VerificationEngineService({
      projectValidator,
      dependencyValidator: new NodeDependencyValidator(commandRunner),
      buildRunner: new NodeBuildRunner(commandRunner),
      testRunner: new NodeTestRunner(commandRunner),
    }),
    clock: { now: () => new Date() },
    ids: { generate: randomUUID },
    logger: new StructuredRuntimeLogger(),
    configuration: configuration.workspace,
  });
}
