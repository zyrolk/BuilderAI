import type { VerificationContext, VerificationStagePortResult } from '../types';

export interface ProjectValidatorPort {
  validateProject(context: VerificationContext): Promise<VerificationStagePortResult>;
}
