import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ContextBuilderService } from '../../context-builder';
import { extractExplicitPathMentions } from '../../context-builder/internal/explicit-path-mentions';
import { FileApplyEngineService } from '../../file-apply';
import {
  InMemoryFileSystemPort,
  createOperation,
  createPlan,
} from '../../file-apply/test/file-apply.fixture';
import { NodeProjectFileSource } from '../../../infrastructure/project';
import { RepositorySearchService } from '../../../application/workspace/investigation/repository-search.service';
import { sanitizeMemoryPaths } from '../../../application/workspace/project-memory/project-memory-sanitize';
import { Gate2ReviewProjectionService } from '../../../application/workspace/gate2-review/gate2-review-projection.service';
import {
  createPlanFromOperations,
  createUpdateOperation,
} from '../../../application/workspace/gate2-review/gate2-review.fixture';
import { createWorkspacePathProtectionPolicyFromManifest } from '../workspace-path-protection';
import { ExternalTargetProjectReaderService } from '../external-target-project-reader.service';
import { loadWorkspaceProjectBrain } from '../workspace-project-brain.loader';
import { createTask } from '../../project-brain/test/project-brain.fixture';
import { NodeFileSystemDocumentSource } from '../../../infrastructure/blueprint-reader';
import { ZYRO_STYLE_FIXTURE_ROOT } from './external-target.fixture';

function createCp10FixtureRoot(): { readonly root: string; readonly cleanup: () => void } {
  const root = mkdtempSync(path.join(tmpdir(), 'builderai-cp10-'));
  cpSync(ZYRO_STYLE_FIXTURE_ROOT, root, { recursive: true });
  writeFileSync(
    path.join(root, '.builderai', 'target-project.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        projectId: 'zyro-style-fixture',
        name: 'CP10 Firebase Fixture',
        vision: 'Exercise Firebase indexing and protected areas.',
        currentMilestone: 'CP10',
        protectedAreas: ['infra/', 'server/secrets/'],
        sourceRoots: ['functions'],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

async function buildFirebaseContext(root: string, taskText: string) {
  const source = new NodeProjectFileSource(root, { manifestScanRoots: ['functions'] });
  const reader = new ExternalTargetProjectReaderService(
    root,
    new NodeFileSystemDocumentSource(root),
  );
  const readerOutput = await reader.read();
  const brain = loadWorkspaceProjectBrain(root, 'EXTERNAL_TARGET');
  const task = createTask({
    id: 'firebase-task',
    title: taskText.slice(0, 120),
    description: taskText,
    status: 'IN_PROGRESS',
  });
  return new ContextBuilderService().build({
    projectBrain: { ...brain, tasks: [task] },
    blueprintReaderOutput: readerOutput,
    currentTaskId: task.id,
    sourceFileSource: source,
  });
}

describe('CP10 firebase protection and indexing', () => {
  it('scenario 1 — discovers firestore.rules', async () => {
    const paths = await new NodeProjectFileSource(ZYRO_STYLE_FIXTURE_ROOT).listSourcePaths();
    expect(paths).toContain('firestore.rules');
  });

  it('scenario 2 — discovers storage.rules', async () => {
    const paths = await new NodeProjectFileSource(ZYRO_STYLE_FIXTURE_ROOT).listSourcePaths();
    expect(paths).toContain('storage.rules');
  });

  it('scenario 3 — discovers firebase.json', async () => {
    const paths = await new NodeProjectFileSource(ZYRO_STYLE_FIXTURE_ROOT).listSourcePaths();
    expect(paths).toContain('firebase.json');
  });

  it('scenario 4 — discovers firestore.indexes.json', async () => {
    const paths = await new NodeProjectFileSource(ZYRO_STYLE_FIXTURE_ROOT).listSourcePaths();
    expect(paths).toContain('firestore.indexes.json');
  });

  it('scenario 5 — firebase task retrieves relevant rules and config', async () => {
    const packageValue = await buildFirebaseContext(
      ZYRO_STYLE_FIXTURE_ROOT,
      'Update Firestore security rules for supplier order cancellation in Firebase.',
    );
    const selected = packageValue.relevantFiles.map(({ path: filePath }) => filePath);
    expect(selected).toEqual(
      expect.arrayContaining(['firestore.rules', 'firebase.json', 'firestore.indexes.json']),
    );
  });

  it('scenario 6 — explicit Firebase path gets top relevance', async () => {
    const sourcePaths = await new NodeProjectFileSource(ZYRO_STYLE_FIXTURE_ROOT).listSourcePaths();
    const explicit = extractExplicitPathMentions(
      'Please review firestore.rules before changing supplier order access.',
      sourcePaths,
    );
    expect(explicit).toContain('firestore.rules');
    const packageValue = await buildFirebaseContext(
      ZYRO_STYLE_FIXTURE_ROOT,
      'Please review firestore.rules before changing supplier order access.',
    );
    const top = packageValue.relevantFiles[0]?.path;
    expect(top).toBe('firestore.rules');
  });

  it('scenario 7 — manifest protected file apply rejected', async () => {
    const policy = createWorkspacePathProtectionPolicyFromManifest(['infra/']);
    const fileSystem = new InMemoryFileSystemPort({ 'infra/pipeline.ts': 'old\n' });
    const result = await new FileApplyEngineService(
      fileSystem,
      policy.toFileApplyConfiguration(),
    ).apply(createPlan([createOperation('UPDATE_FILE', 'infra/pipeline.ts', 'new\n')]));
    expect(result.status).toBe('REJECTED');
    expect(result.errors[0]?.code).toBe('PROTECTED_PATH');
  });

  it('scenario 8 — manifest protected directory descendant rejected', async () => {
    const policy = createWorkspacePathProtectionPolicyFromManifest(['server/secrets/']);
    expect(policy.isMutationProtected('server/secrets/api-config.json')).toBe(true);
    const fileSystem = new InMemoryFileSystemPort();
    const result = await new FileApplyEngineService(
      fileSystem,
      policy.toFileApplyConfiguration(),
    ).apply(
      createPlan([createOperation('UPDATE_FILE', 'server/secrets/api-config.json', '{"x":1}\n')]),
    );
    expect(result.status).toBe('REJECTED');
  });

  it('scenario 9 — mandatory protection cannot be overridden', () => {
    const policy = createWorkspacePathProtectionPolicyFromManifest(['src/']);
    expect(policy.isNeverExpose('project-brain.json')).toBe(true);
    expect(policy.isNeverExpose('.env.local')).toBe(true);
  });

  it('scenario 10 — Windows/POSIX path normalization parity', () => {
    const policy = createWorkspacePathProtectionPolicyFromManifest(['infra/']);
    expect(policy.isMutationProtected('infra\\deploy.ts')).toBe(true);
    expect(policy.isMutationProtected('infra/deploy.ts')).toBe(true);
  });

  it('scenario 11 — malformed protectedAreas fails closed during manifest parse', () => {
    expect(() => createWorkspacePathProtectionPolicyFromManifest(['../escape'])).toThrow();
  });

  it('scenario 12 — Gate 2 secret content suppression', () => {
    const policy = createWorkspacePathProtectionPolicyFromManifest(['server/secrets/']);
    const review = new Gate2ReviewProjectionService(undefined, policy).project(
      createPlanFromOperations([
        createUpdateOperation(
          'server/secrets/api-config.json',
          '{"token":"hidden"}\n',
          '{"token":"exposed"}\n',
        ),
      ]),
      {
        readTextBaseline(logicalPath) {
          return logicalPath === 'server/secrets/api-config.json'
            ? {
                logicalPath,
                content: '{"token":"hidden"}\n',
                checksum: { algorithm: 'SHA-256', value: 'a'.repeat(64) },
                sizeBytes: 20,
              }
            : null;
        },
      },
    );
    expect(review.operationDiffs[0]?.format).toBe('PROTECTED');
    expect(JSON.stringify(review)).not.toContain('hidden');
    expect(JSON.stringify(review)).not.toContain('exposed');
  });

  it('scenario 13 — investigation secret exclusion', async () => {
    const policy = createWorkspacePathProtectionPolicyFromManifest(['server/secrets/']);
    const sourcePaths = await new NodeProjectFileSource(ZYRO_STYLE_FIXTURE_ROOT).listSourcePaths();
    const search = await new RepositorySearchService(undefined, policy).search(
      sourcePaths,
      ['supplier'],
      async (logicalPath) => {
        if (logicalPath === 'server/secrets/api-config.json') return '{"provider":"example"}\n';
        if (logicalPath === 'firestore.rules') return 'allow read: if true;\n';
        return '';
      },
    );
    expect(search.matches.some(({ logicalPath }) => logicalPath.includes('secrets'))).toBe(false);
  });

  it('scenario 14 — readable Firebase rules available to investigation when policy permits', async () => {
    const policy = createWorkspacePathProtectionPolicyFromManifest(['infra/']);
    const sourcePaths = await new NodeProjectFileSource(ZYRO_STYLE_FIXTURE_ROOT).listSourcePaths();
    const search = await new RepositorySearchService(undefined, policy).search(
      sourcePaths,
      ['orders'],
      async (logicalPath) => (logicalPath === 'firestore.rules' ? 'match /orders' : ''),
    );
    expect(search.matches.some(({ logicalPath }) => logicalPath === 'firestore.rules')).toBe(true);
  });

  it('scenario 15 — project-memory protected-path safety', () => {
    const policy = createWorkspacePathProtectionPolicyFromManifest(['server/secrets/']);
    expect(
      sanitizeMemoryPaths(
        ['src/app.ts', 'server/secrets/api-config.json', '.env.local'],
        10,
        policy,
      ),
    ).toEqual(['src/app.ts']);
  });

  it('scenario 16 — normal non-protected apply regression', async () => {
    const policy = createWorkspacePathProtectionPolicyFromManifest(['infra/']);
    const fileSystem = new InMemoryFileSystemPort({ 'src/app.ts': 'old\n' });
    const result = await new FileApplyEngineService(
      fileSystem,
      policy.toFileApplyConfiguration(),
    ).apply(createPlan([createOperation('UPDATE_FILE', 'src/app.ts', 'new\n')]));
    expect(result.status).toBe('APPLIED');
  });

  it('scenario 17 — BUILDERAI_SELF regression', () => {
    const policy = createWorkspacePathProtectionPolicyFromManifest(undefined);
    expect(policy.isMutationProtected('src/app.ts')).toBe(false);
    expect(policy.isNeverExpose('AGENTS.md')).toBe(true);
  });

  it('scenario 18 — zyro-style external-target happy path', async () => {
    const { root, cleanup } = createCp10FixtureRoot();
    try {
      const paths = await new NodeProjectFileSource(root, {
        manifestScanRoots: ['functions'],
      }).listSourcePaths();
      expect(paths).toEqual(
        expect.arrayContaining([
          'firestore.rules',
          'storage.rules',
          'firebase.json',
          'firestore.indexes.json',
          'functions/src/index.ts',
          'functions/package.json',
        ]),
      );
      const reader = new ExternalTargetProjectReaderService(
        root,
        new NodeFileSystemDocumentSource(root),
      );
      expect((await reader.read()).valid).toBe(true);
    } finally {
      cleanup();
    }
  });
});
