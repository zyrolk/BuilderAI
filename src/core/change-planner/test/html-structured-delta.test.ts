import { describe, expect, it } from 'vitest';

import { DEFAULT_PRESERVATION_CONFIGURATION } from '../config';
import { HtmlStructuredDeltaService } from '../services/html-structured-delta.service';
import { UpdatePreservationAnalysisService } from '../services/update-preservation-analysis.service';
import {
  buildGoldenAccessibilityHtml,
  loadSmokeAtelierGoldenBaseline,
} from './fixtures/smoke-atelier-golden-fixture';

const BASELINE = loadSmokeAtelierGoldenBaseline();

const structuredService = new HtmlStructuredDeltaService();
const preservationService = new UpdatePreservationAnalysisService();

function analyzeStructured(baseline: string, proposed: string, churnRatio = 0) {
  return structuredService.analyze({
    baselineContent: baseline,
    proposedContent: proposed,
    churnRatio,
    elevatedChurnThreshold: DEFAULT_PRESERVATION_CONFIGURATION.elevatedChurnThreshold,
    configuration: DEFAULT_PRESERVATION_CONFIGURATION.structuredHtml,
  });
}

describe('HtmlStructuredDeltaService golden fixtures (ADR-032 Slice 1)', () => {
  it('Fixture 1: golden accessibility patch reports attribute-only structured delta', () => {
    const golden = buildGoldenAccessibilityHtml(BASELINE);
    const structured = analyzeStructured(BASELINE, golden, 0.4444);

    expect(structured.parseStatus).toBe('SUCCESS');
    expect(structured.attributeChanges).toBe(8);
    expect(structured.textChanges).toBe(0);
    expect(structured.structuralChanges).toBe(0);
    expect(structured.formattingOnlyEvidence).toBe(false);
    expect(structured.preservedStableIdCount).toBe(6);
    expect(structured.removedStableIdCount).toBe(0);
    expect(structured.elementCountBaseline).toBe(structured.elementCountProposed);
  });

  it('Fixture 2: single aria-live addition reports one attribute change', () => {
    const proposed = BASELINE.replace(
      '<span id="counter-value">0</span>',
      '<span id="counter-value" aria-live="polite">0</span>',
    );
    const structured = analyzeStructured(BASELINE, proposed);

    expect(structured.parseStatus).toBe('SUCCESS');
    expect(structured.attributeChanges).toBe(1);
    expect(structured.textChanges).toBe(0);
    expect(structured.structuralChanges).toBe(0);
  });

  it('Fixture 3: stable ID rename reports removed stable id and structural change', () => {
    const proposed = BASELINE.replace('id="increment-counter"', 'id="increment-counter-v2"');
    const structured = analyzeStructured(BASELINE, proposed);

    expect(structured.parseStatus).toBe('SUCCESS');
    expect(structured.removedStableIdCount).toBe(1);
    expect(structured.structuralChanges).toBeGreaterThan(0);
  });

  it('Fixture 4: aria-label removal reports attribute change on matched button', () => {
    const proposed = BASELINE.replace(' aria-label="Increment counter"', '');
    const structured = analyzeStructured(BASELINE, proposed);

    expect(structured.parseStatus).toBe('SUCCESS');
    expect(structured.attributeChanges).toBeGreaterThan(0);
  });

  it('Fixture 5: text rewrite only reports text changes without structural delta', () => {
    const proposed = BASELINE.replace('Interactive Counter', 'Live Counter Dashboard');
    const structured = analyzeStructured(BASELINE, proposed);

    expect(structured.parseStatus).toBe('SUCCESS');
    expect(structured.textChanges).toBeGreaterThan(0);
    expect(structured.structuralChanges).toBe(0);
  });

  it('Fixture 6: formatting-only rewrite reports formatting evidence at elevated churn', () => {
    const proposed = BASELINE.replace(/>\s+</g, '><').replace(/></g, '>\n<');
    const structured = analyzeStructured(BASELINE, proposed, 0.5);

    expect(structured.parseStatus).toBe('SUCCESS');
    expect(structured.attributeChanges).toBe(0);
    expect(structured.textChanges).toBe(0);
    expect(structured.structuralChanges).toBe(0);
    expect(structured.formattingOnlyEvidence).toBe(true);
  });

  it('Fixture 7: structural redesign reports structural changes', () => {
    const proposed = BASELINE.replace(
      '<main>',
      '<main><div class="layout"><div class="primary">',
    ).replace('</main>', '</div></div></main>');
    const structured = analyzeStructured(BASELINE, proposed);

    expect(structured.parseStatus).toBe('SUCCESS');
    expect(structured.structuralChanges).toBeGreaterThan(0);
  });

  it('Fixture 8: full HTML rewrite reports structural changes', () => {
    const proposed = `<!DOCTYPE html>
<html lang="en"><head><title>Rewritten</title></head>
<body><div id="counter-value">0</div></body></html>`;
    const structured = analyzeStructured(BASELINE, proposed);

    expect(structured.parseStatus).toBe('SUCCESS');
    expect(structured.structuralChanges).toBeGreaterThan(0);
  });

  it('Fixture 12: binary content falls back safely', () => {
    const structured = analyzeStructured('before\u0000after', '<html></html>');

    expect(structured.parseStatus).toBe('FALLBACK');
    expect(structured.fallbackReason).toBe('PARSE_ERROR');
    expect(structured.attributeChanges).toBe(0);
  });
});

describe('UpdatePreservationAnalysisService structured metadata integration', () => {
  it('Fixture 9: JS surgical edit omits structuredAnalysis', async () => {
    const baseline = 'const value = 1;\n';
    const proposed = 'const value = 2;\n';
    const result = await preservationService.analyze({
      logicalPath: 'assets/app.js',
      baselineContent: baseline,
      proposedContent: proposed,
    });

    expect(result.structuredAnalysis).toBeUndefined();
    expect(result.churnRatio).toBeGreaterThan(0);
  });

  it('Fixture 10: CSS surgical edit omits structuredAnalysis', async () => {
    const baseline = '.counter { color: red; }\n';
    const proposed = '.counter { color: blue; }\n';
    const result = await preservationService.analyze({
      logicalPath: 'assets/styles.css',
      baselineContent: baseline,
      proposedContent: proposed,
    });

    expect(result.structuredAnalysis).toBeUndefined();
  });

  it('Fixture 11: CREATE_FILE paths are out of scope for preservation analysis', async () => {
    const result = await preservationService.analyze({
      logicalPath: 'new.html',
      baselineContent: '',
      proposedContent: '<html></html>',
    });

    expect(result.structuredAnalysis?.kind).toBe('HTML');
  });

  it('Fixture 1: golden patch keeps ADR-030 churn and elevated finding inputs unchanged', async () => {
    const golden = buildGoldenAccessibilityHtml(BASELINE);
    const result = await preservationService.analyze({
      logicalPath: 'index.html',
      baselineContent: BASELINE,
      proposedContent: golden,
    });

    expect(result.churnRatio).toBe(0.4444);
    expect(result.similarityRatio).toBe(0.7778);
    expect(result.structuredAnalysis).toEqual(
      expect.objectContaining({
        kind: 'HTML',
        parseStatus: 'SUCCESS',
        attributeChanges: 8,
        textChanges: 0,
        structuralChanges: 0,
      }),
    );
  });

  it('includes structuredAnalysis for .htm paths', async () => {
    const result = await preservationService.analyze({
      logicalPath: 'legacy/page.htm',
      baselineContent: '<html><body><p id="x">A</p></body></html>',
      proposedContent: '<html><body><p id="x">B</p></body></html>',
    });

    expect(result.structuredAnalysis?.parseStatus).toBe('SUCCESS');
    expect(result.structuredAnalysis?.textChanges).toBe(1);
  });
});

describe('HtmlStructuredDeltaService resource limits', () => {
  it('returns BASELINE_TOO_LARGE when baseline exceeds configured byte limit', () => {
    const structured = structuredService.analyze({
      baselineContent: 'x'.repeat(32),
      proposedContent: '<html></html>',
      churnRatio: 0,
      elevatedChurnThreshold: 0.4,
      configuration: {
        ...DEFAULT_PRESERVATION_CONFIGURATION.structuredHtml,
        maximumBaselineBytes: 8,
      },
    });

    expect(structured.parseStatus).toBe('FALLBACK');
    expect(structured.fallbackReason).toBe('BASELINE_TOO_LARGE');
  });
});
