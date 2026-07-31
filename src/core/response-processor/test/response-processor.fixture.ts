import type { AIProviderResponse, ProviderJsonValue } from '../../ai-provider';
import type { ExecutionResult } from '../../execution-engine';
import type { ResponseProcessorConfiguration } from '../config';
import type { ArtifactChecksumPort } from '../ports';
import type { GeneratedArtifact, ResponseProcessingInput } from '../types';

export function createGeneratedArtifact(
  overrides: Partial<GeneratedArtifact> = {},
): GeneratedArtifact {
  return {
    logicalPath: 'src/example.ts',
    type: 'SOURCE_FILE',
    content: 'export const value = true;\n',
    metadata: { description: 'Example source file', language: 'typescript' },
    ...overrides,
  };
}

export function createResponseProcessorConfiguration(
  overrides: Partial<ResponseProcessorConfiguration> = {},
): ResponseProcessorConfiguration {
  return {
    maximumArtifacts: 10,
    maximumArtifactBytes: 10_000,
    maximumTotalBytes: 50_000,
    maximumMetadataEntries: 10,
    maximumMetadataStringCharacters: 1_000,
    requiredArtifactMetadataKeys: ['description'],
    checksumAlgorithm: 'test-checksum',
    ...overrides,
  };
}

export class TestChecksumPort implements ArtifactChecksumPort {
  readonly algorithm = 'test-checksum';

  async checksum(content: string): Promise<string> {
    const bytes = new TextEncoder().encode(content);
    const sum = bytes.reduce((total, byte) => (total + byte) % 65_536, 0);
    return sum.toString(16).padStart(4, '0');
  }
}

export function createProcessingInput(
  artifacts: readonly GeneratedArtifact[] = [createGeneratedArtifact()],
  overrides: {
    readonly providerResponse?: Partial<AIProviderResponse>;
    readonly executionResult?: Partial<ExecutionResult>;
    readonly metadata?: ResponseProcessingInput['metadata'];
  } = {},
): ResponseProcessingInput {
  const providerArtifacts: AIProviderResponse['artifacts'] = [
    { id: 'provider-text', name: 'Raw response', kind: 'TEXT', content: 'raw' },
    {
      id: 'provider-structured',
      name: 'Structured response',
      kind: 'STRUCTURED_DATA',
      data: {
        artifacts: artifacts.map<ProviderJsonValue>((artifact) => ({
          logicalPath: artifact.logicalPath,
          type: artifact.type,
          content: artifact.content,
          metadata: { ...artifact.metadata },
        })),
      },
    },
  ];
  const providerResponse: AIProviderResponse = {
    contractVersion: 1,
    requestId: 'execution-one',
    status: 'COMPLETED',
    artifacts: providerArtifacts,
    diagnostics: [
      { code: 'ZETA', severity: 'INFO', message: 'Second\r\nline' },
      { code: 'ALPHA', severity: 'WARNING', message: 'First' },
    ],
    warnings: [
      { code: 'ZETA_WARNING', message: 'Later' },
      { code: 'ALPHA_WARNING', message: 'Earlier\r' },
    ],
    statistics: {
      startedAt: '2026-07-31T05:00:00.000Z',
      completedAt: '2026-07-31T05:00:01.000Z',
      durationMs: 1_000,
    },
    usage: {
      inputCharacters: 1_000,
      promptCharacters: 900,
      outputCharacters: 100,
      artifactCount: 2,
    },
    metadata: { 'provider-id': 'fixture-provider', shared: 'same' },
    ...overrides.providerResponse,
  };
  const executionResult: ExecutionResult = {
    schemaVersion: 1,
    executionId: 'execution-one',
    status: 'COMPLETED',
    diagnostics: [],
    timing: {
      createdAt: '2026-07-31T05:00:00.000Z',
      finishedAt: '2026-07-31T05:00:01.000Z',
      durationMs: 1_000,
    },
    usage: { promptCharacters: 900, outputCharacters: 100, estimated: false },
    artifacts: providerArtifacts.map(({ id, name, kind }) => ({
      id,
      name,
      kind,
      state: 'PLACEHOLDER',
    })),
    errors: [],
    metadata: { 'execution-policy': 'strict', shared: 'same' },
    ...overrides.executionResult,
  };
  return {
    providerResponse,
    executionResult,
    ...(overrides.metadata === undefined ? {} : { metadata: overrides.metadata }),
  };
}
