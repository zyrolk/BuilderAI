import type { VerificationContext, VerificationStagePortResult } from '../types';

export interface TestRunnerPort {
  runTests(context: VerificationContext): Promise<VerificationStagePortResult>;
}
