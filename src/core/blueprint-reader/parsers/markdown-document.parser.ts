import type { DiscoveredDocument, MarkdownSection, ParsedMarkdownDocument } from '../types';

const METADATA_PATTERN = /<!--\s*builderai-document\s*\r?\n([\s\S]*?)-->/i;
const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*$/gm;

function parseMetadata(content: string): Readonly<Record<string, string>> {
  const metadataBlock = METADATA_PATTERN.exec(content)?.[1];
  if (metadataBlock === undefined) return {};

  return Object.fromEntries(
    metadataBlock
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*([a-z][a-z-]*):\s*(.*?)\s*$/i))
      .filter((match): match is RegExpMatchArray => match !== null)
      .map((match) => [match[1]?.toLowerCase() ?? '', match[2] ?? '']),
  );
}

function parseVersion(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  return Number(value);
}

function parseSections(content: string): readonly MarkdownSection[] {
  const headings = [...content.matchAll(HEADING_PATTERN)];

  return headings.map((heading, index) => {
    const hashes = heading[1] ?? '';
    const title = heading[2]?.trim() ?? '';
    const start = (heading.index ?? 0) + heading[0].length;
    const end = headings[index + 1]?.index ?? content.length;

    return {
      heading: title,
      normalizedHeading: normalizeHeading(title),
      level: hashes.length,
      content: content.slice(start, end).trim(),
    };
  });
}

export function normalizeHeading(heading: string): string {
  return heading.trim().toLowerCase().replace(/\s+/g, ' ');
}

export class MarkdownDocumentParser {
  parse(document: DiscoveredDocument, content: string): ParsedMarkdownDocument {
    const metadata = parseMetadata(content);
    const sections = parseSections(content);

    return {
      kind: document.kind,
      path: document.actualPath,
      declaredKind: metadata.type,
      version: parseVersion(metadata.version),
      title: sections.find(({ level }) => level === 1)?.heading,
      content,
      sections,
    };
  }
}
