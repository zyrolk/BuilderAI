import type { AIProviderErrorCode, ProviderMetadata } from '../../ai-provider';
import { ProviderContractViolationError } from '../../ai-provider';
import type { ProviderJsonValue } from '../../ai-provider/types/ai-provider';
import { isSafeLogicalPath } from '../../response-processor/validators/generated-artifact.validator';
import { recomputePromptPackageBudget } from './prompt-budget.service';
import type {
  PromptIterationSection,
  PromptPackage,
  PromptSection,
} from '../types/prompt-orchestrator';

export const TRUNCATION_RETRY_MAX_ALLOWLIST_PATHS = 8 as const;
export const TRUNCATION_RETRY_MAX_DIAGNOSTICS = 1 as const;
export const TRUNCATION_RETRY_MAX_SUMMARY_CHARACTERS = 1000 as const;
export const TRUNCATION_RETRY_METADATA_COMPACTION = 'truncation-retry-compaction' as const;
export const TRUNCATION_RETRY_METADATA_ALLOWLIST = 'truncation-retry-allowlist' as const;
export const CORRECTION_OUTPUT_BOUNDING_METADATA = 'correction-output-bounding' as const;
const ALLOWLIST_SEPARATOR = '\u001f';

const FORBIDDEN_PATH_FRAGMENTS = [
  'project-brain.json',
  'src/core/project-brain/',
  '.env',
  'node_modules/',
] as const;

export interface TruncationRetryAttemptInput {
  readonly prompt: PromptPackage;
  readonly attempt: number;
  readonly priorFailureCode?: AIProviderErrorCode;
}

export interface TruncationRetryAttemptResolution {
  readonly prompt: PromptPackage;
  readonly boundingActive: boolean;
  readonly compactionActive: boolean;
  readonly allowlist: readonly string[];
}

export class TruncationRetryCompactionService {
  resolveAttempt(input: TruncationRetryAttemptInput): TruncationRetryAttemptResolution {
    const allowlist = deriveCompactionAllowlist(input.prompt);
    const inactive: TruncationRetryAttemptResolution = {
      prompt: input.prompt,
      boundingActive: false,
      compactionActive: false,
      allowlist: [],
    };
    if (allowlist.length === 0) {
      return inactive;
    }
    if (input.attempt >= 2 && input.priorFailureCode === 'OUTPUT_TRUNCATED') {
      return {
        prompt: buildCompactedPrompt(input.prompt, allowlist),
        boundingActive: true,
        compactionActive: true,
        allowlist,
      };
    }
    return {
      prompt: input.prompt,
      boundingActive: true,
      compactionActive: false,
      allowlist,
    };
  }

  appendAttemptMetadata(
    metadata: ProviderMetadata,
    resolution: TruncationRetryAttemptResolution,
  ): ProviderMetadata {
    if (!resolution.boundingActive || resolution.allowlist.length === 0) {
      return metadata;
    }
    const withAllowlist = {
      ...metadata,
      [TRUNCATION_RETRY_METADATA_ALLOWLIST]: resolution.allowlist.join(ALLOWLIST_SEPARATOR),
    };
    if (resolution.compactionActive) {
      return {
        ...withAllowlist,
        [TRUNCATION_RETRY_METADATA_COMPACTION]: true,
      };
    }
    return {
      ...withAllowlist,
      [CORRECTION_OUTPUT_BOUNDING_METADATA]: true,
    };
  }

  /** @deprecated Use appendAttemptMetadata */
  appendCompactionMetadata(
    metadata: ProviderMetadata,
    resolution: TruncationRetryAttemptResolution,
  ): ProviderMetadata {
    return this.appendAttemptMetadata(metadata, resolution);
  }

  parseAllowlistFromMetadata(metadata: ProviderMetadata): readonly string[] | undefined {
    const bounded =
      metadata[CORRECTION_OUTPUT_BOUNDING_METADATA] === true ||
      metadata[TRUNCATION_RETRY_METADATA_COMPACTION] === true;
    if (!bounded) return undefined;
    const raw = metadata[TRUNCATION_RETRY_METADATA_ALLOWLIST];
    if (typeof raw !== 'string' || raw.length === 0) return undefined;
    return raw.split(ALLOWLIST_SEPARATOR).filter((entry) => entry.length > 0);
  }
  validateStructuredOutput(
    structuredOutput: ProviderJsonValue,
    resolution: TruncationRetryAttemptResolution,
  ): void {
    if (!resolution.boundingActive || resolution.allowlist.length === 0) return;
    const allowed = new Set(resolution.allowlist);
    if (!isRecord(structuredOutput)) {
      throw compactionViolation('$.structuredOutput', 'must be an object');
    }
    const artifacts = structuredOutput.artifacts;
    if (!Array.isArray(artifacts)) {
      throw compactionViolation('$.artifacts', 'must be an array');
    }
    if (artifacts.length > resolution.allowlist.length) {
      throw compactionViolation(
        '$.artifacts',
        `must contain at most ${resolution.allowlist.length} artifacts during correction output bounding`,
      );
    }
    const seenPaths = new Set<string>();
    for (const [index, artifact] of artifacts.entries()) {
      if (!isRecord(artifact)) {
        throw compactionViolation(`$.artifacts[${index}]`, 'must be an object');
      }
      const logicalPath = artifact.logicalPath;
      if (typeof logicalPath !== 'string' || !allowed.has(logicalPath)) {
        throw compactionViolation(
          `$.artifacts[${index}].logicalPath`,
          'must be one of the approved correction allowlist paths',
        );
      }
      if (seenPaths.has(logicalPath)) {
        throw compactionViolation(
          `$.artifacts[${index}].logicalPath`,
          'must not duplicate an approved correction allowlist path',
        );
      }
      seenPaths.add(logicalPath);
    }
    const diagnostics = structuredOutput.diagnostics;
    if (!Array.isArray(diagnostics)) {
      throw compactionViolation('$.diagnostics', 'must be an array');
    }
    if (diagnostics.length > TRUNCATION_RETRY_MAX_DIAGNOSTICS) {
      throw compactionViolation(
        '$.diagnostics',
        `must contain at most ${TRUNCATION_RETRY_MAX_DIAGNOSTICS} entries during correction output bounding`,
      );
    }
    const summary = structuredOutput.summary;
    if (typeof summary !== 'string') {
      throw compactionViolation('$.summary', 'must be a string');
    }
    if (summary.length > TRUNCATION_RETRY_MAX_SUMMARY_CHARACTERS) {
      throw compactionViolation(
        '$.summary',
        `must contain at most ${TRUNCATION_RETRY_MAX_SUMMARY_CHARACTERS} characters during correction output bounding`,
      );
    }
  }
}

export function deriveCompactionAllowlist(prompt: PromptPackage): readonly string[] {
  const iteration = prompt.sections.find(
    (section): section is PromptIterationSection => section.kind === 'ITERATION',
  );
  if (iteration === undefined) return [];

  const candidates = [
    ...iteration.feedback.apply.updatedPaths,
    ...iteration.feedback.apply.createdPaths,
    ...iteration.feedback.apply.deletedPaths,
  ];

  const allowlist: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const normalized = normalizeCompactionPath(candidate);
    if (normalized === undefined || seen.has(normalized)) continue;
    seen.add(normalized);
    allowlist.push(normalized);
    if (allowlist.length >= TRUNCATION_RETRY_MAX_ALLOWLIST_PATHS) break;
  }
  return allowlist.sort((left, right) => left.localeCompare(right));
}

export function buildCompactedPrompt(
  prompt: PromptPackage,
  allowlist: readonly string[],
): PromptPackage {
  const pathList = allowlist.join('\n');
  const sections = prompt.sections.map((section) => {
    if (section.kind !== 'ITERATION') return section;
    return {
      ...section,
      instructions: [
        ...section.instructions,
        {
          id: 'output-truncation-retry-compaction',
          text: [
            'OUTPUT_TRUNCATION_RETRY:',
            'The previous provider attempt exceeded the output limit.',
            'Emit artifacts ONLY for the following approved paths:',
            pathList,
            `Emit at most ${allowlist.length} artifacts.`,
            'Do not emit unchanged contextual files.',
            'Keep diagnostics minimal.',
            'Each UPDATE_FILE artifact must still contain the complete resulting file content.',
          ].join(' '),
          source: 'TEMPLATE' as const,
        },
      ],
    };
  });
  return recomputePromptPackageBudget({
    ...prompt,
    sections: sections as readonly PromptSection[],
  });
}

export function normalizeCompactionPath(value: string): string | undefined {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '').trim();
  if (normalized.length === 0 || !isSafeLogicalPath(normalized)) return undefined;
  const lower = normalized.toLowerCase();
  for (const forbidden of FORBIDDEN_PATH_FRAGMENTS) {
    if (lower.includes(forbidden.replaceAll('\\', '/'))) return undefined;
  }
  return normalized;
}

function compactionViolation(path: string, message: string): ProviderContractViolationError {
  return new ProviderContractViolationError('RESPONSE', [{ path, message }]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
