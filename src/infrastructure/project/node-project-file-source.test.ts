import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { DEFAULT_CONTEXT_LIMITS, ContextBuilderService } from '@/core/context-builder';

import { NodeProjectFileSource } from './node-project-file-source';

describe('NodeProjectFileSource', () => {
  let root = '';

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'builderai-source-'));
    await mkdir(path.join(root, 'src', 'nested'), { recursive: true });
    await mkdir(path.join(root, 'src', 'node_modules'));
    await writeFile(path.join(root, 'src', 'a.ts'), 'export {};\n');
    await writeFile(path.join(root, 'src', 'nested', 'b.tsx'), 'export default null;\n');
    await writeFile(path.join(root, 'src', 'ignored.txt'), 'ignore');
    await writeFile(path.join(root, 'src', 'node_modules', 'dependency.ts'), 'ignore');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('lists supported source files deterministically and reads contained files', async () => {
    const source = new NodeProjectFileSource(root);
    expect(await source.listSourcePaths()).toEqual(['src/a.ts', 'src/nested/b.tsx']);
    expect(await source.readSourceFile('src/a.ts')).toBe('export {};\n');
  });

  it('rejects traversal and symbolic-link source reads', async () => {
    const source = new NodeProjectFileSource(root);
    await expect(source.readSourceFile('../outside.ts')).rejects.toThrow('invalid');
    const link = path.join(root, 'src', 'linked.ts');
    try {
      await symlink(path.join(root, 'src', 'a.ts'), link, 'file');
      await expect(source.readSourceFile('src/linked.ts')).rejects.toThrow('symbolic link');
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && Reflect.get(error, 'code') === 'EPERM') {
        return;
      }
      throw error;
    }
  });
});

describe('NodeProjectFileSource expanded indexing (Phase 1)', () => {
  let root = '';

  afterEach(async () => {
    if (root.length > 0) await rm(root, { recursive: true, force: true });
    root = '';
  });

  async function createFixture(): Promise<void> {
    root = await mkdtemp(path.join(os.tmpdir(), 'builderai-expanded-'));
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'main.ts'), 'export {};\n');
    await writeFile(path.join(root, 'package.json'), '{"name":"fixture"}\n');
    await writeFile(path.join(root, 'tsconfig.json'), '{}\n');
    await writeFile(path.join(root, 'tsconfig.build.json'), '{}\n');
    await mkdir(path.join(root, 'prisma'), { recursive: true });
    await writeFile(path.join(root, 'prisma', 'schema.prisma'), 'model User {}\n');
    await mkdir(path.join(root, 'tests', 'integration'), { recursive: true });
    await writeFile(path.join(root, 'tests', 'integration', 'app.test.ts'), 'test();\n');
    await mkdir(path.join(root, 'app', 'api'), { recursive: true });
    await writeFile(path.join(root, 'app', 'api', 'route.ts'), 'export {};\n');
    await mkdir(path.join(root, 'packages', 'web', 'src'), { recursive: true });
    await writeFile(path.join(root, 'packages', 'web', 'src', 'index.ts'), 'export {};\n');
    await mkdir(path.join(root, 'dist', 'compiled'), { recursive: true });
    await writeFile(path.join(root, 'dist', 'compiled', 'bundle.js'), 'ignored\n');
    await mkdir(path.join(root, '.next', 'cache'), { recursive: true });
    await writeFile(path.join(root, '.next', 'cache', 'page.js'), 'ignored\n');
    await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(path.join(root, 'node_modules', 'pkg', 'index.ts'), 'ignored\n');
    await writeFile(path.join(root, '.env'), 'SECRET=1\n');
    await writeFile(path.join(root, '.env.local'), 'SECRET=1\n');
    await writeFile(path.join(root, 'package-lock.json'), '{}\n');
    await writeFile(path.join(root, 'pnpm-lock.yaml'), 'ignored\n');
    await writeFile(path.join(root, 'yarn.lock'), 'ignored\n');
    await writeFile(path.join(root, 'README.md'), '# ignore md in Phase 1\n');
    await writeFile(path.join(root, 'notes.txt'), 'ignore\n');
    await mkdir(path.join(root, 'public'), { recursive: true });
    await writeFile(path.join(root, 'public', 'logo.png'), 'binary\n');
  }

  it('discovers root configs, prisma schema, tests, app routes, and monorepo packages', async () => {
    await createFixture();
    const paths = await new NodeProjectFileSource(root).listSourcePaths();
    expect(paths).toEqual(
      expect.arrayContaining([
        'app/api/route.ts',
        'package.json',
        'packages/web/src/index.ts',
        'prisma/schema.prisma',
        'src/main.ts',
        'tests/integration/app.test.ts',
        'tsconfig.build.json',
        'tsconfig.json',
      ]),
    );
    expect(paths).not.toEqual(
      expect.arrayContaining(['README.md', 'notes.txt', 'public/logo.png']),
    );
  });

  it('skips missing scan roots without error', async () => {
    await createFixture();
    await rm(path.join(root, 'drizzle'), { recursive: true, force: true });
    await expect(new NodeProjectFileSource(root).listSourcePaths()).resolves.toEqual(
      expect.any(Array),
    );
  });

  it('ignores generated, cache, and dependency directories', async () => {
    await createFixture();
    const paths = await new NodeProjectFileSource(root).listSourcePaths();
    expect(paths.some((entry) => entry.includes('dist/'))).toBe(false);
    expect(paths.some((entry) => entry.includes('.next/'))).toBe(false);
    expect(paths.some((entry) => entry.includes('node_modules/'))).toBe(false);
  });

  it('excludes env files and lockfiles even when they use allowed extensions', async () => {
    await createFixture();
    const paths = await new NodeProjectFileSource(root).listSourcePaths();
    expect(paths).not.toEqual(
      expect.arrayContaining([
        '.env',
        '.env.local',
        'package-lock.json',
        'pnpm-lock.yaml',
        'yarn.lock',
      ]),
    );
  });

  it('discovers additional configured scan roots', async () => {
    await createFixture();
    await mkdir(path.join(root, 'custom-root', 'nested'), { recursive: true });
    await writeFile(path.join(root, 'custom-root', 'nested', 'feature.ts'), 'export {};\n');
    const paths = await new NodeProjectFileSource(root, {
      extraScanRoots: ['custom-root'],
    }).listSourcePaths();
    expect(paths).toContain('custom-root/nested/feature.ts');
  });

  it('returns deterministic ordering across repeated listings', async () => {
    await createFixture();
    const source = new NodeProjectFileSource(root);
    const first = await source.listSourcePaths();
    const second = await source.listSourcePaths();
    expect(first).toEqual(second);
    expect([...first]).toEqual([...first].sort());
  });

  it('does not traverse symlinked directories outside the project root', async () => {
    await createFixture();
    const outside = await mkdtemp(path.join(os.tmpdir(), 'builderai-outside-'));
    try {
      await writeFile(path.join(outside, 'secret.ts'), 'export const secret = 1;\n');
      const linkDir = path.join(root, 'linked-out');
      try {
        await symlink(outside, linkDir, 'dir');
      } catch (error: unknown) {
        if (typeof error === 'object' && error !== null && Reflect.get(error, 'code') === 'EPERM') {
          return;
        }
        throw error;
      }
      const paths = await new NodeProjectFileSource(root).listSourcePaths();
      expect(paths.some((entry) => entry.includes('secret.ts'))).toBe(false);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('lists a reasonably large fixture deterministically', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'builderai-large-'));
    await mkdir(path.join(root, 'src'), { recursive: true });
    const expected: string[] = [];
    for (let index = 0; index < 120; index += 1) {
      const relativePath = `src/file-${String(index).padStart(3, '0')}.ts`;
      await writeFile(
        path.join(root, ...relativePath.split('/')),
        `export const v${index} = ${index};\n`,
      );
      expected.push(relativePath);
    }
    const paths = await new NodeProjectFileSource(root).listSourcePaths();
    expect(paths).toEqual(expected);
  }, 30_000);
});

describe('ContextBuilder maxSourcePaths catalog boundary', () => {
  it('accepts up to the default 15,000 discovered source paths', async () => {
    const listedPaths = Array.from({ length: DEFAULT_CONTEXT_LIMITS.maxSourcePaths }, (_, index) =>
      index === 0 ? 'src/seed.ts' : `src/file-${index}.ts`,
    );
    const service = new ContextBuilderService();
    const input = await import('../../core/context-builder/test/context-builder.fixture').then(
      ({ createContextInput }) => createContextInput(),
    );
    await expect(
      service.build({
        ...input,
        sourceFileSource: {
          listSourcePaths: async () => listedPaths,
          readSourceFile: async () => 'export {};\n',
        },
      }),
    ).resolves.toBeDefined();
  });

  it('rejects more than the default 15,000 discovered source paths', async () => {
    const listedPaths = Array.from(
      { length: DEFAULT_CONTEXT_LIMITS.maxSourcePaths + 1 },
      (_, index) => `src/file-${index}.ts`,
    );
    const service = new ContextBuilderService();
    const input = await import('../../core/context-builder/test/context-builder.fixture').then(
      ({ createContextInput }) => createContextInput(),
    );
    await expect(
      service.build({
        ...input,
        sourceFileSource: {
          listSourcePaths: async () => listedPaths,
          readSourceFile: async () => 'export {};\n',
        },
      }),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: 'CONTEXT_SIZE_EXCEEDED' })],
    });
  });
});
