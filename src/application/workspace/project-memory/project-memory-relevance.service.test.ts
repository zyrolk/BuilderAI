import { describe, expect, it } from 'vitest';

import { ProjectMemoryRelevanceService } from './project-memory-relevance.service';
import type { ExternalTargetProjectMemory } from './project-memory.types';

function emptyMemory(): ExternalTargetProjectMemory {
  return {
    schemaVersion: 1,
    projectId: 'zyro-style-fixture',
    updatedAt: '2026-08-05T12:00:00.000Z',
    decisions: [],
    completedWork: [],
    investigations: [],
    findings: [],
  };
}

describe('ProjectMemoryRelevanceService branches', () => {
  it('returns empty context when no records score above zero', () => {
    const service = new ProjectMemoryRelevanceService();
    const selection = service.selectRelevant({
      request: 'checkout payment screen',
      memory: {
        ...emptyMemory(),
        investigations: [
          {
            id: 'inv-1',
            category: 'INVESTIGATION',
            createdAt: '2026-08-05T12:00:00.000Z',
            updatedAt: '2026-08-05T12:00:00.000Z',
            summary: 'Supplier Hub cancellation validation only.',
            supportingPaths: ['server/services/order-cancellation.service.ts'],
            source: 'INVESTIGATION_SAVE',
            investigationId: 'inv-1',
            confidence: 'LOW',
            affectedAreas: ['server/services/order-cancellation.service.ts'],
          },
        ],
      },
      existingSourcePaths: ['server/services/order-cancellation.service.ts'],
    });
    expect(selection.records).toHaveLength(0);
    expect(selection.renderedText).toBe('');
  });

  it('includes investigation likely root cause in rendered context', () => {
    const service = new ProjectMemoryRelevanceService();
    const selection = service.selectRelevant({
      request: 'supplier cancellation validation service',
      memory: {
        ...emptyMemory(),
        investigations: [
          {
            id: 'inv-root-cause',
            category: 'INVESTIGATION',
            createdAt: '2026-08-05T12:00:00.000Z',
            updatedAt: '2026-08-05T12:00:00.000Z',
            summary: 'Cancellation depends on shared validation service.',
            supportingPaths: ['server/services/order-cancellation.service.ts'],
            source: 'INVESTIGATION_SAVE',
            investigationId: 'inv-root-cause',
            confidence: 'MEDIUM',
            affectedAreas: ['server/services/order-cancellation.service.ts'],
            likelyRootCause: 'Missing status transition after validation failure.',
          },
        ],
      },
      existingSourcePaths: ['server/services/order-cancellation.service.ts'],
    });
    expect(selection.renderedText).toContain('Likely root cause (historical)');
  });

  it('scores completed work and decision records for related requests', () => {
    const service = new ProjectMemoryRelevanceService();
    const selection = service.selectRelevant({
      request: 'supplier order cancellation validation',
      memory: {
        ...emptyMemory(),
        completedWork: [
          {
            id: 'work-1',
            category: 'COMPLETED_WORK',
            createdAt: '2026-08-05T12:00:00.000Z',
            updatedAt: '2026-08-05T12:00:00.000Z',
            summary: 'Updated supplier order cancellation validation in service layer.',
            supportingPaths: ['server/services/order-cancellation.service.ts'],
            source: 'VERIFIED_APPLY',
            preparationId: 'prep-1',
            verificationStatus: 'PASSED',
          },
        ],
        decisions: [
          {
            id: 'decision-1',
            category: 'DECISION',
            createdAt: '2026-08-05T12:00:00.000Z',
            updatedAt: '2026-08-05T12:00:00.000Z',
            summary: 'Supplier cancellation must preserve audit trail.',
            supportingPaths: ['server/routes/supplier-orders.ts'],
            source: 'OPERATOR',
            tags: ['supplier'],
          },
        ],
      },
      existingSourcePaths: [
        'server/services/order-cancellation.service.ts',
        'server/routes/supplier-orders.ts',
      ],
    });
    expect(selection.records.length).toBeGreaterThanOrEqual(2);
  });

  it('truncates rendered memory context when over budget', () => {
    const service = new ProjectMemoryRelevanceService({
      maximumRelevantRecords: 8,
      maximumContextCharacters: 120,
      maximumDecisions: 100,
      maximumCompletedWork: 200,
      maximumInvestigations: 100,
      maximumFindings: 150,
      maximumSupportingPathsPerRecord: 12,
      maximumSummaryCharacters: 1_000,
      maximumTagsPerRecord: 8,
      maximumTagCharacters: 48,
      maximumSerializedBytes: 512_000,
      recencyBoostWindowDays: 30,
    });
    const selection = service.selectRelevant({
      request: 'supplier cancellation validation service',
      memory: {
        ...emptyMemory(),
        findings: [
          {
            id: 'finding-1',
            category: 'FINDING',
            createdAt: '2026-08-05T12:00:00.000Z',
            updatedAt: '2026-08-05T12:00:00.000Z',
            summary:
              'Supplier Hub cancellation depends on shared validation service and route handlers across frontend and backend.',
            supportingPaths: ['server/services/order-cancellation.service.ts'],
            source: 'OPERATOR',
          },
        ],
      },
      existingSourcePaths: ['server/services/order-cancellation.service.ts'],
    });
    expect(selection.truncated).toBe(true);
    expect(selection.renderedText.endsWith('…')).toBe(true);
  });

  it('breaks score ties by updatedAt and honors explicit path hints', () => {
    const service = new ProjectMemoryRelevanceService();
    const selection = service.selectRelevant({
      request: 'supplier cancellation',
      explicitPathHints: ['server/routes/supplier-orders.ts'],
      memory: {
        ...emptyMemory(),
        decisions: [
          {
            id: 'decision-old',
            category: 'DECISION',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            summary: 'Supplier cancellation route audit trail requirement.',
            supportingPaths: ['server/routes/supplier-orders.ts'],
            source: 'OPERATOR',
          },
          {
            id: 'decision-new',
            category: 'DECISION',
            createdAt: '2026-02-01T00:00:00.000Z',
            updatedAt: '2026-02-01T00:00:00.000Z',
            summary: 'Supplier cancellation route audit trail requirement.',
            supportingPaths: ['server/routes/supplier-orders.ts'],
            source: 'OPERATOR',
          },
        ],
      },
      existingSourcePaths: ['server/routes/supplier-orders.ts'],
      now: new Date('2026-08-05T12:00:00.000Z'),
    });
    expect(selection.records[0]?.record.id).toBe('decision-new');
  });
});
