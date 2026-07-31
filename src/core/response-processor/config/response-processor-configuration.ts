export interface ResponseProcessorConfiguration {
  readonly maximumArtifacts: number;
  readonly maximumArtifactBytes: number;
  readonly maximumTotalBytes: number;
  readonly maximumMetadataEntries: number;
  readonly maximumMetadataStringCharacters: number;
  readonly requiredArtifactMetadataKeys: readonly string[];
  readonly checksumAlgorithm: string;
}

export const DEFAULT_RESPONSE_PROCESSOR_CONFIGURATION: ResponseProcessorConfiguration = {
  maximumArtifacts: 100,
  maximumArtifactBytes: 1_000_000,
  maximumTotalBytes: 5_000_000,
  maximumMetadataEntries: 16,
  maximumMetadataStringCharacters: 2_000,
  requiredArtifactMetadataKeys: ['description'],
  checksumAlgorithm: 'sha256',
};
