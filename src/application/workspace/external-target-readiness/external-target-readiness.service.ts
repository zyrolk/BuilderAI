import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  classifyManifestProtectedAreaExposure,
  ManifestProtectedAreasValidationError,
  normalizeManifestProtectedArea,
  parseManifestProtectedAreas,
} from '../../../core/target-project/manifest-protected-areas';
import {
  EXTERNAL_TARGET_REQUIRED_DOCUMENTS,
  TARGET_PROJECT_MANIFEST_PATH,
} from '../../../core/target-project/external-target-documents';
import { ExternalTargetDiscoveryService } from '../../../core/target-project/external-target-discovery.service';
import { loadExternalTargetSourceIndexOptions } from '../../../core/target-project/external-target-source-index';
import {
  parseTargetProjectManifest,
  TargetProjectManifestValidationError,
} from '../../../core/target-project/target-project-manifest.validator';
import type { TargetProjectManifest } from '../../../core/target-project/target-project-manifest.types';
import { NodeFileSystemDocumentSource } from '../../../infrastructure/blueprint-reader';
import { NodeProjectFileSource } from '../../../infrastructure/project';
import {
  DEFAULT_SCAN_ROOTS,
  resolveScanRoots,
} from '../../../infrastructure/project/project-source-index-policy';
import { discoverPackageScripts } from '../../../infrastructure/verification/package-script-discovery';
import { READINESS_DIAGNOSTIC_CODES } from './external-target-readiness-codes';
import {
  EXTERNAL_TARGET_READINESS_SCHEMA_VERSION,
  type ExternalTargetProtectedAreaSummary,
  type ExternalTargetReadiness,
  type ReadinessIssue,
} from './external-target-readiness.types';

const TEST_ROOT_CANDIDATES = ['tests', 'test', '__tests__'] as const;

export interface ExternalTargetReadinessServiceInput {
  readonly projectRoot: string;
  readonly extraSourceScanRoots?: readonly string[];
  readonly runtimeConnected?: boolean;
}

export class ExternalTargetReadinessService {
  constructor(private readonly discoveryService = new ExternalTargetDiscoveryService()) {}

  async project(input: ExternalTargetReadinessServiceInput): Promise<ExternalTargetReadiness> {
    const projectRoot = path.resolve(input.projectRoot);
    const blockers: ReadinessIssue[] = [];
    const warnings: ReadinessIssue[] = [];

    if (!existsSync(projectRoot)) {
      blockers.push(
        readinessIssue(
          READINESS_DIAGNOSTIC_CODES.PROJECT_ROOT_UNAVAILABLE,
          'BLOCKER',
          'Configured project root is not available on disk.',
          undefined,
          'Set BUILDERAI_PROJECT_ROOT to an existing directory.',
        ),
      );
      return buildProjection({
        projectRoot,
        blockers,
        warnings,
        runtimeConnected: input.runtimeConnected ?? false,
      });
    }

    const projectRootDisplay = path.basename(projectRoot) || projectRoot;

    if (!existsSync(path.join(projectRoot, 'package.json'))) {
      blockers.push(
        readinessIssue(
          READINESS_DIAGNOSTIC_CODES.PACKAGE_JSON_MISSING,
          'BLOCKER',
          'package.json is required so verification can discover build and test scripts.',
          'package.json',
          'Add a package.json at the project root.',
        ),
      );
    }

    let manifest: TargetProjectManifest | undefined;
    const manifestPath = path.join(projectRoot, TARGET_PROJECT_MANIFEST_PATH);
    if (!existsSync(manifestPath)) {
      blockers.push(
        readinessIssue(
          READINESS_DIAGNOSTIC_CODES.MANIFEST_MISSING,
          'BLOCKER',
          'External target manifest is missing.',
          TARGET_PROJECT_MANIFEST_PATH,
          'Copy templates/external-target-bootstrap/.builderai/target-project.json into the project.',
        ),
      );
    } else {
      try {
        const raw = await readFile(manifestPath, 'utf8');
        manifest = parseTargetProjectManifest(JSON.parse(raw) as unknown);
      } catch (error: unknown) {
        blockers.push(manifestBlocker(error));
      }
    }

    if (manifest?.protectedAreas !== undefined) {
      try {
        parseManifestProtectedAreas(manifest.protectedAreas, '$.protectedAreas');
      } catch (error: unknown) {
        blockers.push(protectedAreaBlocker(error));
      }
    }

    const documentSource = new NodeFileSystemDocumentSource(projectRoot);
    let governanceDocuments: string[] = [];
    if (blockers.every(({ code }) => code !== READINESS_DIAGNOSTIC_CODES.MANIFEST_MISSING)) {
      try {
        const discovery = this.discoveryService.discover(
          await documentSource.listDocumentPaths(),
          EXTERNAL_TARGET_REQUIRED_DOCUMENTS,
        );
        governanceDocuments = discovery.documents
          .map(({ actualPath }) => actualPath)
          .sort((left, right) => left.localeCompare(right));
        for (const missing of discovery.missing) {
          blockers.push(
            readinessIssue(
              READINESS_DIAGNOSTIC_CODES.GOVERNANCE_DOCUMENT_MISSING,
              'BLOCKER',
              `Required governance document '${missing.path}' is missing.`,
              missing.path,
              `Add docs/${path.basename(missing.path)} from the external-target bootstrap template.`,
            ),
          );
        }
        for (const diagnostic of discovery.diagnostics) {
          if (diagnostic.code === 'UNKNOWN_DOCUMENT' && diagnostic.severity === 'WARNING') {
            warnings.push(
              readinessIssue(
                READINESS_DIAGNOSTIC_CODES.UNKNOWN_GOVERNANCE_DOCUMENT,
                'WARNING',
                diagnostic.message,
                diagnostic.path,
              ),
            );
          }
        }
      } catch {
        blockers.push(
          readinessIssue(
            READINESS_DIAGNOSTIC_CODES.GOVERNANCE_DOCUMENT_MISSING,
            'BLOCKER',
            'Governance documents could not be inspected.',
            'docs/',
            'Ensure docs/architecture.md, docs/project-constitution.md, and docs/ai-rules.md exist.',
          ),
        );
      }
    }

    const configuredSourceRoots = manifest?.sourceRoots ?? [];
    for (const sourceRoot of configuredSourceRoots) {
      const absolute = path.join(projectRoot, ...sourceRoot.split('/'));
      if (!existsSync(absolute)) {
        blockers.push(
          readinessIssue(
            READINESS_DIAGNOSTIC_CODES.SOURCE_ROOT_MISSING,
            'BLOCKER',
            `Configured source root '${sourceRoot}' does not exist.`,
            sourceRoot,
            'Create the directory or remove it from manifest sourceRoots.',
          ),
        );
      }
    }

    const effectiveSourceRoots = resolveScanRoots(
      input.extraSourceScanRoots ?? [],
      configuredSourceRoots,
    );
    const testRoots = TEST_ROOT_CANDIDATES.filter((candidate) =>
      existsSync(path.join(projectRoot, candidate)),
    );

    let indexedFileCount = 0;
    try {
      const indexOptions = {
        extraScanRoots: input.extraSourceScanRoots ?? [],
        ...loadExternalTargetSourceIndexOptions(projectRoot, 'EXTERNAL_TARGET'),
      };
      const sourcePaths = await new NodeProjectFileSource(
        projectRoot,
        indexOptions,
      ).listSourcePaths();
      indexedFileCount = sourcePaths.length;
      if (indexedFileCount === 0 && blockers.length === 0) {
        warnings.push(
          readinessIssue(
            READINESS_DIAGNOSTIC_CODES.SOURCE_INDEX_EMPTY,
            'WARNING',
            'Source indexing completed but no eligible files were discovered.',
            undefined,
            'Confirm sourceRoots and repository layout include indexable source files.',
          ),
        );
      }
    } catch {
      blockers.push(
        readinessIssue(
          READINESS_DIAGNOSTIC_CODES.SOURCE_INDEX_UNAVAILABLE,
          'BLOCKER',
          'Source indexing could not be initialized for this project.',
          undefined,
          'Check manifest sourceRoots and repository permissions.',
        ),
      );
    }

    const verificationScripts = discoverPackageScripts(projectRoot);
    if (!verificationScripts.hasBuild) {
      warnings.push(
        readinessIssue(
          READINESS_DIAGNOSTIC_CODES.VERIFICATION_BUILD_UNAVAILABLE,
          'WARNING',
          'package.json has no build script; build verification will be skipped.',
          'package.json',
          'Add a "build" script when build verification is required.',
        ),
      );
    }
    if (!verificationScripts.hasTest) {
      warnings.push(
        readinessIssue(
          READINESS_DIAGNOSTIC_CODES.VERIFICATION_TEST_UNAVAILABLE,
          'WARNING',
          'package.json has no test script; test verification will be skipped.',
          'package.json',
          'Add a "test" script when test verification is required.',
        ),
      );
    }
    if (verificationScripts.lintScript === undefined) {
      warnings.push(
        readinessIssue(
          READINESS_DIAGNOSTIC_CODES.VERIFICATION_LINT_UNAVAILABLE,
          'WARNING',
          'No lint script was discovered in package.json.',
          'package.json',
        ),
      );
    }
    if (verificationScripts.typecheckScript === undefined) {
      warnings.push(
        readinessIssue(
          READINESS_DIAGNOSTIC_CODES.VERIFICATION_TYPECHECK_UNAVAILABLE,
          'WARNING',
          'No typecheck script was discovered in package.json.',
          'package.json',
        ),
      );
    }

    return buildProjection({
      projectRoot,
      projectRootDisplay,
      manifest,
      blockers,
      warnings,
      governanceDocuments,
      sourceRoots: summarizeSourceRoots(effectiveSourceRoots, configuredSourceRoots),
      testRoots,
      indexedFileCount,
      protectedAreas: summarizeProtectedAreas(manifest?.protectedAreas),
      verification: {
        build: verificationScripts.hasBuild,
        test: verificationScripts.hasTest,
        lint: verificationScripts.lintScript !== undefined,
        typecheck: verificationScripts.typecheckScript !== undefined,
      },
      runtimeConnected: input.runtimeConnected ?? true,
    });
  }
}

function summarizeSourceRoots(
  effective: readonly string[],
  configured: readonly string[],
): readonly string[] {
  if (configured.length > 0)
    return [...configured].sort((left, right) => left.localeCompare(right));
  return [...DEFAULT_SCAN_ROOTS].sort((left, right) => left.localeCompare(right));
}

function summarizeProtectedAreas(
  protectedAreas: readonly string[] | undefined,
): readonly ExternalTargetProtectedAreaSummary[] {
  if (protectedAreas === undefined) return [];
  return protectedAreas
    .map((raw) => {
      const normalized = normalizeManifestProtectedArea(raw);
      return {
        path: normalized,
        classification: classifyManifestProtectedAreaExposure(normalized),
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function readinessIssue(
  code: string,
  severity: ReadinessIssue['severity'],
  message: string,
  issuePath?: string,
  remediation?: string,
): ReadinessIssue {
  return {
    code,
    severity,
    message,
    ...(issuePath === undefined ? {} : { path: issuePath }),
    ...(remediation === undefined ? {} : { remediation }),
  };
}

function manifestBlocker(error: unknown): ReadinessIssue {
  if (error instanceof TargetProjectManifestValidationError) {
    const protectedAreaIssues = error.issues.filter(({ path: issuePath }) =>
      issuePath.startsWith('$.protectedAreas'),
    );
    if (protectedAreaIssues.length > 0) {
      return readinessIssue(
        READINESS_DIAGNOSTIC_CODES.PROTECTED_AREA_INVALID,
        'BLOCKER',
        protectedAreaIssues
          .map(({ path: issuePath, message }) => `${issuePath}: ${message}`)
          .join('; '),
        '$.protectedAreas',
        'Use safe repository-relative paths without traversal or glob characters.',
      );
    }
    return readinessIssue(
      READINESS_DIAGNOSTIC_CODES.MANIFEST_MALFORMED,
      'BLOCKER',
      error.issues.map(({ path: issuePath, message }) => `${issuePath}: ${message}`).join('; '),
      TARGET_PROJECT_MANIFEST_PATH,
      'Fix manifest fields to match the external-target bootstrap schema.',
    );
  }
  return readinessIssue(
    READINESS_DIAGNOSTIC_CODES.MANIFEST_MALFORMED,
    'BLOCKER',
    error instanceof Error ? error.message : 'Target project manifest is invalid.',
    TARGET_PROJECT_MANIFEST_PATH,
  );
}

function protectedAreaBlocker(error: unknown): ReadinessIssue {
  if (error instanceof ManifestProtectedAreasValidationError) {
    return readinessIssue(
      READINESS_DIAGNOSTIC_CODES.PROTECTED_AREA_INVALID,
      'BLOCKER',
      error.issues.map(({ path: issuePath, message }) => `${issuePath}: ${message}`).join('; '),
      '$.protectedAreas',
      'Use safe repository-relative paths without traversal or glob characters.',
    );
  }
  return readinessIssue(
    READINESS_DIAGNOSTIC_CODES.PROTECTED_AREA_INVALID,
    'BLOCKER',
    error instanceof Error ? error.message : 'Protected areas are invalid.',
    '$.protectedAreas',
  );
}

function buildStatus(
  blockers: readonly ReadinessIssue[],
  warnings: readonly ReadinessIssue[],
): ExternalTargetReadiness['status'] {
  if (blockers.length > 0) return 'BLOCKED';
  if (warnings.length > 0) return 'READY_WITH_WARNINGS';
  return 'READY';
}

function compareIssues(left: ReadinessIssue, right: ReadinessIssue): number {
  return left.code.localeCompare(right.code) || left.message.localeCompare(right.message);
}

function buildProjection(input: {
  readonly projectRoot: string;
  readonly projectRootDisplay?: string;
  readonly manifest?: TargetProjectManifest;
  readonly blockers: ReadinessIssue[];
  readonly warnings: ReadinessIssue[];
  readonly governanceDocuments?: readonly string[];
  readonly sourceRoots?: readonly string[];
  readonly testRoots?: readonly string[];
  readonly indexedFileCount?: number;
  readonly protectedAreas?: readonly ExternalTargetProtectedAreaSummary[];
  readonly verification?: ExternalTargetReadiness['verification'];
  readonly runtimeConnected: boolean;
}): ExternalTargetReadiness {
  const blockers = [...input.blockers].sort(compareIssues);
  const warnings = [...input.warnings].sort(compareIssues);
  return {
    schemaVersion: EXTERNAL_TARGET_READINESS_SCHEMA_VERSION,
    status: buildStatus(blockers, warnings),
    profile: 'EXTERNAL_TARGET',
    projectId: input.manifest?.projectId ?? 'unknown-project',
    projectName: input.manifest?.name ?? 'Unconfigured external target',
    projectRootDisplay: input.projectRootDisplay ?? path.basename(input.projectRoot),
    runtimeConnected: input.runtimeConnected,
    sourceRoots: input.sourceRoots ?? [],
    testRoots: input.testRoots ?? [],
    governanceDocuments: input.governanceDocuments ?? [],
    indexedFileCount: input.indexedFileCount ?? 0,
    protectedAreas: input.protectedAreas ?? [],
    verification: input.verification ?? {
      build: false,
      test: false,
      lint: false,
      typecheck: false,
    },
    warnings,
    blockers,
  };
}
