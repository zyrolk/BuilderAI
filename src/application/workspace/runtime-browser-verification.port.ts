import type {
  RuntimeBrowserVerificationInput,
  RuntimeBrowserVerificationReport,
} from '../../core/runtime-verification';

export interface RuntimeBrowserVerificationPort {
  verify(input: RuntimeBrowserVerificationInput): Promise<RuntimeBrowserVerificationReport>;
}
