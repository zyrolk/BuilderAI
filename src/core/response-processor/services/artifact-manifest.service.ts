import type { ResponseProcessorConfiguration } from '../config';
import { DEFAULT_RESPONSE_PROCESSOR_CONFIGURATION } from '../config';
import type { ArtifactChecksumPort } from '../ports';
import {
  ARTIFACT_MANIFEST_SCHEMA_VERSION,
  ResponseProcessorValidationError,
  type ArtifactManifest,
  type GeneratedArtifact,
} from '../types';
import { GeneratedArtifactValidator, ResponseProcessorConfigurationValidator } from '../validators';
import { CHECKSUM_VALUE_PATTERN, utf8Size } from '../validators/validation-helpers';
import { Sha256ChecksumService } from './sha256-checksum.service';
import { ResponseNormalizationService } from './response-normalization.service';

export class ArtifactManifestService {
  private readonly configurationValidator: ResponseProcessorConfigurationValidator =
    new ResponseProcessorConfigurationValidator();
  private readonly artifactValidator: GeneratedArtifactValidator;
  private readonly normalization = new ResponseNormalizationService();

  constructor(
    private readonly configuration: ResponseProcessorConfiguration = DEFAULT_RESPONSE_PROCESSOR_CONFIGURATION,
    private readonly checksumPort: ArtifactChecksumPort = new Sha256ChecksumService(),
  ) {
    this.configurationValidator.validate(configuration);
    this.artifactValidator = new GeneratedArtifactValidator(configuration);
    if (checksumPort.algorithm !== configuration.checksumAlgorithm) {
      throw new ResponseProcessorValidationError([
        {
          code: 'INVALID_CONFIGURATION',
          path: '$.checksumAlgorithm',
          message: `must match checksum port '${checksumPort.algorithm}'`,
        },
      ]);
    }
  }

  async generate(artifacts: readonly GeneratedArtifact[]): Promise<ArtifactManifest> {
    this.artifactValidator.validate(artifacts);
    const normalizedArtifacts = this.normalization.normalizeArtifacts(artifacts);
    const entries = [];
    let totalSizeBytes = 0;
    for (const artifact of normalizedArtifacts) {
      const sizeBytes = utf8Size(artifact.content);
      const checksum = await this.checksumPort.checksum(artifact.content);
      if (!CHECKSUM_VALUE_PATTERN.test(checksum)) {
        throw new ResponseProcessorValidationError([
          {
            code: 'INTEGRITY_MISMATCH',
            path: `$.artifacts.${artifact.logicalPath}.checksum`,
            message: 'checksum port must return lowercase hexadecimal output',
          },
        ]);
      }
      totalSizeBytes += sizeBytes;
      entries.push({
        logicalPath: artifact.logicalPath,
        type: artifact.type,
        checksum: { algorithm: this.checksumPort.algorithm, value: checksum },
        sizeBytes,
        metadata: structuredClone(artifact.metadata),
      });
    }
    return {
      schemaVersion: ARTIFACT_MANIFEST_SCHEMA_VERSION,
      checksumAlgorithm: this.checksumPort.algorithm,
      entries,
      totalSizeBytes,
    };
  }
}
