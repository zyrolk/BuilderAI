import type { WorkspaceBaselinePort } from '../../change-planner/ports/workspace-baseline.port';
import type { ContextOmission, ContextSourceFile } from '../../context-builder';
import type { UpdateScopePlan } from '../types/update-scope-plan';
import type { PreservationContractContent } from '../types/preservation-contract';
import { PinnedBaselineResolver } from './pinned-baseline-resolver.service';
import { UpdateScopePlanner } from './update-scope-planner.service';

export interface PrepareScopeResolution {
  readonly scopePlan: UpdateScopePlan;
  readonly pinnedBaselineFiles: readonly ContextSourceFile[];
  readonly baselineOmissions: readonly ContextOmission[];
  readonly preservationContract?: PreservationContractContent;
}

export class PrepareScopeService {
  constructor(
    private readonly scopePlanner = new UpdateScopePlanner(),
    private readonly baselineResolver = new PinnedBaselineResolver(),
  ) {}

  resolve(input: {
    readonly taskText: string;
    readonly sourcePaths: readonly string[];
    readonly iterationPathHints?: readonly string[];
    readonly baselinePort: WorkspaceBaselinePort;
  }): PrepareScopeResolution {
    const scopePlan = this.scopePlanner.plan({
      taskText: input.taskText,
      sourcePaths: input.sourcePaths,
      ...(input.iterationPathHints === undefined || input.iterationPathHints.length === 0
        ? {}
        : { iterationPathHints: input.iterationPathHints }),
    });
    const resolution = this.baselineResolver.resolve(scopePlan, input.baselinePort);
    return {
      scopePlan: resolution.scopePlan,
      pinnedBaselineFiles: resolution.pinnedFiles,
      baselineOmissions: resolution.omissions,
      preservationContract: resolution.preservationContract,
    };
  }
}
