import { describe, expect, it } from 'vitest';

import { buildPartialSourceExcerpt } from './partial-source-content';

describe('buildPartialSourceExcerpt', () => {
  it('slices content when header plus lines exceed the budget', () => {
    const excerpt = buildPartialSourceExcerpt('abcdefghij'.repeat(50), 80);
    expect(excerpt.truncated).toBe(true);
    expect(excerpt.content.endsWith('…')).toBe(true);
  });

  it('keeps short content unchanged when within budget', () => {
    const excerpt = buildPartialSourceExcerpt('line-one\nline-two\n', 200);
    expect(excerpt.truncated).toBe(false);
    expect(excerpt.content).toBe('line-one\nline-two\n');
  });

  it('stops adding lines once the excerpt budget is exhausted', () => {
    const content = `${'x'.repeat(110)}\nsecond-line\nthird-line\n`;
    const excerpt = buildPartialSourceExcerpt(content, 120);
    expect(excerpt.truncated).toBe(true);
    expect(excerpt.content).toMatch(/PARTIAL_EXCERPT/);
    expect(excerpt.content).not.toContain('third-line');
  });

  it('breaks before appending a line that would exceed the remaining budget', () => {
    const excerpt = buildPartialSourceExcerpt(`hi\n${'b'.repeat(200)}\n`, 100);
    expect(excerpt.truncated).toBe(true);
    expect(excerpt.content).toContain('hi');
    expect(excerpt.content).not.toContain('bbbb');
  });
});
