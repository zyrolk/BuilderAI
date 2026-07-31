import type {
  GeneratedArtifact,
  ResponseMetadata,
  ResponsePackage,
  ResponseProcessingInput,
} from '../types';
import { compareText, normalizeLineEndings } from '../validators/validation-helpers';

export class ResponseNormalizationService {
  normalizeArtifacts(artifacts: readonly GeneratedArtifact[]): readonly GeneratedArtifact[] {
    return artifacts
      .map((artifact) => ({
        logicalPath: artifact.logicalPath,
        type: artifact.type,
        content: normalizeLineEndings(artifact.content),
        metadata: this.normalizeMetadata(artifact.metadata),
      }))
      .sort(
        (left, right) =>
          compareText(left.logicalPath, right.logicalPath) || compareText(left.type, right.type),
      );
  }

  normalizeDiagnostics(
    diagnostics: ResponsePackage['diagnostics'],
  ): ResponsePackage['diagnostics'] {
    return diagnostics
      .map((diagnostic) => ({
        code: diagnostic.code,
        severity: diagnostic.severity,
        message: normalizeLineEndings(diagnostic.message),
        ...(diagnostic.path === undefined ? {} : { path: normalizeLineEndings(diagnostic.path) }),
      }))
      .sort(
        (left, right) =>
          compareText(left.code, right.code) ||
          compareText(left.severity, right.severity) ||
          compareText(left.path ?? '', right.path ?? '') ||
          compareText(left.message, right.message),
      );
  }

  normalizeWarnings(warnings: ResponsePackage['warnings']): ResponsePackage['warnings'] {
    return warnings
      .map((warning) => ({
        code: warning.code,
        message: normalizeLineEndings(warning.message),
      }))
      .sort(
        (left, right) =>
          compareText(left.code, right.code) || compareText(left.message, right.message),
      );
  }

  mergeMetadata(input: ResponseProcessingInput): ResponseMetadata {
    return this.normalizeMetadata({
      ...input.executionResult.metadata,
      ...input.providerResponse.metadata,
      ...input.metadata,
    });
  }

  normalizeMetadata(metadata: ResponseMetadata): ResponseMetadata {
    return Object.fromEntries(
      Object.entries(metadata)
        .map(
          ([key, value]) =>
            [key, typeof value === 'string' ? normalizeLineEndings(value) : value] as const,
        )
        .sort(([left], [right]) => compareText(left, right)),
    );
  }
}
