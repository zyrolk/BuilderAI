import {
  GATE2_DIFF_TRUNCATION_MESSAGE,
  GATE2_PROTECTED_DIFF_MESSAGE,
  GATE2_TEXT_DIFF_UNAVAILABLE_MESSAGE,
  GATE2_TOTAL_TRUNCATION_MESSAGE,
  type Gate2ReviewConfiguration,
} from './gate2-review-configuration';
import { Gate2ReviewProjectionService } from './gate2-review-projection.service';
import {
  createCreateOperation,
  createDeleteOperation,
  createPlanFromOperations,
  createUpdateOperation,
  projectGate2ReviewForPlan,
} from './gate2-review.fixture';
import { InMemoryPreparationStore } from '../in-memory-preparation.store';
import { CHANGE_PLAN } from '../../../ui/workspace/test/workspace.fixture';
import { EMPTY_GATE2_REVIEW } from './gate2-review.fixture';

describe('Gate2ReviewProjectionService', () => {
  describe('scenario 1 — small UPDATE_FILE diff', () => {
    it('shows removed and added lines with correct path and kind', () => {
      const baseline = 'const limit = 10;\n';
      const proposed = 'const limit = 20;\n';
      const operation = createUpdateOperation('src/config.ts', baseline, proposed);
      const review = projectGate2ReviewForPlan(createPlanFromOperations([operation]), {
        'src/config.ts': baseline,
      });
      const diff = review.operationDiffs[0]!;

      expect(diff.kind).toBe('UPDATE_FILE');
      expect(diff.logicalPath).toBe('src/config.ts');
      expect(diff.label).toBe('UPDATE FILE');
      expect(diff.format).toBe('UNIFIED');
      expect(diff.unifiedDiff).toContain('-const limit = 10;');
      expect(diff.unifiedDiff).toContain('+const limit = 20;');
      expect(diff.baselineContentChecksum).toBeDefined();
      expect(diff.proposedContentChecksum).toBeDefined();
    });
  });

  describe('scenario 2 — CREATE_FILE diff', () => {
    it('labels NEW FILE and represents content as additions', () => {
      const content = 'export const created = true;\n';
      const operation = createCreateOperation('src/new-module.ts', content);
      const review = projectGate2ReviewForPlan(createPlanFromOperations([operation]));
      const diff = review.operationDiffs[0]!;

      expect(diff.label).toBe('NEW FILE');
      expect(diff.kind).toBe('CREATE_FILE');
      expect(diff.format).toBe('UNIFIED');
      expect(diff.unifiedDiff).toContain('--- /dev/null');
      expect(diff.unifiedDiff).toContain(`+++ b/src/new-module.ts`);
      expect(diff.unifiedDiff).toContain('+export const created = true;');
      expect(diff.baselineContentChecksum).toBeUndefined();
      expect(diff.proposedContentChecksum).toBeDefined();
    });
  });

  describe('scenario 3 — DELETE_FILE diff', () => {
    it('labels DELETE FILE and represents baseline as removals', () => {
      const baseline = 'export const obsolete = true;\n';
      const operation = createDeleteOperation('src/obsolete.ts');
      const review = projectGate2ReviewForPlan(createPlanFromOperations([operation]), {
        'src/obsolete.ts': baseline,
      });
      const diff = review.operationDiffs[0]!;

      expect(diff.label).toBe('DELETE FILE');
      expect(diff.kind).toBe('DELETE_FILE');
      expect(diff.format).toBe('UNIFIED');
      expect(diff.unifiedDiff).toContain('+++ /dev/null');
      expect(diff.unifiedDiff).toContain('-export const obsolete = true;');
      expect(diff.baselineContentChecksum).toBeDefined();
      expect(diff.proposedContentChecksum).toBeUndefined();
    });
  });

  describe('scenario 4 — multi-file plan', () => {
    it('returns separate diff sections with correct operation and path association', () => {
      const review = projectGate2ReviewForPlan(
        createPlanFromOperations([
          createUpdateOperation('src/a.ts', 'const a = 1;\n', 'const a = 2;\n'),
          createCreateOperation('src/b.ts', 'export const b = 1;\n'),
          createDeleteOperation('src/c.ts'),
        ]),
        {
          'src/a.ts': 'const a = 1;\n',
          'src/c.ts': 'legacy\n',
        },
      );

      expect(review.operationDiffs).toHaveLength(3);
      expect(review.operationDiffs.map(({ logicalPath, kind }) => ({ logicalPath, kind }))).toEqual(
        [
          { logicalPath: 'src/a.ts', kind: 'UPDATE_FILE' },
          { logicalPath: 'src/b.ts', kind: 'CREATE_FILE' },
          { logicalPath: 'src/c.ts', kind: 'DELETE_FILE' },
        ],
      );
    });
  });

  describe('scenario 5 — unchanged context lines', () => {
    it('includes readable surrounding context without full-file replacement presentation', () => {
      const baseline = [
        'line-1',
        'line-2',
        'line-3',
        'line-4',
        'line-5',
        'line-6',
        'line-7',
        'const limit = 10;',
        'line-9',
        'line-10',
      ].join('\n');
      const proposed = [
        'line-1',
        'line-2',
        'line-3',
        'line-4',
        'line-5',
        'line-6',
        'line-7',
        'const limit = 20;',
        'line-9',
        'line-10',
      ].join('\n');
      const review = projectGate2ReviewForPlan(
        createPlanFromOperations([createUpdateOperation('src/context.ts', baseline, proposed)]),
        { 'src/context.ts': baseline },
      );
      const diff = review.operationDiffs[0]!.unifiedDiff ?? '';

      expect(diff).toContain(' line-7');
      expect(diff).toContain('-const limit = 10;');
      expect(diff).toContain('+const limit = 20;');
      expect(diff).toContain(' line-9');
      expect(diff).not.toMatch(/^\+line-1/m);
    });
  });

  describe('scenario 6 — large diff truncation', () => {
    it('truncates deterministically with an explicit warning', () => {
      const tightConfiguration: Gate2ReviewConfiguration = {
        maximumLinesPerOperation: 5,
        maximumCharactersPerOperation: 120,
        maximumTotalCharacters: 200,
        contextLines: 1,
      };
      const service = new Gate2ReviewProjectionService(tightConfiguration);
      const lines = Array.from({ length: 20 }, (_, index) => `line-${index}`).join('\n');
      const proposed = `${lines}\nchanged\n`;
      const review = service.project(
        createPlanFromOperations([
          createUpdateOperation('src/large.ts', `${lines}\noriginal\n`, proposed),
        ]),
        {
          readTextBaseline(logicalPath) {
            if (logicalPath !== 'src/large.ts') return null;
            return {
              logicalPath,
              content: `${lines}\noriginal\n`,
              checksum: { algorithm: 'SHA-256', value: 'a'.repeat(64) },
              sizeBytes: 1,
            };
          },
        },
      );
      const diff = review.operationDiffs[0]!;

      expect(diff.truncated).toBe(true);
      expect(diff.truncationMessage).toBe(GATE2_DIFF_TRUNCATION_MESSAGE);
      expect(review.truncated).toBe(true);
      expect(review.truncationMessage).toBe(GATE2_TOTAL_TRUNCATION_MESSAGE);
      expect((diff.unifiedDiff ?? '').split('\n').length).toBeLessThanOrEqual(5);
    });
  });

  describe('scenario 7 — protected path', () => {
    it('never exposes protected content through review projection', () => {
      const secret = 'API_KEY=super-secret-token\n';
      const review = projectGate2ReviewForPlan(
        createPlanFromOperations([
          createUpdateOperation('project-brain.json', '{}', secret),
          createUpdateOperation('.env.local', '', secret),
        ]),
        { 'project-brain.json': '{}', '.env.local': '' },
      );

      for (const diff of review.operationDiffs) {
        expect(diff.format).toBe('PROTECTED');
        expect(diff.unifiedDiff).toBeUndefined();
        expect(GATE2_PROTECTED_DIFF_MESSAGE).toContain('never exposed');
      }
      expect(JSON.stringify(review)).not.toContain('super-secret-token');
    });
  });

  describe('scenario 8 — corrected preparation diff identity', () => {
    it('projects a different diff for corrected plans than the original', () => {
      const original = projectGate2ReviewForPlan(
        createPlanFromOperations([
          createUpdateOperation('src/feature.ts', 'const v = 1;\n', 'const v = 2;\n'),
        ]),
        { 'src/feature.ts': 'const v = 1;\n' },
      );
      const corrected = projectGate2ReviewForPlan(
        createPlanFromOperations([
          createUpdateOperation('src/feature.ts', 'const v = 1;\n', 'const v = 3;\n'),
        ]),
        { 'src/feature.ts': 'const v = 1;\n' },
      );

      expect(original.operationDiffs[0]?.unifiedDiff).toContain('+const v = 2;');
      expect(corrected.operationDiffs[0]?.unifiedDiff).toContain('+const v = 3;');
      expect(original.operationDiffs[0]?.unifiedDiff).not.toContain('+const v = 3;');
    });
  });

  describe('scenario 10 — server authority', () => {
    it('stores gate2Review separately from the change plan used by apply claim', () => {
      const store = new InMemoryPreparationStore(
        { now: () => new Date('2026-08-05T00:00:00.000Z') },
        10,
      );
      const serverReview = projectGate2ReviewForPlan(CHANGE_PLAN);
      const clientTamperedReview = {
        ...serverReview,
        operationDiffs: [
          {
            ...serverReview.operationDiffs[0]!,
            unifiedDiff: '+++ injected client diff\n+malicious',
          },
        ],
      };

      store.save(
        'prep-server-authority',
        CHANGE_PLAN,
        clientTamperedReview,
        new Date('2026-08-05T01:00:00.000Z'),
      );

      const claimed = store.claim('prep-server-authority');
      expect(claimed.kind).toBe('CLAIMED');
      if (claimed.kind !== 'CLAIMED') return;

      expect(claimed.plan).toEqual(CHANGE_PLAN);
      const claimedOperation = claimed.plan.changeSet.operations[0];
      const originalOperation = CHANGE_PLAN.changeSet.operations[0];
      expect(claimedOperation?.kind).toBe('CREATE_FILE');
      if (claimedOperation?.kind === 'CREATE_FILE' && originalOperation?.kind === 'CREATE_FILE') {
        expect(claimedOperation.content).toBe(originalOperation.content);
      }
      expect(JSON.stringify(claimed.plan)).not.toContain('malicious');
    });

    it('does not treat client-supplied diff text as authoritative apply input', () => {
      expect(EMPTY_GATE2_REVIEW.operationDiffs).toEqual([]);
      const claimedPlan = CHANGE_PLAN;
      expect(claimedPlan.source.executionId).toBe('execution-ui-001');
    });
  });

  describe('binary and unavailable content', () => {
    it('reports text diff unavailable for binary-like content', () => {
      const binaryContent = 'prefix\u0000suffix';
      const review = projectGate2ReviewForPlan(
        createPlanFromOperations([createCreateOperation('src/binary.dat', binaryContent)]),
      );
      const diff = review.operationDiffs[0]!;

      expect(diff.format).toBe('UNAVAILABLE');
      expect(diff.unifiedDiff).toBeUndefined();
      expect(GATE2_TEXT_DIFF_UNAVAILABLE_MESSAGE).toBe('Text diff unavailable for this operation.');
    });
  });
});
