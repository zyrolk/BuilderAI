import type { VerificationContext, VerificationStagePortResult } from '../types';

export interface BuildRunnerPort {
  runBuild(context: VerificationContext): Promise<VerificationStagePortResult>;
}
