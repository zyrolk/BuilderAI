import { normalizeLineEndings } from '../../../infrastructure/workspace/text-baseline-content';

type EditOperation = 'equal' | 'insert' | 'delete';

interface EditScriptEntry {
  readonly type: EditOperation;
  readonly line: string;
}

interface UnifiedDiffOptions {
  readonly logicalPath: string;
  readonly baselineContent: string;
  readonly proposedContent: string;
  readonly contextLines?: number;
}

export function isTextDiffEligible(content: string): boolean {
  return !content.includes('\u0000');
}

export function createUnifiedDiff({
  logicalPath,
  baselineContent,
  proposedContent,
  contextLines = 3,
}: UnifiedDiffOptions): string {
  const baselineLines = splitLines(normalizeLineEndings(baselineContent));
  const proposedLines = splitLines(normalizeLineEndings(proposedContent));
  const script = buildEditScript(baselineLines, proposedLines);
  const hunks = groupHunks(script, contextLines);
  const header = [`--- a/${logicalPath}`, `+++ b/${logicalPath}`];
  if (hunks.length === 0) {
    return [...header, '@@'].join('\n');
  }
  return [...header, ...hunks].join('\n');
}

export function createAdditionDiff(logicalPath: string, proposedContent: string): string {
  const lines = splitLines(normalizeLineEndings(proposedContent));
  const header = [`--- /dev/null`, `+++ b/${logicalPath}`];
  if (lines.length === 0) {
    return [...header, '@@ -0,0 +1,0 @@'].join('\n');
  }
  const body = lines.map((line) => `+${line}`).join('\n');
  return [...header, `@@ -0,0 +1,${lines.length} @@`, body].join('\n');
}

export function createDeletionDiff(logicalPath: string, baselineContent: string): string {
  const lines = splitLines(normalizeLineEndings(baselineContent));
  const header = [`--- a/${logicalPath}`, `+++ /dev/null`];
  if (lines.length === 0) {
    return [...header, '@@ -0,0 +0,0 @@'].join('\n');
  }
  const body = lines.map((line) => `-${line}`).join('\n');
  return [...header, `@@ -1,${lines.length} +0,0 @@`, body].join('\n');
}

function splitLines(content: string): string[] {
  if (content.length === 0) return [];
  return content.split('\n');
}

function buildEditScript(
  baselineLines: readonly string[],
  proposedLines: readonly string[],
): readonly EditScriptEntry[] {
  const lcs = longestCommonSubsequence(baselineLines, proposedLines);
  const script: EditScriptEntry[] = [];
  let baselineIndex = 0;
  let proposedIndex = 0;
  for (const commonLine of lcs) {
    while (baselineIndex < baselineLines.length && baselineLines[baselineIndex] !== commonLine) {
      script.push({ type: 'delete', line: baselineLines[baselineIndex]! });
      baselineIndex += 1;
    }
    while (proposedIndex < proposedLines.length && proposedLines[proposedIndex] !== commonLine) {
      script.push({ type: 'insert', line: proposedLines[proposedIndex]! });
      proposedIndex += 1;
    }
    script.push({ type: 'equal', line: commonLine });
    baselineIndex += 1;
    proposedIndex += 1;
  }
  while (baselineIndex < baselineLines.length) {
    script.push({ type: 'delete', line: baselineLines[baselineIndex]! });
    baselineIndex += 1;
  }
  while (proposedIndex < proposedLines.length) {
    script.push({ type: 'insert', line: proposedLines[proposedIndex]! });
    proposedIndex += 1;
  }
  return script;
}

function longestCommonSubsequence(
  left: readonly string[],
  right: readonly string[],
): readonly string[] {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const lengths = Array.from({ length: rows }, () => Array<number>(cols).fill(0));
  for (let row = left.length - 1; row >= 0; row -= 1) {
    for (let col = right.length - 1; col >= 0; col -= 1) {
      if (left[row] === right[col]) {
        lengths[row]![col] = lengths[row + 1]![col + 1]! + 1;
      } else {
        lengths[row]![col] = Math.max(lengths[row + 1]![col]!, lengths[row]![col + 1]!);
      }
    }
  }
  const sequence: string[] = [];
  let row = 0;
  let col = 0;
  while (row < left.length && col < right.length) {
    if (left[row] === right[col]) {
      sequence.push(left[row]!);
      row += 1;
      col += 1;
      continue;
    }
    if (lengths[row + 1]![col]! >= lengths[row]![col + 1]!) {
      row += 1;
    } else {
      col += 1;
    }
  }
  return sequence;
}

function groupHunks(script: readonly EditScriptEntry[], contextLines: number): string[] {
  const changeIndexes = script
    .map((entry, index) => (entry.type === 'equal' ? -1 : index))
    .filter((index) => index >= 0);
  if (changeIndexes.length === 0) return [];

  const ranges: Array<{ start: number; end: number }> = [];
  let rangeStart = Math.max(0, changeIndexes[0]! - contextLines);
  let rangeEnd = Math.min(script.length - 1, changeIndexes[0]! + contextLines);
  for (const changeIndex of changeIndexes.slice(1)) {
    const nextStart = Math.max(0, changeIndex - contextLines);
    const nextEnd = Math.min(script.length - 1, changeIndex + contextLines);
    if (nextStart <= rangeEnd + 1) {
      rangeEnd = Math.max(rangeEnd, nextEnd);
      continue;
    }
    ranges.push({ start: rangeStart, end: rangeEnd });
    rangeStart = nextStart;
    rangeEnd = nextEnd;
  }
  ranges.push({ start: rangeStart, end: rangeEnd });

  return ranges.map(({ start, end }) => formatHunk(script, start, end));
}

function formatHunk(script: readonly EditScriptEntry[], start: number, end: number): string {
  let oldLine = 1;
  let newLine = 1;
  for (let index = 0; index < start; index += 1) {
    const entry = script[index]!;
    if (entry.type === 'equal' || entry.type === 'delete') oldLine += 1;
    if (entry.type === 'equal' || entry.type === 'insert') newLine += 1;
  }

  const hunkLines: string[] = [];
  let oldCount = 0;
  let newCount = 0;
  for (let index = start; index <= end; index += 1) {
    const entry = script[index]!;
    if (entry.type === 'equal') {
      hunkLines.push(` ${entry.line}`);
      oldCount += 1;
      newCount += 1;
      continue;
    }
    if (entry.type === 'delete') {
      hunkLines.push(`-${entry.line}`);
      oldCount += 1;
      continue;
    }
    hunkLines.push(`+${entry.line}`);
    newCount += 1;
  }

  return [`@@ -${oldLine},${oldCount} +${newLine},${newCount} @@`, ...hunkLines].join('\n');
}

export function truncateUnifiedDiff(
  diff: string,
  maximumLines: number,
  maximumCharacters: number,
): { readonly diff: string; readonly truncated: boolean } {
  const lines = diff.split('\n');
  if (lines.length <= maximumLines && diff.length <= maximumCharacters) {
    return { diff, truncated: false };
  }
  const truncatedLines = lines.slice(0, maximumLines);
  let truncatedDiff = truncatedLines.join('\n');
  if (truncatedDiff.length > maximumCharacters) {
    truncatedDiff = truncatedDiff.slice(0, maximumCharacters);
  }
  return { diff: truncatedDiff, truncated: true };
}

export function countDiffLines(diff: string): number {
  if (diff.length === 0) return 0;
  return diff.split('\n').length;
}
