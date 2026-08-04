import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_PRESERVATION_CONFIGURATION } from '../config';
import { createOperationId } from '../services/operation-ordering.service';
import { ChangePreservationService } from '../services/change-preservation.service';
import { HtmlStructuredDeltaService } from '../services/html-structured-delta.service';
import { SurgicalityClassifierService } from '../services/surgicality-classifier.service';
import type { HtmlStructuredAnalysis } from '../types/html-structured-analysis';
import type { SurgicalityClassifierInput } from '../services/surgicality-classifier.service';

const BASELINE = readFileSync(
  path.resolve('D:/projects2/smoke-atelier/index.html'),
  'utf8',
).replace(/\r\n?/g, '\n');

function buildGoldenAccessibilityHtml(baseline: string): string {
  return baseline
    .replace(
      '<section class="counter-section">',
      '<section class="counter-section" aria-labelledby="counter-heading">',
    )
    .replace('<h2>Interactive Counter</h2>', '<h2 id="counter-heading">Interactive Counter</h2>')
    .replace(
      '<span id="counter-value">0</span>',
      '<span id="counter-value" aria-live="polite">0</span>',
    )
    .replace(
      '<button id="increment-counter" aria-label="Increment counter">Increment</button>',
      '<button id="increment-counter" type="button" aria-label="Increment counter">Increment</button>',
    )
    .replace(
      '<button id="reset-counter" aria-label="Reset counter to zero">Reset</button>',
      '<button id="reset-counter" type="button" aria-label="Reset counter to zero">Reset</button>',
    )
    .replace(
      '<section class="quote-section">',
      '<section class="quote-section" aria-labelledby="quote-heading">',
    )
    .replace('<h2>Inspirational Quote</h2>', '<h2 id="quote-heading">Inspirational Quote</h2>')
    .replace(
      '<button id="next-quote" aria-label="Show next quote">Next Quote</button>',
      '<button id="next-quote" type="button" aria-label="Show next quote">Next Quote</button>',
    );
}

const structuredService = new HtmlStructuredDeltaService();
const classifier = new SurgicalityClassifierService();

function classifyHtml(
  baseline: string,
  proposed: string,
  churnRatio: number,
  overrides: Partial<SurgicalityClassifierInput> = {},
) {
  const structuredAnalysis = structuredService.analyze({
    baselineContent: baseline,
    proposedContent: proposed,
    churnRatio,
    elevatedChurnThreshold: DEFAULT_PRESERVATION_CONFIGURATION.elevatedChurnThreshold,
    configuration: DEFAULT_PRESERVATION_CONFIGURATION.structuredHtml,
  });

  return classifier.classify({
    logicalPath: 'index.html',
    churnRatio,
    structuredAnalysis,
    removedHtmlIds: overrides.removedHtmlIds ?? [],
    removedAccessibilityAttributes: overrides.removedAccessibilityAttributes ?? [],
    crossFileReferenceRisks: overrides.crossFileReferenceRisks ?? [],
    largeDeletionSuspicious: overrides.largeDeletionSuspicious ?? false,
    preservationConfiguration: DEFAULT_PRESERVATION_CONFIGURATION,
  });
}

function classifyGeneric(churnRatio: number, overrides: Partial<SurgicalityClassifierInput> = {}) {
  return classifier.classify({
    logicalPath: overrides.logicalPath ?? 'assets/app.js',
    churnRatio,
    removedHtmlIds: overrides.removedHtmlIds ?? [],
    removedAccessibilityAttributes: overrides.removedAccessibilityAttributes ?? [],
    crossFileReferenceRisks: overrides.crossFileReferenceRisks ?? [],
    largeDeletionSuspicious: overrides.largeDeletionSuspicious ?? false,
    preservationConfiguration: DEFAULT_PRESERVATION_CONFIGURATION,
    structuredAnalysis: overrides.structuredAnalysis,
  });
}

describe('SurgicalityClassifierService (ADR-032 Slice 2)', () => {
  it('A. golden 8 attribute-only HTML patch => EXCELLENT / STRUCTURED_HTML at churn 0.4444', () => {
    const golden = buildGoldenAccessibilityHtml(BASELINE);
    const result = classifyHtml(BASELINE, golden, 0.4444);

    expect(result.classification).toBe('EXCELLENT');
    expect(result.basis).toBe('STRUCTURED_HTML');
    expect(result.reasons.join(' ')).toContain('attribute-only');
  });

  it('B. single aria-live attribute => EXCELLENT', () => {
    const proposed = BASELINE.replace(
      '<span id="counter-value">0</span>',
      '<span id="counter-value" aria-live="polite">0</span>',
    );
    const result = classifyHtml(BASELINE, proposed, 0.0556);
    expect(result.classification).toBe('EXCELLENT');
    expect(result.basis).toBe('STRUCTURED_HTML');
  });

  it('C. stable ID rename/removal => POOR', () => {
    const proposed = BASELINE.replace('id="increment-counter"', 'id="increment-counter-v2"');
    const result = classifyHtml(BASELINE, proposed, 0.1, {
      removedHtmlIds: ['increment-counter'],
    });
    expect(result.classification).toBe('POOR');
  });

  it('D. aria preservation violation => POOR', () => {
    const proposed = BASELINE.replace(' aria-label="Increment counter"', '');
    const result = classifyHtml(BASELINE, proposed, 0.05, {
      removedAccessibilityAttributes: ['aria-label'],
    });
    expect(result.classification).toBe('POOR');
    expect(result.reasons.join(' ')).toContain('accessibility');
  });

  it('E. small intentional text delta <=2 with no structure => GOOD', () => {
    const proposed = BASELINE.replace('Interactive Counter', 'Live Counter');
    const result = classifyHtml(BASELINE, proposed, 0.08);
    expect(result.classification).toBe('GOOD');
    expect(result.basis).toBe('STRUCTURED_HTML');
  });

  it('F. larger text rewrite => POOR', () => {
    const proposed = BASELINE.replaceAll('Interactive Counter', 'Dashboard')
      .replaceAll('Inspirational Quote', 'Daily Quote')
      .replaceAll('Atelier Local', 'Studio Local')
      .replace('Loading quote...', 'Fetching quote...');
    const result = classifyHtml(BASELINE, proposed, 0.35);
    expect(result.classification).toBe('POOR');
  });

  it('G. formatting-only HTML with elevated LCS churn => MARGINAL', () => {
    const proposed = BASELINE.replace(/>\s+</g, '><').replace(/></g, '>\n<');
    const result = classifyHtml(BASELINE, proposed, 0.5);
    expect(result.classification).toBe('MARGINAL');
    expect(result.basis).toBe('STRUCTURED_HTML');
  });

  it('H. structural redesign => POOR', () => {
    const proposed = BASELINE.replace(
      '<main>',
      '<main><div class="layout"><div class="primary">',
    ).replace('</main>', '</div></div></main>');
    const result = classifyHtml(BASELINE, proposed, 0.6);
    expect(result.classification).toBe('POOR');
  });

  it('I. full HTML rewrite => POOR', () => {
    const proposed = `<!DOCTYPE html><html><head><title>Rewritten</title></head><body><div id="counter-value">0</div></body></html>`;
    const result = classifyHtml(BASELINE, proposed, 0.95);
    expect(result.classification).toBe('POOR');
  });

  it('J. JS update => GENERIC_LINE_LCS', () => {
    const result = classifyGeneric(0.15, { logicalPath: 'assets/app.js' });
    expect(result.basis).toBe('GENERIC_LINE_LCS');
    expect(result.classification).toBe('EXCELLENT');
  });

  it('K. CSS update => GENERIC_LINE_LCS', () => {
    const result = classifyGeneric(0.35, { logicalPath: 'assets/styles.css' });
    expect(result.basis).toBe('GENERIC_LINE_LCS');
    expect(result.classification).toBe('GOOD');
  });

  it('L. HTML parser FALLBACK => GENERIC_LINE_LCS', () => {
    const fallbackAnalysis: HtmlStructuredAnalysis = {
      kind: 'HTML',
      parseStatus: 'FALLBACK',
      attributeChanges: 0,
      textChanges: 0,
      structuralChanges: 0,
      formattingOnlyEvidence: false,
      preservedStableIdCount: 0,
      removedStableIdCount: 0,
      elementCountBaseline: 0,
      elementCountProposed: 0,
      fallbackReason: 'PARSE_ERROR',
    };
    const result = classifyGeneric(0.4444, {
      logicalPath: 'index.html',
      structuredAnalysis: fallbackAnalysis,
    });
    expect(result.basis).toBe('GENERIC_LINE_LCS');
    expect(result.classification).toBe('MARGINAL');
  });
});

describe('ChangePreservationService surgicality integration', () => {
  it('attaches EXCELLENT surgicality for golden accessibility patch while retaining elevated churn finding', () => {
    const golden = buildGoldenAccessibilityHtml(BASELINE);
    const service = new ChangePreservationService({
      maximumOperations: 100,
      maximumMetadataEntries: 32,
      maximumMetadataStringCharacters: 2_000,
      broadChangeOperationThreshold: 20,
      preservation: DEFAULT_PRESERVATION_CONFIGURATION,
    });

    const baselinePort = {
      readTextBaseline: () => ({
        logicalPath: 'index.html',
        content: BASELINE,
        checksum: { algorithm: 'sha256', value: 'a'.repeat(64) },
        sizeBytes: BASELINE.length,
      }),
    };

    const result = service.enrichOperations(
      [
        {
          operationId: createOperationId('UPDATE_FILE', 'index.html'),
          kind: 'UPDATE_FILE',
          logicalPath: 'index.html',
          artifactType: 'SOURCE_FILE',
          description: 'Accessibility patch',
          sourceChecksum: { algorithm: 'sha256', value: 'b'.repeat(64) },
          sourceSizeBytes: golden.length,
          content: golden,
        },
      ],
      baselinePort,
    );

    const preservation =
      result.operations[0]?.kind === 'UPDATE_FILE' ? result.operations[0].preservation : undefined;
    expect(preservation?.churnRatio).toBe(0.4444);
    expect(preservation?.findings.some(({ code }) => code === 'PRESERVATION_ELEVATED_CHURN')).toBe(
      true,
    );
    expect(preservation?.surgicality).toEqual(
      expect.objectContaining({
        classification: 'EXCELLENT',
        basis: 'STRUCTURED_HTML',
      }),
    );
  });
});
