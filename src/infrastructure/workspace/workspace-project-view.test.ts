import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadCanonicalProjectBrain } from '../../core/project-brain';
import {
  EXTERNAL_TARGET_REQUIRED_DOCUMENTS,
  WorkspaceProjectIdUnavailableError,
} from '../../core/target-project';
import { markdownFor } from '../../core/blueprint-reader/test/document-set.fixture';
import { ZYRO_STYLE_FIXTURE_ROOT } from '../../core/target-project/test/external-target.fixture';
import { loadWorkspaceProjectBrainForView } from './workspace-project-view';

function stubLocalRuntime(projectRoot: string, profile: 'builderai-self' | 'external-target') {
  vi.stubEnv('BUILDERAI_LIVE_WORKFLOW_ENABLED', 'true');
  vi.stubEnv('BUILDERAI_AI_PROVIDER', 'openai');
  vi.stubEnv('OPENAI_API_KEY', 'test-secret');
  vi.stubEnv('OPENAI_MODEL', 'configured-model');
  vi.stubEnv('BUILDERAI_PROJECT_ROOT', projectRoot);
  vi.stubEnv('BUILDERAI_WORKSPACE_PROJECT_PROFILE', profile);
}

describe('loadWorkspaceProjectBrainForView', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('loads canonical BuilderAI brain when the local runtime is disabled', () => {
    vi.stubEnv('BUILDERAI_LIVE_WORKFLOW_ENABLED', 'false');
    expect(loadWorkspaceProjectBrainForView()).toEqual(loadCanonicalProjectBrain());
  });

  it('loads synthetic external-target brain when project-brain.json is absent', () => {
    stubLocalRuntime(ZYRO_STYLE_FIXTURE_ROOT, 'external-target');
    const brain = loadWorkspaceProjectBrainForView();
    expect(brain.blueprint.projectId).toBe('zyro-style-fixture');
    expect(brain.blueprint.name).toBe('Zyro Style Fixture');
    expect(brain.progressLog.currentMilestone).toContain('bootstrap');
  });

  it('honors an optional external-target project-brain.json', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'builderai-view-optional-brain-'));
    try {
      await mkdir(path.join(root, '.builderai'), { recursive: true });
      await mkdir(path.join(root, 'docs'), { recursive: true });
      await writeFile(path.join(root, 'package.json'), '{"name":"full","scripts":{}}', 'utf8');
      await writeFile(
        path.join(root, '.builderai/target-project.json'),
        JSON.stringify({
          schemaVersion: 1,
          projectId: 'optional-brain-target',
          name: 'Manifest Name',
          vision: 'Manifest vision.',
          currentMilestone: 'Manifest milestone',
        }),
        'utf8',
      );
      for (const spec of EXTERNAL_TARGET_REQUIRED_DOCUMENTS) {
        await writeFile(path.join(root, spec.path), markdownFor(spec), 'utf8');
      }
      await writeFile(
        path.join(root, 'project-brain.json'),
        JSON.stringify({
          schemaVersion: 1,
          blueprint: {
            projectId: 'optional-brain-target',
            name: 'Optional Brain Name',
            vision: 'Optional brain vision.',
            goals: [],
            features: [],
            requirements: [],
            constraints: [],
            techStack: [],
            folderOwnership: [],
          },
          memory: {
            completedWork: [],
            pendingWork: [],
            importantDecisionIds: [],
            architecturalRules: [],
            updatedAt: '2026-08-05T00:00:00.000Z',
          },
          decisionLog: [],
          progressLog: {
            currentMilestone: 'Optional brain milestone',
            completedSprints: [],
            completedTaskIds: [],
            updatedAt: '2026-08-05T00:00:00.000Z',
          },
          tasks: [],
          domainGlossary: { terms: [], updatedAt: '2026-08-05T00:00:00.000Z' },
        }),
        'utf8',
      );

      stubLocalRuntime(root, 'external-target');
      const brain = loadWorkspaceProjectBrainForView();
      expect(brain.blueprint.name).toBe('Optional Brain Name');
      expect(brain.progressLog.currentMilestone).toBe('Optional brain milestone');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps BUILDERAI_SELF strict when project-brain.json is present', () => {
    stubLocalRuntime(process.cwd(), 'builderai-self');
    const brain = loadWorkspaceProjectBrainForView();
    expect(brain.blueprint.projectId).toBe('builder-ai');
  });

  it('fails closed for BUILDERAI_SELF when project-brain.json is missing', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'builderai-view-self-missing-'));
    try {
      await writeFile(path.join(root, 'package.json'), '{"name":"self","scripts":{}}', 'utf8');
      stubLocalRuntime(root, 'builderai-self');
      expect(() => loadWorkspaceProjectBrainForView()).toThrow(/ENOENT|no such file/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('surfaces malformed external-target onboarding through the established validation path', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'builderai-view-malformed-'));
    try {
      await mkdir(path.join(root, '.builderai'), { recursive: true });
      await mkdir(path.join(root, 'docs'), { recursive: true });
      await writeFile(path.join(root, 'package.json'), '{"name":"bad","scripts":{}}', 'utf8');
      await writeFile(
        path.join(root, '.builderai/target-project.json'),
        JSON.stringify({ schemaVersion: 1, projectId: '!!!', name: 'x' }),
        'utf8',
      );
      for (const spec of EXTERNAL_TARGET_REQUIRED_DOCUMENTS) {
        await writeFile(path.join(root, spec.path), markdownFor(spec), 'utf8');
      }
      stubLocalRuntime(root, 'external-target');
      expect(() => loadWorkspaceProjectBrainForView()).toThrow(WorkspaceProjectIdUnavailableError);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
