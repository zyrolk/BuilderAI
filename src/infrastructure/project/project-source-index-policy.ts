/**
 * Repository indexing policy for {@link NodeProjectFileSource} (Phase 1, ADR-022).
 * Discovery expands the candidate path catalog; Context Builder selection limits are unchanged.
 */

export const DEFAULT_SCAN_ROOTS: readonly string[] = [
  'assets',
  'src',
  'app',
  'pages',
  'components',
  'features',
  'lib',
  'shared',
  'client',
  'server',
  'api',
  'backend',
  'prisma',
  'drizzle',
  'migrations',
  'tests',
  'test',
  '__tests__',
  'scripts',
  'apps',
  'packages',
] as const;

/** Scan roots that must not be supplied through {@link parseExtraSourceScanRoots}. */
export const BLOCKED_EXTRA_SCAN_ROOTS: ReadonlySet<string> = new Set([
  '.builderai',
  '.git',
  'coverage',
  'dist',
  'docs',
  'node_modules',
  'public',
  'static',
]);

/** Binary or asset extensions excluded from static/public opt-in indexing. */
export const BINARY_OR_ASSET_EXTENSIONS: ReadonlySet<string> = new Set([
  '.bin',
  '.eot',
  '.gif',
  '.ico',
  '.jpeg',
  '.jpg',
  '.mp3',
  '.mp4',
  '.pdf',
  '.png',
  '.ttf',
  '.webp',
  '.woff',
  '.woff2',
  '.zip',
]);

export const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.cjs',
  '.css',
  '.htm',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.mjs',
  '.prisma',
  '.sql',
  '.ts',
  '.tsx',
]);

export const EXCLUDED_DIRECTORIES: ReadonlySet<string> = new Set([
  '.cache',
  '.git',
  '.next',
  '.nuxt',
  '.output',
  '.parcel-cache',
  '.svelte-kit',
  '.turbo',
  '.vercel',
  'build',
  'coverage',
  'dist',
  'generated',
  'node_modules',
  'out',
  'playwright-report',
  'storybook-static',
  'temp',
  'test-results',
  'tmp',
  'vendor',
]);

const EXCLUDED_FILE_NAMES: ReadonlySet<string> = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);

const MAX_EXTRA_SCAN_ROOTS = 32;

export interface ProjectSourceIndexOptions {
  readonly extraScanRoots?: readonly string[];
  readonly manifestScanRoots?: readonly string[];
  readonly staticScanRoots?: readonly string[];
}

export function resolveScanRoots(
  extraScanRoots: readonly string[] = [],
  manifestScanRoots: readonly string[] = [],
): readonly string[] {
  const merged = [...DEFAULT_SCAN_ROOTS, ...extraScanRoots, ...manifestScanRoots];
  return [...new Set(merged)];
}

export function resolveStaticScanRoots(staticScanRoots: readonly string[] = []): readonly string[] {
  return [...new Set(staticScanRoots)];
}

export function parseExtraSourceScanRoots(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw.trim().length === 0) return [];
  const roots: string[] = [];
  const seen = new Set<string>();
  for (const segment of raw.split(',')) {
    const normalized = normalizeScanRoot(segment);
    if (normalized === undefined) continue;
    if (seen.has(normalized)) continue;
    if (BLOCKED_EXTRA_SCAN_ROOTS.has(normalized)) {
      throw new Error(
        `BUILDERAI_EXTRA_SOURCE_SCAN_ROOTS must not include blocked root '${normalized}'.`,
      );
    }
    if (DEFAULT_SCAN_ROOTS.includes(normalized)) continue;
    seen.add(normalized);
    roots.push(normalized);
    if (roots.length > MAX_EXTRA_SCAN_ROOTS) {
      throw new Error(
        `BUILDERAI_EXTRA_SOURCE_SCAN_ROOTS must not list more than ${MAX_EXTRA_SCAN_ROOTS} additional roots.`,
      );
    }
  }
  return roots;
}

function normalizeScanRoot(value: string): string | undefined {
  const trimmed = value.trim().replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (trimmed.length === 0) return undefined;
  if (
    trimmed.startsWith('/') ||
    /^[a-z]:\//i.test(trimmed) ||
    trimmed.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(
      'BUILDERAI_EXTRA_SOURCE_SCAN_ROOTS entries must be safe repository-relative paths.',
    );
  }
  return trimmed;
}

export function isExcludedFileName(name: string): boolean {
  if (EXCLUDED_FILE_NAMES.has(name)) return true;
  if (name === '.env') return true;
  if (name.startsWith('.env.')) return true;
  return false;
}

export function hasSourceExtension(fileName: string): boolean {
  return hasIndexableSourceExtension(fileName, false);
}

export function hasIndexableSourceExtension(fileName: string, staticRoot: boolean): boolean {
  const extension = pathExtname(fileName);
  if (!SOURCE_EXTENSIONS.has(extension)) return false;
  if (staticRoot && BINARY_OR_ASSET_EXTENSIONS.has(extension)) return false;
  return true;
}

export function isRootConfigFile(fileName: string): boolean {
  if (isExcludedFileName(fileName)) return false;
  if (fileName === 'package.json' || fileName === 'components.json') return true;
  if (fileName === 'tsconfig.json' || /^tsconfig\.[^/\\]+\.json$/u.test(fileName)) return true;
  if (/^next\.config\.(cjs|js|mjs|ts)$/u.test(fileName)) return true;
  if (/^vite\.config\.(cjs|js|mjs|ts)$/u.test(fileName)) return true;
  if (/^eslint\.config\.(cjs|js|mjs|ts)$/u.test(fileName)) return true;
  if (/^\.eslintrc(\.(cjs|js|json|mjs|yaml|yml))?$/u.test(fileName)) return true;
  if (/^prettier\.config\.(cjs|js|mjs|ts)$/u.test(fileName)) return true;
  if (/^\.prettierrc(\.(cjs|js|json|mjs|yaml|yml))?$/u.test(fileName)) return true;
  if (/^tailwind\.config\.(cjs|js|mjs|ts)$/u.test(fileName)) return true;
  if (/^postcss\.config\.(cjs|js|mjs|ts)$/u.test(fileName)) return true;
  if (/^drizzle\.config\.(cjs|js|mjs|ts)$/u.test(fileName)) return true;
  if (/^vitest\.config\.(cjs|js|mjs|ts)$/u.test(fileName)) return true;
  if (/^jest\.config\.(cjs|js|mjs|ts)$/u.test(fileName)) return true;
  if (/^playwright\.config\.(cjs|js|mjs|ts)$/u.test(fileName)) return true;
  return false;
}

function pathExtname(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex <= 0) return '';
  return fileName.slice(dotIndex).toLowerCase();
}
