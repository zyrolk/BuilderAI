import { parseExtraSourceScanRoots } from './project-source-index-policy';

describe('parseExtraSourceScanRoots', () => {
  it('returns an empty list when unset or blank', () => {
    expect(parseExtraSourceScanRoots(undefined)).toEqual([]);
    expect(parseExtraSourceScanRoots('   ')).toEqual([]);
  });

  it('parses safe relative roots and deduplicates them', () => {
    expect(parseExtraSourceScanRoots('custom-root, ./features , custom-root')).toEqual([
      'custom-root',
      'features',
    ]);
  });

  it('rejects traversal and absolute paths', () => {
    expect(() => parseExtraSourceScanRoots('../outside')).toThrow('safe repository-relative');
    expect(() => parseExtraSourceScanRoots('/abs/root')).toThrow('safe repository-relative');
  });

  it('rejects blocked roots such as public and docs', () => {
    expect(() => parseExtraSourceScanRoots('public')).toThrow("blocked root 'public'");
    expect(() => parseExtraSourceScanRoots('docs')).toThrow("blocked root 'docs'");
  });

  it('ignores roots that are already part of the default scan policy', () => {
    expect(parseExtraSourceScanRoots('src,app')).toEqual([]);
  });
});
