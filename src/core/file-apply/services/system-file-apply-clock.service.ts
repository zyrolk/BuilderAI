import type { FileApplyClockPort } from '../ports';

export class SystemFileApplyClockService implements FileApplyClockPort {
  now(): number {
    return performance.now();
  }
}
