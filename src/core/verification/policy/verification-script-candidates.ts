export const LINT_SCRIPT_CANDIDATES = ['lint'] as const;
export const TYPECHECK_SCRIPT_CANDIDATES = ['typecheck', 'type-check'] as const;
export const FORMAT_SCRIPT_CANDIDATES = ['format:check', 'format-check'] as const;

export const VERIFICATION_SCRIPT_CANDIDATES = {
  lint: LINT_SCRIPT_CANDIDATES,
  typecheck: TYPECHECK_SCRIPT_CANDIDATES,
  format: FORMAT_SCRIPT_CANDIDATES,
} as const;
