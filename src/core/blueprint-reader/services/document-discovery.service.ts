import { REQUIRED_DOCUMENTS, documentBasename, normalizeDocumentPath } from '../documents';
import type {
  DiscoveredDocument,
  DiscoveryReport,
  DocumentDiagnostic,
  DuplicateDocument,
  RequiredDocumentSpec,
} from '../types';

function selectDocument(spec: RequiredDocumentSpec, matches: readonly string[]): string {
  return matches.includes(spec.path) ? spec.path : (matches[0] ?? spec.path);
}

export class DocumentDiscoveryService {
  discover(paths: readonly string[]): DiscoveryReport {
    const normalizedPaths = [...new Set(paths.map(normalizeDocumentPath))].sort();
    const requiredBasenames = new Set(REQUIRED_DOCUMENTS.map(({ path }) => documentBasename(path)));
    const missing: RequiredDocumentSpec[] = [];
    const duplicates: DuplicateDocument[] = [];
    const documents: DiscoveredDocument[] = [];
    const diagnostics: DocumentDiagnostic[] = [];

    for (const spec of REQUIRED_DOCUMENTS) {
      const expectedBasename = documentBasename(spec.path);
      const matches = normalizedPaths.filter((path) => documentBasename(path) === expectedBasename);

      if (matches.length === 0) {
        missing.push(spec);
        diagnostics.push({
          code: 'MISSING_DOCUMENT',
          severity: 'ERROR',
          path: spec.path,
          message: `Required ${spec.kind} document '${spec.path}' was not found.`,
        });
        continue;
      }

      if (matches.length > 1) {
        duplicates.push({ kind: spec.kind, paths: matches });
        diagnostics.push({
          code: 'DUPLICATE_DOCUMENT',
          severity: 'ERROR',
          path: spec.path,
          relatedPaths: matches,
          message: `Multiple ${spec.kind} documents were found.`,
        });
      }

      documents.push({
        kind: spec.kind,
        expectedPath: spec.path,
        actualPath: selectDocument(spec, matches),
        format: spec.format,
      });
    }

    const unknown = normalizedPaths.filter(
      (path) => !requiredBasenames.has(documentBasename(path)),
    );
    diagnostics.push(
      ...unknown.map<DocumentDiagnostic>((path) => ({
        code: 'UNKNOWN_DOCUMENT',
        severity: 'WARNING',
        path,
        message: `Document '${path}' is not part of the supported Blueprint Reader contract.`,
      })),
    );

    return { documents, missing, duplicates, unknown, diagnostics };
  }
}
