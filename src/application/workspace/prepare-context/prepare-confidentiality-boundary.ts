import type { WorkspaceBaselinePort } from '../../../core/change-planner/ports/workspace-baseline.port';
import {
  ProjectFileSourceAccessDeniedError,
  type ProjectFileSource,
  type SourceContextPolicy,
} from '../../../core/context-builder';
import {
  isSafeProjectPath,
  normalizeProjectPath,
} from '../../../core/context-builder/internal/path';
import type { WorkspacePathProtectionPolicy } from '../../../core/target-project';
import type { WorkspaceProjectProfile } from '../../../core/target-project/workspace-project-profile.types';
import { isScopeEligiblePath } from '../../../core/update-scope/internal/protected-scope-paths';
import type { InvestigationHandoffFeedback } from '../investigation/investigation-handoff';

const WINDOWS_DEVICE_NAME_PATTERN = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;

/**
 * The single application-layer confidentiality boundary for all PREPARE filesystem reads.
 * It preserves self-development behavior and requires an authoritative manifest-derived policy
 * for external targets before source or baseline content can be accessed.
 */
export class PrepareConfidentialityBoundary implements ProjectFileSource, WorkspaceBaselinePort {
  constructor(
    private readonly profile: WorkspaceProjectProfile,
    private readonly sourceFiles: ProjectFileSource,
    private readonly workspaceBaseline: WorkspaceBaselinePort,
    private readonly pathProtection?: WorkspacePathProtectionPolicy,
  ) {}

  async listSourcePaths(): Promise<readonly string[]> {
    if (this.profile === 'BUILDERAI_SELF') return this.sourceFiles.listSourcePaths();
    this.requireExternalPolicy();
    return this.filterPaths(await this.sourceFiles.listSourcePaths());
  }

  async readSourceFile(path: string): Promise<string> {
    if (this.profile === 'BUILDERAI_SELF') return this.sourceFiles.readSourceFile(path);
    const eligiblePath = this.classifyExternalPath(path);
    if (eligiblePath === undefined) throw new ProjectFileSourceAccessDeniedError();
    return this.sourceFiles.readSourceFile(eligiblePath);
  }

  readTextBaseline(logicalPath: string) {
    if (this.profile === 'BUILDERAI_SELF') {
      return this.workspaceBaseline.readTextBaseline(logicalPath);
    }
    const eligiblePath = this.classifyExternalPath(logicalPath);
    if (eligiblePath === undefined) return null;
    return this.workspaceBaseline.readTextBaseline(eligiblePath);
  }

  filterPaths(paths: readonly string[]): readonly string[] {
    if (this.profile === 'BUILDERAI_SELF') return paths;
    this.requireExternalPolicy();
    const filtered: string[] = [];
    const seen = new Set<string>();
    for (const path of paths) {
      // Handoff and policy values originate at an application boundary. Treat malformed
      // runtime values as denied rather than allowing a coercion or exception to reach the
      // filesystem adapter.
      if (typeof path !== 'string') continue;
      const eligiblePath = this.classifyExternalPath(path);
      if (eligiblePath === undefined || seen.has(eligiblePath)) continue;
      seen.add(eligiblePath);
      filtered.push(eligiblePath);
    }
    return filtered;
  }

  filterSourceContextPolicy(
    policy: SourceContextPolicy | undefined,
  ): SourceContextPolicy | undefined {
    if (policy === undefined || this.profile === 'BUILDERAI_SELF') return policy;
    return {
      ...policy,
      protectedPaths: this.filterPaths(policy.protectedPaths),
      priorityPaths: this.filterPaths(policy.priorityPaths),
      fullContentPaths: this.filterPaths(policy.fullContentPaths),
    };
  }

  filterInvestigationHandoff(handoff: InvestigationHandoffFeedback): InvestigationHandoffFeedback {
    if (this.profile === 'BUILDERAI_SELF') return handoff;
    return {
      ...handoff,
      pathHints: this.filterPaths(handoff.pathHints),
      existingPathHints: this.filterPaths(handoff.existingPathHints),
      candidatePathHints: this.filterPaths(handoff.candidatePathHints),
    };
  }

  private classifyExternalPath(path: string): string | undefined {
    const policy = this.requireExternalPolicy();
    if (path.length === 0 || path !== path.trim() || path.length > 512) return undefined;
    if (CONTROL_CHARACTER_PATTERN.test(path)) return undefined;

    const normalized = normalizeProjectPath(path);
    if (!isSafeProjectPath(normalized)) return undefined;
    const segments = normalized.split('/');
    if (
      segments.some(
        (segment) =>
          segment.length === 0 ||
          segment === '.' ||
          segment === '..' ||
          segment.includes(':') ||
          segment.endsWith('.') ||
          segment.endsWith(' ') ||
          WINDOWS_DEVICE_NAME_PATTERN.test(segment),
      )
    ) {
      return undefined;
    }
    return isScopeEligiblePath(normalized, policy) ? normalized : undefined;
  }

  private requireExternalPolicy(): WorkspacePathProtectionPolicy {
    if (this.pathProtection === undefined) {
      throw new ProjectFileSourceAccessDeniedError();
    }
    return this.pathProtection;
  }
}
