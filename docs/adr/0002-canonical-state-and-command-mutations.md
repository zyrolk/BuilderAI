# ADR-002: Canonical state and intent-based mutations

- **Status:** Accepted
- **Date:** 2026-07-30
- **Owners:** BuilderAI architecture
- **Related:** Sprint 1 critical remediation

## Context

Sprint 1 initially duplicated mutable state across Markdown and a runtime test fixture. Its public
aggregate replacement operation could rewrite history or target another project with a coincidentally
matching revision.

## Decision drivers

- One project-state authority.
- Runtime/documentation consistency.
- Immutable project identity.
- Append-only decision and completion history.
- Explicit, reviewable mutation intent.

## Considered options

1. Continue manually synchronizing Markdown and runtime state.
2. Keep aggregate replacement and rely on caller discipline.
3. Use one canonical JSON state, policy-only documentation, explicit commands, and commit invariants.

## Decision

Use option 3. `project-brain.json` owns all mutable Project Brain fields and is parsed by the production
schema in CI and at runtime. Markdown explains policy only. `ProjectBrainService` exposes initialization
and queries but no replacement. Domain services expose named commands. Repository commits require an
explicit project ID and enforce identity plus append-only history.

## Consequences

Runtime and project state cannot independently drift, and supported commands cannot erase history or
rename a project. Every new mutation requires an explicit command. Human-friendly generated views may
be added later, but must be derived and drift-checked rather than hand-maintained.

## Security and privacy impact

Project identity is scoped independently from submitted content. Historical tampering is rejected.
Canonical state remains repository-controlled; authorization and durable audit storage are deferred
until a persistent or remote mutation boundary is approved.

## Rollout and reversal

CI validates canonical state immediately. Reversal would reintroduce competing authorities and is not
supported. A future serialization format requires a migration ADR and lossless conversion test.
