import { describe, expect, it } from 'vitest';

import { parseDecompositionOutput } from './decomposition-prompt';

describe('parseDecompositionOutput', () => {
  it('parses valid decomposition objects', () => {
    expect(
      parseDecompositionOutput({
        title: 'Feature',
        summary: 'Summary',
        tasks: [{ title: 'Task', objective: 'Do it' }],
      }),
    ).toEqual({
      title: 'Feature',
      summary: 'Summary',
      tasks: [{ title: 'Task', objective: 'Do it' }],
    });
  });

  it('omits invalid optional fields and non-object tasks', () => {
    expect(parseDecompositionOutput({ title: 1, summary: 2, tasks: [null, 'x', {}] })).toEqual({
      title: undefined,
      summary: undefined,
      tasks: [{}],
    });
    expect(parseDecompositionOutput({})).toEqual({
      title: undefined,
      summary: undefined,
      tasks: [],
    });
  });

  it('rejects non-object inputs', () => {
    expect(() => parseDecompositionOutput(null)).toThrow(/must be an object/i);
    expect(() => parseDecompositionOutput('x')).toThrow(/must be an object/i);
  });
});
