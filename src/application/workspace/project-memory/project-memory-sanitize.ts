import { normalizeProjectPath } from '../../../core/context-builder/internal/path';
import { isScopeEligiblePath } from '../../../core/update-scope/internal/protected-scope-paths';

const FORBIDDEN_KEY_SUBSTRINGS = [
  'token',
  'secret',
  'password',
  'apikey',
  'api_key',
  'credential',
  'private_key',
  'authorization',
] as const;

const SECRET_VALUE_PATTERNS = [
  /\b(?:sk|pk)[-_][a-z0-9]{10,}\b/iu,
  /\bAIza[0-9A-Za-z_-]{20,}\b/u,
  /\bBearer\s+[A-Za-z0-9._-]{20,}\b/iu,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/u,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/iu,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./u,
  /\b(?:process\.env\.|import\.meta\.env\.)\w+/u,
  /\b[A-Z0-9_]{3,}=(?:['"][^'"]{8,}['"]|\S{8,})/u,
] as const;

export function containsForbiddenKey(text: string): boolean {
  const lower = text.toLowerCase();
  return FORBIDDEN_KEY_SUBSTRINGS.some((fragment) => lower.includes(fragment));
}

export function containsSecretLikeContent(text: string): boolean {
  if (containsForbiddenKey(text)) return true;
  return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(text));
}

export function sanitizeMemorySummary(summary: string, maximumCharacters: number): string {
  const trimmed = summary.trim().replace(/\s+/gu, ' ');
  if (trimmed.length === 0) return '';
  if (containsSecretLikeContent(trimmed)) {
    throw new Error('Summary contains suspicious secret-like content.');
  }
  return trimmed.length <= maximumCharacters ? trimmed : `${trimmed.slice(0, maximumCharacters)}…`;
}

export function sanitizeMemoryTags(
  tags: readonly string[] | undefined,
  maximumTags: number,
  maximumTagCharacters: number,
): readonly string[] {
  if (tags === undefined) return [];
  const sanitized: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase();
    if (tag.length === 0 || containsSecretLikeContent(tag)) continue;
    sanitized.push(tag.slice(0, maximumTagCharacters));
    if (sanitized.length >= maximumTags) break;
  }
  return [...new Set(sanitized)].sort((left, right) => left.localeCompare(right));
}

export function sanitizeMemoryPaths(
  paths: readonly string[],
  maximumPaths: number,
): readonly string[] {
  const sanitized: string[] = [];
  for (const raw of paths) {
    const normalized = normalizeProjectPath(raw.trim());
    if (normalized.length === 0) continue;
    if (normalized.startsWith('..') || normalized.includes('\\')) continue;
    if (!isScopeEligiblePath(normalized)) continue;
    if (containsSecretLikeContent(normalized)) continue;
    sanitized.push(normalized);
    if (sanitized.length >= maximumPaths) break;
  }
  return [...new Set(sanitized)].sort((left, right) => left.localeCompare(right));
}

export function assertSafeMemoryRelativePath(relativePath: string): void {
  const normalized = relativePath.replaceAll('\\', '/');
  if (
    normalized.startsWith('..') ||
    normalized.includes('\0') ||
    !normalized.startsWith('.builderai/')
  ) {
    throw new Error('Project memory path is outside the allowed storage boundary.');
  }
}
