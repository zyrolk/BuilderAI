const PARTIAL_EXCERPT_HEADER =
  '[PARTIAL_EXCERPT: bounded excerpt for prepare context — repository contains the full file]';

export function buildPartialSourceExcerpt(
  content: string,
  maximumCharacters: number,
): { readonly content: string; readonly truncated: boolean } {
  if (content.length <= maximumCharacters) {
    return { content, truncated: false };
  }
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const excerptLines: string[] = [];
  let size = PARTIAL_EXCERPT_HEADER.length + 1;
  for (const line of lines) {
    const nextSize = size + line.length + 1;
    if (nextSize > maximumCharacters && excerptLines.length > 0) break;
    excerptLines.push(line);
    size = nextSize;
    if (size >= maximumCharacters) break;
  }
  const excerpt = [PARTIAL_EXCERPT_HEADER, ...excerptLines].join('\n');
  if (excerpt.length <= maximumCharacters) {
    return { content: excerpt, truncated: true };
  }
  return { content: `${excerpt.slice(0, maximumCharacters)}…`, truncated: true };
}
