# ADR-011: Apply validated file plans through a two-phase filesystem boundary

- **Status:** Accepted
- **Date:** 2026-07-31
- **Owners:** BuilderAI architecture
- **Related:** Sprint 10 Safe File Apply Engine

## Context

Project Change Plans describe explicit file intent but deliberately do not inspect or modify a project.
BuilderAI now needs a narrowly scoped effect boundary that can apply those plans without granting Git,
build, test, network, deployment, rollback, or unrestricted filesystem behavior to core orchestration.

## Decision drivers

- Accept only the existing validated Project Change Plan contract.
- Support only conditional create-file, update-file, and delete-file effects.
- Ensure every validation and filesystem preflight completes before the first mutation.
- Prevent protected-path and symlink bypasses across case-sensitive and case-insensitive platforms.
- Keep filesystem access behind a root-scoped port with conditional mutation semantics.
- Report actual applied, skipped, warning, error, duration, and metadata outcomes honestly.
- Do not imply transactional rollback when rollback is explicitly outside this sprint.

## Considered options

1. Call Node filesystem APIs directly from the apply service.
2. Let each future workflow interpret and apply Change Plan operations independently.
3. Introduce a two-phase engine over a strict filesystem and clock port.
4. Implement transactional backups and rollback with the first apply engine.

## Decision

Use option 3. `src/core/file-apply` revalidates a Change Plan, enforces its operation limit and canonical
ordering, rejects protected paths, then inspects every target and create-parent before invoking any
mutation. Create targets must be absent with an existing regular parent directory. Update and delete
targets must be existing regular files. Symlinks and other entry kinds are rejected.

Mandatory case-insensitive protected rules cover Git internals, environment files, canonical Project
Brain state, repository agent governance, and CI workflows. Callers may add exact, subtree, and path
prefix rules but cannot remove mandatory rules.

The `FileSystemPort` is root scoped. Implementations must contain logical paths under the configured
project root, reject symlink traversal at every ancestor, and implement conditional create-if-absent,
update-if-regular-file, and delete-if-regular-file operations. These conditional methods remain
authoritative if project state changes after preflight.

Operations execute sequentially in the validated plan order. Validation or inspection failure returns
Rejected with every planned path skipped and zero mutations. Execution stops on the first mutation
failure. If earlier operations succeeded, the result is Partially Applied; if none succeeded, it is
Failed. Completed operations are not rolled back, and every valid-plan result carries an explicit
non-transactional warning.

The engine returns a versioned Apply Result containing canonically ordered created, updated, deleted,
and skipped paths; structured warnings and errors; monotonic duration; and defensive metadata. A clock
port keeps duration deterministic in tests.

## Consequences

Core orchestration depends on capabilities rather than Node APIs, all rejectable preconditions run
before the mutation phase, and result status reflects actual filesystem outcomes. A real root-scoped
adapter can be added and conformance-tested without changing engine policy.

The engine does not provide all-or-nothing multi-file transactions. It also lacks expected-current-
content checks because the current Change Plan records desired output provenance rather than a checksum
of the existing target. Authorization, adapter selection, locking, content-drift protection, recovery,
and operator audit remain required before production composition.

## Security and privacy impact

Protected paths are deny-first and case-insensitive. Invalid plans, unsafe paths, duplicate operations,
ordering drift, protected paths, missing or wrong-kind targets, missing parents, symlinks, and inspection
failures cause zero mutations. Unknown adapter failures are translated to stable errors without exposing
implementation details. The engine has no Git, process execution, networking, provider, UI, telemetry,
or deployment capability.

## Rollout and reversal

Tests use a stateful in-memory filesystem port and controlled clock. They cover successful operations,
mandatory and configurable protection, malformed plans, full preflight atomicity, target races,
symlinks, partial failure, result validation, and defensive copies. Reversal removes only
`src/core/file-apply`; Change Plans and earlier contracts remain compatible.
