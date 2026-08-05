import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  BlueprintAnalysisService,
  MarkdownDocumentParser,
  ProjectSummaryService,
  RelationshipAnalysisService,
  type BlueprintReadResult,
  type DiscoveredDocument,
  type DocumentDiagnostic,
  type DocumentSource,
  type ParsedMarkdownDocument,
} from '../blueprint-reader';
import type { ProjectBrain } from '../project-brain';
import { DocumentValidator } from '../blueprint-reader/validators/document.validator';
import {
  EXTERNAL_TARGET_REQUIRED_DOCUMENTS,
  TARGET_PROJECT_MANIFEST_PATH,
} from './external-target-documents';
import { ExternalTargetDiscoveryService } from './external-target-discovery.service';
import { loadProjectBrainForTarget } from './synthetic-project-brain.service';
import {
  parseTargetProjectManifest,
  TargetProjectManifestValidationError,
} from './target-project-manifest.validator';
import type { TargetProjectManifest } from './target-project-manifest.types';

export interface ExternalTargetOnboardingIssue {
  readonly path: string;
  readonly message: string;
}

export class ExternalTargetOnboardingError extends Error {
  readonly code = 'EXTERNAL_TARGET_ONBOARDING_REQUIRED' as const;

  constructor(
    readonly issues: readonly ExternalTargetOnboardingIssue[],
    readonly missingPaths: readonly string[],
  ) {
    super(formatExternalTargetOnboardingMessage(issues, missingPaths));
    this.name = 'ExternalTargetOnboardingError';
  }
}

export class ExternalTargetProjectReaderService {
  private cachedBrain?: ReturnType<typeof loadProjectBrainForTarget>;
  private cachedManifest?: TargetProjectManifest;

  constructor(
    private readonly projectRoot: string,
    private readonly source: DocumentSource,
    private readonly discoveryService = new ExternalTargetDiscoveryService(),
    private readonly parser = new MarkdownDocumentParser(),
    private readonly documentValidator = new DocumentValidator(),
    private readonly analysisService = new BlueprintAnalysisService(),
    private readonly relationshipService = new RelationshipAnalysisService(),
    private readonly summaryService = new ProjectSummaryService(),
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  async read(): Promise<BlueprintReadResult> {
    const onboardingIssues: ExternalTargetOnboardingIssue[] = [];
    const missingPaths: string[] = [];

    if (!existsSync(path.join(this.projectRoot, 'package.json'))) {
      missingPaths.push('package.json');
      onboardingIssues.push({
        path: 'package.json',
        message: 'A package.json file is required so verification can run build and test scripts.',
      });
    }

    let manifest: TargetProjectManifest | undefined;
    try {
      manifest = await this.readManifest();
    } catch (error: unknown) {
      missingPaths.push(TARGET_PROJECT_MANIFEST_PATH);
      onboardingIssues.push(manifestIssue(error));
    }

    const discovery = this.discoveryService.discover(
      await this.source.listDocumentPaths(),
      EXTERNAL_TARGET_REQUIRED_DOCUMENTS,
    );
    for (const spec of discovery.missing) {
      missingPaths.push(spec.path);
    }

    const diagnostics = [
      ...onboardingIssuesToDiagnostics(onboardingIssues),
      ...discovery.diagnostics,
    ];
    if (manifest === undefined || discovery.missing.length > 0 || onboardingIssues.length > 0) {
      throw new ExternalTargetOnboardingError(
        [
          ...onboardingIssues,
          ...discovery.missing.map(({ path: docPath, kind }) => ({
            path: docPath,
            message: `Add the required ${kind} document using the external target bootstrap template.`,
          })),
        ],
        missingPaths,
      );
    }

    const markdown: Awaited<ReturnType<ExternalTargetProjectReaderService['readDocuments']>> =
      await this.readDocuments(discovery.documents);
    diagnostics.push(...markdown.diagnostics);

    const brain = loadProjectBrainForTarget(
      manifest,
      await this.readOptionalProjectBrain(),
      this.clock(),
    );
    this.cachedBrain = brain;
    this.cachedManifest = manifest;

    const analysis = this.analysisService.analyze(brain, markdown.documents);
    const relationships = this.relationshipService.analyze(brain);
    const summary = this.summaryService.create(brain, analysis, discovery, diagnostics);

    return {
      valid: diagnostics.every(({ severity }) => severity !== 'ERROR'),
      discovery,
      documents: markdown.documents,
      analysis,
      relationships,
      diagnostics,
      summary,
    };
  }

  getCachedProjectBrain(): ProjectBrain | undefined {
    return this.cachedBrain;
  }

  getCachedManifest(): TargetProjectManifest | undefined {
    return this.cachedManifest;
  }

  private async readManifest(): Promise<TargetProjectManifest> {
    const raw = await readFile(path.join(this.projectRoot, TARGET_PROJECT_MANIFEST_PATH), 'utf8');
    return parseTargetProjectManifest(JSON.parse(raw) as unknown);
  }

  private async readOptionalProjectBrain(): Promise<unknown | undefined> {
    const brainPath = path.join(this.projectRoot, 'project-brain.json');
    if (!existsSync(brainPath)) return undefined;
    return JSON.parse(await readFile(brainPath, 'utf8')) as unknown;
  }

  private async readDocuments(documents: readonly DiscoveredDocument[]): Promise<{
    readonly documents: readonly ParsedMarkdownDocument[];
    readonly diagnostics: readonly DocumentDiagnostic[];
  }> {
    const diagnostics: DocumentDiagnostic[] = [];
    const markdown: ParsedMarkdownDocument[] = [];

    await Promise.all(
      documents.map(async (document) => {
        const spec = EXTERNAL_TARGET_REQUIRED_DOCUMENTS.find(({ kind }) => kind === document.kind);
        if (spec === undefined) return;
        try {
          const content = await this.source.readDocument(document.actualPath);
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
      documents: markdown.sort((left, right) => left.path.localeCompare(right.path)),
      diagnostics,
    };
  }
}

function manifestIssue(error: unknown): ExternalTargetOnboardingIssue {
  if (error instanceof TargetProjectManifestValidationError) {
    return {
      path: TARGET_PROJECT_MANIFEST_PATH,
      message: error.issues.map(({ path, message }) => `${path} ${message}`).join('; '),
    };
  }
  if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
    return {
      path: TARGET_PROJECT_MANIFEST_PATH,
      message:
        'Create .builderai/target-project.json from templates/external-target-bootstrap/target-project.json.',
    };
  }
  return {
    path: TARGET_PROJECT_MANIFEST_PATH,
    message: error instanceof Error ? error.message : 'Target project manifest is invalid.',
  };
}

function onboardingIssuesToDiagnostics(
  issues: readonly ExternalTargetOnboardingIssue[],
): DocumentDiagnostic[] {
  return issues.map(({ path, message }) => ({
    code: 'MISSING_DOCUMENT',
    severity: 'ERROR' as const,
    path,
    message,
  }));
}

export function formatExternalTargetOnboardingMessage(
  issues: readonly ExternalTargetOnboardingIssue[],
  missingPaths: readonly string[],
): string {
  const uniqueMissing = [...new Set(missingPaths)].sort();
  const detail =
    issues.length === 0
      ? uniqueMissing.join(', ')
      : issues.map(({ path, message }) => `${path}: ${message}`).join(' ');
  return `External target onboarding is incomplete. Add the required bootstrap files before prepare. Missing or invalid: ${detail}`;
}
