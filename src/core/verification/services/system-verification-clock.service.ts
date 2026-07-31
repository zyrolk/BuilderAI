import type { VerificationClockPort } from '../ports';

export class SystemVerificationClockService implements VerificationClockPort {
  now(): number {
    return performance.now();
  }
}
