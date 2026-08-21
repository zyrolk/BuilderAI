import { describe, expect, it } from 'vitest';

import { ChangePlannerService } from '../../../core/change-planner';
import { EditProposalService } from './edit-proposal.service';
import type { ResponsePackage } from '../../../core/response-processor';
import type { WorkspacePreparation } from '../workspace-runtime.types';

describe('EditProposalService', () => {
  it('drafts multi-file proposals and rejects traversal', async () => {
    const service = new EditProposalService({
      changePlanner: new ChangePlannerService(),
      preparePort: {
        prepareFromResponsePackage: async () => {
          throw new Error('unused');
        },
      },
      clock: { now: () => new Date('2026-08-21T16:00:00.000Z') },
      ids: { generate: () => 'exec-1' },
    });

    const draft = service.draft({
      runId: 'r1',
      projectId: 'p1',
      replace: true,
      operations: [
        {
          kind: 'CREATE_FILE',
          logicalPath: 'src/a.ts',
          description: 'create a',
          content: 'export const a = 1;\n',
        },
        {
          kind: 'UPDATE_FILE',
          logicalPath: 'src/b.ts',
          description: 'update b',
          content: 'export const b = 2;\n',
        },
      ],
    });
    expect(draft.operations).toHaveLength(2);
    const inspection = service.inspect('r1', 'p1');
    expect(inspection.operationCount).toBe(2);

    expect(() =>
      service.draft({
        runId: 'r1',
        projectId: 'p1',
        replace: true,
        operations: [
          {
            kind: 'CREATE_FILE',
            logicalPath: '../x.ts',
            description: 'bad',
            content: 'x\n',
          },
        ],
      }),
    ).toThrow(/traverses|PATH_TRAVERSAL|invalid/i);
  });

  it('commit returns preparation refs without calling FileApply', async () => {
    let prepared: ResponsePackage | undefined;
    const service = new EditProposalService({
      changePlanner: new ChangePlannerService(),
      preparePort: {
        prepareFromResponsePackage: async (responsePackage) => {
          prepared = responsePackage;
          return {
            preparationId: 'prep-1',
            expiresAt: '2026-08-21T17:00:00.000Z',
            responsePackage,
            changePlan: new ChangePlannerService().plan(responsePackage),
            gate2Review: {
              schemaVersion: 1,
              operationDiffs: [],
              totalCharacterCount: 0,
              truncated: false,
            },
          } satisfies WorkspacePreparation;
        },
      },
      clock: { now: () => new Date('2026-08-21T16:00:00.000Z') },
      ids: { generate: () => 'exec-2' },
    });

    service.draft({
      runId: 'r2',
      projectId: 'p1',
      replace: true,
      operations: [
        {
          kind: 'CREATE_FILE',
          logicalPath: 'src/c.ts',
          description: 'create c',
          content: 'export const c = 3;\n',
        },
      ],
    });
    const result = await service.commit('r2', 'p1');
    expect(result.preparationId).toBe('prep-1');
    expect(prepared?.generatedArtifacts[0]?.metadata['change-operation']).toBe('CREATE_FILE');
  });
});
