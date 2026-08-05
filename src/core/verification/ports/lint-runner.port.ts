import type { VerificationContext, VerificationStagePortResult } from '../types';

export interface LintRunnerPort {
  runLint(context: VerificationContext): Promise<VerificationStagePortResult>;
}
