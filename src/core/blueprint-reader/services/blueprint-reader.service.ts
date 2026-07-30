import {
  ProjectBrainValidationError,
  parseProjectBrain,
  type ProjectBrain,
} from '../../project-brain';
import { REQUIRED_DOCUMENTS } from '../documents';
import { MarkdownDocumentParser } from '../parsers';
import type { DocumentSource } from '../ports';
import type {
  BlueprintReadResult,
  DiscoveredDocument,
  DocumentDiagnostic,
  ParsedMarkdownDocument,
  RequiredDocumentSpec,
} from '../types';
import { ConsistencyValidator, DocumentValidator } from '../validators';
import { BlueprintAnalysisService } from './blueprint-analysis.service';
import { DocumentDiscoveryService } from './document-discovery.service';
import { ProjectSummaryService } from './project-summary.service';
import { RelationshipAnalysisService } from './relationship-analysis.service';

interface ReadDocumentsResult {
  readonly brain?: ProjectBrain;
  readonly markdown: readonly ParsedMarkdownDocument[];
  readonly diagnostics: readonly DocumentDiagnostic[];
}

function specFor(document: DiscoveredDocument): RequiredDocumentSpec {
  const spec = REQUIRED_DOCUMENTS.find(({ kind }) => kind === document.kind);
  if (spec === undefined) throw new Error(`No document specification exists for ${document.kind}.`);
  return spec;
}

function schemaVersion(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  return Reflect.get(value, 'schemaVersion');
}

function sortDiagnostics(
  diagnostics: readonly DocumentDiagnostic[],
): readonly DocumentDiagnostic[] {
  return [...diagnostics].sort((left, right) => {
    const leftKey = `${left.path ?? ''}\u0000${left.code}\u0000${left.message}`;
    const rightKey = `${right.path ?? ''}\u0000${right.code}\u0000${right.message}`;
    return leftKey.localeCompare(rightKey);
  });
}

export class BlueprintReaderService {
  constructor(
    private readonly source: DocumentSource,
    private readonly discoveryService = new DocumentDiscoveryService(),
    private readonly parser = new MarkdownDocumentParser(),
    private readonly documentValidator = new DocumentValidator(),
    private readonly consistencyValidator = new ConsistencyValidator(),
    private readonly analysisService = new BlueprintAnalysisService(),
    private readonly relationshipService = new RelationshipAnalysisService(),
    private readonly summaryService = new ProjectSummaryService(),
  ) {}

  async read(): Promise<BlueprintReadResult> {
    const discovery = this.discoveryService.discover(await this.source.listDocumentPaths());
    const readResult = await this.readDocuments(discovery.documents);
    const diagnostics = [...discovery.diagnostics, ...readResult.diagnostics];

    if (readResult.brain === undefined) {
      return {
        valid: false,
        discovery,
        documents: readResult.markdown,
        relationships: [],
        diagnostics: sortDiagnostics(diagnostics),
      };
    }

    const consistencyDiagnostics = this.consistencyValidator.validate(
      readResult.brain,
      readResult.markdown,
    );
    diagnostics.push(...consistencyDiagnostics);
    const analysis = this.analysisService.analyze(readResult.brain, readResult.markdown);
    const relationships = this.relationshipService.analyze(readResult.brain);
    const sortedDiagnostics = sortDiagnostics(diagnostics);
    const summary = this.summaryService.create(
      readResult.brain,
      analysis,
      discovery,
      sortedDiagnostics,
    );

    return {
      valid: diagnostics.every(({ severity }) => severity !== 'ERROR'),
      discovery,
      documents: readResult.markdown,
      analysis,
      relationships,
      diagnostics: sortedDiagnostics,
      summary,
    };
  }

  private async readDocuments(
    documents: readonly DiscoveredDocument[],
  ): Promise<ReadDocumentsResult> {
    const diagnostics: DocumentDiagnostic[] = [];
    const markdown: ParsedMarkdownDocument[] = [];
    let brain: ProjectBrain | undefined;

    await Promise.all(
      documents.map(async (document) => {
        try {
          const content = await this.source.readDocument(document.actualPath);
          const spec = specFor(document);

          if (document.format === 'JSON') {
            const result = this.parseBrain(content, document, spec);
            brain = result.brain;
            diagnostics.push(...result.diagnostics);
            return;
          }

          const parsed = this.parser.parse(document, content);
          markdown.push(parsed);
          diagnostics.push(...this.documentValidator.validateMarkdown(parsed, spec));
        } catch (error: unknown) {
          diagnostics.push({
            code: 'MALFORMED_DOCUMENT',
            severity: 'ERROR',
            path: document.actualPath,
            message: `Document could not be read: ${error instanceof Error ? error.message : 'unknown error'}`,
          });
        }
      }),
    );

    return {
      brain,
      markdown: markdown.sort((left, right) => left.path.localeCompare(right.path)),
      diagnostics,
    };
  }

  private parseBrain(
    content: string,
    document: DiscoveredDocument,
    spec: RequiredDocumentSpec,
  ): { readonly brain?: ProjectBrain; readonly diagnostics: readonly DocumentDiagnostic[] } {
    let value: unknown;
    try {
      value = JSON.parse(content) as unknown;
    } catch (error: unknown) {
      return {
        diagnostics: [
          {
            code: 'MALFORMED_DOCUMENT',
            severity: 'ERROR',
            path: document.actualPath,
            message: `Project Brain is not valid JSON: ${error instanceof Error ? error.message : 'unknown error'}`,
          },
        ],
      };
    }

    const version = schemaVersion(value);
    if (typeof version !== 'number' || !spec.supportedVersions.includes(version)) {
      return {
        diagnostics: [
          {
            code: 'UNSUPPORTED_DOCUMENT_VERSION',
            severity: 'ERROR',
            path: document.actualPath,
            message: `Project Brain schema version '${String(version)}' is unsupported.`,
          },
        ],
      };
    }

    try {
      return { brain: parseProjectBrain(value), diagnostics: [] };
    } catch (error: unknown) {
      const details =
        error instanceof ProjectBrainValidationError
          ? error.issues.map(({ path, message }) => `${path} ${message}`).join('; ')
          : error instanceof Error
            ? error.message
            : 'unknown error';
      return {
        diagnostics: [
          {
            code: 'SCHEMA_INCOMPATIBLE',
            severity: 'ERROR',
            path: document.actualPath,
            message: `Project Brain does not match its schema: ${details}`,
          },
        ],
      };
    }
  }
}
