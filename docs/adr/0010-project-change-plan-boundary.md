# ADR-010: Introduce an effect-free Project Change Plan boundary

- **Status:** Accepted
- **Date:** 2026-07-31
- **Owners:** BuilderAI architecture
- **Related:** Sprint 9 Safe Project Change Planning

## Context

The Response Processor produces deterministic, integrity-backed artifacts, but those artifacts are not
safe instructions for changing a repository. BuilderAI needs an intermediate contract that states the
intended file operations, provenance, ordering, review risks, and unresolved preconditions without
reading or modifying project state.

## Decision drivers

- Consume only a validated Response Package rather than provider output.
- Describe only create-file, update-file, and delete-file intents.
- Keep planning provider, framework, storage, filesystem, Git, network, and executor independent.
- Reject ambiguous operation inference, patch application semantics, duplicate paths, and file/tree
  conflicts.
- Preserve artifact checksums and execution identity as immutable source references.
- Produce deterministic operation order, summaries, risks, warnings, and metadata.

## Considered options

1. Inspect the filesystem to infer whether each artifact creates or updates a file.
2. Let a future file writer interpret Response Package metadata directly.
3. Require explicit operation intent and create one pure Project Change Plan.
4. Model patch application and rollback in the planning layer.

## Decision

Use option 3. `src/core/change-planner` accepts one validated Response Package. Every artifact must
declare `change-operation` metadata as `CREATE_FILE`, `UPDATE_FILE`, or `DELETE_FILE`. Planning never
infers existence from a filesystem or storage adapter. Because current project state is deliberately
unavailable, every plan records an `UNVERIFIED_PROJECT_STATE` warning.

Create and update operations carry the normalized desired content. Delete operations carry no content
and require an empty source artifact. Every operation references the source artifact path, type,
description, UTF-8 size, checksum, Response Package version, and execution identity. Patch artifacts
are rejected because applying a patch is not one of the closed exact-result file operations.

The canonical operation order is create, update, then delete, followed by case-insensitive and exact
logical-path order. This is a stable safety-oriented phase policy, not an assertion about runtime
dependency availability. Duplicate operation identifiers, case-insensitive path aliases, conflicting
operation kinds, and file/tree prefix conflicts are rejected.

The plan includes deterministic summaries, structured risks, inherited response warnings, and scalar
metadata. Configuration bounds operation count, metadata, and the broad-change risk threshold. No port
is introduced because this capability has no legitimate external state or effect.

## Consequences

A future reviewed consumer can receive one validated plan rather than interpreting provider artifacts.
Plans are reproducible, source-correlated, independently validatable, and explicit about missing
project-state preconditions.

The planner cannot prove whether a create target is absent or an update/delete target exists. It also
cannot detect content drift, symlinks, permissions, repository policy, or build impact. Those checks
belong to a separately approved project-state review and application boundary.

## Security and privacy impact

Planning treats Response Packages and plans as untrusted boundary data. It validates safe logical
paths, closed operations, exact structure, canonical ordering, scalar bounded metadata, internal and
source references, and deterministic summaries. It performs no filesystem access, Git operation,
network request, build or test execution, persistence, logging, or automatic project modification.

## Rollout and reversal

Unit tests cover generation, conflicts, file/tree aliases, ordering, validation, references, summaries,
risks, warnings, configuration, and defensive copies. Reversal removes only
`src/core/change-planner`; the Response Package and all earlier contracts remain compatible.
