import { normalizeHeading } from '../parsers';
import type { DocumentDiagnostic, ParsedMarkdownDocument, RequiredDocumentSpec } from '../types';

export class DocumentValidator {
  validateMarkdown(
    document: ParsedMarkdownDocument,
    spec: RequiredDocumentSpec,
  ): readonly DocumentDiagnostic[] {
    const diagnostics: DocumentDiagnostic[] = [];

    if (document.declaredKind === undefined || document.version === undefined) {
      diagnostics.push({
        code: 'INVALID_DOCUMENT_METADATA',
        severity: 'ERROR',
        path: document.path,
        message: 'Document metadata must declare a type and numeric version.',
      });
    } else {
      if (document.declaredKind !== spec.kind) {
        diagnostics.push({
          code: 'INVALID_DOCUMENT_METADATA',
          severity: 'ERROR',
          path: document.path,
          message: `Document declares type '${document.declaredKind}', expected '${spec.kind}'.`,
        });
      }
      if (!spec.supportedVersions.includes(document.version)) {
        diagnostics.push({
          code: 'UNSUPPORTED_DOCUMENT_VERSION',
          severity: 'ERROR',
          path: document.path,
          message: `Document version ${document.version} is not supported; expected one of ${spec.supportedVersions.join(', ')}.`,
        });
      }
    }

    if (document.title === undefined) {
      diagnostics.push({
        code: 'MALFORMED_DOCUMENT',
        severity: 'ERROR',
        path: document.path,
        message: 'Document must contain a level-one title.',
      });
    }

    const populatedSections = new Set(
      document.sections
        .filter(({ level, content }) => level === 2 && content.length > 0)
        .map(({ normalizedHeading }) => normalizedHeading),
    );
    diagnostics.push(
      ...spec.requiredSections
        .filter((heading) => !populatedSections.has(normalizeHeading(heading)))
        .map<DocumentDiagnostic>((heading) => ({
          code: 'MISSING_SECTION',
          severity: 'ERROR',
          path: document.path,
          message: `Required section '${heading}' is missing or empty.`,
        })),
    );

    return diagnostics;
  }
}
