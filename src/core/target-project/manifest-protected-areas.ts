import { normalizeProjectPath } from '../context-builder/internal/path';
import type {
  ProtectedPathRule,
  ProtectedPathRuleKind,
} from '../file-apply/config/file-apply-configuration';

export type ManifestProtectedAreaExposure = 'NEVER_EXPOSE' | 'MUTATION_PROTECTED';

export class ManifestProtectedAreasValidationError extends Error {
  constructor(readonly issues: readonly { readonly path: string; readonly message: string }[]) {
    super(
      issues.length === 0
        ? 'Manifest protected areas are invalid.'
        : issues.map(({ path, message }) => `${path}: ${message}`).join('; '),
    );
    this.name = 'ManifestProtectedAreasValidationError';
  }
}

export interface ParsedManifestProtectedAreas {
  readonly rules: readonly ProtectedPathRule[];
  readonly exposures: ReadonlyMap<string, ManifestProtectedAreaExposure>;
}

export function normalizeManifestProtectedArea(raw: string): string {
  return normalizeProjectPath(raw.trim().replaceAll('\\', '/').replace(/\/$/, ''));
}

export function validateManifestProtectedArea(raw: string, issuePath: string): string {
  const normalized = normalizeManifestProtectedArea(raw);
  const issues: { path: string; message: string }[] = [];
  if (normalized.length === 0) {
    issues.push({ path: issuePath, message: 'must be a non-empty path' });
  }
  if (
    normalized.startsWith('/') ||
    /^[a-z]:\//iu.test(normalized) ||
    normalized.split('/').some((segment) => segment === '..' || segment === '.')
  ) {
    issues.push({
      path: issuePath,
      message: 'must be a safe repository-relative path without traversal',
    });
  }
  if (/[*?\u0000]/u.test(normalized)) {
    issues.push({ path: issuePath, message: 'must not contain glob or control characters' });
  }
  if (issues.length > 0) throw new ManifestProtectedAreasValidationError(issues);
  return normalized;
}

export function inferManifestProtectedAreaRuleKind(
  normalized: string,
  raw: string,
): ProtectedPathRuleKind {
  const trimmed = raw.trim().replaceAll('\\', '/');
  if (trimmed.endsWith('/')) return 'SUBTREE';
  const lastSegment = normalized.split('/').at(-1) ?? normalized;
  if (lastSegment.includes('.')) return 'EXACT';
  if (!normalized.includes('/')) return 'SUBTREE';
  return 'SUBTREE';
}

export function classifyManifestProtectedAreaExposure(
  normalized: string,
): ManifestProtectedAreaExposure {
  const lower = normalized.toLowerCase();
  if (lower === '.env' || lower.startsWith('.env.') || lower.startsWith('.env/')) {
    return 'NEVER_EXPOSE';
  }
  if (
    lower === 'secrets' ||
    lower.startsWith('secrets/') ||
    lower.endsWith('/secrets') ||
    lower.includes('/secrets/')
  ) {
    return 'NEVER_EXPOSE';
  }
  if (
    lower.includes('credential') ||
    lower.includes('private-key') ||
    lower.includes('private_key')
  ) {
    return 'NEVER_EXPOSE';
  }
  return 'MUTATION_PROTECTED';
}

export function parseManifestProtectedAreas(
  areas: readonly string[],
  issuePrefix = '$.protectedAreas',
): ParsedManifestProtectedAreas {
  const rules: ProtectedPathRule[] = [];
  const exposures = new Map<string, ManifestProtectedAreaExposure>();
  const seenPaths = new Set<string>();

  for (const [index, raw] of areas.entries()) {
    const issuePath = `${issuePrefix}[${index}]`;
    const normalized = validateManifestProtectedArea(raw, issuePath);
    const dedupeKey = normalized.toLowerCase();
    if (seenPaths.has(dedupeKey)) {
      throw new ManifestProtectedAreasValidationError([
        { path: issuePath, message: 'duplicate protected area path' },
      ]);
    }
    seenPaths.add(dedupeKey);

    const kind = inferManifestProtectedAreaRuleKind(normalized, raw);
    const ruleId = `manifest-protected-${index + 1}`;
    rules.push({
      id: ruleId,
      kind,
      path: normalized,
      rationale: 'External target manifest protected area.',
    });
    exposures.set(ruleId, classifyManifestProtectedAreaExposure(normalized));
  }

  return { rules, exposures };
}
