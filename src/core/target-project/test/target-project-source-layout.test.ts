import { describe, expect, it } from 'vitest';

import {
  parseManifestSourceRoots,
  parseManifestStaticSourceRoots,
} from '../target-project-source-layout';

describe('target project source layout parsers', () => {
  it('parses and deduplicates source roots', () => {
    expect(parseManifestSourceRoots(undefined, 'sourceRoots')).toEqual([]);
    expect(parseManifestSourceRoots(['src', 'src', './app'], 'sourceRoots')).toEqual([
      'src',
      'app',
    ]);
  });

  it('rejects invalid source roots', () => {
    expect(() => parseManifestSourceRoots('src' as never, 'sourceRoots')).toThrow(/array/i);
    expect(() =>
      parseManifestSourceRoots(
        Array.from({ length: 17 }, (_, i) => `root${i}`),
        'sourceRoots',
      ),
    ).toThrow(/16/);
    expect(() => parseManifestSourceRoots(['node_modules'], 'sourceRoots')).toThrow(/blocked/i);
    expect(() => parseManifestSourceRoots(['public'], 'sourceRoots')).toThrow(/staticSourceRoots/i);
    expect(() => parseManifestSourceRoots([123 as never], 'sourceRoots')).toThrow(/string/i);
    expect(() => parseManifestSourceRoots(['../escape'], 'sourceRoots')).toThrow(/safe/i);
    expect(() => parseManifestSourceRoots(['/abs'], 'sourceRoots')).toThrow(/safe/i);
  });

  it('parses static source roots', () => {
    expect(parseManifestStaticSourceRoots(undefined)).toEqual([]);
    expect(parseManifestStaticSourceRoots(['public', 'static', 'public'])).toEqual([
      'public',
      'static',
    ]);
    expect(() => parseManifestStaticSourceRoots('public' as never)).toThrow(/array/i);
    expect(() =>
      parseManifestStaticSourceRoots(['public', 'static', 'public', 'static', 'public']),
    ).toThrow(/4/);
    expect(() => parseManifestStaticSourceRoots(['src'])).toThrow(/public' or 'static/i);
  });
});
