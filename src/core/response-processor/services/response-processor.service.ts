import type { ResponseProcessorConfiguration } from '../config';
import { DEFAULT_RESPONSE_PROCESSOR_CONFIGURATION } from '../config';
import type { ArtifactChecksumPort } from '../ports';
import {
  RESPONSE_PACKAGE_SCHEMA_VERSION,
  ResponseProcessorValidationError,
  type ResponsePackage,
  type ResponseProcessingInput,
} from '../types';
import {
  GeneratedArtifactValidator,
  ResponsePackageValidator,
  ResponseProcessingInputValidator,
} from '../validators';
import { isRecord } from '../validators/validation-helpers';
import { ArtifactManifestService } from './artifact-manifest.service';
import { ResponseIntegrityService } from './response-integrity.service';
import { ResponseNormalizationService } from './response-normalization.service';
import { Sha256ChecksumService } from './sha256-checksum.service';

export class ResponseProcessorService {
  private readonly inputValidator: ResponseProcessingInputValidator;
  private readonly artifactValidator: GeneratedArtifactValidator;
  private readonly packageValidator: ResponsePackageValidator;
  private readonly normalization = new ResponseNormalizationService();
  private readonly manifest: ArtifactManifestService;
  private readonly integrity: ResponseIntegrityService;

  constructor(
    configuration: ResponseProcessorConfiguration = DEFAULT_RESPONSE_PROCESSOR_CONFIGURATION,
    checksumPort: ArtifactChecksumPort = new Sha256ChecksumService(),
  ) {
    this.inputValidator = new ResponseProcessingInputValidator(configuration);
    this.artifactValidator = new GeneratedArtifactValidator(configuration);
    this.packageValidator = new ResponsePackageValidator(configuration);
    this.manifest = new ArtifactManifestService(configuration, checksumPort);
    this.integrity = new ResponseIntegrityService(configuration, checksumPort);
  }

  async process(input: ResponseProcessingInput): Promise<ResponsePackage> {
    this.inputValidator.validate(input);
    const candidates = extractGeneratedArtifacts(input);
    this.artifactValidator.validate(candidates);
    const generatedArtifacts = this.normalization.normalizeArtifacts(candidates);
    this.artifactValidator.validate(generatedArtifacts);
    const manifest = await this.manifest.generate(generatedArtifacts);
    const packageValue: ResponsePackage = {
      schemaVersion: RESPONSE_PACKAGE_SCHEMA_VERSION,
      executionResult: structuredClone(input.executionResult),
      generatedArtifacts,
      manifest,
      diagnostics: this.normalization.normalizeDiagnostics(input.providerResponse.diagnostics),
      warnings: this.normalization.normalizeWarnings(input.providerResponse.warnings),
      metadata: this.normalization.mergeMetadata(input),
    };
    this.packageValidator.validate(packageValue);
    await this.integrity.verify(packageValue);
    return structuredClone(packageValue);
  }
}

function extractGeneratedArtifacts(input: ResponseProcessingInput): unknown {
  const structured = input.providerResponse.artifacts.find(
    (artifact) => artifact.kind === 'STRUCTURED_DATA',
  );
  if (structured?.kind !== 'STRUCTURED_DATA' || !isRecord(structured.data)) {
    throw new ResponseProcessorValidationError([
      {
        code: 'INVALID_RESPONSE_INPUT',
        path: '$.providerResponse.artifacts',
        message: 'is missing structured generated artifacts',
      },
    ]);
  }
  return structured.data.artifacts;
}
