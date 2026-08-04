import type {
  ContextOmission,
  ContextSourceFile,
} from '../../context-builder/types/context-builder';
import type { WorkspaceBaselinePort } from '../../change-planner/ports/workspace-baseline.port';
import {
  deduplicatePreservationInvariants,
  extractPreservationInvariants,
} from '../internal/baseline-invariant-extraction';
import {
  INACTIVE_UPDATE_SCOPE_PLAN,
  MAXIMUM_PINNED_BASELINE_CHARACTERS,
  MAXIMUM_REQUIRED_BASELINE_PATHS,
  type UpdateScopeEvidence,
  type UpdateScopePlan,
} from '../types/update-scope-plan';
import type {
  PreservationBaselineEntry,
  PreservationContractContent,
  PreservationInvariant,
} from '../types/preservation-contract';

export interface PinnedBaselineResolution {
  readonly scopePlan: UpdateScopePlan;
  readonly pinnedFiles: readonly ContextSourceFile[];
  readonly omissions: readonly ContextOmission[];
  readonly preservationContract?: PreservationContractContent;
}

function comparePath(left: string, right: string): number {
  return left.localeCompare(right);
}

function appendEvidence(
  evidence: readonly UpdateScopeEvidence[],
  entry: UpdateScopeEvidence,
): readonly UpdateScopeEvidence[] {
  return [...evidence, entry].sort((left, right) => {
    const codeCompare = left.code.localeCompare(right.code);
    if (codeCompare !== 0) return codeCompare;
    const pathCompare = (left.path ?? '').localeCompare(right.path ?? '');
    if (pathCompare !== 0) return pathCompare;
    return left.message.localeCompare(right.message);
  });
}

export class PinnedBaselineResolver {
  resolve(
    scopePlan: UpdateScopePlan,
    baselinePort: WorkspaceBaselinePort,
  ): PinnedBaselineResolution {
    if (scopePlan.mode === 'NONE' || scopePlan.requiredBaselinePaths.length === 0) {
      return { scopePlan, pinnedFiles: [], omissions: [] };
    }

    const pinnedFiles: ContextSourceFile[] = [];
    const baselines: PreservationBaselineEntry[] = [];
    const invariants: PreservationInvariant[] = [];
    const omissions: ContextOmission[] = [];
    let evidence = scopePlan.evidence;
    let pinnedCharacterBudget = 0;
    const admittedPaths: string[] = [];

    for (const logicalPath of [...scopePlan.requiredBaselinePaths]
      .sort(comparePath)
      .slice(0, MAXIMUM_REQUIRED_BASELINE_PATHS)) {
      const snapshot = baselinePort.readTextBaseline(logicalPath);
      if (snapshot === null) {
        evidence = appendEvidence(evidence, {
          code: 'BASELINE_UNAVAILABLE',
          path: logicalPath,
          message: `Baseline unavailable for '${logicalPath}'.`,
        });
        omissions.push({
          kind: 'FILE',
          identifier: logicalPath,
          reason: 'BASELINE_UNAVAILABLE',
        });
        continue;
      }

      const nextPinnedCharacters = pinnedCharacterBudget + snapshot.content.length;
      if (nextPinnedCharacters > MAXIMUM_PINNED_BASELINE_CHARACTERS) {
        evidence = appendEvidence(evidence, {
          code: 'BASELINE_BUDGET_EXCEEDED',
          path: logicalPath,
          message: `Pinned baseline budget exceeded before '${logicalPath}'.`,
        });
        omissions.push({
          kind: 'FILE',
          identifier: logicalPath,
          reason: 'BASELINE_BUDGET_EXCEEDED',
        });
        continue;
      }

      pinnedCharacterBudget = nextPinnedCharacters;
      admittedPaths.push(logicalPath);
      pinnedFiles.push({
        path: logicalPath,
        content: snapshot.content,
        priority: 'PINNED_BASELINE',
      });
      baselines.push({
        logicalPath,
        content: snapshot.content,
        checksum: snapshot.checksum,
        sizeBytes: snapshot.sizeBytes,
      });
      invariants.push(...extractPreservationInvariants(logicalPath, snapshot.content));
    }

    if (admittedPaths.length === 0) {
      return {
        scopePlan: INACTIVE_UPDATE_SCOPE_PLAN,
        pinnedFiles: [],
        omissions,
      };
    }

    const resolvedScopePlan: UpdateScopePlan = {
      ...scopePlan,
      requiredBaselinePaths: admittedPaths,
      preferredUpdatePaths: scopePlan.preferredUpdatePaths.filter((path) =>
        admittedPaths.includes(path),
      ),
      evidence,
    };

    const preservationContract: PreservationContractContent = {
      scope: resolvedScopePlan,
      baselines,
      invariants: deduplicatePreservationInvariants(invariants),
    };

    return {
      scopePlan: resolvedScopePlan,
      pinnedFiles,
      omissions,
      preservationContract,
    };
  }
}

export class PreservationContractBuilder {
  build(resolution: PinnedBaselineResolution): PreservationContractContent | undefined {
    return resolution.preservationContract;
  }
}
