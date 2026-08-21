import { createHash } from 'node:crypto';

import {
  RESPONSE_PACKAGE_SCHEMA_VERSION,
  ARTIFACT_MANIFEST_SCHEMA_VERSION,
  type GeneratedArtifact,
  type ResponsePackage,
} from '../../../core/response-processor';
import type { EditProposalOperation } from './edit-proposal.types';

export function buildResponsePackageFromEditOperations(
  operations: readonly EditProposalOperation[],
  executionId: string,
  nowIso: string,
): ResponsePackage {
  const generatedArtifacts: GeneratedArtifact[] = operations.map((operation) => ({
    logicalPath: operation.logicalPath,
    type: 'SOURCE_FILE',
    content: operation.kind === 'DELETE_FILE' ? '' : (operation.content ?? ''),
    metadata: {
      'change-operation': operation.kind,
      description: operation.description,
    },
  }));

  const sorted = [...generatedArtifacts].sort((left, right) =>
    left.logicalPath.localeCompare(right.logicalPath),
  );

  const entries = sorted.map((artifact) => {
    const encoded = new TextEncoder().encode(artifact.content);
    return {
      logicalPath: artifact.logicalPath,
      type: artifact.type,
      checksum: {
        algorithm: 'sha256',
        value: createHash('sha256').update(artifact.content, 'utf8').digest('hex'),
      },
      sizeBytes: encoded.byteLength,
      metadata: structuredClone(artifact.metadata),
    };
  });

  return {
    schemaVersion: RESPONSE_PACKAGE_SCHEMA_VERSION,
    executionResult: {
      schemaVersion: 1,
      executionId,
      status: 'COMPLETED',
      diagnostics: [],
      timing: {
        createdAt: nowIso,
        finishedAt: nowIso,
        durationMs: 0,
      },
      usage: {
        promptCharacters: 0,
        outputCharacters: entries.reduce((total, entry) => total + entry.sizeBytes, 0),
        estimated: false,
      },
      artifacts: [],
      errors: [],
      metadata: { source: 'edit-proposal' },
    },
    generatedArtifacts: sorted,
    manifest: {
      schemaVersion: ARTIFACT_MANIFEST_SCHEMA_VERSION,
      checksumAlgorithm: 'sha256',
      entries,
      totalSizeBytes: entries.reduce((total, entry) => total + entry.sizeBytes, 0),
    },
    diagnostics: [],
    warnings: [],
    metadata: { 'request-class': 'edit-proposal' },
  };
}

export function digestEditOperations(operations: readonly EditProposalOperation[]): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        operations.map((operation) => ({
          kind: operation.kind,
          logicalPath: operation.logicalPath,
          description: operation.description,
          contentDigest:
            operation.content === undefined
              ? undefined
              : createHash('sha256').update(operation.content, 'utf8').digest('hex').slice(0, 16),
        })),
      ),
      'utf8',
    )
    .digest('hex')
    .slice(0, 16);
}
