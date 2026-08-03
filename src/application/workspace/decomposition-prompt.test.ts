import { describe, expect, it } from 'vitest';

import {
  buildDecompositionPromptPackage,
  DECOMPOSITION_PROMPT_MAX_CHARACTERS,
  parseDecompositionOutput,
} from '../../core/feature-decomposition';
import { PromptPackageValidator } from '../../core/prompt-orchestrator';
import type { DecompositionContextPackage } from './decomposition-context.service';

const context: DecompositionContextPackage = {
  schemaVersion: 1,
  featureRequest: 'Add checkout',
  project: {
    id: 'demo',
    name: 'Demo',
    vision: 'Vision',
    milestone: 'M1',
  },
  goals: ['Ship checkout'],
  constraints: ['No autonomous apply'],
  architecture: {
    summary: 'Layered architecture',
    modules: [{ path: 'src/core', responsibility: 'Core logic' }],
  },
  repository: {
    totalSourcePaths: 2,
    topLevelAreas: [{ prefix: 'src/core', count: 1 }],
    indicators: ['tests-present'],
  },
  rootConfiguration: {
    packageName: 'demo',
    scripts: ['test'],
    frameworkHints: ['next'],
  },
  ownershipBoundaries: [
    'Project Brain is canonical durable governance—not generic workflow state.',
    'Feature workflow plans persist under .builderai.',
  ],
};

describe('decomposition prompt contract', () => {
  it('builds a validator-compatible decomposition prompt package', () => {
    const prompt = buildDecompositionPromptPackage(context, 'corr-001');
    new PromptPackageValidator().validate(prompt);
    expect(prompt.budget.characters).toBe(JSON.stringify(prompt).length);
    expect(prompt.budget.characters).toBeLessThanOrEqual(DECOMPOSITION_PROMPT_MAX_CHARACTERS);
    expect(prompt.sections.some(({ kind }) => kind === 'OUTPUT_CONTRACT')).toBe(true);
    expect(prompt.sections.some(({ kind }) => kind === 'SAFETY')).toBe(true);
    const contextPresent = prompt.sections.some(({ kind }) => kind === 'CONTEXT');
    const contextOmitted = prompt.budget.omittedSections.some(({ kind }) => kind === 'CONTEXT');
    expect(contextPresent).not.toBe(contextOmitted);
  });

  it('parses structured decomposition output', () => {
    const parsed = parseDecompositionOutput({
      title: 'Checkout',
      summary: 'Summary',
      tasks: [{ taskId: 'task-01', title: 'Schema', objective: 'Add schema' }],
    });
    expect(parsed.tasks).toHaveLength(1);
  });
});
