import {
  basenameStemForPath,
  isTestCounterpart,
} from '../../../core/context-builder/internal/path-relevance';
import { normalizeProjectPath } from '../../../core/context-builder/internal/path';
import type {
  InvestigationClaimKind,
  InvestigationEvidence,
  InvestigationHypothesis,
  RepositorySearchMatch,
} from './investigation.types';

const REFERENCE_FILE_PATTERN =
  /(?:^|\/)(?:firebase\.json|firestore\.indexes\.json|storage\.rules|firestore\.rules|.*-blueprint\.json)$/iu;
const TEST_FILE_PATTERN = /\.(spec|test)\.(cjs|js|jsx|mjs|ts|tsx)$/iu;
const GENERATED_OR_VENDOR_PATTERN =
  /(?:^|\/)(?:node_modules|dist|build|coverage|\.next|vendor)\//iu;

export interface InvestigationRankingContext {
  readonly queries: readonly string[];
  readonly requestText: string;
  readonly explicitPaths: readonly string[];
}

export interface RankedSearchMatch {
  readonly match: RepositorySearchMatch;
  readonly score: number;
}

export interface RankedEvidence extends InvestigationEvidence {
  readonly relevanceScore: number;
}

export interface HandoffPathCandidate {
  readonly logicalPath: string;
  readonly score: number;
  readonly existingInRepository: boolean;
}

function normalizePath(path: string): string {
  return normalizeProjectPath(path).replace(/\\/g, '/');
}

function basename(path: string): string {
  return path.split('/').at(-1) ?? path;
}

function requestTokens(requestText: string): ReadonlySet<string> {
  const tokens = new Set<string>();
  for (const match of requestText.matchAll(/\b[A-Za-z_][A-Za-z0-9_]{2,}\b/gu)) {
    tokens.add(match[0]!.toLowerCase());
  }
  return tokens;
}

function pathMentionedInRequest(path: string, context: InvestigationRankingContext): boolean {
  const normalized = normalizePath(path).toLowerCase();
  const requestLower = context.requestText.toLowerCase();
  if (requestLower.includes(normalized)) return true;
  const base = basename(normalized);
  return requestLower.includes(base);
}

function queryTokenOverlap(path: string, queries: readonly string[]): number {
  const haystack = `${path} ${basename(path)}`.toLowerCase();
  let overlap = 0;
  for (const query of queries) {
    const normalized = query.toLowerCase();
    if (normalized.length < 3) continue;
    if (haystack.includes(normalized)) overlap += 1;
  }
  return overlap;
}

function referenceFilePenalty(path: string, context: InvestigationRankingContext): number {
  if (!REFERENCE_FILE_PATTERN.test(path)) return 0;
  return pathMentionedInRequest(path, context) ? 0 : 40;
}

function generatedPathPenalty(path: string): number {
  return GENERATED_OR_VENDOR_PATTERN.test(path) ? 100 : 0;
}

function claimKindScore(kind: InvestigationClaimKind): number {
  switch (kind) {
    case 'FACT':
      return 80;
    case 'INFERENCE':
      return 35;
    case 'UNKNOWN':
      return 10;
  }
}

export function scoreSearchMatch(
  match: RepositorySearchMatch,
  context: InvestigationRankingContext,
): number {
  const path = normalizePath(match.logicalPath);
  let score = 0;

  if (context.explicitPaths.some((hint) => normalizePath(hint) === path)) {
    score += 200;
  }
  if (pathMentionedInRequest(path, context)) {
    score += 120;
  }

  const queryOverlap = queryTokenOverlap(path, context.queries);
  score += queryOverlap * 25;

  const lineLower = match.lineText.toLowerCase();
  for (const query of context.queries) {
    const normalized = query.toLowerCase();
    if (normalized.length < 3) continue;
    if (lineLower === normalized) score += 30;
    else if (lineLower.includes(normalized)) score += 12;
  }

  const stem = basenameStemForPath(path);
  for (const token of requestTokens(context.requestText)) {
    if (stem.toLowerCase().includes(token)) score += 8;
    if (basename(path).toLowerCase().includes(token)) score += 10;
  }

  if (TEST_FILE_PATTERN.test(path)) score += 12;

  const anchorStems = new Set(
    context.queries
      .map((query) => query.replace(/\.[^.]+$/u, ''))
      .filter((value) => value.length >= 4),
  );
  for (const anchor of anchorStems) {
    if (isTestCounterpart(path, anchor)) score += 20;
  }

  score -= referenceFilePenalty(path, context);
  score -= generatedPathPenalty(path);

  return score;
}

export function rankSearchMatches(
  matches: readonly RepositorySearchMatch[],
  context: InvestigationRankingContext,
  maximumMatches: number,
): readonly RepositorySearchMatch[] {
  const ranked = matches
    .map((match) => ({ match, score: scoreSearchMatch(match, context) }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.match.logicalPath.localeCompare(right.match.logicalPath) ||
        left.match.lineNumber - right.match.lineNumber,
    );
  return ranked.slice(0, maximumMatches).map(({ match }) => match);
}

export function scoreEvidenceEntry(
  entry: InvestigationEvidence,
  context: InvestigationRankingContext,
  searchMatches: readonly RepositorySearchMatch[],
): number {
  const searchMatchPaths = new Set(
    searchMatches.map(({ logicalPath }) => normalizePath(logicalPath)),
  );
  const path = normalizePath(entry.logicalPath);
  let score = claimKindScore(entry.claimKind);

  if (searchMatchPaths.has(path)) score += 50;
  if (context.explicitPaths.some((hint) => normalizePath(hint) === path)) score += 80;
  if (pathMentionedInRequest(path, context)) score += 60;
  score += queryTokenOverlap(path, context.queries) * 15;
  if (TEST_FILE_PATTERN.test(path)) score += 10;
  if (/implementation counterpart/i.test(entry.reason)) score += 55;
  if (/import dependency/i.test(entry.reason)) score += 50;
  for (const match of searchMatches) {
    if (!TEST_FILE_PATTERN.test(match.logicalPath)) continue;
    const testStem = basenameStemForPath(match.logicalPath);
    if (isTestCounterpart(path, testStem) && !TEST_FILE_PATTERN.test(path)) {
      score += 80;
      break;
    }
  }
  score -= referenceFilePenalty(path, context);
  score -= generatedPathPenalty(path);
  return score;
}

function claimKindAuthority(kind: InvestigationClaimKind): number {
  switch (kind) {
    case 'FACT':
      return 3;
    case 'INFERENCE':
      return 2;
    case 'UNKNOWN':
      return 1;
  }
}

export function mergeRepositoryEvidence(
  providerEvidence: readonly InvestigationEvidence[],
  repositoryEvidence: readonly InvestigationEvidence[],
  context: InvestigationRankingContext,
  searchMatches: readonly RepositorySearchMatch[],
  maximumEvidenceFiles: number,
): readonly InvestigationEvidence[] {
  const merged = new Map<string, InvestigationEvidence>();
  for (const entry of repositoryEvidence) {
    merged.set(normalizePath(entry.logicalPath), entry);
  }
  for (const entry of providerEvidence) {
    const key = normalizePath(entry.logicalPath);
    const existing = merged.get(key);
    if (
      existing === undefined ||
      claimKindAuthority(entry.claimKind) >= claimKindAuthority(existing.claimKind)
    ) {
      merged.set(key, entry);
    }
  }
  return rankEvidenceEntries([...merged.values()], context, searchMatches, maximumEvidenceFiles);
}

export function rankEvidenceEntries(
  evidence: readonly InvestigationEvidence[],
  context: InvestigationRankingContext,
  searchMatches: readonly RepositorySearchMatch[],
  maximumEvidenceFiles: number,
): readonly InvestigationEvidence[] {
  const scored = evidence.map((entry) => ({
    entry,
    score: scoreEvidenceEntry(entry, context, searchMatches),
  }));
  const bestByPath = new Map<string, (typeof scored)[number]>();
  for (const item of scored) {
    const key = normalizePath(item.entry.logicalPath);
    const existing = bestByPath.get(key);
    if (existing === undefined || item.score > existing.score) {
      bestByPath.set(key, item);
    }
  }
  return [...bestByPath.values()]
    .sort(
      (left, right) =>
        right.score - left.score || left.entry.logicalPath.localeCompare(right.entry.logicalPath),
    )
    .slice(0, maximumEvidenceFiles)
    .map(({ entry }) => entry);
}

export function collectHandoffPathCandidates(input: {
  readonly sourcePaths: readonly string[];
  readonly evidence: readonly InvestigationEvidence[];
  readonly searchMatches: readonly RepositorySearchMatch[];
  readonly hypotheses: readonly InvestigationHypothesis[];
  readonly affectedAreas: readonly string[];
  readonly likelyRootCause?: string;
  readonly suggestedFixScope?: string;
  readonly context: InvestigationRankingContext;
}): readonly HandoffPathCandidate[] {
  const existingPaths = new Set(input.sourcePaths.map((path) => normalizePath(path)));
  const scores = new Map<string, number>();

  const addScore = (rawPath: string, amount: number): void => {
    const path = normalizePath(rawPath.trim());
    if (path.length === 0) return;
    scores.set(path, (scores.get(path) ?? 0) + amount);
  };

  for (const match of input.searchMatches) {
    addScore(match.logicalPath, 20 + scoreSearchMatch(match, input.context) / 4);
  }
  for (const entry of input.evidence) {
    addScore(entry.logicalPath, scoreEvidenceEntry(entry, input.context, input.searchMatches));
  }
  for (const hypothesis of input.hypotheses) {
    for (const path of hypothesis.supportingEvidencePaths) {
      addScore(path, claimKindScore(hypothesis.claimKind) / 2);
    }
  }
  for (const path of input.affectedAreas) addScore(path, 25);
  if (input.likelyRootCause !== undefined) {
    for (const path of input.sourcePaths) {
      if (input.likelyRootCause.includes(basename(path))) addScore(path, 15);
    }
  }
  if (input.suggestedFixScope !== undefined) {
    for (const token of input.suggestedFixScope.split(/[,\s]+/u)) {
      if (token.includes('/')) addScore(token, 30);
    }
  }

  return [...scores.entries()]
    .map(([logicalPath, score]) => ({
      logicalPath,
      score,
      existingInRepository: existingPaths.has(logicalPath),
    }))
    .sort(
      (left, right) =>
        right.score - left.score || left.logicalPath.localeCompare(right.logicalPath),
    );
}

export function selectTopHandoffPaths(
  candidates: readonly HandoffPathCandidate[],
  maximumPathHints: number,
): {
  readonly pathHints: readonly string[];
  readonly existingPathHints: readonly string[];
  readonly candidatePathHints: readonly string[];
} {
  const top = candidates.slice(0, maximumPathHints);
  const pathHints = top.map(({ logicalPath }) => logicalPath);
  const existingPathHints = top
    .filter(({ existingInRepository }) => existingInRepository)
    .map(({ logicalPath }) => logicalPath);
  const candidatePathHints = top
    .filter(({ existingInRepository }) => !existingInRepository)
    .map(({ logicalPath }) => logicalPath);
  return { pathHints, existingPathHints, candidatePathHints };
}

export function extractExplicitPathsFromRequest(requestText: string): readonly string[] {
  const paths = new Set<string>();
  for (const match of requestText.matchAll(
    /(?:[\w./$-]+\/)?([\w./-]+\.(?:tsx?|jsx?|mjs|cjs|json|rules|ya?ml))\b/giu,
  )) {
    const candidate = match[1];
    if (candidate !== undefined) paths.add(normalizePath(candidate));
  }
  return [...paths];
}

export function buildInvestigationRankingContext(input: {
  readonly requestText: string;
  readonly queries: readonly string[];
}): InvestigationRankingContext {
  return {
    requestText: input.requestText,
    queries: input.queries,
    explicitPaths: extractExplicitPathsFromRequest(input.requestText),
  };
}
