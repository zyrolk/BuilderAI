# ADR-001: Establish the Project Brain core

- **Status:** Accepted
- **Date:** 2026-07-30
- **Owners:** BuilderAI architecture
- **Related:** Sprint 1 — Project Brain Foundation

## Context

Future engineering assistance needs durable, reviewable project context independent of any model,
conversation, framework, or persistence technology. Project state includes several related records
whose references and lifecycle must remain consistent.

## Decision drivers

- Model and vendor independence.
- Runtime integrity at trust boundaries.
- Traceable decisions and progress.
- Replaceable persistence.
- Prevention of concurrent lost updates.

## Considered options

1. Store context only in tool-specific instruction files.
2. Couple Project Brain policy to Next.js routes and select a database immediately.
3. Define a framework-independent aggregate, application services, validators, and repository port.

## Decision

Use option 3. Root `project-brain.json` is the sole mutable authority. Repository documents define
stable policy without copying live state. A versioned TypeScript aggregate provides executable
contracts. Boundary parsers validate unknown input, intent-based services enforce use cases, and a
repository port uses optimistic revisions. Sprint 1 includes only an in-memory adapter and no API.

## Consequences

The core can be used by future interfaces and models without owning their dependencies. Invalid or
stale writes fail explicitly. The team must synchronize documentation and structured state, and must
design migration before breaking schema version 1.

## Security and privacy impact

Strict keys, length bounds, safe paths, timestamp validation, cross-record checks, and defensive copies
reduce malformed input and mutation risk. No personal data, secret, network boundary, or external
processor is introduced.

## Rollout and reversal

Adopt the read-first workflow immediately. A future storage adapter can replace the in-memory adapter
without changing domain policy. Reversal would remove the core and repository documents before any
durable data exists; after persistence, reversal requires an export and migration plan.
