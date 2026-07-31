import type { VerificationContext, VerificationStagePortResult } from '../types';

export interface DependencyValidatorPort {
  validateDependencies(context: VerificationContext): Promise<VerificationStagePortResult>;
}
