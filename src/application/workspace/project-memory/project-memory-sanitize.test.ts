import { describe, expect, it } from 'vitest';

import {
  containsForbiddenKey,
  containsSecretLikeContent,
  sanitizeMemoryPaths,
  sanitizeMemorySummary,
  sanitizeMemoryTags,
} from './project-memory-sanitize';

describe('project-memory-sanitize', () => {
  it('rejects secret-like summaries', () => {
    expect(() => sanitizeMemorySummary('Bearer sk-live-abcdefghijklmnopqrstuvwxyz', 100)).toThrow(
      /secret-like/i,
    );
  });

  it('filters protected and traversal paths', () => {
    expect(sanitizeMemoryPaths(['../escape.ts', '.env.local', 'src/app.ts'], 12)).toEqual([
      'src/app.ts',
    ]);
  });

  it('sanitizes tags and forbidden keys', () => {
    expect(sanitizeMemoryTags([' Supplier ', 'supplier', 'password-hint'], 8, 48)).toEqual([
      'supplier',
    ]);
    expect(containsForbiddenKey('api_key_name')).toBe(true);
    expect(containsSecretLikeContent('process.env.SECRET_VALUE')).toBe(true);
  });

  it('truncates long summaries and skips empty tag values', () => {
    expect(sanitizeMemorySummary('short summary', 100)).toBe('short summary');
    expect(sanitizeMemorySummary('x'.repeat(120), 100)).toBe(`${'x'.repeat(100)}…`);
    expect(sanitizeMemoryTags(['', '   ', 'valid-tag'], 8, 48)).toEqual(['valid-tag']);
  });

  it('deduplicates paths and skips ineligible entries', () => {
    expect(
      sanitizeMemoryPaths(
        ['src/app.ts', 'src/app.ts', '../escape.ts', '', 'server/secrets/key.ts'],
        12,
      ),
    ).toEqual(['src/app.ts']);
  });
});
