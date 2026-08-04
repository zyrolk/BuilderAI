import { describe, expect, it } from 'vitest';

import {
  deduplicatePreservationInvariants,
  extractPreservationInvariants,
} from '../internal/baseline-invariant-extraction';

describe('baseline invariant extraction', () => {
  it('extracts HTML DOM ids, aria attributes, and references', () => {
    const html = `<!doctype html>
<html lang="en">
  <head>
    <link rel="stylesheet" href="assets/styles.css">
  </head>
  <body>
    <button id="counter-button" aria-label="Counter">0</button>
    <script src="assets/app.js"></script>
  </body>
</html>`;

    const invariants = extractPreservationInvariants('index.html', html);
    expect(invariants.find(({ kind }) => kind === 'DOM_ID')?.values).toContain('counter-button');
    expect(invariants.find(({ kind }) => kind === 'ARIA_ATTRIBUTE')?.values).toContain(
      'aria-label',
    );
    expect(invariants.find(({ kind }) => kind === 'SCRIPT_REFERENCE')?.values).toContain(
      'assets/app.js',
    );
    expect(invariants.find(({ kind }) => kind === 'STYLESHEET_REFERENCE')?.values).toContain(
      'assets/styles.css',
    );
  });

  it('extracts JS DOM references and localStorage keys', () => {
    const js = `
const button = document.getElementById('counter-button');
const value = localStorage.getItem('atelier_counter');
localStorage.setItem('atelier_counter', String(next));
document.querySelector('#counter-button');
`;

    const invariants = extractPreservationInvariants('assets/app.js', js);
    expect(invariants.find(({ kind }) => kind === 'LITERAL_DOM_REFERENCE')?.values).toContain(
      'counter-button',
    );
    expect(invariants.find(({ kind }) => kind === 'LOCAL_STORAGE_KEY')?.values).toContain(
      'atelier_counter',
    );
  });

  it('deduplicates and sorts invariants deterministically', () => {
    const invariants = deduplicatePreservationInvariants([
      {
        kind: 'DOM_ID',
        logicalPath: 'index.html',
        values: ['b', 'a'],
      },
      {
        kind: 'DOM_ID',
        logicalPath: 'index.html',
        values: ['b', 'a'],
      },
    ]);

    expect(invariants).toHaveLength(1);
    expect(invariants[0]?.values).toEqual(['a', 'b']);
  });
});
