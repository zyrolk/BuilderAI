import type { VerificationConfiguration } from '../config';
import { DEFAULT_VERIFICATION_CONFIGURATION } from '../config';
import {
  VERIFICATION_REPORT_SCHEMA_VERSION,
  VERIFICATION_STAGES,
  VERIFICATION_STATUSES,
  VerificationValidationError,
  type VerificationFinding,
  type VerificationMessage,
  type VerificationReport,
  type VerificationStageResult,
  type VerificationStatus,
  type VerificationValidationIssue,
} from '../types';
import {
  addIssue,
  isNonNegativeFiniteNumber,
  isRecord,
  validateExactKeys,
  validateMessages,
  validateMetadata,
  validateOptionalDiagnostic,
  validateRequiredKeys,
} from './validation-helpers';
import { VerificationConfigurationValidator } from './configuration.validator';

export class VerificationReportValidator {
  private readonly configurationValidator: VerificationConfigurationValidator =
    new VerificationConfigurationValidator();

  constructor(
    private readonly configuration: VerificationConfiguration = DEFAULT_VERIFICATION_CONFIGURATION,
  ) {
    this.configurationValidator.validate(configuration);
  }

  validate(value: unknown): asserts value is VerificationReport {
    const issues: VerificationValidationIssue[] = [];
    if (!isRecord(value)) {
      throw new VerificationValidationError([
        { code: 'INVALID_REPORT', path: '$', message: 'must be an object' },
      ]);
    }
    validateExactKeys(
      value,
      ['schemaVersion', 'status', 'stages', 'warnings', 'errors', 'durationMs', 'metadata'],
      '$',
      issues,
      'INVALID_REPORT',
    );
    if (value.schemaVersion !== VERIFICATION_REPORT_SCHEMA_VERSION) {
      addIssue(
        issues,
        'UNSUPPORTED_REPORT_VERSION',
        '$.schemaVersion',
        `must equal ${VERIFICATION_REPORT_SCHEMA_VERSION}`,
      );
    }
    if (!VERIFICATION_STATUSES.some((status) => status === value.status)) {
      addIssue(issues, 'INVALID_REPORT', '$.status', 'is unsupported');
    }
    this.validateStages(value.stages, issues);
    this.validateFindings(value.warnings, '$.warnings', issues);
    this.validateFindings(value.errors, '$.errors', issues);
    if (!isNonNegativeFiniteNumber(value.durationMs)) {
      addIssue(issues, 'INVALID_REPORT', '$.durationMs', 'must be a non-negative finite number');
    }
    validateMetadata(value.metadata, '$.metadata', issues, 'INVALID_REPORT', 32, 2_000, true);
    if (issues.length === 0 && isReportShape(value)) this.validateRelationships(value, issues);
    if (issues.length > 0) throw new VerificationValidationError(issues);
  }

  private validateStages(value: unknown, issues: VerificationValidationIssue[]): void {
    if (!Array.isArray(value)) {
      addIssue(issues, 'INVALID_REPORT', '$.stages', 'must be an array');
      return;
    }
    if (value.length !== VERIFICATION_STAGES.length) {
      addIssue(issues, 'INVALID_STAGE_ORDER', '$.stages', 'must contain every stage exactly once');
    }
    value.forEach((stage, index) => {
      const path = `$.stages[${index}]`;
      if (!isRecord(stage)) {
        addIssue(issues, 'INVALID_REPORT', path, 'must be an object');
        return;
      }
      validateRequiredKeys(
        stage,
        ['stage', 'status', 'warnings', 'errors', 'durationMs', 'metadata'],
        path,
        issues,
        'INVALID_REPORT',
      );
      for (const key of Object.keys(stage)) {
        if (
          ![
            'stage',
            'status',
            'warnings',
            'errors',
            'durationMs',
            'metadata',
            'diagnostic',
          ].includes(key)
        ) {
          addIssue(issues, 'INVALID_REPORT', `${path}.${key}`, 'is not allowed');
        }
      }
      if (stage.stage !== VERIFICATION_STAGES[index]) {
        addIssue(issues, 'INVALID_STAGE_ORDER', `${path}.stage`, 'does not match canonical order');
      }
      if (stage.status !== 'PASSED' && stage.status !== 'FAILED') {
        addIssue(issues, 'INVALID_REPORT', `${path}.status`, 'is unsupported');
      }
      validateMessages(
        stage.warnings,
        `${path}.warnings`,
        issues,
        'INVALID_REPORT',
        this.configuration.maximumFindingsPerStage,
        this.configuration.maximumFindingMessageCharacters,
        true,
      );
      validateMessages(
        stage.errors,
        `${path}.errors`,
        issues,
        'INVALID_REPORT',
        this.configuration.maximumFindingsPerStage,
        this.configuration.maximumFindingMessageCharacters,
        true,
      );
      validateMetadata(
        stage.metadata,
        `${path}.metadata`,
        issues,
        'INVALID_REPORT',
        this.configuration.maximumStageMetadataEntries,
        this.configuration.maximumStageMetadataStringCharacters,
        true,
      );
      validateOptionalDiagnostic(stage.diagnostic, `${path}.diagnostic`, issues, 'INVALID_REPORT', {
        maximumStdoutCharacters: this.configuration.maximumDiagnosticStdoutCharacters,
        maximumStderrCharacters: this.configuration.maximumDiagnosticStderrCharacters,
        maximumCombinedCharacters: this.configuration.maximumDiagnosticCombinedCharacters,
      });
      if (!isNonNegativeFiniteNumber(stage.durationMs)) {
        addIssue(issues, 'INVALID_REPORT', `${path}.durationMs`, 'must be non-negative and finite');
      }
      if (Array.isArray(stage.errors)) {
        if (stage.status === 'PASSED' && stage.errors.length > 0) {
          addIssue(issues, 'INVALID_REPORT', `${path}.status`, 'PASSED cannot contain errors');
        }
        if (stage.status === 'FAILED' && stage.errors.length === 0) {
          addIssue(issues, 'INVALID_REPORT', `${path}.status`, 'FAILED requires an error');
        }
      }
    });
  }

  private validateFindings(
    value: unknown,
    path: string,
    issues: VerificationValidationIssue[],
  ): void {
    if (!Array.isArray(value)) {
      addIssue(issues, 'INVALID_REPORT', path, 'must be an array');
      return;
    }
    value.forEach((finding, index) => {
      const itemPath = `${path}[${index}]`;
      if (!isRecord(finding)) {
        addIssue(issues, 'INVALID_REPORT', itemPath, 'must be an object');
        return;
      }
      validateExactKeys(finding, ['stage', 'code', 'message'], itemPath, issues, 'INVALID_REPORT');
      if (!VERIFICATION_STAGES.some((stage) => stage === finding.stage)) {
        addIssue(issues, 'INVALID_REPORT', `${itemPath}.stage`, 'is unsupported');
      }
      if (typeof finding.code !== 'string' || finding.code.length === 0) {
        addIssue(issues, 'INVALID_REPORT', `${itemPath}.code`, 'must be non-empty');
      }
      if (typeof finding.message !== 'string' || finding.message.length === 0) {
        addIssue(issues, 'INVALID_REPORT', `${itemPath}.message`, 'must be non-empty');
      }
    });
  }

  private validateRelationships(
    value: Record<string, unknown> & VerificationReport,
    issues: VerificationValidationIssue[],
  ): void {
    const expectedStatus = deriveStatus(value.stages);
    if (value.status !== expectedStatus) {
      addIssue(issues, 'INVALID_REPORT', '$.status', `must equal derived status ${expectedStatus}`);
    }
    const expectedWarnings = flatten(value.stages, 'warnings');
    const expectedErrors = flatten(value.stages, 'errors');
    if (!sameFindings(value.warnings, expectedWarnings)) {
      addIssue(issues, 'INVALID_REPORT', '$.warnings', 'must exactly summarize stage warnings');
    }
    if (!sameFindings(value.errors, expectedErrors)) {
      addIssue(issues, 'INVALID_REPORT', '$.errors', 'must exactly summarize stage errors');
    }
  }
}

export function deriveStatus(stages: readonly VerificationStageResult[]): VerificationStatus {
  const passed = stages.filter(({ status }) => status === 'PASSED').length;
  if (passed === stages.length) return 'PASSED';
  if (passed === 0) return 'FAILED';
  return 'PARTIALLY_PASSED';
}

export function flatten(
  stages: readonly VerificationStageResult[],
  key: 'warnings' | 'errors',
): VerificationFinding[] {
  return stages.flatMap(({ stage, [key]: messages }) =>
    messages.map(({ code, message }: VerificationMessage) => ({ stage, code, message })),
  );
}

function sameFindings(
  actual: readonly VerificationFinding[],
  expected: readonly VerificationFinding[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every(
      (finding, index) =>
        finding.stage === expected[index]?.stage &&
        finding.code === expected[index]?.code &&
        finding.message === expected[index]?.message,
    )
  );
}

function isReportShape(
  value: Record<string, unknown>,
): value is Record<string, unknown> & VerificationReport {
  return (
    Array.isArray(value.stages) && Array.isArray(value.warnings) && Array.isArray(value.errors)
  );
}
