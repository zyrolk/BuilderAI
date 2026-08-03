# ADR-016: Add an optional read-only Workspace Visibility port to the Change Planner

- **Status:** Accepted
- **Date:** 2026-08-01
- **Owners:** BuilderAI architecture
- **Related:** ADR-010 (Project Change Plan boundary), ADR-011 (Safe File Apply boundary)

## Context

ADR-010 deliberately made `src/core/change-planner` effect-free: it never reads the filesystem, cannot
prove whether a create target is absent or an update/delete target exists, and every plan unconditionally
carries an `UNVERIFIED_PROJECT_STATE` warning. That warning is accurate when the planner has no way to
observe the workspace, but it produces a predictable, late failure mode: a plan can pass planning-time
validation and full human review, then still be rejected by the Safe File Apply Engine's preflight
(`TARGET_ALREADY_EXISTS`, `PARENT_DIRECTORY_MISSING`, `TARGET_MISSING`) because the workspace already
disagreed with the plan the whole time. Reviewers had no way to see that mismatch before approving.

## Decision drivers

- Give reviewers an earlier, accurate signal when a plan's create, update, or delete target already
  conflicts with the real workspace, instead of only discovering it after approval, at apply time.
- Never let this capability become a second source of mutation authority: Safe File Apply must remain
  the sole boundary that revalidates preconditions and performs filesystem effects.
- Keep the planner's transformation from Response Package to Project Change Plan deterministic and
  synchronous; do not introduce asynchronous I/O, retries, or provider/framework coupling into
  `src/core/change-planner`.
- Warnings must describe exactly what was checked; a plan must never claim project state was verified
  when no check occurred, and must never claim state is fully verified when only existence was checked.

## Considered options

1. Leave the planner effect-free exactly as ADR-010 defined it and accept that existence conflicts
   surface only at apply time.
2. Give the planner unconditional, mandatory filesystem access so every plan is always checked.
3. Add one small, optional, synchronous, read-only `WorkspaceVisibilityPort` that the planner consults
   only when a caller supplies it, mirroring Safe File Apply's own precondition semantics, and adjust
   the `UNVERIFIED_PROJECT_STATE` warning to reflect whether that check happened.
4. Move existence checking into a separate pre-planning review step outside `src/core/change-planner`.

## Decision

Use option 3. `src/core/change-planner/ports/workspace-visibility.port.ts` defines
`WorkspaceVisibilityPort` with two synchronous, read-only methods, `directoryExists` and `fileExists`.
`ChangePlannerService` accepts an optional `WorkspaceVisibilityPort` through its constructor and through
each `plan()` call (the per-call argument, when present, takes precedence over the constructor-injected
default). When a port is supplied, `plan()` checks each operation's precondition using the same rules
Safe File Apply's preflight already enforces: a create target must not already exist and its parent
directory must exist; an update or delete target must already exist. A violation is rejected as one
`ChangePlanValidationError` issue with code `INVALID_REFERENCE`, before the plan is ever produced.

The planner still never mutates anything and still performs no asynchronous I/O; `WorkspaceVisibilityPort`
implementations are synchronous, root-scoped, and read-only by contract. `src/infrastructure/workspace`
provides the local `NodeWorkspaceVisibility` adapter using `lstat`, so a symbolic link is treated as
neither an existing file nor an existing directory — consistent with Safe File Apply's own symlink
rejection — and only the local runtime composition (`local-workspace-runtime.ts`) wires it in.

The `UNVERIFIED_PROJECT_STATE` plan warning is now conditional. When no port is supplied (or none is
configured), the plan keeps the original ADR-010 warning verbatim. When a port is supplied and consulted,
the plan instead carries a `PARTIALLY_VERIFIED_PROJECT_STATE` warning stating plainly that only create,
update, and delete target existence was checked, and that symlinks, permissions, content drift, and
concurrent changes remain unverified until Safe File Apply executes. This supersedes only the
"no port is introduced" and "always warn ... unverified" clauses of ADR-010's Decision section; every
other ADR-010 constraint (closed operation kinds, no patch semantics, canonical ordering, no mutation
authority) is unchanged.

## Consequences

Positive:

- Reviewers see an accurate, earlier signal when a plan's targets already conflict with the real
  workspace, reducing wasted review and predictable late apply-time rejections.
- Safe File Apply's preflight remains fully authoritative and unchanged; this is a strictly additive,
  optional, best-effort early warning, not a second enforcement path.
- Existing callers that do not supply a `WorkspaceVisibilityPort` see byte-for-byte unchanged planner
  behavior and the original warning text.

Negative:

- The planner now depends on one new port abstraction, which is a small increase in surface area for a
  core module ADR-010 intentionally kept minimal.
- A time-of-check-to-time-of-use gap remains: the workspace can change between planning and apply, which
  is exactly why the warning says "partially" verified and why Safe File Apply must still revalidate.
- `directoryExists`/`fileExists` intentionally do not distinguish "missing" from "is a symlink"; callers
  only learn the precise reason from Safe File Apply's own preflight error codes.

## Security and privacy impact

`WorkspaceVisibilityPort` is read-only and cannot create, modify, or delete anything; it exposes only two
booleans per logical path. `NodeWorkspaceVisibility` resolves paths against a fixed workspace root using
`lstat` (not `stat`), so it does not follow symlinks when answering existence questions. It introduces no
new external network, credential, or persistence surface. The change does not alter which paths Safe File
Apply is willing to touch, its protected-path rules, or its authorization requirements.

## Rollout and reversal

Unit tests cover every combination of operation kind (create, update, delete) against present/absent
targets and present/absent parent directories, constructor- versus call-site-supplied ports, and both
warning variants. `NodeWorkspaceVisibility` has its own filesystem-backed tests, including a symlink case.
Reversal is fully additive-safe: removing the optional port argument, the `NodeWorkspaceVisibility`
adapter, and its constructor wiring in `local-workspace-runtime.ts` restores the exact ADR-010 behavior,
since every caller path already falls back to the original unconditional `UNVERIFIED_PROJECT_STATE`
warning when no port is supplied.
