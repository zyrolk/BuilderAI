import type { ArtifactChecksumPort } from '../../response-processor/ports';
import { Sha256ChecksumService } from '../../response-processor/services/sha256-checksum.service';
import type { ArtifactChecksum } from '../../response-processor';
import {
  DEFAULT_PRESERVATION_CONFIGURATION,
  DEFAULT_STRUCTURED_HTML_ANALYSIS_CONFIGURATION,
} from '../config/change-planner-configuration';
import type {
  CrossFileReferenceRisk,
  LargeDeletionSignal,
  UpdatePreservationAnalysisInput,
  UpdatePreservationAnalysisResult,
} from '../types/update-preservation-analysis';
import type { HtmlStructuredAnalysis } from '../types/html-structured-analysis';
import { compareText, utf8Size } from '../validators/validation-helpers';
import { HtmlStructuredDeltaService, isHtmlLogicalPath } from './html-structured-delta.service';

const HTML_ID_PATTERN = /\bid\s*=\s*["']([^"']+)["']/gi;
const ARIA_ATTRIBUTE_PATTERN = /\baria-[a-zA-Z0-9-]+\b/g;

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

function roundRatio(value: number): number {
  return Math.min(1, Math.max(0, Math.round(value * 10_000) / 10_000));
}

function splitLines(content: string): readonly string[] {
  if (content.length === 0) return [];
  const lines = content.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function lcsLineCounts(
  baselineLines: readonly string[],
  proposedLines: readonly string[],
): { readonly linesUnchanged: number } {
  const baselineCount = baselineLines.length;
  const proposedCount = proposedLines.length;
  if (baselineCount === 0 || proposedCount === 0) {
    return { linesUnchanged: 0 };
  }

  const table = Array.from({ length: baselineCount + 1 }, () =>
    new Array<number>(proposedCount + 1).fill(0),
  );

  for (let baselineIndex = 1; baselineIndex <= baselineCount; baselineIndex += 1) {
    for (let proposedIndex = 1; proposedIndex <= proposedCount; proposedIndex += 1) {
      if (baselineLines[baselineIndex - 1] === proposedLines[proposedIndex - 1]) {
        table[baselineIndex]![proposedIndex] =
          (table[baselineIndex - 1]![proposedIndex - 1] ?? 0) + 1;
      } else {
        table[baselineIndex]![proposedIndex] = Math.max(
          table[baselineIndex - 1]![proposedIndex] ?? 0,
          table[baselineIndex]![proposedIndex - 1] ?? 0,
        );
      }
    }
  }

  return { linesUnchanged: table[baselineCount]![proposedCount] ?? 0 };
}

function computeLineMetrics(baselineContent: string, proposedContent: string) {
  const baselineLines = splitLines(baselineContent);
  const proposedLines = splitLines(proposedContent);
  const { linesUnchanged } = lcsLineCounts(baselineLines, proposedLines);
  const linesDeleted = baselineLines.length - linesUnchanged;
  const linesAdded = proposedLines.length - linesUnchanged;
  const baselineLineCount = baselineLines.length;
  const proposedLineCount = proposedLines.length;
  const churnRatio = roundRatio((linesAdded + linesDeleted) / Math.max(baselineLineCount, 1));
  const similarityRatio = roundRatio(
    linesUnchanged / Math.max(baselineLineCount, proposedLineCount, 1),
  );

  return {
    baselineLines: baselineLineCount,
    proposedLines: proposedLineCount,
    linesAdded,
    linesDeleted,
    linesUnchanged,
    churnRatio,
    similarityRatio,
  };
}

function extractHtmlIds(content: string): readonly string[] {
  const ids = new Set<string>();
  for (const match of content.matchAll(HTML_ID_PATTERN)) {
    const id = match[1];
    if (id !== undefined && id.length > 0) ids.add(id);
  }
  return [...ids].sort(compareText);
}

function extractAriaAttributeNames(content: string): readonly string[] {
  const names = new Set<string>();
  for (const match of content.matchAll(ARIA_ATTRIBUTE_PATTERN)) {
    names.add(match[0]);
  }
  return [...names].sort(compareText);
}

function setDifference(
  baselineValues: readonly string[],
  proposedValues: readonly string[],
): readonly string[] {
  const proposedSet = new Set(proposedValues);
  return baselineValues.filter((value) => !proposedSet.has(value));
}

function computeLargeDeletionSignal(
  baselineLines: number,
  linesAdded: number,
  linesDeleted: number,
): LargeDeletionSignal {
  const denominator = Math.max(baselineLines, 1);
  const linesDeletedRatio = roundRatio(linesDeleted / denominator);
  const linesAddedRatio = roundRatio(linesAdded / denominator);
  return {
    linesDeletedRatio,
    linesAddedRatio,
    isSuspicious: linesDeletedRatio >= 0.5 && linesAddedRatio < 0.1,
  };
}

export function referencesRemovedHtmlId(content: string, removedId: string): boolean {
  const singleQuoted = `getElementById('${removedId}')`;
  const doubleQuoted = `getElementById("${removedId}")`;
  const singleSelector = `querySelector('#${removedId}')`;
  const doubleSelector = `querySelector("#${removedId}")`;
  return (
    content.includes(singleQuoted) ||
    content.includes(doubleQuoted) ||
    content.includes(singleSelector) ||
    content.includes(doubleSelector)
  );
}

function detectCrossFileReferenceRisks(
  removedHtmlIds: readonly string[],
  siblingJsContents: readonly { readonly logicalPath: string; readonly content: string }[],
): readonly CrossFileReferenceRisk[] {
  const risks: CrossFileReferenceRisk[] = [];
  for (const removedId of removedHtmlIds) {
    for (const sibling of siblingJsContents) {
      if (referencesRemovedHtmlId(sibling.content, removedId)) {
        risks.push({ removedId, referencingLogicalPath: sibling.logicalPath });
      }
    }
  }
  return risks.sort(
    (left, right) =>
      compareText(left.referencingLogicalPath, right.referencingLogicalPath) ||
      compareText(left.removedId, right.removedId),
  );
}

function computeStructuredAnalysis(
  input: UpdatePreservationAnalysisInput,
  baselineContent: string,
  proposedContent: string,
  churnRatio: number,
  structuredDeltaService: HtmlStructuredDeltaService,
): HtmlStructuredAnalysis | undefined {
  if (!isHtmlLogicalPath(input.logicalPath)) return undefined;

  return structuredDeltaService.analyze({
    baselineContent,
    proposedContent,
    churnRatio,
    elevatedChurnThreshold:
      input.elevatedChurnThreshold ?? DEFAULT_PRESERVATION_CONFIGURATION.elevatedChurnThreshold,
    configuration:
      input.structuredHtmlConfiguration ?? DEFAULT_STRUCTURED_HTML_ANALYSIS_CONFIGURATION,
  });
}

export class UpdatePreservationAnalysisService {
  constructor(
    private readonly checksumPort: ArtifactChecksumPort = new Sha256ChecksumService(),
    private readonly structuredDeltaService: HtmlStructuredDeltaService = new HtmlStructuredDeltaService(),
  ) {}

  analyzeSynchronously(
    input: UpdatePreservationAnalysisInput & { readonly baselineContentChecksum: ArtifactChecksum },
  ): UpdatePreservationAnalysisResult {
    const baselineContent = normalizeLineEndings(input.baselineContent);
    const proposedContent = normalizeLineEndings(input.proposedContent);
    const lineMetrics = computeLineMetrics(baselineContent, proposedContent);
    const isHtml = input.logicalPath.toLowerCase().endsWith('.html');

    const baselineHtmlIds = isHtml ? extractHtmlIds(baselineContent) : [];
    const proposedHtmlIds = isHtml ? extractHtmlIds(proposedContent) : [];
    const removedHtmlIds = isHtml ? setDifference(baselineHtmlIds, proposedHtmlIds) : [];
    const addedHtmlIds = isHtml ? setDifference(proposedHtmlIds, baselineHtmlIds) : [];

    const removedAccessibilityAttributes = isHtml
      ? setDifference(
          extractAriaAttributeNames(baselineContent),
          extractAriaAttributeNames(proposedContent),
        )
      : [];

    const crossFileReferenceRisks =
      removedHtmlIds.length > 0 && input.siblingJsContents !== undefined
        ? detectCrossFileReferenceRisks(removedHtmlIds, input.siblingJsContents)
        : [];

    const structuredAnalysis = computeStructuredAnalysis(
      input,
      baselineContent,
      proposedContent,
      lineMetrics.churnRatio,
      this.structuredDeltaService,
    );

    return {
      logicalPath: input.logicalPath,
      baselineContentChecksum: input.baselineContentChecksum,
      baselineBytes: utf8Size(baselineContent),
      proposedBytes: utf8Size(proposedContent),
      baselineLines: lineMetrics.baselineLines,
      proposedLines: lineMetrics.proposedLines,
      linesAdded: lineMetrics.linesAdded,
      linesDeleted: lineMetrics.linesDeleted,
      linesUnchanged: lineMetrics.linesUnchanged,
      churnRatio: lineMetrics.churnRatio,
      similarityRatio: lineMetrics.similarityRatio,
      removedHtmlIds,
      addedHtmlIds,
      removedAccessibilityAttributes,
      crossFileReferenceRisks,
      largeDeletionSignal: computeLargeDeletionSignal(
        lineMetrics.baselineLines,
        lineMetrics.linesAdded,
        lineMetrics.linesDeleted,
      ),
      ...(structuredAnalysis !== undefined ? { structuredAnalysis } : {}),
    };
  }

  async analyze(input: UpdatePreservationAnalysisInput): Promise<UpdatePreservationAnalysisResult> {
    const baselineContent = normalizeLineEndings(input.baselineContent);
    const proposedContent = normalizeLineEndings(input.proposedContent);
    const lineMetrics = computeLineMetrics(baselineContent, proposedContent);
    const isHtml = input.logicalPath.toLowerCase().endsWith('.html');

    const baselineHtmlIds = isHtml ? extractHtmlIds(baselineContent) : [];
    const proposedHtmlIds = isHtml ? extractHtmlIds(proposedContent) : [];
    const removedHtmlIds = isHtml ? setDifference(baselineHtmlIds, proposedHtmlIds) : [];
    const addedHtmlIds = isHtml ? setDifference(proposedHtmlIds, baselineHtmlIds) : [];

    const removedAccessibilityAttributes = isHtml
      ? setDifference(
          extractAriaAttributeNames(baselineContent),
          extractAriaAttributeNames(proposedContent),
        )
      : [];

    const crossFileReferenceRisks =
      removedHtmlIds.length > 0 && input.siblingJsContents !== undefined
        ? detectCrossFileReferenceRisks(removedHtmlIds, input.siblingJsContents)
        : [];

    const structuredAnalysis = computeStructuredAnalysis(
      input,
      baselineContent,
      proposedContent,
      lineMetrics.churnRatio,
      this.structuredDeltaService,
    );

    return {
      logicalPath: input.logicalPath,
      baselineContentChecksum: {
        algorithm: this.checksumPort.algorithm,
        value: await this.checksumPort.checksum(baselineContent),
      },
      baselineBytes: utf8Size(baselineContent),
      proposedBytes: utf8Size(proposedContent),
      baselineLines: lineMetrics.baselineLines,
      proposedLines: lineMetrics.proposedLines,
      linesAdded: lineMetrics.linesAdded,
      linesDeleted: lineMetrics.linesDeleted,
      linesUnchanged: lineMetrics.linesUnchanged,
      churnRatio: lineMetrics.churnRatio,
      similarityRatio: lineMetrics.similarityRatio,
      removedHtmlIds,
      addedHtmlIds,
      removedAccessibilityAttributes,
      crossFileReferenceRisks,
      largeDeletionSignal: computeLargeDeletionSignal(
        lineMetrics.baselineLines,
        lineMetrics.linesAdded,
        lineMetrics.linesDeleted,
      ),
      ...(structuredAnalysis !== undefined ? { structuredAnalysis } : {}),
    };
  }
}
