import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  parseWorkspaceProjectProfile,
  readWorkspaceProjectProfileFromEnvironment,
} from '../parse-workspace-project-profile';
import { loadProjectBrainForTarget } from '../synthetic-project-brain.service';
import { createProjectBrain } from '../../project-brain/test/project-brain.fixture';

describe('target project helpers', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('reads the workspace profile from the environment', () => {
    vi.stubEnv('BUILDERAI_WORKSPACE_PROJECT_PROFILE', 'external-target');
    expect(readWorkspaceProjectProfileFromEnvironment()).toBe('EXTERNAL_TARGET');
    expect(parseWorkspaceProjectProfile('self')).toBe('BUILDERAI_SELF');
    expect(parseWorkspaceProjectProfile('external_target')).toBe('EXTERNAL_TARGET');
    expect(parseWorkspaceProjectProfile('')).toBe('BUILDERAI_SELF');
  });

  it('loads an optional project brain when projectId matches the manifest', () => {
    const manifest = {
      schemaVersion: 1 as const,
      projectId: 'builder-ai',
      name: 'BuilderAI',
      vision: 'Vision',
      currentMilestone: 'Milestone',
    };
    const brain = loadProjectBrainForTarget(
      manifest,
      createProjectBrain(),
      '2026-08-04T17:30:00.000Z',
    );
    expect(brain.blueprint.projectId).toBe('builder-ai');
  });

  it('rejects a mismatched optional project brain projectId', () => {
    const manifest = {
      schemaVersion: 1 as const,
      projectId: 'other-target',
      name: 'Other',
      vision: 'Vision',
      currentMilestone: 'Milestone',
    };
    expect(() =>
      loadProjectBrainForTarget(manifest, createProjectBrain(), '2026-08-04T17:30:00.000Z'),
    ).toThrow(/projectId must match/);
  });
});
