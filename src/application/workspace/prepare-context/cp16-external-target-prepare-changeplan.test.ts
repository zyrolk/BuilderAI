import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ProviderOutputTruncatedError } from '../../../core/ai-provider';
import { ChangePlannerService, ChangePlanValidationError } from '../../../core/change-planner';
import type {
  WorkspaceBaselinePort,
  WorkspaceVisibilityPort,
} from '../../../core/change-planner/ports';
import {
  ContextBuilderService,
  type ContextBuildInput,
  type ContextPackage,
  type ProjectFileSource,
} from '../../../core/context-builder';
import type { ExecutionRequest } from '../../../core/execution-engine';
import { FileApplyEngineService } from '../../../core/file-apply';
import { InMemoryFileSystemPort } from '../../../core/file-apply/test/file-apply.fixture';
import { loadCanonicalProjectBrain } from '../../../core/project-brain';
import {
  PromptOrchestratorService,
  type PromptBuildInput,
  type PromptPackage,
} from '../../../core/prompt-orchestrator';
import { ResponseProcessorService } from '../../../core/response-processor';
import {
  createProjectContextReader,
  loadWorkspaceProjectBrain,
} from '../../../core/target-project';
import { ZYRO_STYLE_FIXTURE_ROOT } from '../../../core/target-project/test/external-target.fixture';
import { createWorkspacePathProtectionPolicyFromManifest } from '../../../core/target-project/workspace-path-protection';
import {
  MemoryWorkspaceBaselinePort,
  NullWorkspaceBaselinePort,
} from '../../../core/update-scope/test/workspace-baseline.fixture';
import { VerificationEngineService } from '../../../core/verification';
import { createPortHarness } from '../../../core/verification/test/verification.fixture';
import { BlueprintReaderService } from '../../../core/blueprint-reader';
import { NodeFileSystemDocumentSource } from '../../../infrastructure/blueprint-reader';
import { NodeProjectFileSource } from '../../../infrastructure/project';
import { NodeProjectValidator } from '../../../infrastructure/verification';
import {
  OpenAIExecutionService,
  OpenAIProvider,
  type OpenAIProviderConfiguration,
} from '../../../providers/openai';
import type { ExternalTargetReadiness } from '../external-target-readiness';
import {
  buildInvestigationHandoffFeedback,
  type InvestigationHandoffFeedback,
} from '../investigation/investigation-handoff';
import type { ProviderExecutionPort } from '../workspace-runtime.types';
import { WorkspaceRuntimeService } from '../workspace-runtime.service';

const configuration: OpenAIProviderConfiguration = {
  model: 'integration-model',
  defaultTimeoutMs: 30_000,
  maximumTimeoutMs: 120_000,
  maximumInputCharacters: 1_000_000,
  maximumOutputCharacters: 100_000,
  maximumOutputTokens: 10_000,
};

const INVESTIGATION_REQUEST =
  'Investigate why supplier PRICE_CHANGED comparisons involving Cost Price may not be preserved correctly when supplier sync settings are enabled. Do not change anything.';

const PREPARE_REQUEST =
  'Improve regression coverage for the already-implemented supplier sync settings behavior. Only modify tests/supplierSyncSettings.test.ts. Add a small regression assertion around the existing PRICE_CHANGED comparison behavior when the sync flags remain enabled. Do not modify production source or any other file.';

const TEST_FILE_PATH = 'tests/supplierSyncSettings.test.ts';
const SERVICE_FILE_PATH = 'src/services/supplierSyncSettings.ts';
const TEST_FILE_CONTENT =
  "describe('supplierSyncSettings PRICE_CHANGED', () => { it('preserves Cost Price', () => {}); });\n";
const UPDATED_TEST_CONTENT = `${TEST_FILE_CONTENT}it('keeps PRICE_CHANGED comparison when sync flags stay enabled', () => {});\n`;
const NEVER_EXPOSE_SECRET_MARKER = 'BUILDERAI_NEVER_EXPOSE_SECRET_MARKER_9f7a4c2e';

class RecordingContextBuilder extends ContextBuilderService {
  lastInput?: ContextBuildInput;
  lastContext?: ContextPackage;

  override async build(
    input: ContextBuildInput,
    ...parameters: Parameters<ContextBuilderService['build']> extends [
      ContextBuildInput,
      ...infer Rest,
    ]
      ? Rest
      : never
  ) {
    this.lastInput = input;
    this.lastContext = await super.build(input, ...parameters);
    return this.lastContext;
  }
}

class RecordingPromptOrchestrator extends PromptOrchestratorService {
  lastBuildInput?: PromptBuildInput;
  lastPrompt?: PromptPackage;

  override async build(
    input: PromptBuildInput,
    ...parameters: Parameters<PromptOrchestratorService['build']> extends [
      PromptBuildInput,
      ...infer Rest,
    ]
      ? Rest
      : never
  ) {
    this.lastBuildInput = input;
    this.lastPrompt = await super.build(input, ...parameters);
    return this.lastPrompt;
  }
}

class RecordingProjectFileSource implements ProjectFileSource {
  readonly reads: string[] = [];

  constructor(private readonly delegate: ProjectFileSource) {}

  listSourcePaths(): Promise<readonly string[]> {
    return this.delegate.listSourcePaths();
  }

  readSourceFile(logicalPath: string): Promise<string> {
    this.reads.push(logicalPath);
    return this.delegate.readSourceFile(logicalPath);
  }
}

class RecordingWorkspaceBaseline implements WorkspaceBaselinePort {
  readonly reads: string[] = [];

  constructor(private readonly delegate: WorkspaceBaselinePort) {}

  readTextBaseline(logicalPath: string) {
    this.reads.push(logicalPath);
    return this.delegate.readTextBaseline(logicalPath);
  }
}

class TruncateFirstPrepareExecution implements ProviderExecutionPort {
  readonly prompts: PromptPackage[] = [];

  constructor(private readonly delegate: ProviderExecutionPort) {}

  execute(request: ExecutionRequest) {
    this.prompts.push(structuredClone(request.prompt));
    if (this.prompts.length === 1) {
      throw new ProviderOutputTruncatedError('integration-provider');
    }
    return this.delegate.execute(request);
  }
}

function fakeVisibility(files: readonly string[]): WorkspaceVisibilityPort {
  const existing = new Set(files);
  return {
    directoryExists: (logicalPath) =>
      logicalPath === '.' ||
      files.some((file) => file === logicalPath || file.startsWith(`${logicalPath}/`)),
    fileExists: (logicalPath) => existing.has(logicalPath),
  };
}

function createSupplierSyncFixture(): { readonly root: string; readonly cleanup: () => void } {
  const root = mkdtempSync(path.join(tmpdir(), 'builderai-cp16-'));
  cpSync(ZYRO_STYLE_FIXTURE_ROOT, root, { recursive: true });
  writeFileSync(
    path.join(root, '.builderai', 'target-project.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        projectId: 'zyro-style-fixture',
        name: 'CP16 Fixture',
        vision: 'Fixture for investigation prepare ChangePlan regression.',
        currentMilestone: 'CP16',
        protectedAreas: ['server/secrets/'],
        folderOwnership: [],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  mkdirSync(path.join(root, 'tests'), { recursive: true });
  mkdirSync(path.join(root, 'src/services'), { recursive: true });
  writeFileSync(path.join(root, TEST_FILE_PATH), TEST_FILE_CONTENT, 'utf8');
  writeFileSync(
    path.join(root, SERVICE_FILE_PATH),
    'export function compareSupplierPriceChanged() { return true; }\n',
    'utf8',
  );
  mkdirSync(path.join(root, 'server/secrets'), { recursive: true });
  writeFileSync(
    path.join(root, 'server/secrets/api-config.json'),
    `${JSON.stringify({ token: NEVER_EXPOSE_SECRET_MARKER })}\n`,
    'utf8',
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function readyReadiness(root: string): ExternalTargetReadiness {
  return {
    schemaVersion: 1,
    status: 'READY',
    profile: 'EXTERNAL_TARGET',
    projectId: 'zyro-style-fixture',
    projectName: 'CP16 Fixture',
    projectRootDisplay: root,
    runtimeConnected: true,
    sourceRoots: ['src'],
    testRoots: ['tests'],
    governanceDocuments: [],
    indexedFileCount: 2,
    protectedAreas: [{ path: 'server/secrets/', classification: 'MUTATION_PROTECTED' }],
    verification: {
      build: true,
      test: true,
      lint: true,
      typecheck: true,
      format: false,
      devServer: true,
      browserVerification: true,
    },
    warnings: [],
    blockers: [],
  };
}

function createProviderResponse(output: {
  readonly summary: string;
  readonly artifacts: readonly {
    readonly logicalPath: string;
    readonly content: string;
    readonly changeOperation: 'CREATE_FILE' | 'UPDATE_FILE' | 'DELETE_FILE';
    readonly description: string;
  }[];
}) {
  return {
    id: 'response-cp16',
    model: 'integration-model',
    status: 'completed',
    output_text: JSON.stringify({
      summary: output.summary,
      artifacts: output.artifacts.map((artifact) => ({
        logicalPath: artifact.logicalPath,
        type: 'SOURCE_FILE',
        content: artifact.content,
        metadata: {
          description: artifact.description,
          'change-operation': artifact.changeOperation,
        },
      })),
      diagnostics: [],
    }),
    error: null,
    usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 },
  };
}

function createRuntime(input: {
  readonly root: string;
  readonly contextBuilder: RecordingContextBuilder;
  readonly promptOrchestrator: RecordingPromptOrchestrator;
  readonly providerResponse: ReturnType<typeof createProviderResponse>;
  readonly existingFiles?: readonly string[];
  readonly baselineFiles?: Readonly<Record<string, string>>;
  readonly pathProtectionManifest?: readonly string[];
  readonly sourceFiles?: ProjectFileSource;
  readonly workspaceBaseline?: WorkspaceBaselinePort;
  readonly providerRequests?: unknown[];
  readonly decorateProviderExecution?: (delegate: ProviderExecutionPort) => ProviderExecutionPort;
}) {
  const documentSource = new NodeFileSystemDocumentSource(input.root);
  const blueprintReader = createProjectContextReader({
    profile: 'EXTERNAL_TARGET',
    projectRoot: input.root,
    source: documentSource,
  });
  const pathProtection = createWorkspacePathProtectionPolicyFromManifest(
    input.pathProtectionManifest ?? ['server/secrets/'],
  );
  const existingFiles = input.existingFiles ?? [
    TEST_FILE_PATH,
    SERVICE_FILE_PATH,
    'server/secrets/api-config.json',
  ];
  const provider = new OpenAIProvider(
    configuration,
    {
      create: async (request) => {
        input.providerRequests?.push(structuredClone(request));
        return input.providerResponse;
      },
    },
    () => '2026-08-08T12:00:00.000Z',
  );
  const verificationPorts = createPortHarness().ports;
  const providerExecution = new OpenAIExecutionService(provider, configuration);
  return new WorkspaceRuntimeService({
    loadProjectBrain: () => loadWorkspaceProjectBrain(input.root, 'EXTERNAL_TARGET'),
    blueprintReader,
    sourceFiles: input.sourceFiles ?? new NodeProjectFileSource(input.root),
    contextBuilder: input.contextBuilder,
    promptOrchestrator: input.promptOrchestrator,
    workspaceBaseline:
      input.workspaceBaseline ??
      new MemoryWorkspaceBaselinePort(
        input.baselineFiles ?? {
          [TEST_FILE_PATH]: TEST_FILE_CONTENT,
          'server/secrets/api-config.json': '{"token":"old"}\n',
        },
      ),
    providerExecution: input.decorateProviderExecution?.(providerExecution) ?? providerExecution,
    responseProcessor: new ResponseProcessorService(),
    changePlanner: new ChangePlannerService(undefined, fakeVisibility(existingFiles)),
    fileApply: new FileApplyEngineService(
      new InMemoryFileSystemPort({
        [TEST_FILE_PATH]: TEST_FILE_CONTENT,
        'server/secrets/api-config.json': '{"token":"old"}\n',
      }),
      pathProtection.toFileApplyConfiguration(),
    ),
    verification: new VerificationEngineService({
      ...verificationPorts,
      projectValidator: new NodeProjectValidator(blueprintReader),
    }),
    clock: { now: () => new Date('2026-08-08T12:00:00.000Z') },
    ids: { generate: () => '123e4567-e89b-12d3-a456-426614174000' },
    logger: { record: () => undefined },
    projectRoot: input.root,
    projectProfile: 'EXTERNAL_TARGET',
    pathProtection,
    evaluateExternalTargetReadiness: async () => readyReadiness(input.root),
  });
}

function buildHandoff() {
  return buildInvestigationHandoffFeedback({
    sourceInvestigationId: 'inv-cp16',
    priorRequestSummary: INVESTIGATION_REQUEST,
    investigationSummary:
      'Repository evidence points to supplier sync settings implementation and regression tests.',
    sourcePaths: [TEST_FILE_PATH, SERVICE_FILE_PATH],
    requestText: INVESTIGATION_REQUEST,
    queries: ['PRICE_CHANGED', 'supplierSyncSettings'],
    evidence: [
      {
        logicalPath: TEST_FILE_PATH,
        reason: 'Repository search matched supplierSyncSettings.',
        excerpt: 'PRICE_CHANGED',
        claimKind: 'FACT',
      },
    ],
    searchMatches: [],
    hypotheses: [],
    affectedAreas: [SERVICE_FILE_PATH],
  });
}

function buildProtectedPathHandoff(): InvestigationHandoffFeedback {
  return {
    schemaVersion: 1,
    kind: 'INVESTIGATION_HANDOFF',
    sourceInvestigationId: 'inv-never-expose',
    priorRequestSummary: 'Read-only repository investigation.',
    investigationSummary: 'Safe implementation evidence was found without reading secrets.',
    suggestedFixScope: `Update ${SERVICE_FILE_PATH}.`,
    pathHints: [
      SERVICE_FILE_PATH,
      'server/secrets/api-config.json',
      'SERVER/SECRETS/API-CONFIG.JSON',
      'server\\secrets\\api-config.json',
    ],
    existingPathHints: [SERVICE_FILE_PATH, './server/secrets/api-config.json'],
    candidatePathHints: ['server/secrets/future-config.json', '../server/secrets/api-config.json'],
  };
}

describe('CP16 external-target investigation prepare ChangePlan generation', () => {
  it('scenario 1 — explicit existing-file UPDATE produces UPDATE_FILE', async () => {
    const fixture = createSupplierSyncFixture();
    try {
      const service = createRuntime({
        root: fixture.root,
        contextBuilder: new RecordingContextBuilder(),
        promptOrchestrator: new RecordingPromptOrchestrator(),
        providerResponse: createProviderResponse({
          summary: 'Add PRICE_CHANGED regression assertion.',
          artifacts: [
            {
              logicalPath: TEST_FILE_PATH,
              content: UPDATED_TEST_CONTENT,
              changeOperation: 'UPDATE_FILE',
              description: 'Add regression assertion for PRICE_CHANGED comparison.',
            },
          ],
        }),
      });
      const preparation = await service.prepare(PREPARE_REQUEST, buildHandoff());
      expect(preparation.changePlan.changeSet.operations).toHaveLength(1);
      expect(preparation.changePlan.changeSet.operations[0]?.kind).toBe('UPDATE_FILE');
      expect(preparation.changePlan.changeSet.operations[0]?.logicalPath).toBe(TEST_FILE_PATH);
      expect(preparation.gate2Review.operationDiffs).toHaveLength(1);
    } finally {
      fixture.cleanup();
    }
  }, 30_000);

  it('scenario 2 — existing file cannot become CREATE_FILE', async () => {
    const fixture = createSupplierSyncFixture();
    try {
      const service = createRuntime({
        root: fixture.root,
        contextBuilder: new RecordingContextBuilder(),
        promptOrchestrator: new RecordingPromptOrchestrator(),
        providerResponse: createProviderResponse({
          summary: 'Attempted create on existing test file.',
          artifacts: [
            {
              logicalPath: TEST_FILE_PATH,
              content: UPDATED_TEST_CONTENT,
              changeOperation: 'CREATE_FILE',
              description: 'Recreate test file.',
            },
          ],
        }),
      });
      await expect(service.prepare(PREPARE_REQUEST, buildHandoff())).rejects.toBeInstanceOf(
        ChangePlanValidationError,
      );
    } finally {
      fixture.cleanup();
    }
  }, 30_000);

  it('scenario 3 — HARD scope remains enforced for explicit test-only request', async () => {
    const fixture = createSupplierSyncFixture();
    const promptOrchestrator = new RecordingPromptOrchestrator();
    try {
      const service = createRuntime({
        root: fixture.root,
        contextBuilder: new RecordingContextBuilder(),
        promptOrchestrator,
        providerResponse: createProviderResponse({
          summary: 'Add PRICE_CHANGED regression assertion.',
          artifacts: [
            {
              logicalPath: TEST_FILE_PATH,
              content: UPDATED_TEST_CONTENT,
              changeOperation: 'UPDATE_FILE',
              description: 'Add regression assertion.',
            },
          ],
        }),
      });
      await service.prepare(PREPARE_REQUEST, buildHandoff());
      expect(promptOrchestrator.lastBuildInput?.preservationContract?.scope.mode).toBe('HARD');
      expect(
        promptOrchestrator.lastBuildInput?.preservationContract?.scope.preferredUpdatePaths,
      ).toContain(TEST_FILE_PATH);
    } finally {
      fixture.cleanup();
    }
  }, 30_000);

  it('scenario 4 — insufficient provider evidence may still yield an empty ChangePlan', async () => {
    const fixture = createSupplierSyncFixture();
    try {
      const service = createRuntime({
        root: fixture.root,
        contextBuilder: new RecordingContextBuilder(),
        promptOrchestrator: new RecordingPromptOrchestrator(),
        providerResponse: createProviderResponse({
          summary: 'Evidence is inconclusive; no safe filesystem mutation.',
          artifacts: [],
        }),
      });
      const preparation = await service.prepare(PREPARE_REQUEST, buildHandoff());
      expect(preparation.changePlan.changeSet.operations).toHaveLength(0);
    } finally {
      fixture.cleanup();
    }
  }, 30_000);

  it('scenario 5 — protected path mutations are blocked at apply', async () => {
    const fixture = createSupplierSyncFixture();
    try {
      const service = createRuntime({
        root: fixture.root,
        contextBuilder: new RecordingContextBuilder(),
        promptOrchestrator: new RecordingPromptOrchestrator(),
        providerResponse: createProviderResponse({
          summary: 'Attempted protected path update.',
          artifacts: [
            {
              logicalPath: 'server/secrets/api-config.json',
              content: '{"token":"new"}\n',
              changeOperation: 'UPDATE_FILE',
              description: 'Update protected secret.',
            },
          ],
        }),
      });
      const preparation = await service.prepare(
        'Only modify server/secrets/api-config.json. Rotate the token string.',
        buildHandoff(),
      );
      expect(preparation.changePlan.changeSet.operations).toHaveLength(1);
      const completion = await service.approveAndApply(preparation.preparationId, true);
      expect(completion.applyResult.status).toBe('REJECTED');
      expect(completion.applyResult.errors[0]?.code).toBe('PROTECTED_PATH');
    } finally {
      fixture.cleanup();
    }
  }, 30_000);

  it('scenario 6 — Gate 2 projection still returns unified diffs for valid UPDATE_FILE plans', async () => {
    const fixture = createSupplierSyncFixture();
    try {
      const service = createRuntime({
        root: fixture.root,
        contextBuilder: new RecordingContextBuilder(),
        promptOrchestrator: new RecordingPromptOrchestrator(),
        providerResponse: createProviderResponse({
          summary: 'Add PRICE_CHANGED regression assertion.',
          artifacts: [
            {
              logicalPath: TEST_FILE_PATH,
              content: UPDATED_TEST_CONTENT,
              changeOperation: 'UPDATE_FILE',
              description: 'Add regression assertion.',
            },
          ],
        }),
      });
      const preparation = await service.prepare(PREPARE_REQUEST, buildHandoff());
      const diff = preparation.gate2Review.operationDiffs[0];
      expect(diff?.logicalPath).toBe(TEST_FILE_PATH);
      expect(diff?.format).toBe('UNIFIED');
      expect(diff?.unifiedDiff).toContain('PRICE_CHANGED');
    } finally {
      fixture.cleanup();
    }
  }, 30_000);

  it('passes the explicit PREPARE request to the prompt instead of investigation-only text', async () => {
    const fixture = createSupplierSyncFixture();
    const promptOrchestrator = new RecordingPromptOrchestrator();
    try {
      const service = createRuntime({
        root: fixture.root,
        contextBuilder: new RecordingContextBuilder(),
        promptOrchestrator,
        providerResponse: createProviderResponse({
          summary: 'Add PRICE_CHANGED regression assertion.',
          artifacts: [
            {
              logicalPath: TEST_FILE_PATH,
              content: UPDATED_TEST_CONTENT,
              changeOperation: 'UPDATE_FILE',
              description: 'Add regression assertion.',
            },
          ],
        }),
      });
      await service.prepare(PREPARE_REQUEST, buildHandoff());
      const promptText = JSON.stringify(promptOrchestrator.lastBuildInput);
      expect(promptText).toContain('Only modify tests/supplierSyncSettings.test.ts');
      expect(promptOrchestrator.lastBuildInput?.metadata?.['prepare-context-profile']).toBe(
        'EXTERNAL_TARGET_INVESTIGATION_PREPARE',
      );
      expect(promptOrchestrator.lastBuildInput?.iterationFeedback?.apply.updatedPaths).toEqual([]);
      expect(promptOrchestrator.lastBuildInput?.iterationFeedback?.apply.status).toBe('FAILED');
    } finally {
      fixture.cleanup();
    }
  }, 30_000);

  it('blocks every protected PREPARE path channel before reads and provider serialization', async () => {
    const fixture = createSupplierSyncFixture();
    const contextBuilder = new RecordingContextBuilder();
    const promptOrchestrator = new RecordingPromptOrchestrator();
    const sourceFiles = new RecordingProjectFileSource(new NodeProjectFileSource(fixture.root));
    const workspaceBaseline = new RecordingWorkspaceBaseline(
      new MemoryWorkspaceBaselinePort({
        [SERVICE_FILE_PATH]:
          "import '../../server/secrets/api-config';\nexport function compareSupplierPriceChanged() { return true; }\n",
        'server/secrets/api-config.json': NEVER_EXPOSE_SECRET_MARKER,
      }),
    );
    const providerRequests: unknown[] = [];
    try {
      writeFileSync(
        path.join(fixture.root, SERVICE_FILE_PATH),
        "import '../../server/secrets/api-config';\nexport function compareSupplierPriceChanged() { return true; }\n",
        'utf8',
      );
      const service = createRuntime({
        root: fixture.root,
        contextBuilder,
        promptOrchestrator,
        sourceFiles,
        workspaceBaseline,
        providerRequests,
        providerResponse: createProviderResponse({
          summary: 'Keep the safe supplier implementation unchanged.',
          artifacts: [],
        }),
      });

      await service.prepare(
        `Inspect ${SERVICE_FILE_PATH} and server/secrets/api-config.json, then prepare the smallest safe change.`,
        buildProtectedPathHandoff(),
      );

      const serializedContext = JSON.stringify(contextBuilder.lastContext);
      const serializedPrompt = JSON.stringify(promptOrchestrator.lastPrompt);
      const serializedProviderBoundary = JSON.stringify(providerRequests);
      expect(sourceFiles.reads).toContain(SERVICE_FILE_PATH);
      expect(sourceFiles.reads.some((logicalPath) => /server\/secrets/iu.test(logicalPath))).toBe(
        false,
      );
      expect(
        workspaceBaseline.reads.some((logicalPath) => /server\/secrets/iu.test(logicalPath)),
      ).toBe(false);
      expect(contextBuilder.lastInput?.iterationPathHints).toEqual([SERVICE_FILE_PATH]);
      expect(contextBuilder.lastInput?.sourceContextPolicy?.priorityPaths).toEqual([
        SERVICE_FILE_PATH,
      ]);
      expect(
        contextBuilder.lastContext?.relevantFiles.map(({ path: logicalPath }) => logicalPath),
      ).toContain(SERVICE_FILE_PATH);
      expect(serializedContext).not.toContain(NEVER_EXPOSE_SECRET_MARKER);
      expect(serializedPrompt).not.toContain(NEVER_EXPOSE_SECRET_MARKER);
      expect(serializedProviderBoundary).not.toContain(NEVER_EXPOSE_SECRET_MARKER);
      expect(providerRequests).toHaveLength(1);
    } finally {
      fixture.cleanup();
    }
  }, 30_000);

  it('rejects an explicit protected path request before the first provider call', async () => {
    const fixture = createSupplierSyncFixture();
    const contextBuilder = new RecordingContextBuilder();
    const promptOrchestrator = new RecordingPromptOrchestrator();
    const sourceFiles = new RecordingProjectFileSource(new NodeProjectFileSource(fixture.root));
    const providerRequests: unknown[] = [];
    try {
      const service = createRuntime({
        root: fixture.root,
        contextBuilder,
        promptOrchestrator,
        sourceFiles,
        providerRequests,
        providerResponse: createProviderResponse({
          summary: 'No safe mutation is required.',
          artifacts: [],
        }),
      });

      await service.prepare(
        `Inspect server/secrets/api-config.json and prepare a safe change without exposing its contents.`,
      );

      expect(sourceFiles.reads.some((logicalPath) => /server\/secrets/iu.test(logicalPath))).toBe(
        false,
      );
      expect(JSON.stringify(contextBuilder.lastContext)).not.toContain(NEVER_EXPOSE_SECRET_MARKER);
      expect(JSON.stringify(promptOrchestrator.lastPrompt)).not.toContain(
        NEVER_EXPOSE_SECRET_MARKER,
      );
      expect(JSON.stringify(providerRequests)).not.toContain(NEVER_EXPOSE_SECRET_MARKER);
    } finally {
      fixture.cleanup();
    }
  }, 30_000);

  it('keeps protected content outside normal and compact PREPARE attempts', async () => {
    const fixture = createSupplierSyncFixture();
    const contextBuilder = new RecordingContextBuilder();
    const promptOrchestrator = new RecordingPromptOrchestrator();
    const sourceFiles = new RecordingProjectFileSource(new NodeProjectFileSource(fixture.root));
    const providerRequests: unknown[] = [];
    let compactExecution: TruncateFirstPrepareExecution | undefined;
    try {
      const service = createRuntime({
        root: fixture.root,
        contextBuilder,
        promptOrchestrator,
        sourceFiles,
        providerRequests,
        decorateProviderExecution: (delegate) => {
          compactExecution = new TruncateFirstPrepareExecution(delegate);
          return compactExecution;
        },
        providerResponse: createProviderResponse({
          summary: 'No safe mutation is required.',
          artifacts: [],
        }),
      });

      const preparation = await service.prepare(
        `Review ${SERVICE_FILE_PATH} and server/secrets/api-config.json without exposing secrets.`,
        buildProtectedPathHandoff(),
      );

      expect(compactExecution?.prompts).toHaveLength(2);
      expect(preparation.prepareContextSelection?.compactRetryUsed).toBe(true);
      expect(JSON.stringify(compactExecution?.prompts)).not.toContain(NEVER_EXPOSE_SECRET_MARKER);
      expect(JSON.stringify(providerRequests)).not.toContain(NEVER_EXPOSE_SECRET_MARKER);
      expect(providerRequests).toHaveLength(1);
      expect(sourceFiles.reads.some((logicalPath) => /server\/secrets/iu.test(logicalPath))).toBe(
        false,
      );
    } finally {
      fixture.cleanup();
    }
  }, 30_000);

  it('scenario 10 — BUILDERAI_SELF does not apply EXTERNAL_TARGET investigation prepare plan', async () => {
    const promptOrchestrator = new RecordingPromptOrchestrator();
    const provider = new OpenAIProvider(
      configuration,
      {
        create: async () =>
          createProviderResponse({
            summary: 'Created an integration artifact.',
            artifacts: [
              {
                logicalPath: 'src/application/workspace/cp16-self-artifact.ts',
                content: 'export const ok = true;\n',
                changeOperation: 'CREATE_FILE',
                description: 'Create integration artifact.',
              },
            ],
          }),
      },
      () => '2026-08-08T12:00:00.000Z',
    );
    const service = new WorkspaceRuntimeService({
      loadProjectBrain: loadCanonicalProjectBrain,
      blueprintReader: new BlueprintReaderService(new NodeFileSystemDocumentSource(process.cwd())),
      sourceFiles: {
        listSourcePaths: async () => [],
        readSourceFile: async () => {
          throw new Error('No source reads expected.');
        },
      },
      contextBuilder: new RecordingContextBuilder(),
      promptOrchestrator,
      workspaceBaseline: new NullWorkspaceBaselinePort(),
      providerExecution: new OpenAIExecutionService(provider, configuration),
      responseProcessor: new ResponseProcessorService(),
      changePlanner: new ChangePlannerService(),
      fileApply: new FileApplyEngineService(new InMemoryFileSystemPort()),
      verification: new VerificationEngineService(createPortHarness().ports),
      clock: { now: () => new Date('2026-08-08T12:00:00.000Z') },
      ids: { generate: () => '123e4567-e89b-12d3-a456-426614174000' },
      logger: { record: () => undefined },
      projectProfile: 'BUILDERAI_SELF',
    });

    await service.prepare(PREPARE_REQUEST, buildHandoff());
    expect(promptOrchestrator.lastBuildInput?.metadata).not.toHaveProperty(
      'prepare-context-profile',
    );
    expect(promptOrchestrator.lastBuildInput?.iterationFeedback).toBeUndefined();
  }, 30_000);
});
