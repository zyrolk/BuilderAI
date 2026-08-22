/**
 * Narrow read-only binding to the last successful FileApply path set (ADR-041).
 * Must not call FileApply or approveAndApply.
 */
export interface AppliedFileApplyBindingPort {
  readBinding(input: {
    readonly projectId: string;
    readonly preparationId: string;
  }): Promise<AppliedFileApplyBindingEvidence | undefined>;
}

export interface AppliedFileApplyBindingEvidence {
  readonly preparationId: string;
  readonly projectId: string;
  readonly appliedPaths: readonly string[];
  readonly headCommitAtApply?: string;
  readonly branchAtApply?: string;
  readonly baselineDigestAtApply?: string;
  readonly appliedAt: string;
}

/** In-memory binding store for composition tests and local wiring. */
export class InMemoryAppliedFileApplyBindingStore implements AppliedFileApplyBindingPort {
  private readonly bindings = new Map<string, AppliedFileApplyBindingEvidence>();

  put(binding: AppliedFileApplyBindingEvidence): void {
    this.bindings.set(`${binding.projectId}:${binding.preparationId}`, binding);
  }

  async readBinding(input: {
    readonly projectId: string;
    readonly preparationId: string;
  }): Promise<AppliedFileApplyBindingEvidence | undefined> {
    return this.bindings.get(`${input.projectId}:${input.preparationId}`);
  }
}
