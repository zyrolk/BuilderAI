import { createHash } from 'node:crypto';

import type { ProjectChangePlan } from '../../change-planner';
import type { WorkflowEvent } from '../types/workflow-event.types';

export const GENESIS_EVENT_DIGEST = '0'.repeat(64);

export function digestValue(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function digestStructured(value: unknown): string {
  return digestValue(stableStringify(value));
}

export function digestChangePlanOperations(changePlan: ProjectChangePlan): string {
  const payload = changePlan.changeSet.operations
    .map(({ kind, logicalPath, operationId }) => `${operationId}:${kind}:${logicalPath}`)
    .sort((left, right) => left.localeCompare(right))
    .join('|');
  return digestValue(payload).slice(0, 16);
}

export interface Gate2ReviewDigestInput {
  readonly operationDiffs: readonly {
    readonly operationId: string;
    readonly kind: string;
    readonly logicalPath: string;
    readonly format: string;
    readonly baselineContentChecksum?: { readonly value: string };
    readonly proposedContentChecksum?: { readonly value: string };
  }[];
}

export function digestGate2Review(projection: Gate2ReviewDigestInput): string {
  const payload = projection.operationDiffs
    .map(
      ({
        operationId,
        kind,
        logicalPath,
        format,
        baselineContentChecksum,
        proposedContentChecksum,
      }) =>
        [
          operationId,
          kind,
          logicalPath,
          format,
          baselineContentChecksum?.value ?? '',
          proposedContentChecksum?.value ?? '',
        ].join(':'),
    )
    .sort((left, right) => left.localeCompare(right))
    .join('|');
  return digestValue(payload).slice(0, 16);
}

export function buildEventDigest(event: Omit<WorkflowEvent, 'eventDigest'>): string {
  return digestStructured({
    eventId: event.eventId,
    workflowId: event.workflowId,
    sequence: event.sequence,
    eventType: event.eventType,
    timestamp: event.timestamp,
    payload: event.payload,
    previousEventDigest: event.previousEventDigest,
    schemaVersion: event.schemaVersion,
  });
}

export function verifyEventDigest(event: WorkflowEvent): boolean {
  const expected = buildEventDigest(event);
  return expected === event.eventDigest;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}
