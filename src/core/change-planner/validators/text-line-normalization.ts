/**
 * Canonical logical-line semantics for change-planner metrics (line count, LCS churn,
 * preservation). CRLF and LF representations of the same text must yield identical results.
 *
 * Trailing newline: a final `\n` (or `\r\n` before normalization) does not add an extra
 * logical line — the empty segment after split is dropped.
 */
export function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

export function splitLogicalLines(content: string): readonly string[] {
  if (content.length === 0) return [];
  const lines = content.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

export function countLogicalLines(content: string): number {
  return splitLogicalLines(content).length;
}

export function normalizeTextForLineMetrics(value: string): string {
  return normalizeLineEndings(value);
}
