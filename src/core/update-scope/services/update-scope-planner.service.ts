import { normalizeProjectPath } from '../../context-builder/internal/path';
import {
  buildReadShortlist,
  rankCandidatePaths,
} from '../../context-builder/internal/path-relevance';
import {
  extractExplicitPathMentions,
  resolveExistingSourcePath,
} from '../../context-builder/internal/explicit-path-mentions';
import { inferTaskCategories } from '../../context-builder/internal/task-category';
import { expandQueryTokens, tokenize } from '../../context-builder/internal/text-relevance';
import { CONTEXT_RETRIEVAL_SCORING } from '../../context-builder/config/context-retrieval-policy';
import { filterScopeEligiblePaths, isScopeEligiblePath } from '../internal/protected-scope-paths';
import {
  INACTIVE_UPDATE_SCOPE_PLAN,
  MAXIMUM_REQUIRED_BASELINE_PATHS,
  UPDATE_SCOPE_PLAN_SCHEMA_VERSION,
  type UpdateScopeEvidence,
  type UpdateScopePlan,
} from '../types/update-scope-plan';

const ONLY_PATH_PATTERNS: readonly RegExp[] = [
  /\bonly\s+(?:modify\s+)?((?:[\w.-]+\/)*[\w.-]+\.(?:html?|css|(?:c|m)?js|jsx|tsx?))\b/giu,
  /\bmodify\s+((?:[\w.-]+\/)*[\w.-]+\.(?:html?|css|(?:c|m)?js|jsx|tsx?))\s+only\b/giu,
  /\b((?:[\w.-]+\/)*[\w.-]+\.(?:html?|css|(?:c|m)?js|jsx|tsx?))\s+only\b/giu,
  /\bdo\s+not\s+modify\s+(?:anything\s+except\s+)?((?:[\w.-]+\/)*[\w.-]+\.(?:html?|css|(?:c|m)?js|jsx|tsx?))\b/giu,
];

const HTML_TASK_PATTERN =
  /\b(?:html|accessibility|aria(?:-|\s)|page|ui|counter|button|dom|markup)\b/iu;
const CSS_TASK_PATTERN = /\b(?:css|stylesheet|style(?:s)?)\b/iu;
const JS_TASK_PATTERN = /\b(?:javascript|js|behavior|localstorage|script|event)\b/iu;
const CREATE_TASK_PATTERN = /\b(?:create|new|add\s+a\s+new|from\s+scratch|greenfield|scaffold)\b/iu;

export interface UpdateScopePlannerInput {
  readonly taskText: string;
  readonly sourcePaths: readonly string[];
  readonly iterationPathHints?: readonly string[];
}

function comparePath(left: string, right: string): number {
  return left.localeCompare(right);
}

function extractOnlyPathInstructions(
  taskText: string,
  sourcePaths: readonly string[],
): readonly string[] {
  const paths = new Set<string>();
  for (const pattern of ONLY_PATH_PATTERNS) {
    for (const match of taskText.matchAll(pattern)) {
      const resolved = resolveExistingSourcePath(match[1] ?? '', sourcePaths);
      if (resolved !== undefined) paths.add(resolved);
    }
  }
  return [...paths].sort(comparePath);
}

function findExtensionHintPaths(
  taskText: string,
  sourcePaths: readonly string[],
): readonly string[] {
  const normalizedPaths = sourcePaths.map((path) => normalizeProjectPath(path));
  const paths = new Set<string>();

  if (HTML_TASK_PATTERN.test(taskText)) {
    const htmlPaths = normalizedPaths.filter((path) => /\.html?$/iu.test(path));
    if (htmlPaths.includes('index.html')) paths.add('index.html');
    else if (htmlPaths.length === 1) paths.add(htmlPaths[0]!);
  }
  if (CSS_TASK_PATTERN.test(taskText)) {
    const cssPaths = normalizedPaths.filter((path) => /\.css$/iu.test(path));
    if (cssPaths.length === 1) paths.add(cssPaths[0]!);
    else if (cssPaths.some((path) => path.endsWith('assets/styles.css'))) {
      paths.add('assets/styles.css');
    }
  }
  if (JS_TASK_PATTERN.test(taskText)) {
    const jsPaths = normalizedPaths.filter((path) => /\.(?:c|m)?js$/iu.test(path));
    if (jsPaths.length === 1) paths.add(jsPaths[0]!);
    else if (jsPaths.some((path) => path.endsWith('assets/app.js'))) paths.add('assets/app.js');
  }

  return filterScopeEligiblePaths([...paths].sort(comparePath));
}

function htmlEntrypointHeuristic(
  taskText: string,
  sourcePaths: readonly string[],
): string | undefined {
  if (!HTML_TASK_PATTERN.test(taskText)) return undefined;
  const normalizedPaths = new Set(sourcePaths.map((path) => normalizeProjectPath(path)));
  if (normalizedPaths.has('index.html') && isScopeEligiblePath('index.html')) return 'index.html';
  return undefined;
}

function contextRankTopPaths(taskText: string, sourcePaths: readonly string[]): readonly string[] {
  const categories = inferTaskCategories(taskText);
  const queryVariants = expandQueryTokens(tokenize(taskText));
  const ranked = rankCandidatePaths(sourcePaths, queryVariants, categories, new Set(), taskText);
  const shortlist = buildReadShortlist(
    ranked,
    categories,
    CONTEXT_RETRIEVAL_SCORING.READ_SHORTLIST_CAPACITY,
    taskText,
  ).slice(0, 12);
  const mentioned = extractExplicitPathMentions(taskText, sourcePaths);
  return mentioned.filter((path) => shortlist.includes(path));
}

function buildEvidence(
  explicitPaths: readonly string[],
  onlyPaths: readonly string[],
  extensionPaths: readonly string[],
  iterationHints: readonly string[],
  contextRankPaths: readonly string[],
  htmlEntrypoint: string | undefined,
): readonly UpdateScopeEvidence[] {
  const evidence: UpdateScopeEvidence[] = [];
  for (const path of explicitPaths) {
    evidence.push({
      code: 'EXPLICIT_PATH_MENTION',
      path,
      message: `Task text mentions '${path}'.`,
    });
  }
  for (const path of onlyPaths) {
    evidence.push({
      code: 'EXPLICIT_ONLY_PATH_INSTRUCTION',
      path,
      message: `Task text restricts updates to '${path}'.`,
    });
  }
  for (const path of extensionPaths) {
    evidence.push({
      code: 'TASK_FILE_EXTENSION_HINT',
      path,
      message: `Task language suggests '${path}' as a likely update target.`,
    });
  }
  for (const path of iterationHints) {
    evidence.push({
      code: 'ITERATION_PATH_HINT',
      path,
      message: `Correction feedback hints at '${path}'.`,
    });
  }
  for (const path of contextRankPaths) {
    evidence.push({
      code: 'CONTEXT_RANK_TOP',
      path,
      message: `'${path}' ranks in the top context shortlist.`,
    });
  }
  if (htmlEntrypoint !== undefined) {
    evidence.push({
      code: 'HTML_ENTRYPOINT_HEURISTIC',
      path: htmlEntrypoint,
      message: `Task implies page/UI change and '${htmlEntrypoint}' exists.`,
    });
  }
  return evidence.sort((left, right) => {
    const codeCompare = left.code.localeCompare(right.code);
    if (codeCompare !== 0) return codeCompare;
    const pathCompare = (left.path ?? '').localeCompare(right.path ?? '');
    if (pathCompare !== 0) return pathCompare;
    return left.message.localeCompare(right.message);
  });
}

function mergePreferredPaths(
  explicitPaths: readonly string[],
  extensionPaths: readonly string[],
  iterationHints: readonly string[],
  htmlEntrypoint: string | undefined,
): readonly string[] {
  const merged = new Set<string>([...explicitPaths, ...extensionPaths, ...iterationHints]);
  if (htmlEntrypoint !== undefined) merged.add(htmlEntrypoint);
  return filterScopeEligiblePaths([...merged].sort(comparePath)).slice(
    0,
    MAXIMUM_REQUIRED_BASELINE_PATHS,
  );
}

export class UpdateScopePlanner {
  plan(input: UpdateScopePlannerInput): UpdateScopePlan {
    const taskText = input.taskText.trim();
    if (taskText.length === 0 || CREATE_TASK_PATTERN.test(taskText)) {
      return INACTIVE_UPDATE_SCOPE_PLAN;
    }

    const sourcePaths = input.sourcePaths.map((path) => normalizeProjectPath(path));
    const iterationHints = filterScopeEligiblePaths(
      (input.iterationPathHints ?? []).map((path) => normalizeProjectPath(path)),
    );
    const explicitPaths = extractExplicitPathMentions(taskText, sourcePaths);
    const onlyPaths = extractOnlyPathInstructions(taskText, sourcePaths);
    const extensionPaths = findExtensionHintPaths(taskText, sourcePaths);
    const contextRankPaths = contextRankTopPaths(taskText, sourcePaths);
    const htmlEntrypoint = htmlEntrypointHeuristic(taskText, sourcePaths);
    const preferredUpdatePaths =
      onlyPaths.length > 0
        ? onlyPaths.slice(0, MAXIMUM_REQUIRED_BASELINE_PATHS)
        : mergePreferredPaths(explicitPaths, extensionPaths, iterationHints, htmlEntrypoint);

    if (preferredUpdatePaths.length === 0) {
      return INACTIVE_UPDATE_SCOPE_PLAN;
    }

    const evidence = buildEvidence(
      explicitPaths,
      onlyPaths,
      extensionPaths,
      iterationHints,
      contextRankPaths,
      htmlEntrypoint,
    );
    const mode = onlyPaths.length > 0 ? 'HARD' : 'SOFT';
    const requiredBaselinePaths = preferredUpdatePaths.slice(0, MAXIMUM_REQUIRED_BASELINE_PATHS);

    return {
      schemaVersion: UPDATE_SCOPE_PLAN_SCHEMA_VERSION,
      mode,
      requiredBaselinePaths,
      preferredUpdatePaths,
      preferredMaximumUpdateOperations:
        mode === 'HARD'
          ? requiredBaselinePaths.length
          : Math.min(3, requiredBaselinePaths.length + 1),
      evidence,
    };
  }
}
