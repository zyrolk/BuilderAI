import type {
  AIProviderResponse,
  ProviderDiagnostic,
  ProviderMetadata,
  ProviderWarning,
} from '../../ai-provider';
import type { ExecutionResult } from '../../execution-engine';

export const RESPONSE_PACKAGE_SCHEMA_VERSION = 1 as const;
export const ARTIFACT_MANIFEST_SCHEMA_VERSION = 1 as const;

export const RESPONSE_ARTIFACT_TYPES = [
  'SOURCE_FILE',
  'DOCUMENTATION',
  'CONFIGURATION',
  'TEST',
  'PATCH',
] as const;

export type ResponseArtifactType = (typeof RESPONSE_ARTIFACT_TYPES)[number];
export type ResponseMetadata = ProviderMetadata;

export interface GeneratedArtifact {
  readonly logicalPath: string;
  readonly type: ResponseArtifactType;
  readonly content: string;
  readonly metadata: ResponseMetadata;
}

export interface ArtifactChecksum {
  readonly algorithm: string;
  readonly value: string;
}

export interface ArtifactManifestEntry {
  readonly logicalPath: string;
  readonly type: ResponseArtifactType;
  readonly checksum: ArtifactChecksum;
  readonly sizeBytes: number;
  readonly metadata: ResponseMetadata;
}

export interface ArtifactManifest {
  readonly schemaVersion: typeof ARTIFACT_MANIFEST_SCHEMA_VERSION;
  readonly checksumAlgorithm: string;
  readonly entries: readonly ArtifactManifestEntry[];
  readonly totalSizeBytes: number;
}

export interface ResponsePackage {
  readonly schemaVersion: typeof RESPONSE_PACKAGE_SCHEMA_VERSION;
  readonly executionResult: ExecutionResult;
  readonly generatedArtifacts: readonly GeneratedArtifact[];
  readonly manifest: ArtifactManifest;
  readonly diagnostics: readonly ProviderDiagnostic[];
  readonly warnings: readonly ProviderWarning[];
  readonly metadata: ResponseMetadata;
}

export interface ResponseProcessingInput {
  readonly providerResponse: AIProviderResponse;
  readonly executionResult: ExecutionResult;
  readonly metadata?: ResponseMetadata;
}

export type ResponseProcessorValidationCode =
  | 'CHECKSUM_MISMATCH'
  | 'DUPLICATE_ARTIFACT_PATH'
  | 'INTEGRITY_MISMATCH'
  | 'INVALID_ARTIFACT'
  | 'INVALID_CONFIGURATION'
  | 'INVALID_METADATA'
  | 'INVALID_RESPONSE_INPUT'
  | 'INVALID_RESPONSE_PACKAGE'
  | 'MISSING_REQUIRED_METADATA'
  | 'RESPONSE_SIZE_EXCEEDED'
  | 'UNSUPPORTED_ARTIFACT_TYPE'
  | 'UNSUPPORTED_RESPONSE_VERSION';

export interface ResponseProcessorValidationIssue {
  readonly code: ResponseProcessorValidationCode;
  readonly path: string;
  readonly message: string;
}
