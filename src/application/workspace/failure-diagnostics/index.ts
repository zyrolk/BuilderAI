/**
 * ADR-052 — bounded structured failure diagnostics (P1-E Slice 1).
 */

export {
  BOUNDED_FAILURE_DIAGNOSTIC_SEVERITIES,
  BOUNDED_FAILURE_DIAGNOSTIC_SOURCES,
  type BoundedFailureDiagnostic,
  type BoundedFailureDiagnosticSeverity,
  type BoundedFailureDiagnosticSource,
  type ExtractBoundedFailureDiagnosticsInput,
} from './bounded-failure-diagnostic.types';

export { BOUNDED_FAILURE_DIAGNOSTIC_SCHEMA_VERSION } from './failure-diagnostic.constants';

export {
  assertNoForbiddenFailureDiagnosticKeys,
  buildBoundedFailureDiagnostic,
  validateBoundedFailureDiagnostic,
} from './bounded-failure-diagnostic.validation';

export {
  extractBoundedFailureDiagnostics,
  extractBoundedFailureDiagnosticsFromTerminalResult,
} from './extract-bounded-failure-diagnostics';

export {
  FAILURE_DIAGNOSTIC_PARSERS,
  resolveFailureDiagnosticParser,
} from './failure-diagnostic-registry';

export {
  MAX_FAILURE_DIAGNOSTIC_CODE_LENGTH,
  MAX_FAILURE_DIAGNOSTIC_COLUMN,
  MAX_FAILURE_DIAGNOSTIC_LINE,
  MAX_FAILURE_DIAGNOSTIC_MESSAGE_LENGTH,
  MAX_FAILURE_DIAGNOSTIC_PATH_LENGTH,
  MAX_FAILURE_DIAGNOSTICS_PER_INVOCATION,
} from './failure-diagnostic.constants';

export { normalizeFailureDiagnosticRelativePath } from './diagnostic-path-normalization';
