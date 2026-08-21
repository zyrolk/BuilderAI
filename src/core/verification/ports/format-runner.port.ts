import type { VerificationContext, VerificationStagePortResult } from '../types';

export interface FormatRunnerPort {
  runFormat(context: VerificationContext): Promise<VerificationStagePortResult>;
}
