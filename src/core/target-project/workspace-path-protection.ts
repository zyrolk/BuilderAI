import { normalizeProjectPath } from '../context-builder/internal/path';
import {
  DEFAULT_FILE_APPLY_CONFIGURATION,
  MANDATORY_PROTECTED_PATH_RULES,
  type FileApplyConfiguration,
  type ProtectedPathRule,
} from '../file-apply/config/file-apply-configuration';
import { ProtectedPathPolicyService } from '../file-apply/services/protected-path-policy.service';
import {
  parseManifestProtectedAreas,
  type ManifestProtectedAreaExposure,
} from './manifest-protected-areas';

export type PathExposureKind = 'NEVER_EXPOSE' | 'MUTATION_PROTECTED' | 'NORMAL';

const MANDATORY_NEVER_EXPOSE_RULE_IDS = new Set(
  MANDATORY_PROTECTED_PATH_RULES.map((rule) => rule.id),
);

export class WorkspacePathProtectionPolicy {
  private readonly applyPolicy: ProtectedPathPolicyService;
  private readonly manifestRules: readonly ProtectedPathRule[];
  private readonly manifestExposures: ReadonlyMap<string, ManifestProtectedAreaExposure>;

  constructor(
    manifestRules: readonly ProtectedPathRule[] = [],
    manifestExposures: ReadonlyMap<string, ManifestProtectedAreaExposure> = new Map(),
  ) {
    this.manifestRules = manifestRules.map((rule) => structuredClone(rule));
    this.manifestExposures = manifestExposures;
    this.applyPolicy = new ProtectedPathPolicyService({
      ...DEFAULT_FILE_APPLY_CONFIGURATION,
      additionalProtectedPathRules: this.manifestRules,
    });
  }

  exposureKind(logicalPath: string): PathExposureKind {
    const normalized = normalizeProjectPath(logicalPath);
    const match = this.applyPolicy.match(normalized);
    if (match === null) return 'NORMAL';
    if (MANDATORY_NEVER_EXPOSE_RULE_IDS.has(match.ruleId)) return 'NEVER_EXPOSE';
    const manifestExposure = this.manifestExposures.get(match.ruleId);
    if (manifestExposure === 'NEVER_EXPOSE') return 'NEVER_EXPOSE';
    if (manifestExposure === 'MUTATION_PROTECTED') return 'MUTATION_PROTECTED';
    return 'NEVER_EXPOSE';
  }

  isNeverExpose(logicalPath: string): boolean {
    return this.exposureKind(logicalPath) === 'NEVER_EXPOSE';
  }

  isMutationProtected(logicalPath: string): boolean {
    const kind = this.exposureKind(logicalPath);
    return kind === 'NEVER_EXPOSE' || kind === 'MUTATION_PROTECTED';
  }

  isContentEligible(logicalPath: string): boolean {
    return !this.isNeverExpose(logicalPath);
  }

  matchForApply(logicalPath: string) {
    return this.applyPolicy.match(normalizeProjectPath(logicalPath));
  }

  toFileApplyConfiguration(): FileApplyConfiguration {
    return {
      ...DEFAULT_FILE_APPLY_CONFIGURATION,
      additionalProtectedPathRules: this.manifestRules,
    };
  }
}

export const DEFAULT_WORKSPACE_PATH_PROTECTION = new WorkspacePathProtectionPolicy();

export function createWorkspacePathProtectionPolicyFromManifest(
  protectedAreas: readonly string[] | undefined,
): WorkspacePathProtectionPolicy {
  if (protectedAreas === undefined || protectedAreas.length === 0) {
    return DEFAULT_WORKSPACE_PATH_PROTECTION;
  }
  const parsed = parseManifestProtectedAreas(protectedAreas);
  return new WorkspacePathProtectionPolicy(parsed.rules, parsed.exposures);
}
