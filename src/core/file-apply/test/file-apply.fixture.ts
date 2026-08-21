import {
  ChangePlanSummaryService,
  OperationOrderingService,
  PROJECT_CHANGE_PLAN_SCHEMA_VERSION,
  createOperationId,
  type ProjectChangeOperation,
  type ProjectChangePlan,
} from '../../change-planner';
import type { ArtifactChecksum } from '../../response-processor';
import type { FileApplyConfiguration } from '../config';
import type { FileApplyClockPort, FileSystemEntry, FileSystemPort } from '../ports';
import { FileSystemPortError } from '../types';
import { readTextBaselineFromRawContent } from '../../../infrastructure/workspace/text-baseline-content';

export function createOperation(
  kind: ProjectChangeOperation['kind'],
  logicalPath: string,
  content = '',
  options: {
    readonly baselineContentChecksum?: ArtifactChecksum;
    readonly sourceChecksum?: ArtifactChecksum;
  } = {},
): ProjectChangeOperation {
  const base = {
    operationId: createOperationId(kind, logicalPath),
    logicalPath,
    artifactType: 'SOURCE_FILE' as const,
    description: `${kind} ${logicalPath}`,
    sourceChecksum: options.sourceChecksum ?? { algorithm: 'sha256', value: 'a'.repeat(64) },
    sourceSizeBytes: new TextEncoder().encode(content).byteLength,
  };
  if (kind === 'DELETE_FILE') {
    return options.baselineContentChecksum === undefined
      ? { ...base, kind }
      : { ...base, kind, baselineContentChecksum: options.baselineContentChecksum };
  }
  if (kind === 'UPDATE_FILE') {
    return options.baselineContentChecksum === undefined
      ? { ...base, kind, content }
      : { ...base, kind, content, baselineContentChecksum: options.baselineContentChecksum };
  }
  return { ...base, kind: 'CREATE_FILE', content };
}

export function baselineChecksumForContent(content: string): ArtifactChecksum {
  const snapshot = readTextBaselineFromRawContent(content);
  if (snapshot === null) throw new Error('Fixture content is not a valid text baseline');
  return snapshot.checksum;
}

export function createPlan(
  operations: readonly ProjectChangeOperation[] = [
    createOperation('CREATE_FILE', 'src/new.ts', 'new\n'),
    createOperation('UPDATE_FILE', 'src/existing.ts', 'updated\n'),
    createOperation('DELETE_FILE', 'src/old.ts'),
  ],
): ProjectChangePlan {
  const ordered = new OperationOrderingService().order(operations);
  const warnings = [
    {
      code: 'UNVERIFIED_PROJECT_STATE',
      message: 'Project state was not verified during planning.',
      operationIds: ordered.map(({ operationId }) => operationId).sort(),
    },
  ];
  return {
    schemaVersion: PROJECT_CHANGE_PLAN_SCHEMA_VERSION,
    source: { responsePackageSchemaVersion: 1, executionId: 'execution-file-apply' },
    changeSet: { operations: ordered },
    summary: new ChangePlanSummaryService().generate(ordered, warnings),
    risks: [],
    warnings,
    metadata: { 'provider-id': 'fixture-provider', 'request-class': 'test' },
  };
}

export function createConfiguration(
  overrides: Partial<FileApplyConfiguration> = {},
): FileApplyConfiguration {
  return {
    maximumOperations: 10,
    additionalProtectedPathRules: [],
    ...overrides,
  };
}

export class SequenceClock implements FileApplyClockPort {
  private index = 0;

  constructor(private readonly values: readonly number[] = [100, 125]) {}

  now(): number {
    const value = this.values[this.index] ?? this.values.at(-1) ?? 0;
    this.index += 1;
    return value;
  }
}

export class InMemoryFileSystemPort implements FileSystemPort {
  readonly inspectionCalls: string[] = [];
  readonly mutationCalls: string[] = [];
  readonly files = new Map<string, string>();
  readonly directories = new Set<string>(['', 'src', 'docs', 'config']);
  readonly symlinks = new Set<string>();
  readonly otherEntries = new Set<string>();
  failMutationPath?: string;
  failInspectionPath?: string;
  indeterminateMutationPath?: string;

  constructor(files: Readonly<Record<string, string>> = {}) {
    Object.entries(files).forEach(([path, content]) => this.files.set(path, content));
  }

  async inspect(logicalPath: string): Promise<FileSystemEntry | null> {
    this.inspectionCalls.push(`target:${logicalPath}`);
    if (this.failInspectionPath === logicalPath) {
      throw new FileSystemPortError('INSPECTION_FAILED', logicalPath, 'Inspection failed safely');
    }
    if (this.symlinks.has(logicalPath)) return { kind: 'SYMLINK' };
    if (this.files.has(logicalPath)) return { kind: 'FILE' };
    if (this.directories.has(logicalPath)) return { kind: 'DIRECTORY' };
    if (this.otherEntries.has(logicalPath)) return { kind: 'OTHER' };
    return null;
  }

  async inspectParentDirectory(logicalPath: string): Promise<FileSystemEntry | null> {
    this.inspectionCalls.push(`parent:${logicalPath}`);
    const segments = logicalPath.split('/');
    segments.pop();
    const parent = segments.join('/');
    if (this.symlinks.has(parent)) return { kind: 'SYMLINK' };
    if (this.directories.has(parent)) return { kind: 'DIRECTORY' };
    if (this.files.has(parent)) return { kind: 'FILE' };
    return null;
  }

  async readRegularFileBaselineChecksum(logicalPath: string): Promise<ArtifactChecksum | null> {
    const content = this.files.get(logicalPath);
    if (content === undefined) return null;
    return readTextBaselineFromRawContent(content)?.checksum ?? null;
  }

  async readRegularFileContent(logicalPath: string): Promise<string | null> {
    return this.files.get(logicalPath) ?? null;
  }

  async createFileIfAbsent(logicalPath: string, content: string): Promise<void> {
    this.mutationCalls.push(`create:${logicalPath}`);
    this.throwIfConfigured(logicalPath, 'CREATE_FAILED');
    if (this.files.has(logicalPath)) {
      throw new FileSystemPortError('CREATE_FAILED', logicalPath, 'Target appeared before create');
    }
    this.files.set(logicalPath, content);
  }

  async updateFileIfRegularFile(logicalPath: string, content: string): Promise<void> {
    this.mutationCalls.push(`update:${logicalPath}`);
    if (this.indeterminateMutationPath === logicalPath) {
      this.files.set(logicalPath, '');
      throw new FileSystemPortError('UPDATE_FAILED', logicalPath, 'INDETERMINATE_MUTATION');
    }
    this.throwIfConfigured(logicalPath, 'UPDATE_FAILED');
    if (!this.files.has(logicalPath)) {
      throw new FileSystemPortError(
        'UPDATE_FAILED',
        logicalPath,
        'Target disappeared before update',
      );
    }
    this.files.set(logicalPath, content);
  }

  async deleteFileIfRegularFile(logicalPath: string): Promise<void> {
    this.mutationCalls.push(`delete:${logicalPath}`);
    this.throwIfConfigured(logicalPath, 'DELETE_FAILED');
    if (!this.files.has(logicalPath)) {
      throw new FileSystemPortError(
        'DELETE_FAILED',
        logicalPath,
        'Target disappeared before delete',
      );
    }
    this.files.delete(logicalPath);
  }

  snapshot(): Readonly<Record<string, string>> {
    return Object.fromEntries(
      [...this.files.entries()].sort(([left], [right]) => left.localeCompare(right)),
    );
  }

  private throwIfConfigured(
    logicalPath: string,
    code: 'CREATE_FAILED' | 'UPDATE_FAILED' | 'DELETE_FAILED',
  ): void {
    if (this.failMutationPath === logicalPath) {
      throw new FileSystemPortError(code, logicalPath, 'Configured mutation failure');
    }
  }
}
