import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { BlueprintReaderService } from '../../blueprint-reader';
import { REQUIRED_DOCUMENTS } from '../../blueprint-reader/documents';
import {
  MemoryDocumentSource,
  createDocumentSet,
  markdownFor,
} from '../../blueprint-reader/test/document-set.fixture';
import { NodeFileSystemDocumentSource } from '../../../infrastructure/blueprint-reader';
import {
  ExternalTargetOnboardingError,
  ExternalTargetProjectReaderService,
  EXTERNAL_TARGET_REQUIRED_DOCUMENTS,
  createProjectContextReader,
  loadWorkspaceProjectBrain,
  parseWorkspaceProjectProfile,
} from '../index';
import { ZYRO_STYLE_FIXTURE_ROOT } from './external-target.fixture';

describe('workspace project profile', () => {
  it('defaults to BUILDERAI_SELF and accepts external-target aliases', () => {
    expect(parseWorkspaceProjectProfile(undefined)).toBe('BUILDERAI_SELF');
    expect(parseWorkspaceProjectProfile('external-target')).toBe('EXTERNAL_TARGET');
    expect(parseWorkspaceProjectProfile('builderai-self')).toBe('BUILDERAI_SELF');
    expect(() => parseWorkspaceProjectProfile('other')).toThrow(
      "BUILDERAI_WORKSPACE_PROJECT_PROFILE must equal 'builderai-self' or 'external-target'.",
    );
  });
});

describe('external target project validation', () => {
  it('keeps BuilderAI self validation strict when governance documents are missing', async () => {
    const documents = createDocumentSet();
    documents.delete('docs/project-memory.md');
    const reader = createProjectContextReader({
      profile: 'BUILDERAI_SELF',
      projectRoot: process.cwd(),
      source: new MemoryDocumentSource(documents),
    });
    const result = await reader.read();
    expect(result.valid).toBe(false);
    expect(result.discovery.missing).toContainEqual(
      expect.objectContaining({ path: 'docs/project-memory.md' }),
    );
  });

  it('accepts the full BuilderAI governance document set for BUILDERAI_SELF', async () => {
    const result = await createProjectContextReader({
      profile: 'BUILDERAI_SELF',
      projectRoot: process.cwd(),
      source: new MemoryDocumentSource(createDocumentSet()),
    }).read();
    expect(result.valid).toBe(true);
    expect(result.discovery.documents.length).toBe(REQUIRED_DOCUMENTS.length);
  });

  it('fails closed with onboarding guidance when bootstrap context is missing', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'builderai-external-empty-'));
    try {
      await writeFile(path.join(root, 'package.json'), '{"name":"empty","scripts":{}}', 'utf8');
      const reader = new ExternalTargetProjectReaderService(
        root,
        new NodeFileSystemDocumentSource(root),
      );
      await expect(reader.read()).rejects.toBeInstanceOf(ExternalTargetOnboardingError);
      await expect(reader.read()).rejects.toMatchObject({
        code: 'EXTERNAL_TARGET_ONBOARDING_REQUIRED',
        missingPaths: expect.arrayContaining([
          '.builderai/target-project.json',
          'docs/architecture.md',
          'docs/project-constitution.md',
          'docs/ai-rules.md',
        ]),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('passes validation for the synthetic Zyro-style fixture without BuilderAI governance docs', async () => {
    const reader = new ExternalTargetProjectReaderService(
      ZYRO_STYLE_FIXTURE_ROOT,
      new NodeFileSystemDocumentSource(ZYRO_STYLE_FIXTURE_ROOT),
    );
    const result = await reader.read();
    expect(result.valid).toBe(true);
    expect(result.analysis?.projectId).toBe('zyro-style-fixture');
    expect(result.documents.map(({ kind }) => kind).sort()).toEqual(
      ['ai-rules', 'architecture', 'project-constitution'].sort(),
    );
    expect(result.discovery.documents).toHaveLength(3);
    expect(result.discovery.missing).toHaveLength(0);
    const sharedPaths = new Set([
      'docs/architecture.md',
      'docs/project-constitution.md',
      'docs/ai-rules.md',
    ]);
    const builderOnlyDocuments = REQUIRED_DOCUMENTS.filter(
      ({ path: requiredPath }) => !sharedPaths.has(requiredPath),
    );
    expect(builderOnlyDocuments.length).toBeGreaterThan(0);
    expect(result.discovery.documents.length).toBeLessThan(REQUIRED_DOCUMENTS.length);
  });

  it('rejects malformed external project context deterministically', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'builderai-external-malformed-'));
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
      const reader = new ExternalTargetProjectReaderService(
        root,
        new NodeFileSystemDocumentSource(root),
      );
      await expect(reader.read()).rejects.toBeInstanceOf(ExternalTargetOnboardingError);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('synthesizes project brain from the manifest when project-brain.json is absent', () => {
    const brain = loadWorkspaceProjectBrain(ZYRO_STYLE_FIXTURE_ROOT, 'EXTERNAL_TARGET');
    expect(brain.blueprint.projectId).toBe('zyro-style-fixture');
    expect(brain.blueprint.name).toBe('Zyro Style Fixture');
    expect(brain.progressLog.currentMilestone).toContain('bootstrap');
  });

  it('selects BlueprintReaderService only for BUILDERAI_SELF profiles', () => {
    const reader = createProjectContextReader({
      profile: 'BUILDERAI_SELF',
      projectRoot: process.cwd(),
      source: new NodeFileSystemDocumentSource(process.cwd()),
    });
    expect(reader).toBeInstanceOf(BlueprintReaderService);
  });

  it('reads optional manifest fields and honors an optional project-brain.json', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'builderai-external-full-'));
    try {
      await mkdir(path.join(root, '.builderai'), { recursive: true });
      await mkdir(path.join(root, 'docs'), { recursive: true });
      await writeFile(
        path.join(root, 'package.json'),
        JSON.stringify({ name: 'full', scripts: { build: 'node -v', test: 'node -v' } }),
        'utf8',
      );
      await writeFile(
        path.join(root, '.builderai/target-project.json'),
        JSON.stringify({
          schemaVersion: 1,
          projectId: 'full-target',
          name: 'Full Target',
          vision: 'Exercise optional manifest fields.',
          currentMilestone: 'Bootstrap',
          constraints: [
            {
              id: 'keep-secrets',
              statement: 'Do not commit secrets.',
              rationale: 'Security baseline.',
            },
          ],
          protectedAreas: ['secrets/'],
          folderOwnership: [{ path: 'src/', owner: 'Team', responsibility: 'Application code.' }],
        }),
        'utf8',
      );
      for (const spec of EXTERNAL_TARGET_REQUIRED_DOCUMENTS) {
        await writeFile(path.join(root, spec.path), markdownFor(spec), 'utf8');
      }
      const brain = loadWorkspaceProjectBrain(root, 'EXTERNAL_TARGET');
      expect(brain.blueprint.constraints).toHaveLength(1);
      const reader = new ExternalTargetProjectReaderService(
        root,
        new NodeFileSystemDocumentSource(root),
      );
      expect((await reader.read()).valid).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects invalid manifest JSON deterministically', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'builderai-external-json-'));
    try {
      await mkdir(path.join(root, '.builderai'), { recursive: true });
      await writeFile(path.join(root, 'package.json'), '{"name":"bad","scripts":{}}', 'utf8');
      await writeFile(path.join(root, '.builderai/target-project.json'), '{', 'utf8');
      const reader = new ExternalTargetProjectReaderService(
        root,
        new NodeFileSystemDocumentSource(root),
      );
      await expect(reader.read()).rejects.toBeInstanceOf(ExternalTargetOnboardingError);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
