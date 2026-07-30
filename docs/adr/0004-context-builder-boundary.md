# ADR-004: One deterministic Context Package boundary

- **Status:** Accepted
- **Date:** 2026-07-30
- **Owners:** BuilderAI architecture
- **Related:** Sprint 3 Context Builder Foundation

## Context

Future project consumers need exact task-relevant context, but allowing each consumer to read canonical
state, documentation, and repository files independently would duplicate selection policy, bypass
governance, and create unbounded inputs. Loading the complete project would also be wasteful and make
context composition unpredictable.

## Decision drivers

- One validated context contract.
- Task relevance without whole-project loading.
- Deterministic priority and dependency rules.
- Configurable, enforceable size limits.
- Framework, storage, network, and consumer independence.
- No duplicated mutable project state.

## Considered options

1. Allow each downstream consumer to assemble its own context.
2. Always serialize the entire Project Brain, documentation set, and repository.
3. Build one task-scoped Context Package through a pure core service.

## Decision

Use option 3. `src/core/context-builder` accepts validated Project Brain state, a valid Blueprint Reader
result, a current task ID, and a storage-independent `ProjectFileSource`. It lists source paths, selects
seeds before reading content, then resolves task-dependency and relative-import graphs. Deterministic
lexical relevance selects the remaining context.

The package declares a fixed priority from constitution, canonical state, and current task through
architecture, blueprint, decisions, progress, standards, rules, and source files. Configured character,
file, document, source-path, and source-read limits are hard boundaries. Optional low-priority items may
be omitted with explicit evidence; mandatory context is never truncated. Invalid references,
conflicting state, duplicate references, duplicate mandatory information, unsafe paths, excessive
source catalogs or reads, and missing required context are rejected.

## Consequences

Every future consumer receives the same bounded, validated contract and cannot silently bypass project
governance. Selection remains explainable and testable without external services. Lexical relevance is
deliberately conservative and depends on clear task, module, and decision vocabulary. Callers must
provide the source port because the core owns no storage adapter.

## Security and privacy impact

Source snapshots are untrusted and potentially sensitive. Package construction does not execute source
content or authorize persistence, logs, network transmission, or disclosure. Safe paths and size limits
are enforced, and conflicts fail closed. A future external boundary requires separate privacy, threat,
authorization, and data-minimization review.

## Rollout and reversal

Unit tests cover selection, priority, dependency graphs, duplicate handling, conflicts, missing context,
references, and hard limits. Removing the boundary would permit inconsistent and unbounded context and
is not supported. A breaking package schema change requires a version migration and ADR.
