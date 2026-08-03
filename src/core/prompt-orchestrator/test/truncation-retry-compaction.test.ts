import { ProviderContractViolationError } from '../../ai-provider';
import { PromptBudgetService } from '../services/prompt-budget.service';
import type { PromptPackage } from '../types/prompt-orchestrator';
import {
  TruncationRetryCompactionService,
  buildCompactedPrompt,
  deriveCompactionAllowlist,
  normalizeCompactionPath,
} from '../services/truncation-retry-compaction.service';

function createCorrectionPrompt(
  paths: {
    updated?: readonly string[];
    created?: readonly string[];
    deleted?: readonly string[];
  } = {},
): PromptPackage {
  return new PromptBudgetService().enforce(
    {
      schemaVersion: 1,
      template: { id: 'builderai-standard', version: 3 },
      sections: [
        {
          id: 'iteration',
          kind: 'ITERATION',
          required: false,
          instructions: [
            {
              id: 'correction-minimal-artifacts',
              text: 'Emit artifacts only for files that must be created, updated, or deleted.',
              source: 'TEMPLATE',
            },
          ],
          feedback: {
            schemaVersion: 1,
            kind: 'CORRECTION',
            apply: {
              status: 'APPLIED',
              createdPaths: paths.created ?? [],
              updatedPaths: paths.updated ?? [],
              deletedPaths: paths.deleted ?? [],
              skippedPaths: [],
              errors: [],
              warnings: [],
            },
          },
        },
        {
          id: 'output-contract',
          kind: 'OUTPUT_CONTRACT',
          required: true,
          expectedOutput: {
            schemaVersion: 1,
            type: 'OBJECT',
            fields: [
              { name: 'summary', description: 'Summary', type: 'STRING', required: true },
              { name: 'artifacts', description: 'Artifacts', type: 'ARRAY', required: true },
              { name: 'diagnostics', description: 'Diagnostics', type: 'ARRAY', required: true },
            ],
            allowAdditionalFields: false,
          },
        },
      ],
      metadata: {
        sourceContextSchemaVersion: 1,
        sourceContextCharacters: 100,
        values: { purpose: 'test' },
      },
    },
    100_000,
  );
}

describe('TruncationRetryCompactionService', () => {
  const service = new TruncationRetryCompactionService();

  it('leaves ordinary attempt 1 without bounding when no iteration allowlist exists', () => {
    const prompt = createCorrectionPrompt({
      updated: ['src/application/workspace/activity-history.service.ts'],
    });
    const withoutIteration = {
      ...prompt,
      sections: prompt.sections.filter(({ kind }) => kind !== 'ITERATION'),
    };
    const resolution = service.resolveAttempt({
      prompt: withoutIteration,
      attempt: 1,
    });
    expect(resolution.boundingActive).toBe(false);
    expect(resolution.compactionActive).toBe(false);
    expect(resolution.prompt).toBe(withoutIteration);
    expect(resolution.allowlist).toEqual([]);
  });

  it('activates attempt-1 correction bounding without prompt compaction', () => {
    const prompt = createCorrectionPrompt({
      updated: [
        'src/application/workspace/activity-history.service.test.ts',
        'src/application/workspace/activity-history.service.ts',
      ],
    });
    const resolution = service.resolveAttempt({
      prompt,
      attempt: 1,
    });
    expect(resolution.boundingActive).toBe(true);
    expect(resolution.compactionActive).toBe(false);
    expect(resolution.prompt).toBe(prompt);
    expect(resolution.allowlist).toEqual([
      'src/application/workspace/activity-history.service.test.ts',
      'src/application/workspace/activity-history.service.ts',
    ]);
    const iteration = resolution.prompt.sections.find(({ kind }) => kind === 'ITERATION');
    expect(iteration?.kind).toBe('ITERATION');
    if (iteration?.kind !== 'ITERATION') throw new Error('Expected iteration section.');
    const text = iteration.instructions.map(({ text: value }) => value).join(' ');
    expect(text).not.toMatch(/OUTPUT_TRUNCATION_RETRY/);
  });

  it('compacts attempt 2 after OUTPUT_TRUNCATED with a safe allowlist', () => {
    const prompt = createCorrectionPrompt({
      updated: [
        'src/application/workspace/activity-history.service.test.ts',
        'src/application/workspace/activity-history.service.ts',
      ],
    });
    const resolution = service.resolveAttempt({
      prompt,
      attempt: 2,
      priorFailureCode: 'OUTPUT_TRUNCATED',
    });
    expect(resolution.boundingActive).toBe(true);
    expect(resolution.compactionActive).toBe(true);
    expect(resolution.allowlist).toEqual([
      'src/application/workspace/activity-history.service.test.ts',
      'src/application/workspace/activity-history.service.ts',
    ]);
    const iteration = resolution.prompt.sections.find(({ kind }) => kind === 'ITERATION');
    expect(iteration?.kind).toBe('ITERATION');
    if (iteration?.kind !== 'ITERATION') throw new Error('Expected iteration section.');
    const text = iteration.instructions.map(({ text: value }) => value).join(' ');
    expect(text).toMatch(/OUTPUT_TRUNCATION_RETRY/);
    expect(text).toMatch(/activity-history.service.ts/);
    expect(text).toMatch(/Emit at most 2 artifacts/);
    expect(resolution.prompt.budget.characters).toBe(JSON.stringify(resolution.prompt).length);
    expect(resolution.prompt.budget.characters).toBeGreaterThan(prompt.budget.characters);
  });

  it('keeps attempt-2 bounding without compaction after PROVIDER_UNAVAILABLE', () => {
    const prompt = createCorrectionPrompt({
      updated: ['src/application/workspace/activity-history.service.ts'],
    });
    const resolution = service.resolveAttempt({
      prompt,
      attempt: 2,
      priorFailureCode: 'PROVIDER_UNAVAILABLE',
    });
    expect(resolution.boundingActive).toBe(true);
    expect(resolution.compactionActive).toBe(false);
    expect(resolution.prompt).toBe(prompt);
  });

  it('rejects unsafe allowlist paths', () => {
    expect(normalizeCompactionPath('.env.local')).toBeUndefined();
    expect(normalizeCompactionPath('project-brain.json')).toBeUndefined();
    expect(normalizeCompactionPath('/etc/passwd')).toBeUndefined();
    expect(normalizeCompactionPath('src/../secrets/env.ts')).toBeUndefined();
    expect(normalizeCompactionPath('src/core/project-brain/state.json')).toBeUndefined();
  });

  it('deduplicates, normalizes, sorts, and caps allowlist paths at 8', () => {
    const paths = Array.from({ length: 10 }, (_, index) => ({
      updated: [`src/z/file-${index}.ts`, `src\\a\\file-${index}.ts`],
    }));
    const prompt = createCorrectionPrompt({
      updated: paths.flatMap((entry) => entry.updated),
    });
    const allowlist = deriveCompactionAllowlist(prompt);
    expect(allowlist).toHaveLength(8);
    expect([...allowlist]).toEqual([...allowlist].sort((a, b) => a.localeCompare(b)));
    expect(new Set(allowlist).size).toBe(allowlist.length);
  });

  it('rejects out-of-scope artifacts on compacted retry', () => {
    const allowlist = ['src/application/workspace/activity-history.service.ts'];
    const resolution = service.resolveAttempt({
      prompt: buildCompactedPrompt(createCorrectionPrompt({ updated: allowlist }), allowlist),
      attempt: 2,
      priorFailureCode: 'OUTPUT_TRUNCATED',
    });
    expect(() =>
      service.validateStructuredOutput(
        {
          summary: 'ok',
          artifacts: [
            {
              logicalPath: 'src/application/workspace/activity-history.schemas.ts',
              type: 'TEST',
              content: 'x',
              metadata: { description: 'bad', 'change-operation': 'UPDATE_FILE' },
            },
          ],
          diagnostics: [],
        },
        resolution,
      ),
    ).toThrow(ProviderContractViolationError);
  });

  it('accepts in-scope artifacts on compacted retry', () => {
    const allowlist = ['src/application/workspace/activity-history.service.ts'] as const;
    const resolution = service.resolveAttempt({
      prompt: buildCompactedPrompt(createCorrectionPrompt({ updated: [...allowlist] }), allowlist),
      attempt: 2,
      priorFailureCode: 'OUTPUT_TRUNCATED',
    });
    expect(() =>
      service.validateStructuredOutput(
        {
          summary: 'ok',
          artifacts: [
            {
              logicalPath: allowlist[0],
              type: 'TEST',
              content: 'export {};',
              metadata: { description: 'fix', 'change-operation': 'UPDATE_FILE' },
            },
          ],
          diagnostics: [{ code: 'INFO', severity: 'INFO', message: 'done' }],
        },
        resolution,
      ),
    ).not.toThrow();
  });

  it('accepts a valid two-file compacted response', () => {
    const allowlist = [
      'src/application/workspace/activity-history.service.test.ts',
      'src/application/workspace/activity-history.service.ts',
    ] as const;
    const resolution = service.resolveAttempt({
      prompt: buildCompactedPrompt(createCorrectionPrompt({ updated: [...allowlist] }), allowlist),
      attempt: 2,
      priorFailureCode: 'OUTPUT_TRUNCATED',
    });
    expect(() =>
      service.validateStructuredOutput(
        {
          summary: 'Updated service and tests.',
          artifacts: [
            {
              logicalPath: allowlist[0],
              type: 'TEST',
              content: 'describe("history", () => {});',
              metadata: { description: 'tests', 'change-operation': 'UPDATE_FILE' },
            },
            {
              logicalPath: allowlist[1],
              type: 'SOURCE_FILE',
              content: 'export class ActivityHistoryService {}',
              metadata: { description: 'service', 'change-operation': 'UPDATE_FILE' },
            },
          ],
          diagnostics: [{ code: 'INFO', severity: 'INFO', message: 'done' }],
        },
        resolution,
      ),
    ).not.toThrow();
  });

  it('accepts complete UPDATE_FILE content without a content length cap', () => {
    const allowlist = ['src/application/workspace/activity-history.service.ts'] as const;
    const resolution = service.resolveAttempt({
      prompt: buildCompactedPrompt(createCorrectionPrompt({ updated: [...allowlist] }), allowlist),
      attempt: 2,
      priorFailureCode: 'OUTPUT_TRUNCATED',
    });
    const completeFileContent = `${'export const line = 1;\n'.repeat(500)}export {};`;
    expect(() =>
      service.validateStructuredOutput(
        {
          summary: 'ok',
          artifacts: [
            {
              logicalPath: allowlist[0],
              type: 'SOURCE_FILE',
              content: completeFileContent,
              metadata: { description: 'full file', 'change-operation': 'UPDATE_FILE' },
            },
          ],
          diagnostics: [],
        },
        resolution,
      ),
    ).not.toThrow();
  });

  it('rejects duplicate logicalPath artifacts on compacted retry', () => {
    const allowlist = [
      'src/application/workspace/activity-history.service.test.ts',
      'src/application/workspace/activity-history.service.ts',
    ] as const;
    const resolution = service.resolveAttempt({
      prompt: buildCompactedPrompt(createCorrectionPrompt({ updated: [...allowlist] }), allowlist),
      attempt: 2,
      priorFailureCode: 'OUTPUT_TRUNCATED',
    });
    expect(() =>
      service.validateStructuredOutput(
        {
          summary: 'ok',
          artifacts: [
            {
              logicalPath: allowlist[0],
              type: 'TEST',
              content: 'first',
              metadata: { description: 'a', 'change-operation': 'UPDATE_FILE' },
            },
            {
              logicalPath: allowlist[0],
              type: 'TEST',
              content: 'duplicate',
              metadata: { description: 'b', 'change-operation': 'UPDATE_FILE' },
            },
          ],
          diagnostics: [],
        },
        resolution,
      ),
    ).toThrow(ProviderContractViolationError);
  });

  it('rejects more artifacts than allowlist length on compacted retry', () => {
    const allowlist = [
      'src/application/workspace/activity-history.service.test.ts',
      'src/application/workspace/activity-history.service.ts',
    ] as const;
    const resolution = service.resolveAttempt({
      prompt: buildCompactedPrompt(createCorrectionPrompt({ updated: [...allowlist] }), allowlist),
      attempt: 2,
      priorFailureCode: 'OUTPUT_TRUNCATED',
    });
    expect(() =>
      service.validateStructuredOutput(
        {
          summary: 'ok',
          artifacts: [
            {
              logicalPath: allowlist[0],
              type: 'TEST',
              content: 'a',
              metadata: { description: 'a', 'change-operation': 'UPDATE_FILE' },
            },
            {
              logicalPath: allowlist[1],
              type: 'SOURCE_FILE',
              content: 'b',
              metadata: { description: 'b', 'change-operation': 'UPDATE_FILE' },
            },
            {
              logicalPath: allowlist[0],
              type: 'TEST',
              content: 'c',
              metadata: { description: 'c', 'change-operation': 'UPDATE_FILE' },
            },
          ],
          diagnostics: [],
        },
        resolution,
      ),
    ).toThrow(ProviderContractViolationError);
  });

  it('rejects more than one diagnostic on compacted retry', () => {
    const allowlist = ['src/application/workspace/activity-history.service.ts'] as const;
    const resolution = service.resolveAttempt({
      prompt: buildCompactedPrompt(createCorrectionPrompt({ updated: [...allowlist] }), allowlist),
      attempt: 2,
      priorFailureCode: 'OUTPUT_TRUNCATED',
    });
    expect(() =>
      service.validateStructuredOutput(
        {
          summary: 'ok',
          artifacts: [
            {
              logicalPath: allowlist[0],
              type: 'TEST',
              content: 'export {};',
              metadata: { description: 'fix', 'change-operation': 'UPDATE_FILE' },
            },
          ],
          diagnostics: [
            { code: 'INFO', severity: 'INFO', message: 'one' },
            { code: 'INFO', severity: 'INFO', message: 'two' },
          ],
        },
        resolution,
      ),
    ).toThrow(ProviderContractViolationError);
  });

  it('rejects an overly verbose summary on compacted retry', () => {
    const allowlist = ['src/application/workspace/activity-history.service.ts'] as const;
    const resolution = service.resolveAttempt({
      prompt: buildCompactedPrompt(createCorrectionPrompt({ updated: [...allowlist] }), allowlist),
      attempt: 2,
      priorFailureCode: 'OUTPUT_TRUNCATED',
    });
    expect(() =>
      service.validateStructuredOutput(
        {
          summary: 'x'.repeat(1001),
          artifacts: [
            {
              logicalPath: allowlist[0],
              type: 'TEST',
              content: 'export {};',
              metadata: { description: 'fix', 'change-operation': 'UPDATE_FILE' },
            },
          ],
          diagnostics: [],
        },
        resolution,
      ),
    ).toThrow(ProviderContractViolationError);
  });

  it('returns inactive bounding when no safe allowlist can be derived', () => {
    const prompt = createCorrectionPrompt({ updated: ['.env.local', '/abs/path.ts'] });
    const resolution = service.resolveAttempt({
      prompt,
      attempt: 2,
      priorFailureCode: 'OUTPUT_TRUNCATED',
    });
    expect(resolution.boundingActive).toBe(false);
    expect(resolution.compactionActive).toBe(false);
    expect(resolution.allowlist).toEqual([]);
  });
});
