/**
 * Lightweight deterministic regex outline — names + line numbers only (ADR-038).
 * No AST / LSP / TypeScript Language Service.
 */

export const FILE_OUTLINE_MAX_ENTRIES = 64 as const;
export const FILE_OUTLINE_MAX_SOURCE_CHARS = 200_000 as const;

export type OutlineKind =
  | 'EXPORT_FUNCTION'
  | 'EXPORT_CLASS'
  | 'EXPORT_INTERFACE'
  | 'EXPORT_TYPE'
  | 'EXPORT_CONST'
  | 'FUNCTION'
  | 'CLASS'
  | 'INTERFACE';

export interface FileOutlineEntry {
  readonly kind: OutlineKind;
  readonly name: string;
  readonly lineNumber: number;
}

export interface FileOutlineResult {
  readonly logicalPath: string;
  readonly entries: readonly FileOutlineEntry[];
  readonly truncated: boolean;
  readonly scannedCharacters: number;
}

const PATTERNS: readonly { readonly kind: OutlineKind; readonly regex: RegExp }[] = [
  {
    kind: 'EXPORT_FUNCTION',
    regex: /^\s*export\s+(?:async\s+)?function\s+\*?\s*([A-Za-z_$][\w$]*)/u,
  },
  {
    kind: 'EXPORT_CLASS',
    regex: /^\s*export\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/u,
  },
  {
    kind: 'EXPORT_INTERFACE',
    regex: /^\s*export\s+interface\s+([A-Za-z_$][\w$]*)/u,
  },
  {
    kind: 'EXPORT_TYPE',
    regex: /^\s*export\s+type\s+([A-Za-z_$][\w$]*)\s*=/u,
  },
  {
    kind: 'EXPORT_CONST',
    regex: /^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/u,
  },
  {
    kind: 'FUNCTION',
    regex: /^\s*(?:async\s+)?function\s+\*?\s*([A-Za-z_$][\w$]*)/u,
  },
  {
    kind: 'CLASS',
    regex: /^\s*(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/u,
  },
  {
    kind: 'INTERFACE',
    regex: /^\s*interface\s+([A-Za-z_$][\w$]*)/u,
  },
];

export function buildFileOutline(input: {
  readonly logicalPath: string;
  readonly content: string;
  readonly maximumEntries?: number;
}): FileOutlineResult {
  const maximumEntries = Math.min(
    input.maximumEntries ?? FILE_OUTLINE_MAX_ENTRIES,
    FILE_OUTLINE_MAX_ENTRIES,
  );
  const truncatedBySize = input.content.length > FILE_OUTLINE_MAX_SOURCE_CHARS;
  const source = truncatedBySize
    ? input.content.slice(0, FILE_OUTLINE_MAX_SOURCE_CHARS)
    : input.content;
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const entries: FileOutlineEntry[] = [];
  let truncated = truncatedBySize;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    for (const pattern of PATTERNS) {
      const match = pattern.regex.exec(line);
      if (match?.[1] === undefined) continue;
      // Prefer export forms: skip bare FUNCTION/CLASS/INTERFACE if export already matched.
      if (
        (pattern.kind === 'FUNCTION' || pattern.kind === 'CLASS' || pattern.kind === 'INTERFACE') &&
        /^\s*export\b/u.test(line)
      ) {
        continue;
      }
      entries.push({
        kind: pattern.kind,
        name: match[1],
        lineNumber: index + 1,
      });
      break;
    }
    if (entries.length >= maximumEntries) {
      truncated = true;
      break;
    }
  }

  return {
    logicalPath: input.logicalPath,
    entries,
    truncated,
    scannedCharacters: source.length,
  };
}
