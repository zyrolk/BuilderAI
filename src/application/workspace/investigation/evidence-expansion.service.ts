import {
  isTestCounterpart,
  basenameStemForPath,
} from '../../../core/context-builder/internal/path-relevance';
import {
  normalizeProjectPath,
  resolveRelativePath,
} from '../../../core/context-builder/internal/path';
import { isScopeEligiblePath } from '../../../core/update-scope/internal/protected-scope-paths';
import {
  DEFAULT_WORKSPACE_PATH_PROTECTION,
  type WorkspacePathProtectionPolicy,
} from '../../../core/target-project/workspace-path-protection';
import {
  DEFAULT_INVESTIGATION_CONFIGURATION,
  type InvestigationConfiguration,
} from './investigation-configuration';
import {
  buildInvestigationRankingContext,
  rankEvidenceEntries,
} from './investigation-path-ranking';
import type { InvestigationEvidence, RepositorySearchMatch } from './investigation.types';

const TEST_FILE_PATTERN = /\.(spec|test)\.(cjs|js|jsx|mjs|ts|tsx)$/u;
const IMPLEMENTATION_ROOT_PREFIXES = ['src/', 'functions/', 'server/', 'lib/', 'app/'] as const;
const SOURCE_SUFFIXES = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx'] as const;
const IMPORT_SPECIFIER_PATTERN =
  /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\sfrom\s+)?['"](\.\.?\/[^'"]+)['"]/gu;

export const MAX_IMPLEMENTATION_COUNTERPARTS_PER_HIT = 4;
export const MAX_IMPORT_DEPENDENCIES_PER_HIT = 4;
export const MAX_RELATED_PATHS_PER_HIT = 8;

function uniqueSorted(paths: Iterable<string>): readonly string[] {
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right));
}

function basename(path: string): string {
  return path.split('/').at(-1) ?? path;
}

function directory(path: string): string {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/');
}

function isInvestigationTestPath(path: string): boolean {
  return TEST_FILE_PATTERN.test(path) || path.includes('/__tests__/') || path.startsWith('tests/');
}

function moduleStemFromPath(path: string): string {
  return basename(path)
    .replace(/\.(test|spec)\./u, '.')
    .replace(/\.[^.]+$/u, '');
}

function isImplementationModulePath(path: string): boolean {
  return IMPLEMENTATION_ROOT_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function basenameMatchesModuleStem(path: string, stem: string): boolean {
  const fileStem = moduleStemFromPath(path);
  return fileStem === stem || basename(path).startsWith(`${stem}.`);
}

function findImportedPath(
  importPath: string,
  availablePaths: ReadonlySet<string>,
): string | undefined {
  for (const suffix of SOURCE_SUFFIXES) {
    const candidate = `${importPath}${suffix}`;
    if (availablePaths.has(candidate)) return candidate;
  }
  return undefined;
}

function findImportDependencyPaths(
  hitPath: string,
  content: string | undefined,
  sourcePaths: readonly string[],
  pathProtection: WorkspacePathProtectionPolicy,
): readonly string[] {
  if (content === undefined) return [];
  const availablePaths = new Set(
    sourcePaths
      .filter((path) => isScopeEligiblePath(path, pathProtection))
      .map((path) => normalizeProjectPath(path)),
  );
  const hitDirectory = directory(normalizeProjectPath(hitPath));
  const dependencies: string[] = [];
  for (const match of content.matchAll(IMPORT_SPECIFIER_PATTERN)) {
    const specifier = match[1];
    if (specifier === undefined) continue;
    const resolved = resolveRelativePath(hitDirectory, specifier);
    const dependencyPath = findImportedPath(resolved, availablePaths);
    if (dependencyPath === undefined) continue;
    dependencies.push(dependencyPath);
    if (dependencies.length >= MAX_IMPORT_DEPENDENCIES_PER_HIT) break;
  }
  return uniqueSorted(dependencies);
}

export function findImplementationCounterpartPaths(
  hitPath: string,
  sourcePaths: readonly string[],
  pathProtection: WorkspacePathProtectionPolicy,
): readonly string[] {
  if (!isInvestigationTestPath(hitPath)) return [];
  const stem = moduleStemFromPath(hitPath);
  if (stem.length < 4) return [];
  const normalizedHit = normalizeProjectPath(hitPath);
  const counterparts: string[] = [];

  for (const candidate of sourcePaths) {
    if (!isScopeEligiblePath(candidate, pathProtection)) continue;
    const normalized = normalizeProjectPath(candidate);
    if (normalized === normalizedHit || isInvestigationTestPath(normalized)) continue;
    if (!basenameMatchesModuleStem(normalized, stem)) continue;
    if (!isImplementationModulePath(normalized)) continue;
    counterparts.push(normalized);
    if (counterparts.length >= MAX_IMPLEMENTATION_COUNTERPARTS_PER_HIT) break;
  }

  return uniqueSorted(counterparts);
}

function relatedPaths(
  hitPath: string,
  sourcePaths: readonly string[],
  pathProtection: WorkspacePathProtectionPolicy,
  queries: readonly string[] = [],
  fileContents: Readonly<Record<string, string>> = {},
): readonly string[] {
  const normalizedHit = normalizeProjectPath(hitPath);
  const hitDir = directory(normalizedHit);
  const stem = moduleStemFromPath(normalizedHit);
  const anchorStems = new Set<string>([basenameStemForPath(normalizedHit), stem]);
  for (const query of queries) {
    const normalized = query.replace(/\.[^.]+$/u, '');
    if (normalized.length >= 4) anchorStems.add(normalized);
  }
  const related = new Set<string>([
    ...findImplementationCounterpartPaths(hitPath, sourcePaths, pathProtection),
    ...findImportDependencyPaths(hitPath, fileContents[normalizedHit], sourcePaths, pathProtection),
  ]);

  for (const candidate of sourcePaths) {
    if (related.size >= MAX_RELATED_PATHS_PER_HIT) break;
    if (!isScopeEligiblePath(candidate, pathProtection)) continue;
    const normalized = normalizeProjectPath(candidate);
    if (normalized === normalizedHit) continue;
    if (
      normalized.startsWith(`${hitDir}/`) &&
      normalized.split('/').length <= hitDir.split('/').length + 2
    ) {
      related.add(normalized);
    }
    if (basename(normalized).includes(stem) && stem.length >= 4) {
      related.add(normalized);
    }
    for (const anchor of anchorStems) {
      if (isTestCounterpart(normalized, anchor)) {
        related.add(normalized);
      }
      if (/\.(spec|test)\./u.test(normalized)) {
        const testStem = basenameStemForPath(normalized).replace(/\.(spec|test)$/u, '');
        if (testStem.includes(anchor) || anchor.includes(testStem)) {
          related.add(normalized);
        }
      }
    }
  }

  return uniqueSorted(related).slice(0, MAX_RELATED_PATHS_PER_HIT);
}

export function collectExpansionCandidatePaths(
  matches: readonly RepositorySearchMatch[],
  sourcePaths: readonly string[],
  pathProtection: WorkspacePathProtectionPolicy,
  fileContents: Readonly<Record<string, string>>,
  queries: readonly string[] = [],
): readonly string[] {
  const loaded = new Set(Object.keys(fileContents).map((path) => normalizeProjectPath(path)));
  const candidates = new Set<string>();
  for (const match of matches) {
    for (const relatedPath of relatedPaths(
      match.logicalPath,
      sourcePaths,
      pathProtection,
      queries,
      fileContents,
    )) {
      if (loaded.has(relatedPath)) continue;
      candidates.add(relatedPath);
    }
  }
  return uniqueSorted(candidates);
}

export class EvidenceExpansionService {
  constructor(
    private readonly configuration: InvestigationConfiguration = DEFAULT_INVESTIGATION_CONFIGURATION,
    private readonly pathProtection: WorkspacePathProtectionPolicy = DEFAULT_WORKSPACE_PATH_PROTECTION,
  ) {}

  collectCandidatePaths(
    matches: readonly RepositorySearchMatch[],
    sourcePaths: readonly string[],
    fileContents: Readonly<Record<string, string>>,
    queries: readonly string[] = [],
  ): readonly string[] {
    return collectExpansionCandidatePaths(
      matches,
      sourcePaths,
      this.pathProtection,
      fileContents,
      queries,
    );
  }

  expandFromMatches(
    matches: readonly RepositorySearchMatch[],
    sourcePaths: readonly string[],
    fileContents: Readonly<Record<string, string>>,
    requestText = '',
    queries: readonly string[] = [],
  ): readonly InvestigationEvidence[] {
    const evidence: InvestigationEvidence[] = [];
    const seen = new Set<string>();

    for (const match of matches) {
      const key = `${match.logicalPath}:${match.lineNumber}`;
      if (seen.has(key)) continue;
      seen.add(key);
      evidence.push({
        logicalPath: match.logicalPath,
        lineStart: match.lineNumber,
        lineEnd: match.lineNumber,
        reason: `Repository search matched query "${match.query}".`,
        excerpt: match.excerpt,
        claimKind: 'FACT',
      });
    }

    for (const match of matches) {
      if (evidence.length >= this.configuration.maximumEvidenceFiles) break;
      for (const relatedPath of relatedPaths(
        match.logicalPath,
        sourcePaths,
        this.pathProtection,
        queries,
        fileContents,
      )) {
        if (evidence.length >= this.configuration.maximumEvidenceFiles) break;
        if (seen.has(relatedPath)) continue;
        if (relatedPath === normalizeProjectPath(match.logicalPath)) continue;
        const content = fileContents[relatedPath];
        if (content === undefined) continue;
        seen.add(relatedPath);
        const hitPath = normalizeProjectPath(match.logicalPath);
        const implementationCounterpart =
          isInvestigationTestPath(hitPath) &&
          !isInvestigationTestPath(relatedPath) &&
          isImplementationModulePath(relatedPath) &&
          basenameMatchesModuleStem(relatedPath, moduleStemFromPath(hitPath));
        const importDependency = findImportDependencyPaths(
          match.logicalPath,
          fileContents[hitPath],
          sourcePaths,
          this.pathProtection,
        ).includes(relatedPath);
        evidence.push({
          logicalPath: relatedPath,
          reason: implementationCounterpart
            ? `Implementation counterpart for test evidence in ${match.logicalPath}.`
            : importDependency
              ? `Direct import dependency of ${match.logicalPath}.`
              : `Related evidence near search hit in ${match.logicalPath}.`,
          excerpt: content
            .split('\n')
            .slice(0, 6)
            .join('\n')
            .slice(0, this.configuration.maximumExcerptCharacters),
          claimKind: 'INFERENCE',
        });
      }
    }

    const rankingContext = buildInvestigationRankingContext({ requestText, queries });
    return rankEvidenceEntries(
      evidence,
      rankingContext,
      matches,
      this.configuration.maximumEvidenceFiles,
    );
  }
}
