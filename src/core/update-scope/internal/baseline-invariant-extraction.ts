import type {
  PreservationInvariant,
  PreservationInvariantKind,
} from '../types/preservation-contract';

const HTML_ID_PATTERN = /\bid\s*=\s*["']([^"']+)["']/gi;
const ARIA_ATTRIBUTE_PATTERN = /\baria-[a-zA-Z0-9-]+\b/g;
const HTML_SCRIPT_SRC_PATTERN = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
const HTML_STYLESHEET_HREF_PATTERN =
  /<link\b[^>]*\brel\s*=\s*["']stylesheet["'][^>]*\bhref\s*=\s*["']([^"']+)["']/gi;
const HTML_STYLESHEET_HREF_ALT_PATTERN =
  /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*\brel\s*=\s*["']stylesheet["']/gi;
const GET_ELEMENT_BY_ID_PATTERN = /getElementById\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const QUERY_SELECTOR_ID_PATTERN = /querySelector\s*\(\s*['"]#([^'"]+)['"]\s*\)/g;
const LOCAL_STORAGE_GET_PATTERN = /localStorage\.getItem\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const LOCAL_STORAGE_SET_PATTERN = /localStorage\.setItem\s*\(\s*['"]([^'"]+)['"]/g;

const INVARIANT_CAPS: Readonly<Record<PreservationInvariantKind, number>> = {
  DOM_ID: 32,
  ARIA_ATTRIBUTE: 16,
  SCRIPT_REFERENCE: 16,
  STYLESHEET_REFERENCE: 16,
  LITERAL_DOM_REFERENCE: 16,
  LOCAL_STORAGE_KEY: 8,
};

function compareText(left: string, right: string): number {
  return left.localeCompare(right);
}

function extractUniqueMatches(content: string, pattern: RegExp, groupIndex = 1): readonly string[] {
  const values = new Set<string>();
  for (const match of content.matchAll(pattern)) {
    const value = match[groupIndex];
    if (value !== undefined && value.length > 0) values.add(value);
  }
  return [...values].sort(compareText);
}

function isHtmlPath(logicalPath: string): boolean {
  return /\.html?$/iu.test(logicalPath);
}

function isJsPath(logicalPath: string): boolean {
  return /\.(?:cjs|js|jsx|mjs|ts|tsx)$/iu.test(logicalPath);
}

function truncateValues(
  kind: PreservationInvariantKind,
  values: readonly string[],
): readonly string[] {
  return values.slice(0, INVARIANT_CAPS[kind]);
}

function pushInvariant(
  invariants: PreservationInvariant[],
  kind: PreservationInvariantKind,
  logicalPath: string,
  values: readonly string[],
): void {
  if (values.length === 0) return;
  invariants.push({
    kind,
    logicalPath,
    values: truncateValues(kind, values),
  });
}

export function extractPreservationInvariants(
  logicalPath: string,
  content: string,
): readonly PreservationInvariant[] {
  const invariants: PreservationInvariant[] = [];

  if (isHtmlPath(logicalPath)) {
    pushInvariant(
      invariants,
      'DOM_ID',
      logicalPath,
      extractUniqueMatches(content, HTML_ID_PATTERN),
    );
    pushInvariant(
      invariants,
      'ARIA_ATTRIBUTE',
      logicalPath,
      extractUniqueMatches(content, ARIA_ATTRIBUTE_PATTERN, 0),
    );
    pushInvariant(
      invariants,
      'SCRIPT_REFERENCE',
      logicalPath,
      extractUniqueMatches(content, HTML_SCRIPT_SRC_PATTERN),
    );
    pushInvariant(
      invariants,
      'STYLESHEET_REFERENCE',
      logicalPath,
      [
        ...extractUniqueMatches(content, HTML_STYLESHEET_HREF_PATTERN),
        ...extractUniqueMatches(content, HTML_STYLESHEET_HREF_ALT_PATTERN),
      ].sort(compareText),
    );
  }

  if (isJsPath(logicalPath)) {
    const domRefs = [
      ...extractUniqueMatches(content, GET_ELEMENT_BY_ID_PATTERN),
      ...extractUniqueMatches(content, QUERY_SELECTOR_ID_PATTERN),
    ].sort(compareText);
    pushInvariant(invariants, 'LITERAL_DOM_REFERENCE', logicalPath, domRefs);
    const storageKeys = [
      ...extractUniqueMatches(content, LOCAL_STORAGE_GET_PATTERN),
      ...extractUniqueMatches(content, LOCAL_STORAGE_SET_PATTERN),
    ].sort(compareText);
    pushInvariant(invariants, 'LOCAL_STORAGE_KEY', logicalPath, storageKeys);
  }

  return invariants.sort((left, right) => {
    const kindCompare = left.kind.localeCompare(right.kind);
    if (kindCompare !== 0) return kindCompare;
    const pathCompare = left.logicalPath.localeCompare(right.logicalPath);
    if (pathCompare !== 0) return pathCompare;
    return left.values.join('\u001f').localeCompare(right.values.join('\u001f'));
  });
}

export function deduplicatePreservationInvariants(
  invariants: readonly PreservationInvariant[],
): readonly PreservationInvariant[] {
  const seen = new Set<string>();
  const deduped: PreservationInvariant[] = [];
  for (const invariant of invariants) {
    const key = `${invariant.kind}\u001f${invariant.logicalPath}\u001f${invariant.values.join('\u001f')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({
      ...invariant,
      values: [...invariant.values].sort(compareText),
    });
  }
  return deduped;
}
