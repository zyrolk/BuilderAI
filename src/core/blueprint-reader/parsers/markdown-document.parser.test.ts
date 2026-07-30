import { REQUIRED_DOCUMENTS } from '../documents';
import { markdownFor } from '../test/document-set.fixture';
import { DocumentValidator } from '../validators';
import { MarkdownDocumentParser } from './markdown-document.parser';

describe('MarkdownDocumentParser', () => {
  const spec = REQUIRED_DOCUMENTS.find(({ kind }) => kind === 'roadmap');
  if (spec === undefined) throw new Error('Roadmap specification is missing.');
  const discovered = {
    kind: spec.kind,
    expectedPath: spec.path,
    actualPath: spec.path,
    format: spec.format,
  } as const;
  const parser = new MarkdownDocumentParser();
  const validator = new DocumentValidator();

  it('parses machine metadata, a title, and populated sections', () => {
    const parsed = parser.parse(discovered, markdownFor(spec));

    expect(parsed).toMatchObject({
      kind: 'roadmap',
      declaredKind: 'roadmap',
      version: 1,
      title: 'Roadmap',
    });
    expect(validator.validateMarkdown(parsed, spec)).toEqual([]);
  });

  it('reports invalid metadata, a missing title, and missing sections', () => {
    const parsed = parser.parse(discovered, '## Planning rules\n\n');
    const diagnostics = validator.validateMarkdown(parsed, spec);

    expect(diagnostics.map(({ code }) => code)).toEqual([
      'INVALID_DOCUMENT_METADATA',
      'MALFORMED_DOCUMENT',
      'MISSING_SECTION',
      'MISSING_SECTION',
      'MISSING_SECTION',
      'MISSING_SECTION',
    ]);
  });

  it('reports a mismatched type and unsupported version', () => {
    const parsed = parser.parse(
      discovered,
      markdownFor(spec, { declaredKind: 'architecture', version: 2 }),
    );

    expect(validator.validateMarkdown(parsed, spec)).toEqual([
      expect.objectContaining({ code: 'INVALID_DOCUMENT_METADATA' }),
      expect.objectContaining({ code: 'UNSUPPORTED_DOCUMENT_VERSION' }),
    ]);
  });

  it('rejects an empty required section', () => {
    const parsed = parser.parse(
      discovered,
      markdownFor(spec).replace('Policy for Product AI gate.', ''),
    );

    expect(validator.validateMarkdown(parsed, spec)).toContainEqual(
      expect.objectContaining({
        code: 'MISSING_SECTION',
        message: expect.stringContaining('Product AI gate'),
      }),
    );
  });
});
