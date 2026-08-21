import type { RuntimeBrowserVerificationReport } from '../../core/runtime-verification';

export function formatRuntimeServerStatus(
  status: RuntimeBrowserVerificationReport['server']['status'],
): string {
  switch (status) {
    case 'READY':
      return 'Ready';
    case 'NOT_READY':
      return 'Not ready';
    case 'PROCESS_FAILED':
      return 'Failed';
    case 'TIMEOUT':
      return 'Timeout';
    case 'CANCELLED':
      return 'Cancelled';
    case 'POLICY_BLOCKED':
      return 'Policy blocked';
    case 'UNAVAILABLE':
      return 'Unavailable';
    default:
      return status;
  }
}

export function formatBrowserVerificationStatus(
  status: RuntimeBrowserVerificationReport['browser']['status'],
): string {
  switch (status) {
    case 'PASSED':
      return 'Passed';
    case 'FAILED':
      return 'Failed';
    case 'TIMEOUT':
      return 'Timeout';
    case 'CANCELLED':
      return 'Cancelled';
    case 'UNAVAILABLE':
      return 'Unavailable';
    case 'POLICY_BLOCKED':
      return 'Policy blocked';
    default:
      return status;
  }
}

export function runtimeBrowserVerificationFailed(
  report: RuntimeBrowserVerificationReport | undefined,
): boolean {
  if (report === undefined) return false;
  return report.status === 'FAILED' || report.status === 'PARTIAL' || report.status === 'TIMEOUT';
}
