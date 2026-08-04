import { describe, expect, it } from 'vitest';

import {
  referencesRemovedHtmlId,
  UpdatePreservationAnalysisService,
} from '../services/update-preservation-analysis.service';

const service = new UpdatePreservationAnalysisService();

const smokeBaselineHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Counter</title>
  <link rel="stylesheet" href="assets/styles.css" />
</head>
<body>
  <main id="app-root" aria-labelledby="counter-heading">
    <h1 id="counter-heading">Counter</h1>
    <p id="counter-value" aria-live="polite">0</p>
    <button id="increment-counter" type="button" aria-label="Increment counter">+1</button>
    <button id="reset-counter" type="button" aria-label="Reset counter">Reset</button>
  </main>
  <script src="assets/app.js"></script>
</body>
</html>
`;

const smokeDestructiveProposalHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Counter App</title>
  <link rel="stylesheet" href="assets/styles.css" />
</head>
<body>
  <div id="container">
    <h1>Counter App</h1>
    <span id="count-display">0</span>
    <button id="increment-btn">Increment</button>
  </div>
  <script src="assets/app.js"></script>
</body>
</html>
`;

const smokeSiblingJs = `const valueEl = document.getElementById('counter-value');
const incrementButton = document.getElementById('increment-counter');
const resetButton = document.getElementById('reset-counter');
`;

describe('UpdatePreservationAnalysisService', () => {
  it('reports zero churn for identical baseline and proposal', async () => {
    const content = 'line one\nline two\n';
    const result = await service.analyze({
      logicalPath: 'src/example.ts',
      baselineContent: content,
      proposedContent: content,
    });

    expect(result.linesAdded).toBe(0);
    expect(result.linesDeleted).toBe(0);
    expect(result.linesUnchanged).toBe(2);
    expect(result.churnRatio).toBe(0);
    expect(result.similarityRatio).toBe(1);
  });

  it('reports low churn for a small surgical update', async () => {
    const baseline = Array.from({ length: 10 }, (_, index) => `line-${index}`).join('\n');
    const proposed = baseline
      .split('\n')
      .map((line, index) => (index === 4 ? 'line-4-updated' : line))
      .join('\n');
    const result = await service.analyze({
      logicalPath: 'src/example.ts',
      baselineContent: baseline,
      proposedContent: proposed,
    });

    expect(result.churnRatio).toBeLessThan(0.4);
    expect(result.linesAdded).toBe(1);
    expect(result.linesDeleted).toBe(1);
  });

  it('reports elevated churn for a moderate update', async () => {
    const baseline = Array.from({ length: 20 }, (_, index) => `line-${index}`).join('\n');
    const proposed = baseline
      .split('\n')
      .map((line, index) => (index >= 8 && index <= 12 ? `${line}-updated` : line))
      .join('\n');
    const result = await service.analyze({
      logicalPath: 'src/example.ts',
      baselineContent: baseline,
      proposedContent: proposed,
    });

    expect(result.churnRatio).toBeGreaterThanOrEqual(0.4);
    expect(result.churnRatio).toBeLessThan(0.7);
  });

  it('reports high churn for a near-full rewrite', async () => {
    const baseline = ['old-1', 'old-2', 'old-3', 'old-4', 'old-5', 'old-6', 'old-7', 'old-8'].join(
      '\n',
    );
    const proposed = ['new-1', 'new-2', 'new-3', 'new-4', 'new-5', 'new-6', 'new-7', 'old-8'].join(
      '\n',
    );
    const result = await service.analyze({
      logicalPath: 'src/example.ts',
      baselineContent: baseline,
      proposedContent: proposed,
    });

    expect(result.churnRatio).toBeGreaterThanOrEqual(0.7);
    expect(result.similarityRatio).toBeLessThan(0.3);
  });

  it('computes a deterministic baseline checksum', async () => {
    const content = 'stable baseline\n';
    const first = await service.analyze({
      logicalPath: 'src/example.ts',
      baselineContent: content,
      proposedContent: content,
    });
    const second = await service.analyze({
      logicalPath: 'src/example.ts',
      baselineContent: content,
      proposedContent: content,
    });

    expect(first.baselineContentChecksum).toEqual(second.baselineContentChecksum);
    expect(first.baselineContentChecksum.algorithm).toBe('sha256');
    expect(first.baselineContentChecksum.value).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns deterministic metrics across repeated runs', async () => {
    const input = {
      logicalPath: 'index.html',
      baselineContent: smokeBaselineHtml,
      proposedContent: smokeDestructiveProposalHtml,
      siblingJsContents: [{ logicalPath: 'assets/app.js', content: smokeSiblingJs }],
    };
    const first = await service.analyze(input);
    const second = await service.analyze(input);

    expect(second).toEqual(first);
  });

  it('detects removed HTML ids', async () => {
    const result = await service.analyze({
      logicalPath: 'index.html',
      baselineContent: smokeBaselineHtml,
      proposedContent: smokeDestructiveProposalHtml,
    });

    expect(result.removedHtmlIds).toEqual(
      expect.arrayContaining(['app-root', 'counter-heading', 'counter-value', 'increment-counter']),
    );
  });

  it('detects added HTML ids', async () => {
    const result = await service.analyze({
      logicalPath: 'index.html',
      baselineContent: smokeBaselineHtml,
      proposedContent: smokeDestructiveProposalHtml,
    });

    expect(result.addedHtmlIds).toEqual(
      expect.arrayContaining(['container', 'count-display', 'increment-btn']),
    );
  });

  it('detects removed aria attributes', async () => {
    const result = await service.analyze({
      logicalPath: 'index.html',
      baselineContent: smokeBaselineHtml,
      proposedContent: smokeDestructiveProposalHtml,
    });

    expect(result.removedAccessibilityAttributes).toEqual(
      expect.arrayContaining(['aria-labelledby', 'aria-live', 'aria-label']),
    );
  });

  it('handles multiple HTML ids deterministically', async () => {
    const baseline = '<div id="b"></div><div id="a"></div>';
    const proposed = '<div id="c"></div>';
    const result = await service.analyze({
      logicalPath: 'index.html',
      baselineContent: baseline,
      proposedContent: proposed,
    });

    expect(result.removedHtmlIds).toEqual(['a', 'b']);
    expect(result.addedHtmlIds).toEqual(['c']);
  });

  it('calculates line additions and deletions correctly', async () => {
    const result = await service.analyze({
      logicalPath: 'src/example.ts',
      baselineContent: 'one\n two\n three\n',
      proposedContent: 'one\n two updated\n four\n',
    });

    expect(result.linesAdded).toBe(2);
    expect(result.linesDeleted).toBe(2);
    expect(result.linesUnchanged).toBe(1);
  });

  it('handles empty baseline and proposed edge cases', async () => {
    const emptyBoth = await service.analyze({
      logicalPath: 'src/example.ts',
      baselineContent: '',
      proposedContent: '',
    });
    expect(emptyBoth.baselineLines).toBe(0);
    expect(emptyBoth.proposedLines).toBe(0);
    expect(emptyBoth.churnRatio).toBe(0);

    const emptyToContent = await service.analyze({
      logicalPath: 'src/example.ts',
      baselineContent: '',
      proposedContent: 'new line\n',
    });
    expect(emptyToContent.linesAdded).toBe(1);
    expect(emptyToContent.linesDeleted).toBe(0);
  });

  it('normalizes CRLF line endings before analysis', async () => {
    const crlf = 'line one\r\nline two\r\n';
    const lf = 'line one\nline two\n';
    const crlfResult = await service.analyze({
      logicalPath: 'src/example.ts',
      baselineContent: crlf,
      proposedContent: crlf,
    });
    const lfResult = await service.analyze({
      logicalPath: 'src/example.ts',
      baselineContent: lf,
      proposedContent: lf,
    });

    expect(crlfResult).toEqual(lfResult);
  });

  it('marks suspicious large deletions when most lines are removed with few replacements', async () => {
    const baseline = Array.from({ length: 10 }, (_, index) => `line-${index}`).join('\n');
    const proposed = '';
    const result = await service.analyze({
      logicalPath: 'src/example.ts',
      baselineContent: baseline,
      proposedContent: proposed,
    });

    expect(result.largeDeletionSignal.isSuspicious).toBe(true);
    expect(result.largeDeletionSignal.linesDeletedRatio).toBeGreaterThanOrEqual(0.5);
    expect(result.largeDeletionSignal.linesAddedRatio).toBeLessThan(0.1);
  });

  it('flags Smoke #2-style destructive HTML rewrite with high churn and removed ids', async () => {
    const result = await service.analyze({
      logicalPath: 'index.html',
      baselineContent: smokeBaselineHtml,
      proposedContent: smokeDestructiveProposalHtml,
      siblingJsContents: [{ logicalPath: 'assets/app.js', content: smokeSiblingJs }],
    });

    expect(result.churnRatio).toBeGreaterThanOrEqual(0.7);
    expect(result.removedHtmlIds.length).toBeGreaterThan(0);
    expect(result.crossFileReferenceRisks.length).toBeGreaterThan(0);
    expect(result.largeDeletionSignal.linesDeletedRatio).toBeGreaterThan(0);
  });
});

describe('referencesRemovedHtmlId', () => {
  it('detects literal getElementById references', () => {
    expect(
      referencesRemovedHtmlId("document.getElementById('counter-value');", 'counter-value'),
    ).toBe(true);
    expect(
      referencesRemovedHtmlId('document.getElementById("counter-value");', 'counter-value'),
    ).toBe(true);
  });

  it('detects literal querySelector references', () => {
    expect(
      referencesRemovedHtmlId("document.querySelector('#counter-value');", 'counter-value'),
    ).toBe(true);
    expect(
      referencesRemovedHtmlId('document.querySelector("#counter-value");', 'counter-value'),
    ).toBe(true);
  });

  it('does not overclaim unrelated dynamic expressions', () => {
    const dynamic = "document.getElementById(prefix + '-counter');";
    expect(referencesRemovedHtmlId(dynamic, 'counter-value')).toBe(false);
    expect(referencesRemovedHtmlId('document.querySelector(`#${id}`);', 'counter-value')).toBe(
      false,
    );
  });
});

describe('UpdatePreservationAnalysisService cross-file risks', () => {
  it('reports cross-file risks when sibling JS still references removed ids', async () => {
    const result = await service.analyze({
      logicalPath: 'index.html',
      baselineContent: smokeBaselineHtml,
      proposedContent: smokeDestructiveProposalHtml,
      siblingJsContents: [{ logicalPath: 'assets/app.js', content: smokeSiblingJs }],
    });

    expect(result.crossFileReferenceRisks).toEqual(
      expect.arrayContaining([
        { removedId: 'counter-value', referencingLogicalPath: 'assets/app.js' },
        { removedId: 'increment-counter', referencingLogicalPath: 'assets/app.js' },
      ]),
    );
  });
});
