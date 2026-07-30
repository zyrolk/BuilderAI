import { REQUIRED_DOCUMENTS } from '../documents';
import type { DocumentSource } from '../ports';
import type { RequiredDocumentSpec } from '../types';
import { createProjectBrain } from '../../project-brain/test/project-brain.fixture';

function titleFor(spec: RequiredDocumentSpec): string {
  return spec.kind
    .split('-')
    .map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`)
    .join(' ');
}

export function markdownFor(
  spec: RequiredDocumentSpec,
  options: {
    readonly version?: number;
    readonly declaredKind?: string;
    readonly append?: string;
    readonly omitSection?: string;
  } = {},
): string {
  const sections = spec.requiredSections
    .filter((section) => section !== options.omitSection)
    .map((section) =>
      section === 'Architectural principles'
        ? `## ${section}\n\n1. Keep the core independent.\n2. Validate every boundary.`
        : `## ${section}\n\nPolicy for ${section}.`,
    )
    .join('\n\n');

  return `<!-- builderai-document\ntype: ${options.declaredKind ?? spec.kind}\nversion: ${options.version ?? 1}\n-->\n\n# ${titleFor(spec)}\n\n${sections}${options.append ?? ''}\n`;
}

export function createDocumentSet(): Map<string, string> {
  return new Map(
    REQUIRED_DOCUMENTS.map((spec) => [
      spec.path,
      spec.format === 'JSON' ? JSON.stringify(createProjectBrain()) : markdownFor(spec),
    ]),
  );
}

export class MemoryDocumentSource implements DocumentSource {
  constructor(readonly documents: Map<string, string>) {}

  async listDocumentPaths(): Promise<readonly string[]> {
    return [...this.documents.keys()];
  }

  async readDocument(path: string): Promise<string> {
    const content = this.documents.get(path);
    if (content === undefined) throw new Error(`Missing fixture '${path}'.`);
    return content;
  }
}
