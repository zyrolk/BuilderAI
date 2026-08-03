import type { ProviderMetadata } from '../../ai-provider';
import {
  CORRECTION_OUTPUT_BOUNDING_METADATA,
  TRUNCATION_RETRY_METADATA_ALLOWLIST,
  TRUNCATION_RETRY_METADATA_COMPACTION,
} from '../services/truncation-retry-compaction.service';

const ALLOWLIST_SEPARATOR = '\u001f';

export function parseOutputBoundingAllowlistFromMetadata(
  metadata: ProviderMetadata,
): readonly string[] | undefined {
  const bounded =
    metadata[CORRECTION_OUTPUT_BOUNDING_METADATA] === true ||
    metadata[TRUNCATION_RETRY_METADATA_COMPACTION] === true;
  if (!bounded) return undefined;
  const raw = metadata[TRUNCATION_RETRY_METADATA_ALLOWLIST];
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  return raw.split(ALLOWLIST_SEPARATOR).filter((entry) => entry.length > 0);
}

/** @deprecated Use parseOutputBoundingAllowlistFromMetadata */
export function parseCompactionAllowlistFromMetadata(
  metadata: ProviderMetadata,
): readonly string[] | undefined {
  return parseOutputBoundingAllowlistFromMetadata(metadata);
}
