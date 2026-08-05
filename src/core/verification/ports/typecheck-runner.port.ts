import type { VerificationContext, VerificationStagePortResult } from '../types';

export interface TypecheckRunnerPort {
  runTypecheck(context: VerificationContext): Promise<VerificationStagePortResult>;
}
