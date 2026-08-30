/**
 * ADR-052 — bounded failure diagnostic caps (P1-E Slice 1).
 */

export const BOUNDED_FAILURE_DIAGNOSTIC_SCHEMA_VERSION = 1 as const;

/** Maximum structured diagnostics returned per parser invocation. */
export const MAX_FAILURE_DIAGNOSTICS_PER_INVOCATION = 32 as const;

/** Maximum diagnostic code token length (e.g. TS2322, no-unused-vars). */
export const MAX_FAILURE_DIAGNOSTIC_CODE_LENGTH = 64 as const;

/** Maximum workspace-relative path length. */
export const MAX_FAILURE_DIAGNOSTIC_PATH_LENGTH = 512 as const;

/** Maximum optional bounded message length after normalization. */
export const MAX_FAILURE_DIAGNOSTIC_MESSAGE_LENGTH = 256 as const;

/** Inclusive upper bound for line numbers. */
export const MAX_FAILURE_DIAGNOSTIC_LINE = 1_000_000 as const;

/** Inclusive upper bound for column numbers. */
export const MAX_FAILURE_DIAGNOSTIC_COLUMN = 100_000 as const;

/** Maximum serialized JSON size for a single diagnostic record. */
export const MAX_FAILURE_DIAGNOSTIC_SERIALIZED_CHARS = 1024 as const;

/** Printable code characters: letters, digits, hyphen, underscore, slash, at-sign. */
export const FAILURE_DIAGNOSTIC_CODE_PATTERN = /^[\w@/-]+$/u;
