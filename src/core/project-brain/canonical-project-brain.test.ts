import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import canonicalState from '../../../project-brain.json';

import { ProjectBrainService } from './services';
import { InMemoryProjectBrainRepository } from './storage';
import { loadCanonicalProjectBrain } from './canonical-project-brain';

const STATE_POLICY_DOCUMENTS = [
  'project-blueprint.md',
  'project-memory.md',
  'decision-log.md',
  'progress-log.md',
  'domain-glossary.md',
  'roadmap.md',
] as const;

describe('canonical Project Brain', () => {
  it('loads the repository state through the production parser and returns defensive copies', () => {
    const first = loadCanonicalProjectBrain();
    const second = loadCanonicalProjectBrain();

    expect(first).toEqual(canonicalState);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(second.blueprint).not.toBe(first.blueprint);
  });

  it('initializes the repository from canonical state', async () => {
    const service = new ProjectBrainService(new InMemoryProjectBrainRepository());
    const created = await service.initialize(loadCanonicalProjectBrain());

    expect(created.revision).toBe(1);
    expect(created.brain.blueprint.projectId).toBe('builder-ai');
    expect(service).not.toHaveProperty('replace');
  });

  it('keeps mutable state out of policy documentation', async () => {
    const stateMarkers = [
      canonicalState.progressLog.currentMilestone,
      canonicalState.tasks[0]?.title,
      canonicalState.tasks[1]?.title,
      canonicalState.decisionLog.at(-1)?.id,
      canonicalState.memory.pendingWork[0]?.summary,
    ].filter((marker): marker is string => marker !== undefined);

    for (const document of STATE_POLICY_DOCUMENTS) {
      const content = await readFile(resolve(process.cwd(), 'docs', document), 'utf8');
      expect(content).toContain('../project-brain.json');
      for (const marker of stateMarkers) expect(content).not.toContain(marker);
    }
  });
});
