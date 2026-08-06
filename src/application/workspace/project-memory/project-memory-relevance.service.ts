import {
  DEFAULT_PROJECT_MEMORY_CONFIGURATION,
  type ProjectMemoryConfiguration,
} from './project-memory-configuration';
import { listAllProjectMemoryRecords } from './project-memory.validator';
import {
  type ExternalTargetProjectMemory,
  type ProjectMemoryContextSelection,
  type ProjectMemoryRelevantRecord,
  type ProjectMemoryRecord,
} from './project-memory.types';

const STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'because',
  'before',
  'change',
  'could',
  'from',
  'have',
  'help',
  'investigate',
  'issue',
  'need',
  'order',
  'please',
  'problem',
  'request',
  'should',
  'that',
  'this',
  'with',
  'without',
  'would',
  'your',
]);

export class ProjectMemoryRelevanceService {
  constructor(
    private readonly configuration: ProjectMemoryConfiguration = DEFAULT_PROJECT_MEMORY_CONFIGURATION,
  ) {}

  selectRelevant(input: {
    readonly request: string;
    readonly memory: ExternalTargetProjectMemory;
    readonly existingSourcePaths: readonly string[];
    readonly explicitPathHints?: readonly string[];
    readonly now?: Date;
  }): ProjectMemoryContextSelection {
    const requestTokens = tokenize(input.request);
    const explicitPaths = new Set(
      (input.explicitPathHints ?? []).map((path) => path.toLowerCase()),
    );
    const existingPaths = new Set(input.existingSourcePaths.map((path) => path.toLowerCase()));
    const now = input.now ?? new Date();

    const scored = listAllProjectMemoryRecords(input.memory)
      .map((record) =>
        scoreRecord(record, requestTokens, explicitPaths, existingPaths, now, this.configuration),
      )
      .filter(({ score }) => score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return right.record.updatedAt.localeCompare(left.record.updatedAt);
      })
      .slice(0, this.configuration.maximumRelevantRecords);

    const renderedText = renderMemoryContext(scored, this.configuration.maximumContextCharacters);
    return {
      records: scored,
      renderedText,
      truncated: renderedText.endsWith('…'),
    };
  }
}

function scoreRecord(
  record: ProjectMemoryRecord,
  requestTokens: readonly string[],
  explicitPaths: ReadonlySet<string>,
  existingPaths: ReadonlySet<string>,
  now: Date,
  configuration: ProjectMemoryConfiguration,
): ProjectMemoryRelevantRecord {
  let score = 0;
  const haystack = [
    record.summary,
    ...(record.tags ?? []),
    ...record.supportingPaths,
    ...(record.category === 'INVESTIGATION' ? record.affectedAreas : []),
    ...(record.category === 'INVESTIGATION' && record.likelyRootCause !== undefined
      ? [record.likelyRootCause]
      : []),
  ]
    .join(' ')
    .toLowerCase();

  for (const token of requestTokens) {
    if (haystack.includes(token)) score += 2;
  }

  const recordPaths = [
    ...record.supportingPaths,
    ...(record.category === 'INVESTIGATION' ? record.affectedAreas : []),
  ];
  for (const recordPath of recordPaths) {
    const normalized = recordPath.toLowerCase();
    if (explicitPaths.has(normalized)) score += 12;
    for (const token of requestTokens) {
      if (normalized.includes(token)) score += 4;
    }
  }

  const ageMs = Math.max(0, now.getTime() - Date.parse(record.updatedAt));
  const ageDays = ageMs / (24 * 60 * 60 * 1_000);
  if (score > 0 && ageDays <= configuration.recencyBoostWindowDays) {
    score += Math.max(0, 3 - Math.floor(ageDays / 7));
  }

  const potentiallyStale = recordPaths.some(
    (recordPath) => !existingPaths.has(recordPath.toLowerCase()),
  );

  return { record, score, potentiallyStale };
}

function renderMemoryContext(
  records: readonly ProjectMemoryRelevantRecord[],
  maximumCharacters: number,
): string {
  if (records.length === 0) return '';
  const lines = [
    'Historical project memory (not current filesystem evidence):',
    'Current repository evidence has higher authority than these records.',
  ];
  for (const { record, potentiallyStale } of records) {
    const staleLabel = potentiallyStale ? ' [POTENTIALLY STALE]' : '';
    const paths = [
      ...record.supportingPaths,
      ...(record.category === 'INVESTIGATION' ? record.affectedAreas : []),
    ];
    const pathSummary = paths.length === 0 ? '' : ` Paths: ${paths.join(', ')}.`;
    lines.push(
      `- [${record.category}]${staleLabel} ${record.summary}.${pathSummary} (source: ${record.source}, updated: ${record.updatedAt})`,
    );
    if (record.category === 'INVESTIGATION' && record.likelyRootCause !== undefined) {
      lines.push(`  Likely root cause (historical): ${record.likelyRootCause}`);
    }
  }
  const rendered = lines.join('\n');
  if (rendered.length <= maximumCharacters) return rendered;
  return `${rendered.slice(0, maximumCharacters)}…`;
}

function tokenize(request: string): readonly string[] {
  const tokens = request
    .toLowerCase()
    .match(/\b[a-z][a-z0-9_-]{2,}\b/gu)
    ?.filter((token) => !STOP_WORDS.has(token));
  return [...new Set(tokens ?? [])].sort((left, right) => left.localeCompare(right));
}

export function buildMemoryAugmentedRequest(
  request: string,
  memoryContext: ProjectMemoryContextSelection,
): string {
  if (memoryContext.renderedText.length === 0) return request;
  return `${request.trim()}\n\n${memoryContext.renderedText}`;
}
