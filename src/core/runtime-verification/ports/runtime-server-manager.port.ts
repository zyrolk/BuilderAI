import type { ExecutionCancellationToken } from '../../execution-engine';
import type { RuntimeServerDescriptor } from '../policy/runtime-server-descriptor';
import type { RuntimeServerEvidence } from '../types/runtime-verification.types';

export interface RuntimeServerStartRequest {
  readonly projectRoot: string;
  readonly descriptor: RuntimeServerDescriptor;
  readonly port: number;
  readonly host: '127.0.0.1';
  readonly outputLimitBytes: number;
  readonly startupTimeoutMs: number;
  readonly shutdownTimeoutMs: number;
  readonly cancellation?: ExecutionCancellationToken;
}

export interface RuntimeServerManagerPort {
  start(request: RuntimeServerStartRequest): Promise<RuntimeServerEvidence>;
  shutdown(): Promise<void>;
}
