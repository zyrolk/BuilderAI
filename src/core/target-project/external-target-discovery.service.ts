import {
  documentBasename,
  normalizeDocumentPath,
} from '../blueprint-reader/documents/required-documents';
import type {
  DiscoveredDocument,
  DiscoveryReport,
  DocumentDiagnostic,
  RequiredDocumentSpec,
} from '../blueprint-reader';

function selectDocument(spec: RequiredDocumentSpec, matches: readonly string[]): string {
  return matches.includes(spec.path) ? spec.path : (matches[0] ?? spec.path);
}

export class ExternalTargetDiscoveryService {
  discover(
    paths: readonly string[],
    requiredDocuments: readonly RequiredDocumentSpec[],
  ): DiscoveryReport {
    const normalizedPaths = [...new Set(paths.map(normalizeDocumentPath))].sort();
    const requiredBasenames = new Set(requiredDocuments.map(({ path }) => documentBasename(path)));
    const missing: RequiredDocumentSpec[] = [];
    const documents: DiscoveredDocument[] = [];
    const diagnostics: DocumentDiagnostic[] = [];

    for (const spec of requiredDocuments) {
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
        message: `Document '${path}' is outside the external target bootstrap contract.`,
      })),
    );

    return { documents, missing, duplicates: [], unknown, diagnostics };
  }
}
