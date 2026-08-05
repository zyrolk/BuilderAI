import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { BlueprintReaderService } from '../../core/blueprint-reader';
import { ChangePlannerService, type ProjectChangePlan } from '../../core/change-planner';
import { ContextBuilderService, type ProjectFileSource } from '../../core/context-builder';
import { FileApplyEngineService } from '../../core/file-apply';
import {
  baselineChecksumForContent,
  createOperation,
  createPlan,
  InMemoryFileSystemPort,
} from '../../core/file-apply/test/file-apply.fixture';
import { loadCanonicalProjectBrain } from '../../core/project-brain';
import { PromptOrchestratorService } from '../../core/prompt-orchestrator';
import { ResponseProcessorService } from '../../core/response-processor';
import { VerificationEngineService } from '../../core/verification';
import { createPortHarness } from '../../core/verification/test/verification.fixture';
import { NodeFileSystemDocumentSource } from '../../infrastructure/blueprint-reader';
import { NullWorkspaceBaselinePort } from '../../core/update-scope/test/workspace-baseline.fixture';
import {
  OpenAIExecutionService,
  OpenAIProvider,
  type OpenAIProviderConfiguration,
} from '../../providers/openai';
import { WorkspaceApplyAuditService } from './workspace-apply-audit.service';
import { WorkspaceApplyLockService } from './workspace-apply-lock.service';
import { WorkspaceApplyPolicyService } from './workspace-apply-policy.service';
import {
  createWorkspaceAuthorizationContext,
  WorkspaceAuthorizationService,
} from './workspace-authorization.service';
import type {
  WorkspaceRequestSecurityEvidence,
  WorkspaceSecurityConfiguration,
} from './workspace-authorization.types';
import { WorkspaceRuntimeError } from './workspace-runtime.types';
import { WorkspaceRuntimeService } from './workspace-runtime.service';

const providerConfiguration: OpenAIProviderConfiguration = {
  model: 'integration-model',
  defaultTimeoutMs: 30_000,
  maximumTimeoutMs: 30_000,
  maximumInputCharacters: 1_000_000,
  maximumOutputCharacters: 100_000,
  maximumOutputTokens: 10_000,
};

const TRUSTED_LOCAL: WorkspaceSecurityConfiguration = {
  profile: 'TRUSTED_LOCAL',
  projectId: 'builder-ai',
  principalId: 'local-operator',
};

const PROTECTED: WorkspaceSecurityConfiguration = {
  profile: 'PROTECTED',
  projectId: 'builder-ai',
  accessToken: 'access-token',
  csrfToken: 'csrf-token',
  principalId: 'workspace-operator',
};

const emptySource: ProjectFileSource = {
  listSourcePaths: async () => [],
  readSourceFile: async () => {
    throw new Error('No source reads expected.');
  },
};

function protectedEvidence(
  overrides: Partial<WorkspaceRequestSecurityEvidence> = {},
): WorkspaceRequestSecurityEvidence {
  return {
    bearerToken: 'access-token',
    csrfToken: 'csrf-token',
    operatorApproved: true,
    ...overrides,
  };
}

class DelayingFileApplyEngineService extends FileApplyEngineService {
  constructor(
    fileSystem: InMemoryFileSystemPort,
    private readonly delayMs: number,
  ) {
    super(fileSystem);
  }

  override async apply(
    ...parameters: Parameters<FileApplyEngineService['apply']>
  ): Promise<Awaited<ReturnType<FileApplyEngineService['apply']>>> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return super.apply(...parameters);
  }
}

class PathSwitchingProvider {
  private call = 0;

  constructor(private readonly paths: readonly string[]) {}

  createHandler(): ConstructorParameters<typeof OpenAIProvider>[1]['create'] {
    return async () => {
      const logicalPath = this.paths[this.call] ?? this.paths.at(-1)!;
      this.call += 1;
      return {
        id: `response-${this.call}`,
        model: 'integration-model',
        status: 'completed',
        output_text: JSON.stringify({
          summary: 'Created an integration artifact.',
          artifacts: [
            {
              logicalPath,
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
      };
    };
  }
}

describe('authorize-artifact-application Slice 1', () => {
  describe('authorization', () => {
    it('keeps trusted-local apply working without bearer or CSRF evidence', async () => {
      const service = createRuntime(TRUSTED_LOCAL);
      const preparation = await service.prepare('Create the approved integration artifact.');
      const completion = await service.approveAndApply(preparation.preparationId, true);
      expect(completion.applyResult.status).toBe('APPLIED');
    });

    it('rejects protected apply without principal credentials', async () => {
      const service = createRuntime(PROTECTED);
      const preparation = await service.prepare('Create the approved integration artifact.');
      await expect(
        service.approveAndApply(preparation.preparationId, true, { operatorApproved: true }),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('rejects protected apply with invalid bearer token', async () => {
      const service = createRuntime(PROTECTED);
      const preparation = await service.prepare('Create the approved integration artifact.');
      await expect(
        service.approveAndApply(
          preparation.preparationId,
          true,
          protectedEvidence({ bearerToken: 'wrong-token' }),
        ),
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('rejects protected apply when principal project does not match workspace', () => {
      const authorization = new WorkspaceAuthorizationService(PROTECTED);
      const decision = authorization.authorize(
        createWorkspaceAuthorizationContext({
          configuration: PROTECTED,
          action: 'APPLY',
          evidence: protectedEvidence(),
          principal: { principalId: 'workspace-operator', projectId: 'other-project' },
        }),
      );
      expect(decision).toMatchObject({ outcome: 'REJECTED', code: 'UNAUTHORIZED' });
    });

    it('authorizes protected apply with valid credentials and server apply token', async () => {
      const service = createRuntime(PROTECTED);
      const preparation = await service.prepare('Create the approved integration artifact.');
      expect(preparation.applyAuthorizationToken).toBeDefined();
      const completion = await service.approveAndApply(
        preparation.preparationId,
        true,
        protectedEvidence({ applyAuthorizationToken: preparation.applyAuthorizationToken }),
      );
      expect(completion.applyResult.status).toBe('APPLIED');
    });

    it('does not authorize protected apply with approved: true alone', async () => {
      const service = createRuntime(PROTECTED);
      const preparation = await service.prepare('Create the approved integration artifact.');
      await expect(
        service.approveAndApply(preparation.preparationId, true, {
          bearerToken: 'access-token',
          csrfToken: 'csrf-token',
          operatorApproved: true,
        }),
      ).rejects.toMatchObject({ code: 'APPLY_AUTHORIZATION_REQUIRED' });
    });
  });

  describe('CSRF', () => {
    it('rejects protected browser mutation without anti-forgery evidence', () => {
      const authorization = new WorkspaceAuthorizationService(PROTECTED);
      const decision = authorization.authorize(
        createWorkspaceAuthorizationContext({
          configuration: PROTECTED,
          action: 'APPLY',
          evidence: {
            bearerToken: 'access-token',
            operatorApproved: true,
          },
        }),
      );
      expect(decision).toMatchObject({ outcome: 'REJECTED', code: 'CSRF_VALIDATION_FAILED' });
    });

    it('rejects protected mutation with invalid anti-forgery evidence', () => {
      const authorization = new WorkspaceAuthorizationService(PROTECTED);
      const decision = authorization.authorize(
        createWorkspaceAuthorizationContext({
          configuration: PROTECTED,
          action: 'APPLY',
          evidence: protectedEvidence({ csrfToken: 'wrong-csrf' }),
        }),
      );
      expect(decision).toMatchObject({ outcome: 'REJECTED', code: 'CSRF_VALIDATION_FAILED' });
    });

    it('allows protected mutation with valid anti-forgery evidence', () => {
      const authorization = new WorkspaceAuthorizationService(PROTECTED);
      const decision = authorization.authorize(
        createWorkspaceAuthorizationContext({
          configuration: PROTECTED,
          action: 'APPLY',
          evidence: protectedEvidence(),
        }),
      );
      expect(decision.outcome).toBe('AUTHORIZED');
    });
  });

  describe('concurrency', () => {
    let nextId = 0;
    const uniqueIds = (): string => {
      nextId += 1;
      return `aaaaaaaa-bbbb-cccc-dddd-${String(nextId).padStart(12, '0')}`;
    };

    beforeEach(() => {
      nextId = 0;
    });

    it('prevents concurrent applies targeting the same file', async () => {
      const fileSystem = new InMemoryFileSystemPort();
      const applyLock = new WorkspaceApplyLockService();
      const service = createRuntime(
        TRUSTED_LOCAL,
        fileSystem,
        applyLock,
        50,
        undefined,
        undefined,
        undefined,
        undefined,
        uniqueIds,
      );
      const prepA = await service.prepare('Create artifact A.');
      const prepB = await service.prepare('Create artifact B.');
      const first = service.approveAndApply(prepA.preparationId, true);
      await expect(service.approveAndApply(prepB.preparationId, true)).rejects.toMatchObject({
        code: 'APPLY_PATH_CONFLICT',
      });
      await first;
    });

    it('conflicts when multi-file plans overlap', () => {
      const lock = new WorkspaceApplyLockService();
      lock.acquire('builder-ai', 'prep-a', ['src/shared.ts', 'src/a.ts']);
      expect(() =>
        lock.acquire('builder-ai', 'prep-b', ['src/b.ts', 'src/shared.ts']),
      ).toThrowError(WorkspaceRuntimeError);
    });

    it('allows disjoint targets to proceed concurrently', async () => {
      const fileSystem = new InMemoryFileSystemPort();
      const applyLock = new WorkspaceApplyLockService();
      const pathProvider = new PathSwitchingProvider(['src/first.ts', 'src/second.ts']);
      const service = createRuntime(
        TRUSTED_LOCAL,
        fileSystem,
        applyLock,
        50,
        pathProvider.createHandler(),
        undefined,
        undefined,
        undefined,
        uniqueIds,
      );
      const prepA = await service.prepare('Create first artifact.');
      const prepB = await service.prepare('Create second artifact.');
      const first = service.approveAndApply(prepA.preparationId, true);
      const second = service.approveAndApply(prepB.preparationId, true);
      await expect(Promise.all([first, second])).resolves.toBeDefined();
    });

    it('releases locks after successful apply', async () => {
      const lock = new WorkspaceApplyLockService();
      const service = createRuntime(TRUSTED_LOCAL, new InMemoryFileSystemPort(), lock);
      const preparation = await service.prepare('Create artifact.');
      await service.approveAndApply(preparation.preparationId, true);
      expect(() =>
        lock.acquire('builder-ai', 'prep-next', ['src/integration-output.ts']),
      ).not.toThrow();
    });

    it('releases locks after drift rejection', async () => {
      const baseline = baselineChecksumForContent('baseline A\n');
      const fileSystem = new InMemoryFileSystemPort({ 'src/page.html': 'operator B\n' });
      const lock = new WorkspaceApplyLockService();
      const service = createRuntime(
        TRUSTED_LOCAL,
        fileSystem,
        lock,
        0,
        undefined,
        undefined,
        undefined,
        createPlan([
          createOperation('UPDATE_FILE', 'src/page.html', 'proposed C\n', {
            baselineContentChecksum: baseline,
          }),
        ]),
      );
      const preparation = await service.prepare('Update page.');
      const result = await service.approveAndApply(preparation.preparationId, true);
      expect(result.applyResult.status).toBe('FAILED');
      expect(() => lock.acquire('builder-ai', 'prep-next', ['src/page.html'])).not.toThrow();
    });

    it('releases locks after apply exception', async () => {
      const lock = new WorkspaceApplyLockService();
      class ThrowingApply extends FileApplyEngineService {
        override async apply(): Promise<never> {
          throw new Error('apply exploded');
        }
      }
      const service = createRuntime(
        TRUSTED_LOCAL,
        new InMemoryFileSystemPort(),
        lock,
        0,
        undefined,
        new ThrowingApply(new InMemoryFileSystemPort()),
      );
      const preparation = await service.prepare('Create artifact.');
      await expect(service.approveAndApply(preparation.preparationId, true)).rejects.toThrow(
        'apply exploded',
      );
      expect(() =>
        lock.acquire('builder-ai', 'prep-next', ['src/integration-output.ts']),
      ).not.toThrow();
    });
  });

  describe('baseline checksum enforcement', () => {
    it('rejects protected UPDATE without required baseline checksum before mutation', async () => {
      const fileSystem = new InMemoryFileSystemPort({ 'src/page.html': 'baseline A\n' });
      const service = createRuntime(
        PROTECTED,
        fileSystem,
        undefined,
        0,
        undefined,
        undefined,
        undefined,
        createPlan([createOperation('UPDATE_FILE', 'src/page.html', 'proposed C\n')]),
      );
      const preparation = await service.prepare('Update page.');
      await expect(
        service.approveAndApply(
          preparation.preparationId,
          true,
          protectedEvidence({ applyAuthorizationToken: preparation.applyAuthorizationToken }),
        ),
      ).rejects.toMatchObject({ code: 'BASELINE_INTEGRITY_REQUIRED' });
      expect(fileSystem.mutationCalls).toEqual([]);
    });

    it('allows protected UPDATE with valid checksum to proceed', async () => {
      const baseline = baselineChecksumForContent('baseline A\n');
      const fileSystem = new InMemoryFileSystemPort({ 'src/page.html': 'baseline A\n' });
      const service = createRuntime(
        PROTECTED,
        fileSystem,
        undefined,
        0,
        undefined,
        undefined,
        undefined,
        createPlan([
          createOperation('UPDATE_FILE', 'src/page.html', 'proposed C\n', {
            baselineContentChecksum: baseline,
          }),
        ]),
      );
      const preparation = await service.prepare('Update page.');
      const completion = await service.approveAndApply(
        preparation.preparationId,
        true,
        protectedEvidence({ applyAuthorizationToken: preparation.applyAuthorizationToken }),
      );
      expect(completion.applyResult.status).toBe('APPLIED');
    });

    it('retains ADR-030 drift behavior in protected mode', async () => {
      const baseline = baselineChecksumForContent('baseline A\n');
      const fileSystem = new InMemoryFileSystemPort({ 'src/page.html': 'operator B\n' });
      const service = createRuntime(
        PROTECTED,
        fileSystem,
        undefined,
        0,
        undefined,
        undefined,
        undefined,
        createPlan([
          createOperation('UPDATE_FILE', 'src/page.html', 'proposed C\n', {
            baselineContentChecksum: baseline,
          }),
        ]),
      );
      const preparation = await service.prepare('Update page.');
      const completion = await service.approveAndApply(
        preparation.preparationId,
        true,
        protectedEvidence({ applyAuthorizationToken: preparation.applyAuthorizationToken }),
      );
      expect(completion.applyResult.status).toBe('FAILED');
      expect(completion.applyResult.errors[0]?.code).toBe('BASELINE_CONTENT_DRIFT');
      expect(fileSystem.mutationCalls).toEqual([]);
    });
  });

  describe('apply audit evidence', () => {
    let tempRoot = '';

    beforeEach(async () => {
      tempRoot = await mkdtemp(path.join(os.tmpdir(), 'builderai-audit-'));
    });

    afterEach(async () => {
      await rm(tempRoot, { recursive: true, force: true });
    });

    it('records authorization rejection without artifact bodies', async () => {
      const audit = new WorkspaceApplyAuditService({ projectRoot: tempRoot });
      audit.record({
        correlationId: 'corr-1',
        preparationId: 'prep-1',
        principal: { principalId: 'workspace-operator', projectId: 'builder-ai' },
        authorizationOutcome: 'REJECTED',
        reasonCode: 'UNAUTHORIZED',
      });
      const line = (await readFile(audit.getAuditFilePath(), 'utf8')).trim();
      const record = JSON.parse(line) as Record<string, unknown>;
      expect(record.authorizationOutcome).toBe('REJECTED');
      expect(record.reasonCode).toBe('UNAUTHORIZED');
      expect(line).not.toMatch(/apikey|secret|BEGIN PRIVATE/i);
      expect(record).not.toHaveProperty('content');
    });

    it('records successful apply without bodies or secrets', async () => {
      const service = createRuntime(
        TRUSTED_LOCAL,
        new InMemoryFileSystemPort(),
        undefined,
        0,
        undefined,
        undefined,
        tempRoot,
      );
      const preparation = await service.prepare('Create artifact.');
      await service.approveAndApply(preparation.preparationId, true);
      const auditPath = path.join(tempRoot, '.builderai', 'apply-audit.jsonl');
      const line = (await readFile(auditPath, 'utf8')).trim();
      const record = JSON.parse(line) as Record<string, unknown>;
      expect(record.applyOutcome).toBe('APPLIED');
      expect(record.authorizationOutcome).toBe('AUTHORIZED');
      expect(line).not.toMatch(/export const integrated|apikey|secret/i);
    });

    it('records baseline drift without artifact bodies', async () => {
      const baseline = baselineChecksumForContent('baseline A\n');
      const fileSystem = new InMemoryFileSystemPort({ 'src/page.html': 'operator B\n' });
      const service = createRuntime(
        TRUSTED_LOCAL,
        fileSystem,
        undefined,
        0,
        undefined,
        undefined,
        tempRoot,
        createPlan([
          createOperation('UPDATE_FILE', 'src/page.html', 'proposed C\n', {
            baselineContentChecksum: baseline,
          }),
        ]),
      );
      const preparation = await service.prepare('Update page.');
      await service.approveAndApply(preparation.preparationId, true);
      const auditPath = path.join(tempRoot, '.builderai', 'apply-audit.jsonl');
      const record = JSON.parse((await readFile(auditPath, 'utf8')).trim()) as Record<
        string,
        unknown
      >;
      expect(record.applyOutcome).toBe('FAILED');
      expect(JSON.stringify(record)).not.toContain('proposed C');
    });

    it('records lock conflict', async () => {
      const fileSystem = new InMemoryFileSystemPort();
      const applyLock = new WorkspaceApplyLockService();
      let lockAuditId = 0;
      const service = createRuntime(
        TRUSTED_LOCAL,
        fileSystem,
        applyLock,
        50,
        undefined,
        undefined,
        tempRoot,
        undefined,
        () => {
          lockAuditId += 1;
          return `bbbbbbbb-bbbb-cccc-dddd-${String(lockAuditId).padStart(12, '0')}`;
        },
      );
      const prepA = await service.prepare('Create artifact A.');
      const prepB = await service.prepare('Create artifact B.');
      void service.approveAndApply(prepA.preparationId, true);
      await expect(service.approveAndApply(prepB.preparationId, true)).rejects.toMatchObject({
        code: 'APPLY_PATH_CONFLICT',
      });
      const auditPath = path.join(tempRoot, '.builderai', 'apply-audit.jsonl');
      const records = (await readFile(auditPath, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(records.some((record) => record.reasonCode === 'APPLY_PATH_CONFLICT')).toBe(true);
    });

    it('records PARTIALLY_APPLIED without artifact bodies', async () => {
      const fileSystem = new InMemoryFileSystemPort();
      const service = createRuntime(
        TRUSTED_LOCAL,
        fileSystem,
        undefined,
        0,
        undefined,
        undefined,
        tempRoot,
        createPlan([
          createOperation('CREATE_FILE', 'src/aaa-success.ts', 'ok\n'),
          createOperation('CREATE_FILE', 'src/zzz-second.ts', 'secret-body\n'),
        ]),
      );
      const preparation = await service.prepare('Mixed apply.');
      fileSystem.failMutationPath = 'src/zzz-second.ts';
      const completion = await service.approveAndApply(preparation.preparationId, true);
      expect(completion.applyResult.status).toBe('PARTIALLY_APPLIED');
      const auditPath = path.join(tempRoot, '.builderai', 'apply-audit.jsonl');
      const record = JSON.parse((await readFile(auditPath, 'utf8')).trim()) as Record<
        string,
        unknown
      >;
      expect(record.applyOutcome).toBe('PARTIALLY_APPLIED');
      expect(JSON.stringify(record)).not.toContain('secret-body');
    });
  });

  describe('apply policy unit', () => {
    it('does not require baseline checksum in trusted-local profile', () => {
      expect(() =>
        new WorkspaceApplyPolicyService().assertUpdateBaselineIntegrity(
          'TRUSTED_LOCAL',
          createPlan([createOperation('UPDATE_FILE', 'src/page.html', 'next\n')]),
        ),
      ).not.toThrow();
    });
  });
});

function createRuntime(
  security: WorkspaceSecurityConfiguration,
  fileSystem: InMemoryFileSystemPort = new InMemoryFileSystemPort(),
  applyLock?: WorkspaceApplyLockService,
  applyDelayMs = 0,
  providerCreate?: ConstructorParameters<typeof OpenAIProvider>[1]['create'],
  fileApply?: FileApplyEngineService,
  projectRoot?: string,
  fixedPlan?: ProjectChangePlan,
  idGenerator?: () => string,
): WorkspaceRuntimeService {
  let providerTick = 0;
  const providerClock = (): string =>
    new Date(Date.parse('2026-07-31T13:00:00.000Z') + providerTick++ * 10).toISOString();
  const provider = new OpenAIProvider(
    providerConfiguration,
    {
      create:
        providerCreate ??
        (async () => ({
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
        })),
    },
    providerClock,
  );
  const applyEngine =
    fileApply ??
    (applyDelayMs > 0
      ? new DelayingFileApplyEngineService(fileSystem, applyDelayMs)
      : new FileApplyEngineService(fileSystem));
  const changePlanner =
    fixedPlan === undefined ? new ChangePlannerService() : new FixedPlanChangePlanner(fixedPlan);
  return new WorkspaceRuntimeService({
    loadProjectBrain: loadCanonicalProjectBrain,
    blueprintReader: new BlueprintReaderService(new NodeFileSystemDocumentSource(process.cwd())),
    sourceFiles: emptySource,
    contextBuilder: new ContextBuilderService(),
    promptOrchestrator: new PromptOrchestratorService(),
    workspaceBaseline: new NullWorkspaceBaselinePort(),
    providerExecution: new OpenAIExecutionService(provider, providerConfiguration, providerClock),
    responseProcessor: new ResponseProcessorService(),
    changePlanner,
    fileApply: applyEngine,
    verification: new VerificationEngineService(createPortHarness().ports),
    clock: { now: () => new Date('2026-07-31T13:00:00.000Z') },
    ids: { generate: idGenerator ?? (() => '123e4567-e89b-12d3-a456-426614174000') },
    logger: { record: () => undefined },
    security,
    projectRoot,
    ...(applyLock === undefined ? {} : { applyLock }),
  });
}

class FixedPlanChangePlanner extends ChangePlannerService {
  constructor(private readonly fixedPlan: ProjectChangePlan) {
    super();
  }

  override plan(): ProjectChangePlan {
    return structuredClone(this.fixedPlan);
  }
}
