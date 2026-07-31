import type { ResponsePackage, GeneratedArtifact } from '../../response-processor';
import type { ChangePlannerConfiguration } from '../config';
import type { ProjectChangeOperation, ProjectChangePlan } from '../types';

export function createArtifact(overrides: Partial<GeneratedArtifact> = {}): GeneratedArtifact {
  return {
    logicalPath: 'src/new-file.ts',
    type: 'SOURCE_FILE',
    content: 'export const created = true;\n',
    metadata: {
      'change-operation': 'CREATE_FILE',
      description: 'Create a source file',
    },
    ...overrides,
  };
}

export function createResponsePackage(
  artifacts: readonly GeneratedArtifact[] = [createArtifact()],
): ResponsePackage {
  const generatedArtifacts = [...artifacts].sort((left, right) =>
    left.logicalPath < right.logicalPath ? -1 : left.logicalPath > right.logicalPath ? 1 : 0,
  );
  const entries = generatedArtifacts.map((artifact, index) => ({
    logicalPath: artifact.logicalPath,
    type: artifact.type,
    checksum: { algorithm: 'sha256', value: String(index + 1).padStart(64, '0') },
    sizeBytes: new TextEncoder().encode(artifact.content).byteLength,
    metadata: structuredClone(artifact.metadata),
  }));
  return {
    schemaVersion: 1,
    executionResult: {
      schemaVersion: 1,
      executionId: 'execution-change-plan',
      status: 'COMPLETED',
      diagnostics: [],
      timing: {
        createdAt: '2026-07-31T07:00:00.000Z',
        finishedAt: '2026-07-31T07:00:01.000Z',
        durationMs: 1_000,
      },
      usage: { promptCharacters: 500, outputCharacters: 250, estimated: false },
      artifacts: [],
      errors: [],
      metadata: {},
    },
    generatedArtifacts,
    manifest: {
      schemaVersion: 1,
      checksumAlgorithm: 'sha256',
      entries,
      totalSizeBytes: entries.reduce((total, entry) => total + entry.sizeBytes, 0),
    },
    diagnostics: [],
    warnings: [{ code: 'REVIEW_OUTPUT', message: 'Review generated output.' }],
    metadata: { 'provider-id': 'fixture-provider', 'request-class': 'test' },
  };
}

export function createConfiguration(
  overrides: Partial<ChangePlannerConfiguration> = {},
): ChangePlannerConfiguration {
  return {
    maximumOperations: 10,
    maximumMetadataEntries: 10,
    maximumMetadataStringCharacters: 500,
    broadChangeOperationThreshold: 3,
    ...overrides,
  };
}

export function operationFrom(plan: ProjectChangePlan, index = 0): ProjectChangeOperation {
  const operation = plan.changeSet.operations[index];
  if (operation === undefined) throw new Error(`Missing fixture operation ${index}`);
  return operation;
}
