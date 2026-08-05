# ADR-0035: External-target optional lint and typecheck verification stages

## Status

Accepted

## Context

Checkpoint 4 requires Zyro-aligned verification for trusted-local external targets.
ADR-012 established the four-stage verification pipeline (project, dependency, build, test).
Real full-stack targets such as Zyro.lk commonly expose `lint` and `typecheck` npm scripts in
`package.json`, but those scripts are optional and must not fail verification when absent.

## Decision

1. Extend `VERIFICATION_STAGES` with `LINT_VALIDATION` and `TYPECHECK_VALIDATION` after test.
2. Discover scripts deterministically from target `package.json`:
   - lint: `lint`
   - typecheck: `typecheck`, then `type-check`
3. When an optional script is absent, the stage returns `PASSED` with `STAGE_SKIPPED` warning
   metadata — verification continues without failure.
4. When present, run bounded `npm run <script>` via existing `BoundedNpmCommandRunner` with stage
   failure codes: `LINT_FAILED`, `TYPECHECK_FAILED`.
5. Build and test invocation remains unchanged (`npm run build`, `npm test`).
6. Operator-facing failure categories map stage/error codes without discarding raw structured
   results (BUILD_FAILED, TEST_FAILED, LINT_FAILED, TYPECHECK_FAILED,
   VERIFICATION_COMMAND_TIMEOUT, VERIFICATION_INFRASTRUCTURE_FAILURE).

## Consequences

- External targets with lint/typecheck scripts gain aligned verification coverage.
- Targets without optional scripts remain compatible (Checkpoint 4 scenario 6).
- Feature task mandatory stage lists automatically include the new stages.
- UI must treat `PARTIALLY_APPLIED` separately from verification failure correction (fresh prepare only).
