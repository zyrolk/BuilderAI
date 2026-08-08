import { describe, expect, it } from 'vitest';

import { extractSearchQueries } from './search-query-extraction';

describe('extractSearchQueries', () => {
  it('extracts single- and double-quoted fragments', () => {
    const queries = extractSearchQueries(
      `Investigate 'supplier sync' and "PRICE_CHANGED mismatch" in repository.`,
      12,
    );
    expect(queries).toContain('supplier sync');
    expect(queries).toContain('PRICE_CHANGED mismatch');
  });

  it('ignores quoted fragments that exceed the query length limit', () => {
    const longFragment = 'a'.repeat(121);
    const queries = extractSearchQueries(`Investigate '${longFragment}'`, 12);
    expect(queries).not.toContain(longFragment);
  });

  it('ignores short all-caps identifier tokens', () => {
    const queries = extractSearchQueries('API SKU supplierSyncSettings failed', 12);
    expect(queries).not.toContain('API');
    expect(queries).not.toContain('SKU');
    expect(queries.some((query) => query.includes('supplierSyncSettings'))).toBe(true);
  });

  it('limits the number of extracted search queries', () => {
    const queries = extractSearchQueries(
      'supplierSyncSettings PRICE_CHANGED CostPrice supplierHub supplierReview supplierOrders supplierMetadata',
      3,
    );
    expect(queries).toHaveLength(3);
  });
});
