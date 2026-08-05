import { describe, expect, it } from 'vitest';

import { WorkspaceRuntimeService } from '../../../application/workspace/workspace-runtime.service';
import { WorkspaceRuntimeError } from '../../../application/workspace/workspace-runtime.types';
import { ExternalTargetOnboardingError } from '../external-target-project-reader.service';
import {
  loadWorkspaceProjectBrain,
  readWorkspaceProjectId,
} from '../workspace-project-brain.loader';
import { ZYRO_STYLE_FIXTURE_ROOT } from './external-target.fixture';

describe('workspace runtime external target onboarding', () => {
  it('maps ExternalTargetOnboardingError to WorkspaceRuntimeError during prepare', async () => {
    const service = new WorkspaceRuntimeService({
      loadProjectBrain: () => {
        throw new ExternalTargetOnboardingError(
          [{ path: '.builderai/target-project.json', message: 'missing' }],
          ['.builderai/target-project.json'],
        );
      },
      blueprintReader: {
        read: async () => ({
          valid: false,
          discovery: { documents: [], missing: [], duplicates: [], unknown: [], diagnostics: [] },
          documents: [],
          relationships: [],
          diagnostics: [],
        }),
      },
      sourceFiles: { listSourcePaths: async () => [], readSourceFile: async () => '' },
      contextBuilder: {
        build: async () => {
          throw new Error('not reached');
        },
      } as never,
      promptOrchestrator: {
        orchestrate: async () => {
          throw new Error('not reached');
        },
      } as never,
      workspaceBaseline: { readTextBaseline: () => null },
      providerExecution: {
        execute: async () => {
          throw new Error('not reached');
        },
      },
      responseProcessor: {
        process: async () => {
          throw new Error('not reached');
        },
      } as never,
      changePlanner: {
        plan: () => {
          throw new Error('not reached');
        },
      } as never,
      fileApply: {
        apply: async () => {
          throw new Error('not reached');
        },
      } as never,
      verification: {
        verify: async () => {
          throw new Error('not reached');
        },
      } as never,
      clock: { now: () => new Date('2026-08-04T17:30:00.000Z') },
      ids: { generate: () => 'test-id' },
      logger: { record: () => undefined },
    });

    await expect(service.prepare('Add a feature.')).rejects.toMatchObject({
      code: 'EXTERNAL_TARGET_ONBOARDING_REQUIRED',
    });
    await expect(service.prepare('Add a feature.')).rejects.toBeInstanceOf(WorkspaceRuntimeError);
  });

  it('reads project ids for external targets and falls back for builderai-self', () => {
    expect(readWorkspaceProjectId(ZYRO_STYLE_FIXTURE_ROOT, 'EXTERNAL_TARGET')).toBe(
      'zyro-style-fixture',
    );
    expect(readWorkspaceProjectId(process.cwd(), 'BUILDERAI_SELF')).toBe('builder-ai');
    expect(
      loadWorkspaceProjectBrain(ZYRO_STYLE_FIXTURE_ROOT, 'EXTERNAL_TARGET').blueprint.name,
    ).toBe('Zyro Style Fixture');
  });
});
