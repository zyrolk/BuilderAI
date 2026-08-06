import { VERIFICATION_STAGES, type VerificationStage } from '../types';

export interface VerificationConfiguration {
  readonly pipeline: readonly VerificationStage[];
  readonly maximumFindingsPerStage: number;
  readonly maximumFindingMessageCharacters: number;
  readonly maximumStageMetadataEntries: number;
  readonly maximumStageMetadataStringCharacters: number;
  readonly maximumDiagnosticStdoutCharacters: number;
  readonly maximumDiagnosticStderrCharacters: number;
  readonly maximumDiagnosticCombinedCharacters: number;
  readonly maximumReportDiagnosticCharacters: number;
}

export const DEFAULT_VERIFICATION_CONFIGURATION: VerificationConfiguration = {
  pipeline: VERIFICATION_STAGES,
  maximumFindingsPerStage: 100,
  maximumFindingMessageCharacters: 2_000,
  maximumStageMetadataEntries: 32,
  maximumStageMetadataStringCharacters: 2_000,
  maximumDiagnosticStdoutCharacters: 8_192,
  maximumDiagnosticStderrCharacters: 8_192,
  maximumDiagnosticCombinedCharacters: 16_384,
  maximumReportDiagnosticCharacters: 48_768,
};
