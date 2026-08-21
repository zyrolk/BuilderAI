/**
 * Shared relevance-first inventory selection for investigation search and B2 tools (ADR-038).
 *
 * Scores all eligible paths with cheap path-only signals, then returns the top N for content
 * scans. Never lexicographically truncates before scoring.
 */

import {
  buildInvestigationRankingContext,
  selectCandidatePathsByRelevance,
  type InvestigationRankingContext,
} from '../investigation/investigation-path-ranking';

export interface InventorySelectionLimits {
  /** Maximum paths retained after scoring for content scanning. */
  readonly maximumContentScanPaths: number;
  /**
   * Soft cap on how many ranked paths may be retained as an expanded inventory for related-file
   * walks. Content scans still use `maximumContentScanPaths`.
   */
  readonly maximumRankedInventory?: number;
}

export interface InventorySelectionResult {
  readonly rankingContext: InvestigationRankingContext;
  /** Top paths selected for content reads / search scans. */
  readonly contentScanPaths: readonly string[];
  /** Larger ranked inventory (≤ maximumRankedInventory) for related-file expansion. */
  readonly rankedInventory: readonly string[];
  readonly eligibleCount: number;
  readonly truncated: boolean;
}

/**
 * Rank the full eligible set by path relevance, then take bounded tops.
 * High-relevance paths remain selectable regardless of lexicographic position.
 */
export function selectInventoryByRelevance(
  eligiblePaths: readonly string[],
  input: {
    readonly requestText: string;
    readonly queries: readonly string[];
  },
  limits: InventorySelectionLimits,
): InventorySelectionResult {
  const rankingContext = buildInvestigationRankingContext(input);
  const inventoryLimit = Math.max(
    limits.maximumContentScanPaths,
    limits.maximumRankedInventory ?? limits.maximumContentScanPaths,
  );

  const rankedInventory = selectCandidatePathsByRelevance(
    eligiblePaths,
    rankingContext,
    Math.min(eligiblePaths.length, inventoryLimit),
  );

  const contentScanPaths = rankedInventory.slice(0, limits.maximumContentScanPaths);

  return {
    rankingContext,
    contentScanPaths,
    rankedInventory,
    eligibleCount: eligiblePaths.length,
    truncated: eligiblePaths.length > contentScanPaths.length,
  };
}
