import {
  MANDATORY_PROTECTED_PATH_RULES,
  type FileApplyConfiguration,
  type ProtectedPathRule,
} from '../config';
import { FileApplyConfigurationValidator } from '../validators/configuration.validator';

export interface ProtectedPathMatch {
  readonly ruleId: string;
  readonly rationale: string;
}

export class ProtectedPathPolicyService {
  private readonly rules: readonly ProtectedPathRule[];

  constructor(configuration: FileApplyConfiguration) {
    const validator: FileApplyConfigurationValidator = new FileApplyConfigurationValidator();
    validator.validate(configuration);
    this.rules = [
      ...MANDATORY_PROTECTED_PATH_RULES,
      ...configuration.additionalProtectedPathRules,
    ].map((rule) => structuredClone(rule));
  }

  match(logicalPath: string): ProtectedPathMatch | null {
    const candidate = logicalPath.toLowerCase();
    for (const rule of this.rules) {
      const protectedPath = rule.path.toLowerCase();
      const matched =
        rule.kind === 'EXACT'
          ? candidate === protectedPath
          : rule.kind === 'SUBTREE'
            ? candidate === protectedPath || candidate.startsWith(`${protectedPath}/`)
            : candidate.startsWith(protectedPath);
      if (matched) return { ruleId: rule.id, rationale: rule.rationale };
    }
    return null;
  }
}
