import {
  isTestCounterpart,
  basenameStemForPath,
} from '../../../core/context-builder/internal/path-relevance';
import { normalizeProjectPath } from '../../../core/context-builder/internal/path';
import { isScopeEligiblePath } from '../../../core/update-scope/internal/protected-scope-paths';
import {
  DEFAULT_WORKSPACE_PATH_PROTECTION,
  type WorkspacePathProtectionPolicy,
} from '../../../core/target-project/workspace-path-protection';
import {
  DEFAULT_INVESTIGATION_CONFIGURATION,
  type InvestigationConfiguration,
} from './investigation-configuration';
import type { InvestigationEvidence, RepositorySearchMatch } from './investigation.types';

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

function relatedPaths(
  hitPath: string,
  sourcePaths: readonly string[],
  pathProtection: WorkspacePathProtectionPolicy,
): readonly string[] {
  const normalizedHit = normalizeProjectPath(hitPath);
  const hitDir = directory(normalizedHit);
  const hitBase = basename(normalizedHit);
  const stem = hitBase.replace(/\.(test|spec)\./u, '.').replace(/\.[^.]+$/u, '');
  const related = new Set<string>([normalizedHit]);

  for (const candidate of sourcePaths) {
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
    if (isTestCounterpart(normalized, basenameStemForPath(normalizedHit))) {
      related.add(normalized);
    }
  }

  return uniqueSorted(related);
}

export class EvidenceExpansionService {
  constructor(
    private readonly configuration: InvestigationConfiguration = DEFAULT_INVESTIGATION_CONFIGURATION,
    private readonly pathProtection: WorkspacePathProtectionPolicy = DEFAULT_WORKSPACE_PATH_PROTECTION,
  ) {}

  expandFromMatches(
    matches: readonly RepositorySearchMatch[],
    sourcePaths: readonly string[],
    fileContents: Readonly<Record<string, string>>,
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
      for (const relatedPath of relatedPaths(match.logicalPath, sourcePaths, this.pathProtection)) {
        if (evidence.length >= this.configuration.maximumEvidenceFiles) break;
        if (seen.has(relatedPath)) continue;
        const content = fileContents[relatedPath];
        if (content === undefined) continue;
        seen.add(relatedPath);
        evidence.push({
          logicalPath: relatedPath,
          reason: `Related evidence near search hit in ${match.logicalPath}.`,
          excerpt: content
            .split('\n')
            .slice(0, 6)
            .join('\n')
            .slice(0, this.configuration.maximumExcerptCharacters),
          claimKind: 'INFERENCE',
        });
      }
    }

    return evidence.slice(0, this.configuration.maximumEvidenceFiles);
  }
}
