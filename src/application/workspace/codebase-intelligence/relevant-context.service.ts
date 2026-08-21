import { createHash } from 'node:crypto';

import { expandQueryTokens, tokenize } from '../../../core/context-builder/internal/text-relevance';
import { inferTaskCategories } from '../../../core/context-builder/internal/task-category';
import {
  rankCandidatePaths,
  scoreCandidatePath,
} from '../../../core/context-builder/internal/path-relevance';
import { isScopeEligiblePath } from '../../../core/update-scope/internal/protected-scope-paths';
import {
  DEFAULT_WORKSPACE_PATH_PROTECTION,
  type WorkspacePathProtectionPolicy,
} from '../../../core/target-project/workspace-path-protection';
import { normalizeProjectPath } from '../../../core/context-builder/internal/path';
import { ProjectFileSourceAccessDeniedError } from '../../../core/context-builder';
import { selectInventoryByRelevance } from './inventory-selection';

export const RELEVANT_CONTEXT_MAX_FILES = 16 as const;
export const RELEVANT_CONTEXT_MAX_READS = 36 as const;
export const RELEVANT_CONTEXT_MAX_PREVIEW_CHARS = 1_200 as const;
export const RELEVANT_CONTEXT_MAX_TOTAL_PREVIEW_CHARS = 12_000 as const;

export interface RelevantContextFile {
  readonly logicalPath: string;
  readonly pathScore: number;
  readonly preview: string;
  readonly truncated: boolean;
  readonly contentDigest: string;
}

export interface RelevantContextResult {
  readonly goal: string;
  readonly files: readonly RelevantContextFile[];
  readonly filesConsidered: number;
  readonly reads: number;
  readonly truncated: boolean;
  readonly structuredDigest: string;
}

export interface RelevantContextServiceInput {
  readonly goal: string;
  readonly sourcePaths: readonly string[];
  readonly readFile: (logicalPath: string) => Promise<string>;
  readonly maximumFiles?: number;
  readonly maximumReads?: number;
}

/**
 * Bounded high-value context retrieval using Context Builder path scoring (ADR-038).
 */
export class RelevantContextService {
  constructor(
    private readonly pathProtection: WorkspacePathProtectionPolicy = DEFAULT_WORKSPACE_PATH_PROTECTION,
  ) {}

  async retrieve(input: RelevantContextServiceInput): Promise<RelevantContextResult> {
    const maximumFiles = Math.min(
      input.maximumFiles ?? RELEVANT_CONTEXT_MAX_FILES,
      RELEVANT_CONTEXT_MAX_FILES,
    );
    const maximumReads = Math.min(
      input.maximumReads ?? RELEVANT_CONTEXT_MAX_READS,
      RELEVANT_CONTEXT_MAX_READS,
    );

    const eligible = input.sourcePaths.filter((path) =>
      isScopeEligiblePath(path, this.pathProtection),
    );

    const categories = inferTaskCategories(input.goal);
    const queryVariants = expandQueryTokens(tokenize(input.goal));
    const ranked = rankCandidatePaths(
      eligible,
      queryVariants,
      categories,
      new Set(),
      input.goal,
      new Set(),
      new Set(),
    );

    // Also blend investigation inventory selection so lex-far high-signal paths stay visible.
    const inventory = selectInventoryByRelevance(
      eligible,
      { requestText: input.goal, queries: [...queryVariants].slice(0, 12) },
      { maximumContentScanPaths: maximumReads, maximumRankedInventory: Math.max(maximumReads, 64) },
    );

    const shortlistPaths = uniquePaths([
      ...ranked.slice(0, maximumReads).map((entry) => entry.path),
      ...inventory.contentScanPaths,
    ]).slice(0, maximumReads);

    const files: RelevantContextFile[] = [];
    let reads = 0;
    let totalPreviewChars = 0;
    let truncated = ranked.length > maximumFiles || inventory.truncated;

    for (const logicalPath of shortlistPaths) {
      if (files.length >= maximumFiles) {
        truncated = true;
        break;
      }
      if (reads >= maximumReads) {
        truncated = true;
        break;
      }
      if (totalPreviewChars >= RELEVANT_CONTEXT_MAX_TOTAL_PREVIEW_CHARS) {
        truncated = true;
        break;
      }

      reads += 1;
      let content: string;
      try {
        content = await input.readFile(logicalPath);
      } catch (error) {
        if (error instanceof ProjectFileSourceAccessDeniedError) continue;
        continue;
      }

      const pathScore = scoreCandidatePath(
        logicalPath,
        queryVariants,
        categories,
        new Set(),
        input.goal,
      );
      const previewTruncated = content.length > RELEVANT_CONTEXT_MAX_PREVIEW_CHARS;
      const preview = previewTruncated
        ? `${content.slice(0, RELEVANT_CONTEXT_MAX_PREVIEW_CHARS - 1)}…`
        : content;
      totalPreviewChars += preview.length;

      files.push({
        logicalPath: normalizeProjectPath(logicalPath),
        pathScore,
        preview,
        truncated: previewTruncated,
        contentDigest: createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16),
      });
    }

    files.sort(
      (left, right) =>
        right.pathScore - left.pathScore || left.logicalPath.localeCompare(right.logicalPath),
    );

    const boundedFiles = files.slice(0, maximumFiles);
    if (files.length > boundedFiles.length) truncated = true;

    const structuredDigest = createHash('sha256')
      .update(
        JSON.stringify({
          goal: input.goal,
          paths: boundedFiles.map((file) => `${file.logicalPath}:${file.contentDigest}`),
        }),
        'utf8',
      )
      .digest('hex')
      .slice(0, 16);

    return {
      goal: input.goal,
      files: boundedFiles,
      filesConsidered: eligible.length,
      reads,
      truncated,
      structuredDigest,
    };
  }
}

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const path of paths) {
    const normalized = normalizeProjectPath(path);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}
