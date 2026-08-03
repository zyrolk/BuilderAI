import { createHash } from 'node:crypto';

/** Matches `validation-context.ts` identifier contract for Project Brain task IDs. */
export const PROJECT_BRAIN_IDENTIFIER_MAX_LENGTH = 100 as const;

export const PROJECT_BRAIN_IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

const DIGEST_HEX_LENGTH = 16;

export const FEATURE_TASK_ID_PREFIX = 'ftask' as const;
export const FEATURE_SHADOW_TASK_ID_PREFIX = 'fshadow' as const;

/**
 * Builds a deterministic, collision-resistant Project Brain task identifier that
 * always satisfies the canonical lowercase kebab-case contract (max 100 characters).
 */
export function createBoundedProjectTaskId(
  prefix: string,
  semanticParts: readonly string[],
): string {
  if (!PROJECT_BRAIN_IDENTIFIER_PATTERN.test(prefix)) {
    throw new Error(`Project task ID prefix '${prefix}' is invalid.`);
  }
  const digest = createHash('sha256')
    .update(semanticParts.join('\0'))
    .digest('hex')
    .slice(0, DIGEST_HEX_LENGTH);
  const id = `${prefix}-${digest}`;
  if (
    id.length > PROJECT_BRAIN_IDENTIFIER_MAX_LENGTH ||
    !PROJECT_BRAIN_IDENTIFIER_PATTERN.test(id)
  ) {
    throw new Error(`Bounded project task ID '${id}' violates Project Brain identifier contract.`);
  }
  return id;
}
