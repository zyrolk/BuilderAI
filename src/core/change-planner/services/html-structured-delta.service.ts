import { parse } from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';

import type {
  HtmlStructuredAnalysis,
  HtmlStructuredAnalysisFallbackReason,
  HtmlStructuredDeltaInput,
} from '../types/html-structured-analysis';
import { utf8Size } from '../validators/validation-helpers';

type Element = DefaultTreeAdapterTypes.Element;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;
type TextNode = DefaultTreeAdapterTypes.TextNode;
type Template = DefaultTreeAdapterTypes.Template;

interface AnalysisContext {
  readonly startedAtMs: number;
  readonly timeLimitMs: number;
  readonly maximumDomNodes: number;
  readonly maximumTreeDepth: number;
  nodeCount: number;
  attributeChanges: number;
  textChanges: number;
  structuralChanges: number;
  preservedStableIdCount: number;
  removedStableIdCount: number;
  abortReason?: HtmlStructuredAnalysisFallbackReason;
}

function createFallback(reason: HtmlStructuredAnalysisFallbackReason): HtmlStructuredAnalysis {
  return {
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
    fallbackReason: reason,
  };
}

function isElementNode(node: DefaultTreeAdapterTypes.Node): node is Element | Template {
  return (
    node.nodeName !== '#text' &&
    node.nodeName !== '#comment' &&
    node.nodeName !== '#documentType' &&
    node.nodeName !== '#document' &&
    node.nodeName !== '#document-fragment'
  );
}

function getElementChildren(parent: ParentNode): readonly (Element | Template)[] {
  const children: (Element | Template)[] = [];
  for (const child of parent.childNodes) {
    if (isElementNode(child)) children.push(child);
  }
  return children;
}

function getAttribute(element: Element | Template, name: string): string | undefined {
  const attribute = element.attrs.find(({ name: attributeName }) => attributeName === name);
  if (attribute === undefined || attribute.value.length === 0) return undefined;
  return attribute.value;
}

function attributesToMap(element: Element | Template): Map<string, string> {
  const map = new Map<string, string>();
  for (const attribute of element.attrs) {
    map.set(attribute.name, attribute.value);
  }
  return map;
}

function countAttributeChanges(base: Element | Template, proposed: Element | Template): number {
  const baseAttributes = attributesToMap(base);
  const proposedAttributes = attributesToMap(proposed);
  let changes = 0;

  for (const [name, value] of baseAttributes) {
    const proposedValue = proposedAttributes.get(name);
    if (proposedValue === undefined || proposedValue !== value) changes += 1;
  }
  for (const name of proposedAttributes.keys()) {
    if (!baseAttributes.has(name)) changes += 1;
  }

  return changes;
}

function directTextContent(element: Element | Template): string {
  return element.childNodes
    .filter((child): child is TextNode => child.nodeName === '#text')
    .map((child) => child.value)
    .join('');
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function getDocumentElement(document: DefaultTreeAdapterTypes.Document): Element | undefined {
  for (const child of document.childNodes) {
    if (isElementNode(child)) return child;
  }
  return undefined;
}

function checkLimits(context: AnalysisContext, depth: number): boolean {
  if (context.abortReason !== undefined) return false;
  if (Date.now() - context.startedAtMs > context.timeLimitMs) {
    context.abortReason = 'TIME_LIMIT';
    return false;
  }
  if (depth > context.maximumTreeDepth) {
    context.abortReason = 'DEPTH_LIMIT';
    return false;
  }
  return true;
}

function registerElementNode(context: AnalysisContext): boolean {
  context.nodeCount += 1;
  if (context.nodeCount > context.maximumDomNodes) {
    context.abortReason = 'NODE_LIMIT';
    return false;
  }
  return true;
}

function walkElements(
  parent: ParentNode,
  depth: number,
  context: AnalysisContext,
  visitor: (element: Element | Template, depth: number) => void,
): void {
  if (!checkLimits(context, depth)) return;

  for (const child of parent.childNodes) {
    if (context.abortReason !== undefined) return;
    if (isElementNode(child)) {
      if (!registerElementNode(context)) return;
      visitor(child, depth);
      walkElements(child, depth + 1, context, visitor);
      if (child.nodeName === 'template') {
        walkElements((child as Template).content, depth + 1, context, visitor);
      }
    }
  }
}

function countElements(
  document: DefaultTreeAdapterTypes.Document,
  context: AnalysisContext,
): number {
  let count = 0;
  const counterContext: AnalysisContext = { ...context, nodeCount: 0, abortReason: undefined };
  walkElements(document, 0, counterContext, () => {
    count += 1;
  });
  if (counterContext.abortReason !== undefined) context.abortReason = counterContext.abortReason;
  return count;
}

function buildIdMap(
  root: DefaultTreeAdapterTypes.Document,
  context: AnalysisContext,
): Map<string, Element | Template> {
  const idMap = new Map<string, Element | Template>();
  walkElements(root, 0, context, (element) => {
    const id = getAttribute(element, 'id');
    if (id !== undefined && !idMap.has(id)) idMap.set(id, element);
  });
  return idMap;
}

function groupByTagName(
  elements: readonly (Element | Template)[],
): Map<string, (Element | Template)[]> {
  const groups = new Map<string, (Element | Template)[]>();
  for (const element of elements) {
    const group = groups.get(element.tagName) ?? [];
    group.push(element);
    groups.set(element.tagName, group);
  }
  return groups;
}

function compareMatchedElements(
  baseline: Element | Template,
  proposed: Element | Template,
  context: AnalysisContext,
  matchedBaseline: Set<Element | Template>,
  matchedProposed: Set<Element | Template>,
): void {
  if (context.abortReason !== undefined) return;
  if (matchedBaseline.has(baseline) || matchedProposed.has(proposed)) return;

  matchedBaseline.add(baseline);
  matchedProposed.add(proposed);

  if (baseline.tagName !== proposed.tagName) {
    context.structuralChanges += 1;
    return;
  }

  context.attributeChanges += countAttributeChanges(baseline, proposed);

  if (normalizeText(directTextContent(baseline)) !== normalizeText(directTextContent(proposed))) {
    context.textChanges += 1;
  }

  matchStructuralChildren(baseline, proposed, context, matchedBaseline, matchedProposed);
}

function matchStructuralChildren(
  baselineParent: Element | Template,
  proposedParent: Element | Template,
  context: AnalysisContext,
  matchedBaseline: Set<Element | Template>,
  matchedProposed: Set<Element | Template>,
): void {
  if (context.abortReason !== undefined) return;

  const baselineChildren = getElementChildren(baselineParent).filter(
    (element) => !matchedBaseline.has(element),
  );
  const proposedChildren = getElementChildren(proposedParent).filter(
    (element) => !matchedProposed.has(element),
  );

  const baselineByTag = groupByTagName(baselineChildren);
  const proposedByTag = groupByTagName(proposedChildren);
  const tagNames = [...new Set([...baselineByTag.keys(), ...proposedByTag.keys()])].sort(
    (left, right) => left.localeCompare(right),
  );

  for (const tagName of tagNames) {
    const baselineGroup = baselineByTag.get(tagName) ?? [];
    const proposedGroup = proposedByTag.get(tagName) ?? [];
    const pairCount = Math.min(baselineGroup.length, proposedGroup.length);

    for (let index = 0; index < pairCount; index += 1) {
      compareMatchedElements(
        baselineGroup[index]!,
        proposedGroup[index]!,
        context,
        matchedBaseline,
        matchedProposed,
      );
    }

    for (let index = pairCount; index < baselineGroup.length; index += 1) {
      context.structuralChanges += 1;
      matchedBaseline.add(baselineGroup[index]!);
    }
    for (let index = pairCount; index < proposedGroup.length; index += 1) {
      context.structuralChanges += 1;
      matchedProposed.add(proposedGroup[index]!);
    }
  }
}

function compareTrees(
  baselineDocument: DefaultTreeAdapterTypes.Document,
  proposedDocument: DefaultTreeAdapterTypes.Document,
  context: AnalysisContext,
): void {
  const matchedBaseline = new Set<Element | Template>();
  const matchedProposed = new Set<Element | Template>();

  const baselineIdMap = buildIdMap(baselineDocument, context);
  if (context.abortReason !== undefined) return;

  context.nodeCount = 0;
  const proposedIdMap = buildIdMap(proposedDocument, context);
  if (context.abortReason !== undefined) return;

  context.nodeCount = 0;
  const baselineIds = [...baselineIdMap.keys()].sort((left, right) => left.localeCompare(right));

  for (const id of baselineIds) {
    const baselineElement = baselineIdMap.get(id);
    const proposedElement = proposedIdMap.get(id);
    if (baselineElement === undefined) continue;

    if (proposedElement === undefined) {
      context.removedStableIdCount += 1;
      context.structuralChanges += 1;
      matchedBaseline.add(baselineElement);
      continue;
    }

    context.preservedStableIdCount += 1;
    compareMatchedElements(
      baselineElement,
      proposedElement,
      context,
      matchedBaseline,
      matchedProposed,
    );
  }

  if (context.abortReason !== undefined) return;

  const baselineHtml = getDocumentElement(baselineDocument);
  const proposedHtml = getDocumentElement(proposedDocument);
  if (baselineHtml === undefined || proposedHtml === undefined) {
    if (baselineHtml !== proposedHtml) context.structuralChanges += 1;
    return;
  }

  compareMatchedElements(baselineHtml, proposedHtml, context, matchedBaseline, matchedProposed);
}

export function isHtmlLogicalPath(logicalPath: string): boolean {
  const lower = logicalPath.toLowerCase();
  return lower.endsWith('.html') || lower.endsWith('.htm');
}

export class HtmlStructuredDeltaService {
  analyze(input: HtmlStructuredDeltaInput): HtmlStructuredAnalysis {
    if (input.baselineContent.includes('\u0000') || input.proposedContent.includes('\u0000')) {
      return createFallback('PARSE_ERROR');
    }

    const baselineBytes = utf8Size(input.baselineContent);
    const proposedBytes = utf8Size(input.proposedContent);
    if (baselineBytes > input.configuration.maximumBaselineBytes) {
      return createFallback('BASELINE_TOO_LARGE');
    }
    if (proposedBytes > input.configuration.maximumBaselineBytes) {
      return createFallback('PROPOSED_TOO_LARGE');
    }

    const context: AnalysisContext = {
      startedAtMs: Date.now(),
      timeLimitMs: input.configuration.parseTimeLimitMs,
      maximumDomNodes: input.configuration.maximumDomNodes,
      maximumTreeDepth: input.configuration.maximumTreeDepth,
      nodeCount: 0,
      attributeChanges: 0,
      textChanges: 0,
      structuralChanges: 0,
      preservedStableIdCount: 0,
      removedStableIdCount: 0,
    };

    let baselineDocument: DefaultTreeAdapterTypes.Document;
    let proposedDocument: DefaultTreeAdapterTypes.Document;

    try {
      baselineDocument = parse(input.baselineContent);
      proposedDocument = parse(input.proposedContent);
    } catch {
      return createFallback('PARSE_ERROR');
    }

    const elementCountBaseline = countElements(baselineDocument, context);
    if (context.abortReason !== undefined) return createFallback(context.abortReason);

    context.nodeCount = 0;
    context.abortReason = undefined;
    const elementCountProposed = countElements(proposedDocument, context);
    if (context.abortReason !== undefined) return createFallback(context.abortReason);

    context.nodeCount = 0;
    context.abortReason = undefined;
    compareTrees(baselineDocument, proposedDocument, context);
    if (context.abortReason !== undefined) return createFallback(context.abortReason);

    const formattingOnlyEvidence =
      context.attributeChanges === 0 &&
      context.textChanges === 0 &&
      context.structuralChanges === 0 &&
      input.churnRatio >= input.elevatedChurnThreshold;

    return {
      kind: 'HTML',
      parseStatus: 'SUCCESS',
      attributeChanges: context.attributeChanges,
      textChanges: context.textChanges,
      structuralChanges: context.structuralChanges,
      formattingOnlyEvidence,
      preservedStableIdCount: context.preservedStableIdCount,
      removedStableIdCount: context.removedStableIdCount,
      elementCountBaseline,
      elementCountProposed,
    };
  }
}
