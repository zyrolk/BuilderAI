import { describe, expect, it, vi } from 'vitest';

import { FeatureDecompositionService } from './feature-decomposition.service';
import { WorkspaceRuntimeError } from './workspace-runtime.types';
import type { BlueprintReaderService } from '../../core/blueprint-reader';
import { loadCanonicalProjectBrain } from '../../core/project-brain';

describe('FeatureDecompositionService', () => {
  it('returns a bounded draft plan from structured provider output', async () => {
    const brain = loadCanonicalProjectBrain();
    const service = new FeatureDecompositionService({
      loadProjectBrain: () => brain,
      blueprintReader: {
        read: async () => ({
          valid: true,
          analysis: {
            projectId: 'demo',
            projectName: 'Demo',
            vision: 'Vision',
            goals: [],
            architecture: { scope: 'Layered', principles: ['Safety first'] },
            modules: [{ path: 'src/core', owner: 'core', responsibility: 'Core logic' }],
            milestones: { current: 'M1', completed: [] },
            features: [],
            requirements: [],
            constraints: [],
            techStack: [],
          },
          summary: { projectId: 'demo', projectName: 'Demo', vision: 'Vision' },
        }),
      } as unknown as BlueprintReaderService,
      sourceFiles: {
        listSourcePaths: async () => ['src/app/page.tsx', 'src/core/index.ts'],
        readSourceFile: async () => {
          throw new Error('not expected');
        },
      },
      providerExecution: {
        execute: vi.fn(async () => ({
          providerResponse: {
            schemaVersion: 1,
            providerId: 'test',
            model: 'test',
            status: 'SUCCEEDED',
            artifacts: [
              {
                kind: 'STRUCTURED_DATA',
                data: {
                  title: 'Checkout feature',
                  summary: 'Add checkout flow',
                  tasks: Array.from({ length: 14 }, (_, index) => ({
                    taskId: `task-${String(index + 1).padStart(2, '0')}`,
                    title: `Task ${index + 1}`,
                    objective: `Objective ${index + 1}`,
                    scope: 'src',
                    dependencyIds: index === 0 ? [] : [`task-${String(index).padStart(2, '0')}`],
                    expectedAreas: ['src/app'],
                    acceptanceCriteria: ['Criterion'],
                    order: index + 1,
                  })),
                },
              },
            ],
            metadata: { values: {} },
          },
          executionResult: {
            schemaVersion: 1,
            executionId: 'exec-001',
            status: 'SUCCEEDED',
            attempts: [],
            metadata: { values: {} },
          },
        })),
      } as never,
      projectRoot: process.cwd(),
      clock: { now: () => new Date('2026-08-01T00:00:00.000Z') },
      ids: { generate: () => 'decompose-plan-001' },
    });

    const plan = await service.decompose('Add checkout with cart persistence');
    expect(plan.status).toBe('DRAFT');
    expect(plan.tasks.length).toBeLessThanOrEqual(12);
    expect(plan.title).toBe('Checkout feature');
  });

  it('rejects decomposition output without structured data', async () => {
    const service = new FeatureDecompositionService({
      loadProjectBrain: () => loadCanonicalProjectBrain(),
      blueprintReader: {
        read: async () => ({
          valid: true,
          analysis: {
            projectId: 'demo',
            projectName: 'Demo',
            vision: 'Vision',
            goals: [],
            architecture: { scope: 'Layered', principles: [] },
            modules: [],
            milestones: { current: 'M1', completed: [] },
            features: [],
            requirements: [],
            constraints: [],
            techStack: [],
          },
          summary: { projectId: 'demo', projectName: 'Demo', vision: 'Vision' },
        }),
      } as unknown as BlueprintReaderService,
      sourceFiles: { listSourcePaths: async () => [], readSourceFile: async () => '' },
      providerExecution: {
        execute: vi.fn(async () => ({
          providerResponse: {
            schemaVersion: 1,
            providerId: 'test',
            model: 'test',
            status: 'SUCCEEDED',
            artifacts: [],
            metadata: { values: {} },
          },
          executionResult: {
            schemaVersion: 1,
            executionId: 'exec-002',
            status: 'SUCCEEDED',
            attempts: [],
            metadata: { values: {} },
          },
        })),
      } as never,
      projectRoot: process.cwd(),
      clock: { now: () => new Date('2026-08-01T00:00:00.000Z') },
      ids: { generate: () => 'decompose-plan-002' },
    });

    await expect(service.decompose('Add checkout')).rejects.toThrow(WorkspaceRuntimeError);
  });
});
