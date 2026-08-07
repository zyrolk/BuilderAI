import { cpSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { FileApplyEngineService } from '../../../core/file-apply';
import {
  InMemoryFileSystemPort,
  createOperation,
  createPlan,
} from '../../../core/file-apply/test/file-apply.fixture';
import { ContextBuilderService } from '../../../core/context-builder';
import { NodeProjectFileSource } from '../../../infrastructure/project';
import { ZYRO_STYLE_FIXTURE_ROOT } from '../../../core/target-project/test/external-target.fixture';
import { ExternalTargetProjectReaderService } from '../../../core/target-project/external-target-project-reader.service';
import { NodeFileSystemDocumentSource } from '../../../infrastructure/blueprint-reader';
import { createTask } from '../../../core/project-brain/test/project-brain.fixture';
import { loadWorkspaceProjectBrain } from '../../../core/target-project/workspace-project-brain.loader';
import {
  assertExternalTargetWorkflowAllowed,
  ExternalTargetReadinessService,
  READINESS_DIAGNOSTIC_CODES,
} from '../external-target-readiness';
import { InvestigationService } from '../investigation/investigation.service';
import { DeterministicInvestigationAnalyzer } from '../investigation/investigation-analysis.service';
import { MemoryProjectFileSource } from '../../../core/context-builder/test/context-builder.fixture';
import { WorkspaceRuntimeService } from '../workspace-runtime.service';
import { WorkspaceRuntimeError } from '../workspace-runtime.types';
import { Gate2ReviewProjectionService } from '../gate2-review/gate2-review-projection.service';
import {
  createPlanFromOperations,
  createUpdateOperation,
} from '../gate2-review/gate2-review.fixture';
import { createWorkspacePathProtectionPolicyFromManifest } from '../../../core/target-project/workspace-path-protection';
import { sanitizeMemoryPaths } from '../project-memory/project-memory-sanitize';

function createExternalFixture(input: {
  readonly manifest?: Record<string, unknown>;
  readonly includeDocs?: boolean;
  readonly includePackageJson?: boolean;
  readonly extraFiles?: Record<string, string>;
}): { readonly root: string; readonly cleanup: () => void } {
  const root = mkdtempSync(path.join(tmpdir(), 'builderai-cp11-'));
  cpSync(ZYRO_STYLE_FIXTURE_ROOT, root, { recursive: true });
  mkdirSync(path.join(root, '.builderai'), { recursive: true });
  const manifestPath = path.join(root, '.builderai', 'target-project.json');
  if (input.manifest !== undefined) {
    writeFileSync(manifestPath, `${JSON.stringify(input.manifest, null, 2)}\n`, 'utf8');
  } else if (existsSync(manifestPath)) {
    rmSync(manifestPath);
  }
  if (input.includePackageJson === false && existsSync(path.join(root, 'package.json'))) {
    rmSync(path.join(root, 'package.json'));
  }
  if (input.extraFiles !== undefined) {
    for (const [relativePath, content] of Object.entries(input.extraFiles)) {
      const absolute = path.join(root, relativePath);
      mkdirSync(path.dirname(absolute), { recursive: true });
      writeFileSync(absolute, content, 'utf8');
    }
  }
  if (input.includeDocs === false) {
    rmSync(path.join(root, 'docs'), { recursive: true, force: true });
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const baseManifest = {
  schemaVersion: 1,
  projectId: 'zyro-style-fixture',
  name: 'CP11 Fixture',
  vision: 'CP11 readiness fixture.',
  currentMilestone: 'CP11',
  protectedAreas: ['infra/', 'server/secrets/'],
  sourceRoots: ['functions'],
};

describe('CP11 external-target readiness', () => {
  it('scenario 1 — valid Zyro-style EXTERNAL_TARGET is READY', async () => {
    const { root, cleanup } = createExternalFixture({ manifest: baseManifest });
    try {
      const readiness = await new ExternalTargetReadinessService().project({ projectRoot: root });
      expect(readiness.status).toBe('READY');
      expect(readiness.projectId).toBe('zyro-style-fixture');
      expect(readiness.indexedFileCount).toBeGreaterThan(0);
      expect(readiness.governanceDocuments.length).toBe(3);
    } finally {
      cleanup();
    }
  });

  it('scenario 2 — valid target with optional missing capability is READY_WITH_WARNINGS', async () => {
    const { root, cleanup } = createExternalFixture({
      manifest: baseManifest,
      extraFiles: {
        'package.json': JSON.stringify({ name: 'warnings-only', scripts: { build: 'node -v' } }),
      },
    });
    try {
      const readiness = await new ExternalTargetReadinessService().project({ projectRoot: root });
      expect(readiness.status).toBe('READY_WITH_WARNINGS');
      expect(
        readiness.warnings.some(
          ({ code }) => code === READINESS_DIAGNOSTIC_CODES.VERIFICATION_TEST_UNAVAILABLE,
        ),
      ).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('scenario 3 — missing manifest is BLOCKED with useful diagnostic', async () => {
    const { root, cleanup } = createExternalFixture({ manifest: undefined });
    try {
      const readiness = await new ExternalTargetReadinessService().project({ projectRoot: root });
      expect(readiness.status).toBe('BLOCKED');
      expect(
        readiness.blockers.some(({ code }) => code === READINESS_DIAGNOSTIC_CODES.MANIFEST_MISSING),
      ).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('scenario 4 — malformed manifest is BLOCKED', async () => {
    const { root, cleanup } = createExternalFixture({
      manifest: {
        schemaVersion: 1,
        projectId: 'bad id',
        name: '',
        vision: '',
        currentMilestone: '',
      },
    });
    try {
      const readiness = await new ExternalTargetReadinessService().project({ projectRoot: root });
      expect(readiness.status).toBe('BLOCKED');
      expect(
        readiness.blockers.some(
          ({ code }) => code === READINESS_DIAGNOSTIC_CODES.MANIFEST_MALFORMED,
        ),
      ).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('scenario 5 — missing configured source root is BLOCKED', async () => {
    const { root, cleanup } = createExternalFixture({
      manifest: { ...baseManifest, sourceRoots: ['missing-root'] },
    });
    try {
      const readiness = await new ExternalTargetReadinessService().project({ projectRoot: root });
      expect(readiness.status).toBe('BLOCKED');
      expect(
        readiness.blockers.some(
          ({ code }) => code === READINESS_DIAGNOSTIC_CODES.SOURCE_ROOT_MISSING,
        ),
      ).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('scenario 6 — missing governance document is BLOCKED', async () => {
    const { root, cleanup } = createExternalFixture({ manifest: baseManifest, includeDocs: false });
    try {
      const readiness = await new ExternalTargetReadinessService().project({ projectRoot: root });
      expect(readiness.status).toBe('BLOCKED');
      expect(
        readiness.blockers.some(
          ({ code }) => code === READINESS_DIAGNOSTIC_CODES.GOVERNANCE_DOCUMENT_MISSING,
        ),
      ).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('scenario 7 — invalid protectedAreas is BLOCKED', async () => {
    const { root, cleanup } = createExternalFixture({
      manifest: { ...baseManifest, protectedAreas: ['../escape'] },
    });
    try {
      const readiness = await new ExternalTargetReadinessService().project({ projectRoot: root });
      expect(readiness.status).toBe('BLOCKED');
      expect(
        readiness.blockers.some(
          ({ code }) => code === READINESS_DIAGNOSTIC_CODES.PROTECTED_AREA_INVALID,
        ),
      ).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('scenario 8 — traversal protected path is BLOCKED', async () => {
    const { root, cleanup } = createExternalFixture({
      manifest: { ...baseManifest, protectedAreas: ['..\\secrets'] },
    });
    try {
      const readiness = await new ExternalTargetReadinessService().project({ projectRoot: root });
      expect(readiness.status).toBe('BLOCKED');
      expect(
        readiness.blockers.some(
          ({ code }) => code === READINESS_DIAGNOSTIC_CODES.PROTECTED_AREA_INVALID,
        ),
      ).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('scenario 9 — Windows/POSIX normalization parity for protected areas', async () => {
    const { root, cleanup } = createExternalFixture({
      manifest: { ...baseManifest, protectedAreas: ['infra\\', 'server/secrets/'] },
    });
    try {
      const readiness = await new ExternalTargetReadinessService().project({ projectRoot: root });
      expect(readiness.protectedAreas.map(({ path: areaPath }) => areaPath)).toEqual(
        expect.arrayContaining(['infra', 'server/secrets']),
      );
    } finally {
      cleanup();
    }
  });

  it('scenario 10 — mandatory protection remains visible through CP10 policy', () => {
    const policy = createWorkspacePathProtectionPolicyFromManifest(['infra/']);
    expect(policy.isNeverExpose('project-brain.json')).toBe(true);
    expect(policy.isNeverExpose('.env.local')).toBe(true);
  });

  it('scenario 11 — manifest NEVER_EXPOSE path represented without content', async () => {
    const { root, cleanup } = createExternalFixture({
      manifest: { ...baseManifest, protectedAreas: ['server/secrets/'] },
    });
    try {
      const readiness = await new ExternalTargetReadinessService().project({ projectRoot: root });
      const secret = readiness.protectedAreas.find(
        ({ path: areaPath }) => areaPath === 'server/secrets',
      );
      expect(secret?.classification).toBe('NEVER_EXPOSE');
      expect(JSON.stringify(readiness)).not.toContain('api-config');
    } finally {
      cleanup();
    }
  });

  it('scenario 12 — MUTATION_PROTECTED path represented safely', async () => {
    const { root, cleanup } = createExternalFixture({
      manifest: { ...baseManifest, protectedAreas: ['infra/'] },
    });
    try {
      const readiness = await new ExternalTargetReadinessService().project({ projectRoot: root });
      const infra = readiness.protectedAreas.find(({ path: areaPath }) => areaPath === 'infra');
      expect(infra?.classification).toBe('MUTATION_PROTECTED');
    } finally {
      cleanup();
    }
  });

  it('scenario 13 — Firebase files from CP10 are included in indexed file count', async () => {
    const { root, cleanup } = createExternalFixture({ manifest: baseManifest });
    try {
      const paths = await new NodeProjectFileSource(root, {
        manifestScanRoots: ['functions'],
      }).listSourcePaths();
      expect(paths).toEqual(
        expect.arrayContaining(['firestore.rules', 'firebase.json', 'firestore.indexes.json']),
      );
      const readiness = await new ExternalTargetReadinessService().project({ projectRoot: root });
      expect(readiness.indexedFileCount).toBeGreaterThanOrEqual(paths.length);
    } finally {
      cleanup();
    }
  });

  it('scenario 14 — verification capability detection', async () => {
    const { root, cleanup } = createExternalFixture({ manifest: baseManifest });
    try {
      const readiness = await new ExternalTargetReadinessService().project({ projectRoot: root });
      expect(readiness.verification.build).toBe(true);
      expect(readiness.verification.test).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('scenario 15 — BLOCKED target cannot INVESTIGATE', async () => {
    const blocked = await new ExternalTargetReadinessService().project({
      projectRoot: mkdtempSync(path.join(tmpdir(), 'empty-')),
    });
    const service = new InvestigationService({
      sourceFiles: new MemoryProjectFileSource([]),
      analyzer: new DeterministicInvestigationAnalyzer(),
      clock: { now: () => new Date() },
      ids: { generate: () => 'inv-1' },
      logger: { record: () => undefined },
      projectProfile: 'EXTERNAL_TARGET',
      evaluateExternalTargetReadiness: async () => blocked,
    });
    await expect(service.investigate('Investigate supplier order bug.')).rejects.toMatchObject({
      code: 'EXTERNAL_TARGET_READINESS_BLOCKED',
    });
  });

  it('scenario 16 — BLOCKED target cannot PREPARE', async () => {
    const blocked = await new ExternalTargetReadinessService().project({
      projectRoot: mkdtempSync(path.join(tmpdir(), 'empty-')),
    });
    const runtime = new WorkspaceRuntimeService({
      loadProjectBrain: () => {
        throw new Error('should not load brain');
      },
      blueprintReader: { read: async () => ({ valid: true }) } as never,
      sourceFiles: { listSourcePaths: async () => [], readSourceFile: async () => '' },
      contextBuilder: new ContextBuilderService(),
      promptOrchestrator: { build: async () => ({}) } as never,
      workspaceBaseline: { readTextBaseline: () => null },
      providerExecution: { execute: async () => ({}) } as never,
      responseProcessor: { process: async () => ({}) } as never,
      changePlanner: { plan: () => ({}) } as never,
      fileApply: new FileApplyEngineService(new InMemoryFileSystemPort()),
      verification: { verify: async () => ({}) } as never,
      clock: { now: () => new Date() },
      ids: { generate: () => 'prep-1' },
      logger: { record: () => undefined },
      projectProfile: 'EXTERNAL_TARGET',
      evaluateExternalTargetReadiness: async () => blocked,
    });
    await expect(runtime.prepare('Create artifact.')).rejects.toBeInstanceOf(WorkspaceRuntimeError);
  });

  it('scenario 17 — BLOCKED target cannot APPLY', async () => {
    const blocked = await new ExternalTargetReadinessService().project({
      projectRoot: mkdtempSync(path.join(tmpdir(), 'empty-')),
    });
    const runtime = new WorkspaceRuntimeService({
      loadProjectBrain: () => ({}) as never,
      blueprintReader: { read: async () => ({}) } as never,
      sourceFiles: { listSourcePaths: async () => [], readSourceFile: async () => '' },
      contextBuilder: new ContextBuilderService(),
      promptOrchestrator: { build: async () => ({}) } as never,
      workspaceBaseline: { readTextBaseline: () => null },
      providerExecution: { execute: async () => ({}) } as never,
      responseProcessor: { process: async () => ({}) } as never,
      changePlanner: { plan: () => ({}) } as never,
      fileApply: new FileApplyEngineService(new InMemoryFileSystemPort()),
      verification: { verify: async () => ({}) } as never,
      clock: { now: () => new Date() },
      ids: { generate: () => 'apply-1' },
      logger: { record: () => undefined },
      projectProfile: 'EXTERNAL_TARGET',
      evaluateExternalTargetReadiness: async () => blocked,
    });
    await expect(runtime.approveAndApply('missing', true)).rejects.toMatchObject({
      code: 'EXTERNAL_TARGET_READINESS_BLOCKED',
    });
  });

  it('scenario 18 — READY_WITH_WARNINGS can continue normal workflow guard', () => {
    expect(() =>
      assertExternalTargetWorkflowAllowed(
        'EXTERNAL_TARGET',
        {
          schemaVersion: 1,
          status: 'READY_WITH_WARNINGS',
          profile: 'EXTERNAL_TARGET',
          projectId: 'x',
          projectName: 'X',
          projectRootDisplay: 'x',
          runtimeConnected: true,
          sourceRoots: [],
          testRoots: [],
          governanceDocuments: [],
          indexedFileCount: 1,
          protectedAreas: [],
          verification: { build: true, test: false, lint: false, typecheck: false },
          warnings: [{ code: 'WARN', severity: 'WARNING', message: 'warn' }],
          blockers: [],
        },
        'PREPARE',
      ),
    ).not.toThrow();
  });

  it('scenario 19 — BUILDERAI_SELF bypasses readiness guard', () => {
    expect(() =>
      assertExternalTargetWorkflowAllowed('BUILDERAI_SELF', undefined, 'PREPARE'),
    ).not.toThrow();
  });

  it('scenario 20 — server reload uses current configuration via fresh projection', async () => {
    const { root, cleanup } = createExternalFixture({ manifest: baseManifest });
    try {
      const first = await new ExternalTargetReadinessService().project({ projectRoot: root });
      writeFileSync(
        path.join(root, '.builderai', 'target-project.json'),
        `${JSON.stringify({ ...baseManifest, name: 'Renamed After Reload' }, null, 2)}\n`,
        'utf8',
      );
      const second = await new ExternalTargetReadinessService().project({ projectRoot: root });
      expect(second.projectName).toBe('Renamed After Reload');
      expect(first.projectName).toBe('CP11 Fixture');
    } finally {
      cleanup();
    }
  });

  it('scenario 21 — client tampering cannot authorize workflow through guard', () => {
    const tampered = {
      schemaVersion: 1 as const,
      status: 'READY' as const,
      profile: 'EXTERNAL_TARGET' as const,
      projectId: 'tampered',
      projectName: 'Tampered',
      projectRootDisplay: 'tampered',
      runtimeConnected: true,
      sourceRoots: [],
      testRoots: [],
      governanceDocuments: [],
      indexedFileCount: 0,
      protectedAreas: [],
      verification: { build: true, test: true, lint: true, typecheck: true },
      warnings: [],
      blockers: [
        { code: 'REAL', severity: 'BLOCKER' as const, message: 'still blocked server-side' },
      ],
    };
    expect(() =>
      assertExternalTargetWorkflowAllowed('EXTERNAL_TARGET', tampered, 'APPLY'),
    ).toThrow();
  });

  it('scenario 22 — CP6 Gate 2 regression', () => {
    const review = new Gate2ReviewProjectionService().project(
      createPlanFromOperations([
        createUpdateOperation('project-brain.json', '{}', '{"secret":true}\n'),
      ]),
      { readTextBaseline: () => null },
    );
    expect(review.operationDiffs[0]?.format).toBe('PROTECTED');
  });

  it('scenario 23 — CP7 investigation regression path remains available when READY', async () => {
    const { root, cleanup } = createExternalFixture({ manifest: baseManifest });
    try {
      const readiness = await new ExternalTargetReadinessService().project({ projectRoot: root });
      expect(readiness.status).not.toBe('BLOCKED');
      const reader = new ExternalTargetProjectReaderService(
        root,
        new NodeFileSystemDocumentSource(root),
      );
      expect((await reader.read()).valid).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('scenario 24 — CP8 memory protected-path safety regression', () => {
    const policy = createWorkspacePathProtectionPolicyFromManifest(['server/secrets/']);
    expect(
      sanitizeMemoryPaths(['src/app.ts', 'server/secrets/api-config.json'], 10, policy),
    ).toEqual(['src/app.ts']);
  });

  it('scenario 25 — CP9 verification diagnostics regression path unchanged', async () => {
    const { root, cleanup } = createExternalFixture({
      manifest: baseManifest,
      extraFiles: {
        'package.json': JSON.stringify({
          name: 'diag',
          scripts: { build: 'node -v', test: 'node -v' },
        }),
      },
    });
    try {
      const readiness = await new ExternalTargetReadinessService().project({ projectRoot: root });
      expect(readiness.verification.build).toBe(true);
      expect(readiness.verification.test).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('scenario 26 — CP10 path-protection/indexing regression', async () => {
    const { root, cleanup } = createExternalFixture({ manifest: baseManifest });
    try {
      const policy = createWorkspacePathProtectionPolicyFromManifest(['infra/']);
      const fileSystem = new InMemoryFileSystemPort();
      const result = await new FileApplyEngineService(
        fileSystem,
        policy.toFileApplyConfiguration(),
      ).apply(createPlan([createOperation('UPDATE_FILE', 'infra/pipeline.ts', 'next\n')]));
      expect(result.status).toBe('REJECTED');
      const packageValue = await new ContextBuilderService().build({
        projectBrain: {
          ...loadWorkspaceProjectBrain(root, 'EXTERNAL_TARGET'),
          tasks: [
            createTask({
              id: 'firebase-task',
              title: 'Update Firestore rules',
              description: 'Update firestore.rules for supplier access.',
              status: 'IN_PROGRESS',
            }),
          ],
        },
        blueprintReaderOutput: await new ExternalTargetProjectReaderService(
          root,
          new NodeFileSystemDocumentSource(root),
        ).read(),
        currentTaskId: 'firebase-task',
        sourceFileSource: new NodeProjectFileSource(root, { manifestScanRoots: ['functions'] }),
      });
      expect(
        packageValue.relevantFiles.map(({ path: filePath }: { path: string }) => filePath),
      ).toContain('firestore.rules');
    } finally {
      cleanup();
    }
  });
});
