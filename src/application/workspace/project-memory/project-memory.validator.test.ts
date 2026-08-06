import { describe, expect, it } from 'vitest';

import {
  normalizeProjectMemoryDocument,
  pruneProjectMemory,
  validateProjectMemoryRecordInput,
} from './project-memory.validator';
import { DEFAULT_PROJECT_MEMORY_CONFIGURATION } from './project-memory-configuration';
import { ProjectMemoryValidationError } from './project-memory.types';

describe('project-memory.validator', () => {
  it('rejects invalid schema versions and project ids', () => {
    expect(() => normalizeProjectMemoryDocument({ schemaVersion: 2, projectId: 'a' }, 'a')).toThrow(
      ProjectMemoryValidationError,
    );
    expect(() => normalizeProjectMemoryDocument({ schemaVersion: 1, projectId: 'a' }, 'b')).toThrow(
      ProjectMemoryValidationError,
    );
  });

  it('validates completed work and investigation records', () => {
    const completed = validateProjectMemoryRecordInput(
      {
        id: 'completed-work-00000001',
        summary: 'Verified supplier validation update',
        supportingPaths: ['server/services/order-cancellation.service.ts'],
        preparationId: 'prep-1',
        verificationStatus: 'PASSED',
        source: 'VERIFIED_APPLY',
      },
      'COMPLETED_WORK',
    );
    expect(completed.category).toBe('COMPLETED_WORK');

    const investigation = validateProjectMemoryRecordInput(
      {
        id: 'investigation-00000001',
        investigationId: 'inv-1',
        summary: 'Shared validation service participates in cancellation.',
        confidence: 'HIGH',
        affectedAreas: ['server/services/order-cancellation.service.ts'],
        likelyRootCause: 'Missing status transition.',
        recommendedNextStepSummary: 'Review service and route together.',
        source: 'INVESTIGATION_SAVE',
      },
      'INVESTIGATION',
    );
    expect(investigation.category).toBe('INVESTIGATION');
  });

  it('prunes each category independently', () => {
    const pruned = pruneProjectMemory(
      {
        schemaVersion: 1,
        projectId: 'fixture',
        updatedAt: '2026-08-05T12:00:00.000Z',
        decisions: [
          {
            id: 'd-old',
            category: 'DECISION',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            summary: 'old decision',
            supportingPaths: [],
            source: 'OPERATOR',
          },
          {
            id: 'd-new',
            category: 'DECISION',
            createdAt: '2026-02-01T00:00:00.000Z',
            updatedAt: '2026-02-01T00:00:00.000Z',
            summary: 'new decision',
            supportingPaths: [],
            source: 'OPERATOR',
          },
        ],
        completedWork: [],
        investigations: [],
        findings: [],
      },
      { ...DEFAULT_PROJECT_MEMORY_CONFIGURATION, maximumDecisions: 1 },
    );
    expect(pruned.decisions.map(({ id }) => id)).toEqual(['d-new']);
  });

  it('normalizes persisted documents and skips invalid category entries', () => {
    const normalized = normalizeProjectMemoryDocument(
      {
        schemaVersion: 1,
        projectId: 'fixture',
        updatedAt: '2026-08-05T12:00:00.000Z',
        decisions: [
          {
            id: 'decision-valid-00001',
            category: 'DECISION',
            createdAt: '2026-08-05T12:00:00.000Z',
            updatedAt: '2026-08-05T12:00:00.000Z',
            summary: 'Keep supplier audit trail.',
            supportingPaths: [],
            source: 'OPERATOR',
          },
          { summary: '' },
        ],
        completedWork: 'not-an-array',
        investigations: [],
        findings: [],
      },
      'fixture',
    );
    expect(normalized.decisions).toHaveLength(1);
    expect(normalized.completedWork).toEqual([]);
  });

  it('uses deterministic fallback ids and default source/confidence values', () => {
    const finding = validateProjectMemoryRecordInput(
      { summary: 'Checkout flow requires idempotent retries.' },
      'FINDING',
    );
    expect(finding.id).toMatch(/^finding-/u);
    expect(finding.source).toBe('OPERATOR');

    const investigation = validateProjectMemoryRecordInput(
      {
        investigationId: 'inv-default-confidence',
        summary: 'Cancellation route returns stale status.',
        affectedAreas: [],
      },
      'INVESTIGATION',
    );
    expect(investigation.category).toBe('INVESTIGATION');
    if (investigation.category === 'INVESTIGATION') {
      expect(investigation.confidence).toBe('LOW');
    }
  });

  it('rejects unsupported validator categories', () => {
    expect(() =>
      validateProjectMemoryRecordInput(
        { summary: 'Unsupported category record.' },
        'UNKNOWN' as 'DECISION',
      ),
    ).toThrow(ProjectMemoryValidationError);
  });
});
