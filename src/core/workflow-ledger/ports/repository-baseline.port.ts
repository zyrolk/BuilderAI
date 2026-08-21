import type { RepositoryBaseline } from '../types/repository-baseline.types';

export interface RepositoryBaselinePort {
  capture(repositoryRoot: string): Promise<RepositoryBaseline>;
}

export interface RepositoryBaselineDriftInput {
  readonly boundBaselineDigest: string;
  readonly currentBaseline: RepositoryBaseline;
}

export type RepositoryBaselineDriftOutcome =
  | { readonly kind: 'MATCH' }
  | {
      readonly kind: 'DRIFT';
      readonly previousDigest: string;
      readonly currentDigest: string;
    };

export function detectRepositoryBaselineDrift(
  input: RepositoryBaselineDriftInput,
): RepositoryBaselineDriftOutcome {
  if (input.boundBaselineDigest === input.currentBaseline.baselineDigest) {
    return { kind: 'MATCH' };
  }
  return {
    kind: 'DRIFT',
    previousDigest: input.boundBaselineDigest,
    currentDigest: input.currentBaseline.baselineDigest,
  };
}
