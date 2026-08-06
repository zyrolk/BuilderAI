import { describe, expect, it } from 'vitest';

import { DEFAULT_PRESERVATION_CONFIGURATION } from '../config';
import { HtmlStructuredDeltaService } from '../services/html-structured-delta.service';
import { SurgicalityClassifierService } from '../services/surgicality-classifier.service';
import { UpdatePreservationAnalysisService } from '../services/update-preservation-analysis.service';
import {
  countLogicalLines,
  normalizeLineEndings,
  splitLogicalLines,
} from '../validators/text-line-normalization';
import {
  buildGoldenAccessibilityHtml,
  loadSmokeAtelierGoldenBaseline,
} from './fixtures/smoke-atelier-golden-fixture';

describe('text line normalization (CP9.1)', () => {
  const service = new UpdatePreservationAnalysisService();
  const structuredService = new HtmlStructuredDeltaService();
  const classifier = new SurgicalityClassifierService();

  const lfSample = ['alpha', 'beta', 'gamma'].join('\n');
  const crlfSample = lfSample.replace(/\n/g, '\r\n');

  function classifyGolden(baseline: string, proposed: string, churnRatio: number) {
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
      removedHtmlIds: [],
      removedAccessibilityAttributes: [],
      crossFileReferenceRisks: [],
      largeDeletionSuspicious: false,
      preservationConfiguration: DEFAULT_PRESERVATION_CONFIGURATION,
    });
  }

  it('scenario 1: LF and CRLF produce identical line counts', () => {
    expect(countLogicalLines(lfSample)).toBe(3);
    expect(countLogicalLines(crlfSample)).toBe(3);
    expect(countLogicalLines('')).toBe(0);
    expect(splitLogicalLines('')).toEqual([]);
    expect(splitLogicalLines(normalizeLineEndings(lfSample))).toEqual(
      splitLogicalLines(normalizeLineEndings(crlfSample)),
    );
  });

  it('scenario 2: LF and CRLF produce identical churn for the same UPDATE delta', () => {
    const baselineLf = `${lfSample}\n`;
    const proposedLf = ['alpha', 'beta-updated', 'gamma'].join('\n');
    const baselineCrlf = baselineLf.replace(/\n/g, '\r\n');
    const proposedCrlf = proposedLf.replace(/\n/g, '\r\n');

    return Promise.all([
      service.analyze({
        logicalPath: 'sample.txt',
        baselineContent: baselineLf,
        proposedContent: proposedLf,
      }),
      service.analyze({
        logicalPath: 'sample.txt',
        baselineContent: baselineCrlf,
        proposedContent: proposedCrlf,
      }),
    ]).then(([lfResult, crlfResult]) => {
      expect(crlfResult.churnRatio).toBe(lfResult.churnRatio);
      expect(crlfResult.baselineLines).toBe(lfResult.baselineLines);
      expect(crlfResult.linesAdded).toBe(lfResult.linesAdded);
      expect(crlfResult.linesDeleted).toBe(lfResult.linesDeleted);
    });
  });

  it('scenario 3: LF and CRLF produce identical preservation/surgicality for golden patch', async () => {
    const baseline = loadSmokeAtelierGoldenBaseline();
    const golden = buildGoldenAccessibilityHtml(baseline);
    const baselineCrlf = baseline.replace(/\n/g, '\r\n');
    const goldenCrlf = golden.replace(/\n/g, '\r\n');

    const [lfAnalysis, crlfAnalysis] = await Promise.all([
      service.analyze({
        logicalPath: 'index.html',
        baselineContent: baseline,
        proposedContent: golden,
      }),
      service.analyze({
        logicalPath: 'index.html',
        baselineContent: baselineCrlf,
        proposedContent: goldenCrlf,
      }),
    ]);

    expect(crlfAnalysis.churnRatio).toBe(lfAnalysis.churnRatio);
    expect(crlfAnalysis.baselineLines).toBe(lfAnalysis.baselineLines);
    expect(crlfAnalysis.structuredAnalysis).toEqual(lfAnalysis.structuredAnalysis);

    const lfSurgicality = classifyGolden(baseline, golden, lfAnalysis.churnRatio);
    const crlfSurgicality = classifyGolden(baselineCrlf, goldenCrlf, crlfAnalysis.churnRatio);
    expect(crlfSurgicality).toEqual(lfSurgicality);
  });

  it('scenario 4: trailing newline does not add an extra logical line', () => {
    const withoutTrailing = 'line one\nline two';
    const withTrailing = `${withoutTrailing}\n`;
    const withCrlfTrailing = `${withoutTrailing}\r\n`;

    expect(countLogicalLines(withoutTrailing)).toBe(2);
    expect(countLogicalLines(withTrailing)).toBe(2);
    expect(countLogicalLines(withCrlfTrailing)).toBe(2);
  });

  it('normalizes classic carriage-return-only line endings', () => {
    const classic = 'line one\rline two\r';
    expect(countLogicalLines(normalizeLineEndings(classic))).toBe(2);
    expect(normalizeLineEndings(classic)).toBe('line one\nline two\n');
  });

  it('scenario 5: a real extra logical line increases churn as expected', async () => {
    const baseline = loadSmokeAtelierGoldenBaseline();
    const golden = buildGoldenAccessibilityHtml(baseline);
    const baselineWithExtraLine = baseline.replace('<body>', '<body>\n  <!-- extra marker -->');

    const [canonical, extraLine] = await Promise.all([
      service.analyze({
        logicalPath: 'index.html',
        baselineContent: baseline,
        proposedContent: golden,
      }),
      service.analyze({
        logicalPath: 'index.html',
        baselineContent: baselineWithExtraLine,
        proposedContent: golden,
      }),
    ]);

    expect(extraLine.baselineLines).toBe(canonical.baselineLines + 1);
    expect(extraLine.churnRatio).toBeGreaterThan(canonical.churnRatio);
  });
});
