import type { ProjectBrain } from '../../project-brain';
import {
  FIXED_TIME,
  createProjectBrain,
  createTask,
} from '../../project-brain/test/project-brain.fixture';
import { REQUIRED_DOCUMENTS } from '../documents';
import { MemoryDocumentSource, createDocumentSet, markdownFor } from '../test/document-set.fixture';
import { BlueprintReaderService } from './blueprint-reader.service';

function setBrain(documents: Map<string, string>, brain: unknown): void {
  documents.set('project-brain.json', JSON.stringify(brain));
}

describe('BlueprintReaderService', () => {
  it('reads a valid project and generates deterministic analysis and summary objects', async () => {
    const documents = createDocumentSet();
    documents.set('docs/readme.md', '# Additional documentation');

    const result = await new BlueprintReaderService(new MemoryDocumentSource(documents)).read();

    expect(result.valid).toBe(true);
    expect(result.analysis).toMatchObject({
      projectId: 'builder-ai',
      projectName: 'BuilderAI',
      vision: 'Build a model-independent software engineering platform.',
      architecture: {
        scope: 'Policy for Status and scope.',
        principles: ['Keep the core independent.', 'Validate every boundary.'],
      },
      milestones: { current: 'Sprint 1 - Project Brain Foundation' },
    });
    expect(result.summary).toMatchObject({
      projectOverview: { id: 'builder-ai', name: 'BuilderAI' },
      currentMilestone: 'Sprint 1 - Project Brain Foundation',
      missingDocumentation: [],
    });
    expect(result.summary?.moduleList).toHaveLength(1);
    expect(result.summary?.featureList).toHaveLength(1);
    expect(result.summary?.pendingWork).toHaveLength(1);
    expect(result.summary?.risks).toContainEqual(
      expect.objectContaining({ code: 'UNKNOWN_DOCUMENT', severity: 'WARNING' }),
    );
    expect(result.relationships).toContainEqual({
      from: 'blueprint',
      to: 'module:src/core/project-brain',
      kind: 'GOVERNS',
    });
  });

  it('reports missing files while still deriving a partial summary from canonical state', async () => {
    const documents = createDocumentSet();
    documents.delete('docs/project-memory.md');

    const result = await new BlueprintReaderService(new MemoryDocumentSource(documents)).read();

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'MISSING_DOCUMENT', path: 'docs/project-memory.md' }),
    );
    expect(result.summary?.missingDocumentation).toEqual(['docs/project-memory.md']);
  });

  it('reports Markdown and Project Brain version mismatches', async () => {
    const documents = createDocumentSet();
    const roadmapSpec = REQUIRED_DOCUMENTS.find(({ kind }) => kind === 'roadmap');
    if (roadmapSpec === undefined) throw new Error('Roadmap specification is missing.');
    documents.set(roadmapSpec.path, markdownFor(roadmapSpec, { version: 9 }));
    const originalBrain = createProjectBrain();
    setBrain(documents, { ...originalBrain, schemaVersion: 9 });

    const result = await new BlueprintReaderService(new MemoryDocumentSource(documents)).read();

    expect(result.valid).toBe(false);
    expect(result.analysis).toBeUndefined();
    expect(
      result.diagnostics.filter(({ code }) => code === 'UNSUPPORTED_DOCUMENT_VERSION'),
    ).toHaveLength(2);
  });

  it('reports schema incompatibility and malformed JSON without throwing', async () => {
    const incompatible = createDocumentSet();
    setBrain(incompatible, { ...createProjectBrain(), blueprint: undefined });

    const incompatibleResult = await new BlueprintReaderService(
      new MemoryDocumentSource(incompatible),
    ).read();
    expect(incompatibleResult.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'SCHEMA_INCOMPATIBLE' }),
    );

    const malformed = createDocumentSet();
    malformed.set('project-brain.json', '{broken');
    const malformedResult = await new BlueprintReaderService(
      new MemoryDocumentSource(malformed),
    ).read();
    expect(malformedResult.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'MALFORMED_DOCUMENT' }),
    );
  });

  it('detects conflicting information and duplicated mutable state in Markdown', async () => {
    const documents = createDocumentSet();
    const roadmap = documents.get('docs/roadmap.md') ?? '';
    documents.set(
      'docs/roadmap.md',
      `${roadmap}\nProject name: Another Product\nCurrent milestone: Sprint 1 - Project Brain Foundation\n`,
    );

    const result = await new BlueprintReaderService(new MemoryDocumentSource(documents)).read();

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'CONFLICTING_INFORMATION' }),
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'DUPLICATED_MUTABLE_STATE' }),
    );
    expect(result.valid).toBe(false);
  });

  it('detects missing references from completed work and completed sprints', async () => {
    const documents = createDocumentSet();
    const brain = createProjectBrain();
    const inconsistentBrain: ProjectBrain = {
      ...brain,
      memory: {
        ...brain.memory,
        completedWork: [
          {
            id: 'orphaned-work',
            summary: 'References a missing task.',
            taskIds: ['missing-task'],
            completedAt: FIXED_TIME,
          },
        ],
      },
      progressLog: {
        ...brain.progressLog,
        completedSprints: [
          {
            id: 'orphaned-sprint',
            name: 'Orphaned sprint',
            outcome: 'References a non-DONE task.',
            completedTaskIds: ['foundation-task'],
            completedAt: FIXED_TIME,
          },
        ],
      },
    };
    setBrain(documents, inconsistentBrain);

    const result = await new BlueprintReaderService(new MemoryDocumentSource(documents)).read();

    expect(result.diagnostics.filter(({ code }) => code === 'MISSING_REFERENCE')).toHaveLength(2);
  });

  it('extracts task, decision, completion, and sprint relationships', async () => {
    const documents = createDocumentSet();
    const first = createTask({
      id: 'first-task',
      status: 'DONE',
      completedAt: FIXED_TIME,
    });
    const second = createTask({
      id: 'second-task',
      status: 'DONE',
      dependencyIds: ['first-task'],
      completedAt: FIXED_TIME,
    });
    const base = createProjectBrain([first, second]);
    const relatedBrain: ProjectBrain = {
      ...base,
      memory: {
        ...base.memory,
        importantDecisionIds: ['decision-a'],
        completedWork: [
          {
            id: 'work-a',
            summary: 'Completed related work.',
            taskIds: ['second-task'],
            completedAt: FIXED_TIME,
          },
        ],
      },
      decisionLog: [
        {
          id: 'decision-a',
          title: 'A decision',
          context: 'Context.',
          decision: 'Decision.',
          rationale: 'Rationale.',
          status: 'ACCEPTED',
          alternatives: [],
          consequences: { positive: [], negative: [] },
          important: true,
          recordedAt: FIXED_TIME,
        },
      ],
      progressLog: {
        ...base.progressLog,
        completedTaskIds: ['first-task', 'second-task'],
        completedSprints: [
          {
            id: 'sprint-a',
            name: 'Sprint A',
            outcome: 'Complete.',
            completedTaskIds: ['second-task'],
            completedAt: FIXED_TIME,
          },
        ],
      },
    };
    setBrain(documents, relatedBrain);

    const result = await new BlueprintReaderService(new MemoryDocumentSource(documents)).read();

    expect(result.valid).toBe(true);
    expect(result.relationships).toEqual(
      expect.arrayContaining([
        { from: 'memory', to: 'decision:decision-a', kind: 'REFERENCES' },
        { from: 'decision:decision-a', to: 'blueprint', kind: 'GOVERNS' },
        { from: 'task:second-task', to: 'task:first-task', kind: 'DEPENDS_ON' },
        { from: 'completed-work:work-a', to: 'task:second-task', kind: 'COMPLETED_BY' },
        { from: 'sprint:sprint-a', to: 'task:second-task', kind: 'COMPLETED_BY' },
        { from: 'progress', to: 'task:first-task', kind: 'REFERENCES' },
      ]),
    );
  });

  it('reports unreadable discovered documents as malformed', async () => {
    const source = new MemoryDocumentSource(createDocumentSet());
    source.documents.delete('docs/ai-rules.md');
    source.documents.set('docs/ai-rules.md', '');
    vi.spyOn(source, 'readDocument').mockRejectedValueOnce(new Error('Access denied'));

    const result = await new BlueprintReaderService(source).read();

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'MALFORMED_DOCUMENT',
        message: expect.stringContaining('Access denied'),
      }),
    );
  });
});
