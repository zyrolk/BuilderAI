import { describe, expect, it } from 'vitest';

import { UpdatePreservationAnalysisService } from '../services/update-preservation-analysis.service';
import { countLogicalLines, splitLogicalLines } from '../validators/text-line-normalization';
import {
  buildGoldenAccessibilityHtml,
  loadSmokeAtelierGoldenBaseline,
} from './fixtures/smoke-atelier-golden-fixture';

const BASELINE = loadSmokeAtelierGoldenBaseline();

function classifyLineChanges(baseline: string, proposed: string) {
  const baselineLines = [...splitLogicalLines(baseline)];
  const proposedLines = [...splitLogicalLines(proposed)];

  const max = Math.max(baselineLines.length, proposedLines.length);
  const changes: Array<{
    line: number;
    classification: string;
    baseline: string;
    proposed: string;
    reason: string;
  }> = [];

  for (let index = 0; index < max; index += 1) {
    const before = baselineLines[index];
    const after = proposedLines[index];
    if (before === after) continue;
    if (before === undefined) {
      changes.push({
        line: index + 1,
        classification: 'UNNECESSARY_STRUCTURAL',
        baseline: '',
        proposed: after ?? '',
        reason: 'Line added in proposal',
      });
      continue;
    }
    if (after === undefined) {
      changes.push({
        line: index + 1,
        classification: 'UNNECESSARY_STRUCTURAL',
        baseline: before,
        proposed: '',
        reason: 'Line removed in proposal',
      });
      continue;
    }

    let classification = 'UNNECESSARY_TEXTUAL';
    let reason = 'Line text differs';

    if (before.trim() === after.trim() && before !== after) {
      classification = 'UNNECESSARY_FORMATTING';
      reason = 'Whitespace or formatting-only delta';
    } else if (after.includes(before) || before.includes(after)) {
      classification = 'REQUIRED_CHANGE';
      reason = 'Attribute-only extension on same line';
    } else {
      classification = 'SEMANTICALLY_IDENTICAL_REWRITE';
      reason = 'Line rewritten without clear attribute-only delta';
    }

    changes.push({ line: index + 1, classification, baseline: before, proposed: after, reason });
  }

  return changes;
}

describe('ADR-031 Slice 4b golden churn boundary (diagnostic)', () => {
  const service = new UpdatePreservationAnalysisService();
  const golden = buildGoldenAccessibilityHtml(BASELINE);

  it('golden patch touches exactly 8 lines with attribute-only extensions', () => {
    const changes = classifyLineChanges(BASELINE, golden);
    expect(changes).toHaveLength(8);
    expect(
      changes.every(({ classification }) =>
        ['REQUIRED_CHANGE', 'SEMANTICALLY_IDENTICAL_REWRITE'].includes(classification),
      ),
    ).toBe(true);
  });

  it('ADR-030 LCS churn for minimal golden patch equals 0.4444 on 36-line baseline', async () => {
    expect(countLogicalLines(BASELINE)).toBe(36);

    const analysis = await service.analyze({
      logicalPath: 'index.html',
      baselineContent: BASELINE,
      proposedContent: golden,
    });

    expect(analysis.linesUnchanged).toBe(28);
    expect(analysis.linesAdded).toBe(8);
    expect(analysis.linesDeleted).toBe(8);
    expect(analysis.churnRatio).toBe(0.4444);
    expect(analysis.similarityRatio).toBe(0.7778);
  });

  it('documents that 8 required line edits cannot score GOOD under current metric', () => {
    const minimumChangedLines = 8;
    const baselineLineCount = countLogicalLines(BASELINE);
    const theoreticalMinimumChurn =
      Math.round(((minimumChangedLines * 2) / baselineLineCount) * 10_000) / 10_000;
    expect(theoreticalMinimumChurn).toBe(0.4444);
    expect(theoreticalMinimumChurn).toBeGreaterThanOrEqual(0.4);
  });
});

describe('ADR-031 Slice 4b provider plateau line classification (reconstructed)', () => {
  it('maps live 8+8 line metrics to required attribute-only edits, not formatting excess', () => {
    const golden = buildGoldenAccessibilityHtml(BASELINE);
    const service = new UpdatePreservationAnalysisService();

    return service
      .analyze({
        logicalPath: 'index.html',
        baselineContent: BASELINE,
        proposedContent: golden,
      })
      .then((analysis) => {
        expect(analysis.churnRatio).toBe(0.4444);
        const changes = classifyLineChanges(BASELINE, golden);
        const formatting = changes.filter((c) => c.classification === 'UNNECESSARY_FORMATTING');
        const structural = changes.filter((c) => c.classification === 'UNNECESSARY_STRUCTURAL');
        expect(formatting).toHaveLength(0);
        expect(structural).toHaveLength(0);
      });
  });
});
