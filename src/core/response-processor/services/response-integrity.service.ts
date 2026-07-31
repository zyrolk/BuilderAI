import type { ResponseProcessorConfiguration } from '../config';
import { DEFAULT_RESPONSE_PROCESSOR_CONFIGURATION } from '../config';
import type { ArtifactChecksumPort } from '../ports';
import { ResponseProcessorValidationError, type ResponsePackage } from '../types';
import { ResponsePackageValidator } from '../validators';
import { utf8Size } from '../validators/validation-helpers';
import { Sha256ChecksumService } from './sha256-checksum.service';

export class ResponseIntegrityService {
  private readonly validator: ResponsePackageValidator;

  constructor(
    configuration: ResponseProcessorConfiguration = DEFAULT_RESPONSE_PROCESSOR_CONFIGURATION,
    private readonly checksumPort: ArtifactChecksumPort = new Sha256ChecksumService(),
  ) {
    this.validator = new ResponsePackageValidator(configuration);
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

  async verify(packageValue: ResponsePackage): Promise<void> {
    this.validator.validate(packageValue);
    const issues: ResponseProcessorValidationError['issues'][number][] = [];
    if (packageValue.generatedArtifacts.length !== packageValue.manifest.entries.length) {
      issues.push({
        code: 'INTEGRITY_MISMATCH',
        path: '$.manifest.entries',
        message: 'must contain one entry for every generated artifact',
      });
    }
    let totalSizeBytes = 0;
    for (let index = 0; index < packageValue.generatedArtifacts.length; index += 1) {
      const artifact = packageValue.generatedArtifacts[index];
      const entry = packageValue.manifest.entries[index];
      if (artifact === undefined || entry === undefined) continue;
      const path = `$.manifest.entries[${index}]`;
      if (
        artifact.logicalPath !== entry.logicalPath ||
        artifact.type !== entry.type ||
        JSON.stringify(artifact.metadata) !== JSON.stringify(entry.metadata)
      ) {
        issues.push({
          code: 'INTEGRITY_MISMATCH',
          path,
          message: 'must describe the corresponding generated artifact',
        });
      }
      const sizeBytes = utf8Size(artifact.content);
      totalSizeBytes += sizeBytes;
      if (entry.sizeBytes !== sizeBytes) {
        issues.push({
          code: 'INTEGRITY_MISMATCH',
          path: `${path}.sizeBytes`,
          message: 'does not match normalized content size',
        });
      }
      const checksum = await this.checksumPort.checksum(artifact.content);
      if (entry.checksum.value !== checksum) {
        issues.push({
          code: 'CHECKSUM_MISMATCH',
          path: `${path}.checksum.value`,
          message: 'does not match normalized content',
        });
      }
    }
    if (packageValue.manifest.totalSizeBytes !== totalSizeBytes) {
      issues.push({
        code: 'INTEGRITY_MISMATCH',
        path: '$.manifest.totalSizeBytes',
        message: 'does not match generated artifact sizes',
      });
    }
    if (issues.length > 0) throw new ResponseProcessorValidationError(issues);
  }
}
