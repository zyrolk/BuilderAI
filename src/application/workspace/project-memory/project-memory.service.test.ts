import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PROJECT_MEMORY_CONFIGURATION,
  ProjectMemoryPersistence,
  ProjectMemoryPersistenceError,
  ProjectMemoryRelevanceService,
  ProjectMemoryService,
  ProjectMemoryValidationError,
  pruneProjectMemory,
} from './index';

const ZYRO_FIXTURE_ROOT = path.resolve(
  __dirname,
  '../../../core/target-project/test/fixtures/zyro-style-project',
);

function createExternalTargetFixture(projectId = 'zyro-style-fixture'): {
  readonly root: string;
  readonly cleanup: () => void;
} {
  const root = mkdtempSync(path.join(tmpdir(), 'builderai-memory-'));
  cpSync(ZYRO_FIXTURE_ROOT, root, { recursive: true });
  writeFileSync(
    path.join(root, '.builderai', 'target-project.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        projectId,
        name: 'Memory Fixture',
        vision: 'Fixture for project memory tests.',
        currentMilestone: 'CP8',
        protectedAreas: ['server/secrets/'],
        folderOwnership: [],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return {
    root,
    cleanup: () => {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function createMemoryService(
  root: string,
  projectId = 'zyro-style-fixture',
  configuration = DEFAULT_PROJECT_MEMORY_CONFIGURATION,
): ProjectMemoryService {
  let counter = 0;
  let tick = 0;
  return new ProjectMemoryService({
    projectRoot: root,
    projectId,
    profile: 'EXTERNAL_TARGET',
    configuration,
    clock: () => new Date(Date.parse('2026-08-05T12:00:00.000Z') + tick++ * 60_000),
    ids: { generate: () => `memory-record-${String(++counter).padStart(8, '0')}` },
  });
}

function zyroSourcePaths(): readonly string[] {
  return [
    'server/services/order-cancellation.service.ts',
    'server/routes/supplier-orders.ts',
    'src/features/supplier-orders/SupplierOrdersPage.tsx',
    'tests/supplier-order-cancellation.test.ts',
  ];
}

describe('CP8 project memory scenarios', () => {
  it('scenario 1 — investigation save persists bounded record', async () => {
    const fixture = createExternalTargetFixture();
    try {
      const service = createMemoryService(fixture.root);
      const memory = await service.saveInvestigationMemory({
        investigationId: 'investigation-001',
        requestSummary: 'Supplier cancellation bug',
        report: {
          summary: 'Supplier Hub cancellation depends on shared order validation.',
          confidence: 'MEDIUM',
          likelyRootCause: 'Status transition missing after validation failure.',
          affectedAreas: ['server/services/order-cancellation.service.ts'],
          recommendedNextSteps: ['Review cancellation service status updates.'],
          suggestedFixScope: 'server/services/order-cancellation.service.ts',
        },
      });
      expect(memory.investigations).toHaveLength(1);
      expect(memory.investigations[0]?.summary).toContain('Supplier Hub cancellation');
      expect(memory.investigations[0]?.supportingPaths).toContain(
        'server/services/order-cancellation.service.ts',
      );
      expect(JSON.stringify(memory.investigations[0])).not.toMatch(/excerpt/i);
    } finally {
      fixture.cleanup();
    }
  });

  it('scenario 2 — restart durability reloads saved memory', async () => {
    const fixture = createExternalTargetFixture();
    try {
      const first = createMemoryService(fixture.root);
      await first.saveOperatorRecord({
        category: 'FINDING',
        summary: 'Supplier cancellation uses shared validation service.',
        supportingPaths: ['server/services/order-cancellation.service.ts'],
      });
      const second = createMemoryService(fixture.root);
      const reloaded = await second.read();
      expect(reloaded.findings).toHaveLength(1);
      expect(reloaded.findings[0]?.summary).toContain('shared validation service');
    } finally {
      fixture.cleanup();
    }
  });

  it('scenario 3 — relevant Supplier memory selected for related prepare request', async () => {
    const fixture = createExternalTargetFixture();
    try {
      const service = createMemoryService(fixture.root);
      await service.saveInvestigationMemory({
        investigationId: 'investigation-supplier',
        requestSummary: 'Supplier cancellation',
        report: {
          summary: 'Supplier Hub cancellation validation issue in order cancellation service.',
          confidence: 'MEDIUM',
          affectedAreas: ['server/services/order-cancellation.service.ts'],
          recommendedNextSteps: ['Inspect supplier order cancellation route.'],
        },
      });
      const selection = await service.selectRelevantContext({
        request: 'Fix Supplier Hub order cancellation validation bug',
        existingSourcePaths: zyroSourcePaths(),
      });
      expect(selection.records.length).toBeGreaterThan(0);
      expect(selection.renderedText.toLowerCase()).toContain('supplier');
      expect(selection.renderedText).toContain('Historical project memory');
    } finally {
      fixture.cleanup();
    }
  });

  it('scenario 4 — checkout request does not receive unrelated Supplier memory merely for recency', async () => {
    const fixture = createExternalTargetFixture();
    try {
      const service = createMemoryService(fixture.root);
      await service.saveInvestigationMemory({
        investigationId: 'investigation-supplier-only',
        requestSummary: 'Supplier bug',
        report: {
          summary: 'Supplier Hub cancellation validation issue.',
          confidence: 'LOW',
          affectedAreas: ['server/services/order-cancellation.service.ts'],
          recommendedNextSteps: ['Review supplier cancellation.'],
        },
      });
      const selection = await service.selectRelevantContext({
        request: 'Implement checkout payment confirmation screen',
        existingSourcePaths: zyroSourcePaths(),
      });
      expect(selection.records).toHaveLength(0);
    } finally {
      fixture.cleanup();
    }
  });

  it('scenario 5 — explicit path overlap receives strong relevance', async () => {
    const fixture = createExternalTargetFixture();
    try {
      const service = createMemoryService(fixture.root);
      await service.saveOperatorRecord({
        category: 'DECISION',
        summary: 'Order cancellation must preserve audit trail.',
        supportingPaths: ['server/services/order-cancellation.service.ts'],
      });
      const selection = await service.selectRelevantContext({
        request: 'General backend cleanup',
        existingSourcePaths: zyroSourcePaths(),
        explicitPathHints: ['server/services/order-cancellation.service.ts'],
      });
      expect(selection.records).toHaveLength(1);
      expect(selection.records[0]?.score).toBeGreaterThanOrEqual(12);
    } finally {
      fixture.cleanup();
    }
  });

  it('scenario 6 — missing supporting path is marked potentially stale', async () => {
    const fixture = createExternalTargetFixture();
    try {
      const service = createMemoryService(fixture.root);
      await service.saveOperatorRecord({
        category: 'FINDING',
        summary: 'Legacy supplier route behavior documented.',
        supportingPaths: ['server/routes/removed-supplier-route.ts'],
      });
      const selection = await service.selectRelevantContext({
        request: 'supplier route legacy behavior',
        existingSourcePaths: zyroSourcePaths(),
      });
      expect(selection.records[0]?.potentiallyStale).toBe(true);
      expect(selection.renderedText).toContain('[POTENTIALLY STALE]');
    } finally {
      fixture.cleanup();
    }
  });

  it('scenario 7 — secret-like content cannot be persisted raw', async () => {
    const fixture = createExternalTargetFixture();
    try {
      const service = createMemoryService(fixture.root);
      await expect(
        service.saveOperatorRecord({
          category: 'FINDING',
          summary: 'Use token sk-live-abcdefghijklmnopqrstuvwxyz in requests',
        }),
      ).rejects.toThrow(/secret-like/i);
      await expect(
        service.saveOperatorRecord({
          category: 'FINDING',
          summary: 'Normal finding',
          supportingPaths: ['.env.local'],
        }),
      ).resolves.toBeDefined();
      const memory = await service.read();
      expect(
        memory.findings.some(({ supportingPaths }) => supportingPaths.includes('.env.local')),
      ).toBe(false);
    } finally {
      fixture.cleanup();
    }
  });

  it('scenario 8 — project isolation fails closed on projectId mismatch', async () => {
    const fixture = createExternalTargetFixture('project-a');
    try {
      const service = createMemoryService(fixture.root, 'project-a');
      await service.saveOperatorRecord({
        category: 'FINDING',
        summary: 'Project A finding',
      });
      const persistence = new ProjectMemoryPersistence(fixture.root);
      await expect(persistence.read('project-b')).rejects.toBeInstanceOf(
        ProjectMemoryValidationError,
      );
    } finally {
      fixture.cleanup();
    }
  });

  it('scenario 9 — bounds and pruning are deterministic', async () => {
    const fixture = createExternalTargetFixture();
    try {
      const configuration = {
        ...DEFAULT_PROJECT_MEMORY_CONFIGURATION,
        maximumFindings: 2,
      };
      const service = createMemoryService(fixture.root, 'zyro-style-fixture', configuration);
      await service.saveOperatorRecord({ category: 'FINDING', summary: 'Finding one' });
      await service.saveOperatorRecord({ category: 'FINDING', summary: 'Finding two' });
      const afterThird = await service.saveOperatorRecord({
        category: 'FINDING',
        summary: 'Finding three',
      });
      expect(afterThird.findings).toHaveLength(2);
      const memory = await service.read();
      expect(memory.findings).toHaveLength(2);
      const pruned = pruneProjectMemory(
        {
          schemaVersion: 1,
          projectId: 'zyro-style-fixture',
          updatedAt: new Date().toISOString(),
          decisions: [],
          completedWork: [],
          investigations: [],
          findings: [
            {
              id: 'a',
              category: 'FINDING',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              summary: 'old',
              supportingPaths: [],
              source: 'OPERATOR',
            },
            {
              id: 'b',
              category: 'FINDING',
              createdAt: '2026-02-01T00:00:00.000Z',
              updatedAt: '2026-02-01T00:00:00.000Z',
              summary: 'new',
              supportingPaths: [],
              source: 'OPERATOR',
            },
          ],
        },
        { ...configuration, maximumFindings: 1 },
      );
      expect(pruned.findings.map(({ id }) => id)).toEqual(['b']);
    } finally {
      fixture.cleanup();
    }
  });

  it('scenario 10 — verified completed work persists once without duplicate replay', async () => {
    const fixture = createExternalTargetFixture();
    try {
      const service = createMemoryService(fixture.root);
      const first = await service.saveVerifiedCompletedWork({
        preparationId: 'prep-001',
        summary: 'Added Supplier Hub cancellation validation',
        supportingPaths: ['server/services/order-cancellation.service.ts'],
      });
      expect(first?.completedWork).toHaveLength(1);
      const second = await service.saveVerifiedCompletedWork({
        preparationId: 'prep-001',
        summary: 'Duplicate replay attempt',
        supportingPaths: ['server/services/order-cancellation.service.ts'],
      });
      expect(second).toBeUndefined();
      const memory = await service.read();
      expect(memory.completedWork).toHaveLength(1);
    } finally {
      fixture.cleanup();
    }
  });

  it('scenario 11 — completed work service only accepts verified apply inputs', async () => {
    const fixture = createExternalTargetFixture();
    try {
      const service = createMemoryService(fixture.root);
      const memory = await service.read();
      expect(memory.completedWork).toHaveLength(0);
    } finally {
      fixture.cleanup();
    }
  });

  it('scenario 12 — decisions require explicit operator action', async () => {
    const fixture = createExternalTargetFixture();
    try {
      const service = createMemoryService(fixture.root);
      await expect(
        service.saveOperatorRecord({
          category: 'DECISION',
          summary: 'Architecture decision from operator',
        }),
      ).resolves.toBeDefined();
      const memory = await service.read();
      expect(memory.decisions[0]?.source).toBe('OPERATOR');
      expect(memory.investigations).toHaveLength(0);
    } finally {
      fixture.cleanup();
    }
  });

  it('scenario 13 — saved investigation becomes historical context for later investigation', async () => {
    const fixture = createExternalTargetFixture();
    try {
      const service = createMemoryService(fixture.root);
      await service.saveInvestigationMemory({
        investigationId: 'investigation-shared-validation',
        requestSummary: 'Supplier cancellation',
        report: {
          summary: 'Cancellation depends on shared validation service.',
          confidence: 'MEDIUM',
          affectedAreas: ['server/services/order-cancellation.service.ts'],
          recommendedNextSteps: ['Review shared validation.'],
        },
      });
      const augmented = await service.augmentRequestWithMemory({
        request: 'Investigate related supplier cancellation failure',
        existingSourcePaths: zyroSourcePaths(),
      });
      expect(augmented.request).toContain('Historical project memory');
      expect(augmented.request.toLowerCase()).toContain('validation');
    } finally {
      fixture.cleanup();
    }
  });

  it('scenario 14 — historical memory is labelled and does not claim filesystem FACT authority', async () => {
    const fixture = createExternalTargetFixture();
    try {
      const relevance = new ProjectMemoryRelevanceService();
      const selection = relevance.selectRelevant({
        request: 'supplier cancellation',
        memory: {
          schemaVersion: 1,
          projectId: 'zyro-style-fixture',
          updatedAt: '2026-08-05T12:00:00.000Z',
          decisions: [],
          completedWork: [],
          investigations: [
            {
              id: 'inv-1',
              category: 'INVESTIGATION',
              createdAt: '2026-08-05T12:00:00.000Z',
              updatedAt: '2026-08-05T12:00:00.000Z',
              summary: 'Historical claim that contradicts current code.',
              supportingPaths: ['server/services/order-cancellation.service.ts'],
              source: 'INVESTIGATION_SAVE',
              investigationId: 'inv-1',
              confidence: 'HIGH',
              affectedAreas: ['server/services/order-cancellation.service.ts'],
            },
          ],
          findings: [],
        },
        existingSourcePaths: zyroSourcePaths(),
      });
      expect(selection.renderedText).toContain('Historical project memory');
      expect(selection.renderedText).toContain('Current repository evidence has higher authority');
      expect(selection.renderedText).not.toContain('claimKind');
    } finally {
      fixture.cleanup();
    }
  });

  it('scenario 15 — BUILDERAI_SELF profile disables external-target memory writes', async () => {
    const fixture = createExternalTargetFixture();
    try {
      const service = new ProjectMemoryService({
        projectRoot: fixture.root,
        projectId: 'builder-ai',
        profile: 'BUILDERAI_SELF',
      });
      expect(service.isEnabled()).toBe(false);
      await expect(
        service.saveOperatorRecord({
          category: 'FINDING',
          summary: 'Should not persist for BUILDERAI_SELF',
        }),
      ).rejects.toBeInstanceOf(ProjectMemoryPersistenceError);
    } finally {
      fixture.cleanup();
    }
  });

  it('returns empty context when memory is disabled for BUILDERAI_SELF', async () => {
    const fixture = createExternalTargetFixture();
    try {
      const service = new ProjectMemoryService({
        projectRoot: fixture.root,
        projectId: 'builder-ai',
        profile: 'BUILDERAI_SELF',
      });
      const selection = await service.selectRelevantContext({
        request: 'supplier cancellation',
        existingSourcePaths: zyroSourcePaths(),
      });
      expect(selection.records).toHaveLength(0);
      expect(selection.renderedText).toBe('');
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects secret-like investigation ids before persistence', async () => {
    const fixture = createExternalTargetFixture();
    try {
      const service = createMemoryService(fixture.root);
      await expect(
        service.saveInvestigationMemory({
          investigationId: 'process.env.SUPPLIER_API_TOKEN',
          requestSummary: 'Supplier cancellation bug',
          report: {
            summary: 'Shared validation service participates in cancellation.',
            confidence: 'LOW',
            affectedAreas: ['server/services/order-cancellation.service.ts'],
            recommendedNextSteps: ['Review cancellation service status updates.'],
          },
        }),
      ).rejects.toMatchObject({ code: 'SECRET_CONTENT' });
    } finally {
      fixture.cleanup();
    }
  });

  it('augments requests only when relevant memory exists', async () => {
    const fixture = createExternalTargetFixture();
    try {
      const service = createMemoryService(fixture.root);
      const empty = await service.augmentRequestWithMemory({
        request: 'checkout payment screen',
        existingSourcePaths: zyroSourcePaths(),
      });
      expect(empty.request).toBe('checkout payment screen');

      await service.saveInvestigationMemory({
        investigationId: 'investigation-002',
        requestSummary: 'Supplier cancellation bug',
        report: {
          summary: 'Supplier Hub cancellation depends on shared order validation.',
          confidence: 'MEDIUM',
          affectedAreas: ['server/services/order-cancellation.service.ts'],
          recommendedNextSteps: ['Review cancellation service status updates.'],
        },
      });
      const augmented = await service.augmentRequestWithMemory({
        request: 'supplier cancellation validation',
        existingSourcePaths: zyroSourcePaths(),
      });
      expect(augmented.request).toContain('Historical project memory');
    } finally {
      fixture.cleanup();
    }
  });
});

describe('ProjectMemoryValidationError', () => {
  it('rejects malformed persisted records on write validation', async () => {
    const fixture = createExternalTargetFixture();
    try {
      const service = createMemoryService(fixture.root);
      await expect(
        service.saveOperatorRecord({
          category: 'FINDING',
          summary: '',
        }),
      ).rejects.toBeInstanceOf(ProjectMemoryValidationError);
    } finally {
      fixture.cleanup();
    }
  });
});
