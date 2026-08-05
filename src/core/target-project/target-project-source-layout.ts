export const MANIFEST_STATIC_SCAN_ROOTS = ['public', 'static'] as const;

export const BLOCKED_MANIFEST_SCAN_ROOTS: ReadonlySet<string> = new Set([
  '.builderai',
  '.git',
  '.next',
  'build',
  'coverage',
  'dist',
  'docs',
  'node_modules',
  'out',
]);

export const MAX_MANIFEST_SOURCE_ROOTS = 16 as const;
export const MAX_MANIFEST_STATIC_SOURCE_ROOTS = 4 as const;

const STATIC_ROOT_SET = new Set<string>(MANIFEST_STATIC_SCAN_ROOTS);

export function parseManifestSourceRoots(
  values: readonly string[] | undefined,
  fieldName: string,
): readonly string[] {
  if (values === undefined) return [];
  if (!Array.isArray(values)) {
    throw new Error(`${fieldName} must be an array when provided.`);
  }
  if (values.length > MAX_MANIFEST_SOURCE_ROOTS) {
    throw new Error(`${fieldName} must not list more than ${MAX_MANIFEST_SOURCE_ROOTS} roots.`);
  }
  const roots: string[] = [];
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    const normalized = normalizeManifestScanRoot(value, `${fieldName}[${index}]`);
    if (seen.has(normalized)) continue;
    if (BLOCKED_MANIFEST_SCAN_ROOTS.has(normalized)) {
      throw new Error(`${fieldName} must not include blocked root '${normalized}'.`);
    }
    if (STATIC_ROOT_SET.has(normalized)) {
      throw new Error(
        `${fieldName} must not include '${normalized}'; use staticSourceRoots for public/static opt-in.`,
      );
    }
    seen.add(normalized);
    roots.push(normalized);
  }
  return roots;
}

export function parseManifestStaticSourceRoots(
  values: readonly string[] | undefined,
): readonly string[] {
  if (values === undefined) return [];
  if (!Array.isArray(values)) {
    throw new Error('staticSourceRoots must be an array when provided.');
  }
  if (values.length > MAX_MANIFEST_STATIC_SOURCE_ROOTS) {
    throw new Error(
      `staticSourceRoots must not list more than ${MAX_MANIFEST_STATIC_SOURCE_ROOTS} roots.`,
    );
  }
  const roots: string[] = [];
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    const normalized = normalizeManifestScanRoot(value, `staticSourceRoots[${index}]`);
    if (seen.has(normalized)) continue;
    if (!STATIC_ROOT_SET.has(normalized)) {
      throw new Error(
        `staticSourceRoots[${index}] must equal 'public' or 'static' when using manifest opt-in.`,
      );
    }
    seen.add(normalized);
    roots.push(normalized);
  }
  return roots;
}

function normalizeManifestScanRoot(value: unknown, fieldPath: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldPath} must be a string.`);
  }
  const normalized = value.trim().replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    /^[a-z]:\//i.test(normalized) ||
    normalized.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`${fieldPath} must be a safe repository-relative path.`);
  }
  return normalized;
}
