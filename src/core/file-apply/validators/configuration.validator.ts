import { isSafeLogicalPath } from '../../response-processor';
import { DEFAULT_CHANGE_PLANNER_CONFIGURATION } from '../../change-planner';
import {
  MANDATORY_PROTECTED_PATH_RULES,
  PROTECTED_PATH_RULE_KINDS,
  type FileApplyConfiguration,
  type ProtectedPathRule,
  type ProtectedPathRuleKind,
} from '../config';
import { FileApplyValidationError, type FileApplyValidationIssue } from '../types';
import { addIssue, isPositiveSafeInteger, isRecord, validateExactKeys } from './validation-helpers';

const RULE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class FileApplyConfigurationValidator {
  validate(value: unknown): asserts value is FileApplyConfiguration {
    const issues: FileApplyValidationIssue[] = [];
    if (!isRecord(value)) {
      throw new FileApplyValidationError([
        { code: 'INVALID_CONFIGURATION', path: '$', message: 'must be an object' },
      ]);
    }
    validateExactKeys(
      value,
      ['maximumOperations', 'additionalProtectedPathRules'],
      '$',
      issues,
      'INVALID_CONFIGURATION',
    );
    if (!isPositiveSafeInteger(value.maximumOperations)) {
      addIssue(
        issues,
        'INVALID_CONFIGURATION',
        '$.maximumOperations',
        'must be a positive safe integer',
      );
    } else if (value.maximumOperations > DEFAULT_CHANGE_PLANNER_CONFIGURATION.maximumOperations) {
      addIssue(
        issues,
        'INVALID_CONFIGURATION',
        '$.maximumOperations',
        `must not exceed the Change Plan limit of ${DEFAULT_CHANGE_PLANNER_CONFIGURATION.maximumOperations}`,
      );
    }
    if (!Array.isArray(value.additionalProtectedPathRules)) {
      addIssue(
        issues,
        'INVALID_CONFIGURATION',
        '$.additionalProtectedPathRules',
        'must be an array',
      );
    } else {
      const rules = value.additionalProtectedPathRules;
      rules.forEach((rule, index) => this.validateRule(rule, index, issues));
      const identities = new Set<string>();
      const signatures = new Set<string>();
      [...MANDATORY_PROTECTED_PATH_RULES, ...rules]
        .filter((rule): rule is ProtectedPathRule => isProtectedPathRuleShape(rule))
        .forEach((rule, index) => {
          const identity = rule.id.toLowerCase();
          const signature = `${rule.kind}\0${rule.path.toLowerCase()}`;
          if (identities.has(identity)) {
            addIssue(
              issues,
              'INVALID_CONFIGURATION',
              `$.additionalProtectedPathRules[${Math.max(0, index - MANDATORY_PROTECTED_PATH_RULES.length)}].id`,
              'duplicates another protected-path rule identity',
            );
          }
          if (signatures.has(signature)) {
            addIssue(
              issues,
              'INVALID_CONFIGURATION',
              `$.additionalProtectedPathRules[${Math.max(0, index - MANDATORY_PROTECTED_PATH_RULES.length)}].path`,
              'duplicates another protected-path rule',
            );
          }
          identities.add(identity);
          signatures.add(signature);
        });
    }
    if (issues.length > 0) throw new FileApplyValidationError(issues);
  }

  private validateRule(value: unknown, index: number, issues: FileApplyValidationIssue[]): void {
    const path = `$.additionalProtectedPathRules[${index}]`;
    if (!isRecord(value)) {
      addIssue(issues, 'INVALID_CONFIGURATION', path, 'must be an object');
      return;
    }
    validateExactKeys(
      value,
      ['id', 'kind', 'path', 'rationale'],
      path,
      issues,
      'INVALID_CONFIGURATION',
    );
    if (typeof value.id !== 'string' || !RULE_ID_PATTERN.test(value.id)) {
      addIssue(issues, 'INVALID_CONFIGURATION', `${path}.id`, 'must be lowercase kebab-case');
    }
    if (!isProtectedPathRuleKind(value.kind)) {
      addIssue(issues, 'INVALID_CONFIGURATION', `${path}.kind`, 'is unsupported');
    }
    if (!isSafeLogicalPath(value.path)) {
      addIssue(
        issues,
        'INVALID_CONFIGURATION',
        `${path}.path`,
        'must be a normalized repository-relative POSIX path',
      );
    }
    if (typeof value.rationale !== 'string' || value.rationale.trim().length === 0) {
      addIssue(issues, 'INVALID_CONFIGURATION', `${path}.rationale`, 'must be non-empty');
    }
  }
}

function isProtectedPathRuleKind(value: unknown): value is ProtectedPathRuleKind {
  return typeof value === 'string' && PROTECTED_PATH_RULE_KINDS.some((kind) => kind === value);
}

function isProtectedPathRuleShape(value: unknown): value is ProtectedPathRule {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.kind === 'string' &&
    typeof value.path === 'string' &&
    typeof value.rationale === 'string'
  );
}
