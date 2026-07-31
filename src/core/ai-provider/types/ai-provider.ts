import type { PromptPackage } from '../../prompt-orchestrator';

export const AI_PROVIDER_CONTRACT_VERSION = 1 as const;

export const PROVIDER_CAPABILITY_NAMES = [
  'CONTEXT_INGESTION',
  'STRUCTURED_OUTPUT',
  'STREAMING',
  'TOOL_CALLING',
  'REASONING',
  'FILE_SUPPORT',
  'IMAGE_SUPPORT',
  'STRUCTURED_RESPONSES',
] as const;

export type ProviderCapabilityName = (typeof PROVIDER_CAPABILITY_NAMES)[number];

export interface AIProviderCapabilities {
  readonly contextIngestion: boolean;
  readonly structuredOutput: boolean;
  readonly streaming: boolean;
  readonly toolCalling: boolean;
  readonly reasoning: boolean;
  readonly fileSupport: boolean;
  readonly imageSupport: boolean;
  readonly maximumContextCharacters: number;
  readonly structuredResponses: boolean;
}

export interface AIProviderDescriptor {
  readonly contractVersion: typeof AI_PROVIDER_CONTRACT_VERSION;
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: AIProviderCapabilities;
}

export const PROVIDER_EXECUTION_MODES = ['SINGLE_RESPONSE', 'STREAMING'] as const;
export type ProviderExecutionMode = (typeof PROVIDER_EXECUTION_MODES)[number];

export const PROVIDER_ARTIFACT_KINDS = ['TEXT', 'STRUCTURED_DATA', 'FILE', 'IMAGE'] as const;
export type ProviderArtifactKind = (typeof PROVIDER_ARTIFACT_KINDS)[number];

export type ProviderMetadataValue = string | number | boolean;
export type ProviderMetadata = Readonly<Record<string, ProviderMetadataValue>>;

export interface ProviderCancellationSignal {
  readonly cancelled: boolean;
  readonly reason?: string;
  subscribe(listener: (reason?: string) => void): () => void;
}

export interface ProviderRequestConstraints {
  readonly maximumOutputCharacters: number;
  readonly requiredArtifactKinds: readonly ProviderArtifactKind[];
  readonly requiredCapabilities: readonly ProviderCapabilityName[];
  readonly requireStructuredResponse: boolean;
}

export interface AIProviderRequest {
  readonly contractVersion: typeof AI_PROVIDER_CONTRACT_VERSION;
  readonly requestId: string;
  readonly prompt: PromptPackage;
  readonly executionMode: ProviderExecutionMode;
  readonly constraints: ProviderRequestConstraints;
  readonly timeoutMs: number;
  readonly cancellation: ProviderCancellationSignal;
  readonly metadata: ProviderMetadata;
}

export type ProviderJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly ProviderJsonValue[]
  | { readonly [key: string]: ProviderJsonValue };

interface ProviderArtifactBase {
  readonly id: string;
  readonly name: string;
}

export interface ProviderTextArtifact extends ProviderArtifactBase {
  readonly kind: 'TEXT';
  readonly content: string;
}

export interface ProviderStructuredArtifact extends ProviderArtifactBase {
  readonly kind: 'STRUCTURED_DATA';
  readonly data: ProviderJsonValue;
}

export interface ProviderFileArtifact extends ProviderArtifactBase {
  readonly kind: 'FILE';
  readonly path: string;
  readonly mediaType: string;
  readonly content: string;
}

export interface ProviderImageArtifact extends ProviderArtifactBase {
  readonly kind: 'IMAGE';
  readonly mediaType: string;
  readonly data: string;
}

export type ProviderArtifact =
  ProviderTextArtifact | ProviderStructuredArtifact | ProviderFileArtifact | ProviderImageArtifact;

export const PROVIDER_DIAGNOSTIC_SEVERITIES = ['INFO', 'WARNING', 'ERROR'] as const;
export type ProviderDiagnosticSeverity = (typeof PROVIDER_DIAGNOSTIC_SEVERITIES)[number];

export interface ProviderDiagnostic {
  readonly code: string;
  readonly severity: ProviderDiagnosticSeverity;
  readonly message: string;
  readonly path?: string;
}

export interface ProviderWarning {
  readonly code: string;
  readonly message: string;
}

export interface ProviderExecutionStatistics {
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
}

export interface ProviderUsageMetadata {
  readonly inputCharacters: number;
  readonly promptCharacters: number;
  readonly outputCharacters: number;
  readonly artifactCount: number;
}

export const PROVIDER_RESPONSE_STATUSES = ['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'] as const;
export type ProviderResponseStatus = (typeof PROVIDER_RESPONSE_STATUSES)[number];

export interface AIProviderResponse {
  readonly contractVersion: typeof AI_PROVIDER_CONTRACT_VERSION;
  readonly requestId: string;
  readonly status: ProviderResponseStatus;
  readonly artifacts: readonly ProviderArtifact[];
  readonly diagnostics: readonly ProviderDiagnostic[];
  readonly warnings: readonly ProviderWarning[];
  readonly statistics: ProviderExecutionStatistics;
  readonly usage: ProviderUsageMetadata;
  readonly metadata: ProviderMetadata;
}

export interface ProviderValidationIssue {
  readonly path: string;
  readonly message: string;
}
