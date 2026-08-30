/**
 * ADR-052 — bounded optional diagnostic message (UNTRUSTED DATA).
 */

import { redactVerificationOutput } from '../../../infrastructure/verification/verification-output-sanitize';
import { MAX_FAILURE_DIAGNOSTIC_MESSAGE_LENGTH } from './failure-diagnostic.constants';

export function normalizeFailureDiagnosticMessage(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  let normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  normalized = normalized.replace(/[\0-\x08\x0b\x0c\x0e-\x1f\x7f]/gu, ' ');
  normalized = redactVerificationOutput(normalized);
  normalized = normalized.replace(/\s+/gu, ' ').trim();
  if (normalized.length === 0) return undefined;
  if (normalized.length > MAX_FAILURE_DIAGNOSTIC_MESSAGE_LENGTH) {
    if (MAX_FAILURE_DIAGNOSTIC_MESSAGE_LENGTH <= 1) return '…';
    return `${normalized.slice(0, MAX_FAILURE_DIAGNOSTIC_MESSAGE_LENGTH - 1)}…`;
  }
  return normalized;
}
