import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ContextBuilderService } from '../../context-builder';
import { MemoryProjectFileSource } from '../../context-builder/test/context-builder.fixture';
import { ExternalTargetProjectReaderService } from '../external-target-project-reader.service';
import { createTask } from '../../project-brain/test/project-brain.fixture';
import { loadWorkspaceProjectBrain } from '../workspace-project-brain.loader';
import {
  parseTargetProjectManifest,
  TargetProjectManifestValidationError,
} from '../target-project-manifest.validator';
import { PrepareScopeService } from '../../update-scope/services/prepare-scope.service';
import { MemoryWorkspaceBaselinePort } from '../../update-scope/test/workspace-baseline.fixture';
import { NodeFileSystemDocumentSource } from '../../../infrastructure/blueprint-reader';
import { NodeProjectFileSource } from '../../../infrastructure/project';
import { DependencyResolutionService } from '../../context-builder/services/dependency-resolution.service';
import { ZYRO_STYLE_FIXTURE_ROOT } from './external-target.fixture';

function paths(files: readonly { readonly path: string }[]): string[] {
  return files.map(({ path: filePath }) => filePath);
}

function evidenceKinds(
  files: readonly { readonly selectionEvidence?: readonly { kind: string }[] }[],
) {
  return files.flatMap((file) => file.selectionEvidence?.map(({ kind }) => kind) ?? []);
}

async function buildExternalTargetContext(
  taskText: string,
  source = new NodeProjectFileSource(ZYRO_STYLE_FIXTURE_ROOT),
) {
  const reader = new ExternalTargetProjectReaderService(
    ZYRO_STYLE_FIXTURE_ROOT,
    new NodeFileSystemDocumentSource(ZYRO_STYLE_FIXTURE_ROOT),
  );
  const readerOutput = await reader.read();
  const brain = loadWorkspaceProjectBrain(ZYRO_STYLE_FIXTURE_ROOT, 'EXTERNAL_TARGET');
  const task = createTask({
    id: 'external-task',
    title: taskText.slice(0, 120),
    description: taskText,
    status: 'IN_PROGRESS',
  });
  const packageValue = await new ContextBuilderService().build({
    projectBrain: { ...brain, tasks: [task] },
    blueprintReaderOutput: readerOutput,
    currentTaskId: task.id,
    sourceFileSource: source,
  });
  return packageValue;
}

function scopeBaselineFor(paths: readonly string[]): MemoryWorkspaceBaselinePort {
  return new MemoryWorkspaceBaselinePort(
    Object.fromEntries(paths.map((entry) => [entry, `// baseline for ${entry}\n`])),
  );
}

describe('external target full-stack context coverage', () => {
  it('scenario 1 — explicit single-file task keeps HARD scope while allowing support context', async () => {
    const explicitPath = 'src/features/supplier-orders/OrderCancellationDialog.tsx';
    const taskText = `Update ${explicitPath} to improve cancellation confirmation copy.`;
    const packageValue = await buildExternalTargetContext(taskText);
    expect(paths(packageValue.relevantFiles)).toContain(explicitPath);
    expect(evidenceKinds(packageValue.relevantFiles)).toContain('EXPLICIT_PATH');

    const scope = new PrepareScopeService().resolve({
      taskText,
      sourcePaths: await new NodeProjectFileSource(ZYRO_STYLE_FIXTURE_ROOT).listSourcePaths(),
      baselinePort: scopeBaselineFor([explicitPath]),
    });
    expect(scope.scopePlan.mode).toBe('SOFT');
    expect(scope.scopePlan.preferredUpdatePaths).toEqual([explicitPath]);
    expect(paths(packageValue.relevantFiles).some((entry) => entry.startsWith('server/'))).toBe(
      true,
    );
  });

  it('scenario 2 — cross-stack supplier cancellation includes frontend, backend, shared, and test evidence', async () => {
    const packageValue = await buildExternalTargetContext(
      'Add supplier order cancellation across the React supplier hub UI and Express backend service.',
    );
    const selected = paths(packageValue.relevantFiles);
    expect(selected.some((entry) => entry.includes('supplier-orders'))).toBe(true);
    expect(selected.some((entry) => entry.startsWith('src/'))).toBe(true);
    expect(selected.some((entry) => entry.startsWith('server/'))).toBe(true);
    expect(
      selected.some(
        (entry) => entry.includes('shared/order-types') || entry.includes('validation'),
      ),
    ).toBe(true);
    expect(selected.some((entry) => entry.includes('supplier-order-cancellation.test'))).toBe(true);
    expect(evidenceKinds(packageValue.relevantFiles)).toEqual(
      expect.arrayContaining(['TASK_KEYWORD', 'SOURCE_CATEGORY']),
    );
  });

  it('scenario 3 — backend-only task prioritizes server routes/services over frontend UI', async () => {
    const packageValue = await buildExternalTargetContext(
      'Fix the Express supplier order cancellation API route validation on the backend server.',
    );
    const selected = paths(packageValue.relevantFiles);
    expect(selected.filter((entry) => entry.startsWith('server/')).length).toBeGreaterThan(0);
    expect(selected.filter((entry) => entry.includes('SupplierOrdersPage'))).toHaveLength(0);
  });

  it('scenario 4 — test-focused task prioritizes tests while keeping implementation support', async () => {
    const packageValue = await buildExternalTargetContext(
      'Fix failing supplier cancellation tests and keep backend validation aligned.',
    );
    const selected = paths(packageValue.relevantFiles);
    expect(selected.some((entry) => entry.includes('supplier-order-cancellation.test'))).toBe(true);
    expect(selected.some((entry) => entry.startsWith('server/'))).toBe(true);
    expect(evidenceKinds(packageValue.relevantFiles)).toEqual(
      expect.arrayContaining(['NEARBY_TEST']),
    );
  });

  it('scenario 5 — public/static indexing stays disabled without manifest opt-in', async () => {
    const withoutOptIn = await new NodeProjectFileSource(ZYRO_STYLE_FIXTURE_ROOT).listSourcePaths();
    expect(withoutOptIn.some((entry) => entry.startsWith('public/'))).toBe(false);

    const withOptIn = await new NodeProjectFileSource(ZYRO_STYLE_FIXTURE_ROOT, {
      staticScanRoots: ['public'],
    }).listSourcePaths();
    expect(withOptIn).toContain('public/supplier-hub-copy.html');
  });

  it('scenario 6 — large unrelated repository still selects relevant supplier-order files deterministically', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'builderai-large-cross-stack-'));
    try {
      const noisePaths: Array<{ path: string; content: string }> = [];
      for (let index = 0; index < 120; index += 1) {
        const relativePath = `src/noise/module-${String(index).padStart(3, '0')}/Widget.tsx`;
        noisePaths.push({
          path: relativePath,
          content: `export function Widget${index}() { return null; }\n`,
        });
      }
      noisePaths.push(
        {
          path: 'src/features/supplier-orders/OrderCancellationDialog.tsx',
          content: 'export function OrderCancellationDialog() { return null; }\n',
        },
        {
          path: 'server/services/order-cancellation.service.ts',
          content: 'export function cancelSupplierOrder() { return true; }\n',
        },
        {
          path: 'src/shared/order-types.ts',
          content: 'export type SupplierOrder = { id: string };\n',
        },
        {
          path: 'tests/supplier-order-cancellation.test.ts',
          content: "import test from 'node:test';\ntest('cancellation', () => {});\n",
        },
      );
      const source = new MemoryProjectFileSource(noisePaths);
      const resolver = new DependencyResolutionService();
      const resolution = await resolver.resolveFiles(
        await source.listSourcePaths(),
        source,
        'Add supplier order cancellation across frontend and backend.',
        [],
        [],
        36,
      );
      const selected = paths(resolution.files);
      expect(selected.some((entry) => entry.includes('supplier-orders'))).toBe(true);
      expect(selected.some((entry) => entry.startsWith('server/'))).toBe(true);
      expect(resolution.reads).toBeLessThanOrEqual(36);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('scenario 7 — supporting backend context does not expand HARD frontend update scope', async () => {
    const explicitPath = 'src/features/supplier-orders/OrderCancellationDialog.tsx';
    const taskText = `Update only ${explicitPath} for accessibility copy.`;
    const packageValue = await buildExternalTargetContext(taskText);
    expect(paths(packageValue.relevantFiles).some((entry) => entry.startsWith('server/'))).toBe(
      true,
    );
    const scope = new PrepareScopeService().resolve({
      taskText,
      sourcePaths: await new NodeProjectFileSource(ZYRO_STYLE_FIXTURE_ROOT).listSourcePaths(),
      baselinePort: scopeBaselineFor([explicitPath]),
    });
    expect(scope.scopePlan.mode).toBe('HARD');
    expect(scope.scopePlan.preferredUpdatePaths).toEqual([explicitPath]);
  });

  it('scenario 8 — repeated prepare selects deterministic file ordering and evidence', async () => {
    const taskText = 'Add supplier order cancellation across frontend and backend.';
    const first = await buildExternalTargetContext(taskText);
    const second = await buildExternalTargetContext(taskText);
    expect(paths(first.relevantFiles)).toEqual(paths(second.relevantFiles));
    expect(first.relevantFiles.map((file) => file.selectionEvidence)).toEqual(
      second.relevantFiles.map((file) => file.selectionEvidence),
    );
  });
});

describe('manifest source layout validation', () => {
  it('rejects unsafe manifest scan roots', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'builderai-manifest-roots-'));
    try {
      await mkdir(path.join(root, '.builderai'), { recursive: true });
      await writeFile(
        path.join(root, '.builderai/target-project.json'),
        JSON.stringify({
          schemaVersion: 1,
          projectId: 'unsafe-root',
          name: 'Unsafe',
          vision: 'Test',
          currentMilestone: 'Test',
          sourceRoots: ['../escape'],
        }),
        'utf8',
      );
      await expect(() =>
        parseTargetProjectManifest(
          JSON.parse(
            readFileSync(path.join(root, '.builderai/target-project.json'), 'utf8'),
          ) as unknown,
        ),
      ).toThrow(TargetProjectManifestValidationError);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
