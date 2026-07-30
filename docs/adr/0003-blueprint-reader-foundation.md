# ADR-003: Deterministic Blueprint Reader boundary

- **Status:** Accepted
- **Date:** 2026-07-30
- **Owners:** BuilderAI architecture
- **Related:** Sprint 2 Blueprint Reader Foundation

## Context

BuilderAI needs a portable way to discover and understand its project documentation. The capability
must work before, and independently of, any UI workflow, durable storage, external API, automation, or
AI provider. Documentation also needs an explicit contract so incompatible changes fail visibly rather
than changing interpretation silently.

## Decision drivers

- Framework, AI, and storage independence.
- Deterministic and testable interpretation.
- One canonical owner for mutable project facts.
- Explicit document compatibility and diagnostics.
- A safe local filesystem boundary without selecting durable persistence.

## Considered options

1. Parse documentation inside Next.js routes.
2. Infer document meaning with an AI provider.
3. Place deterministic reader policy in a core boundary behind a document-source port.

## Decision

Use option 3. `src/core/blueprint-reader` owns required-document specifications, Markdown parsing,
runtime validation, analysis, relationships, consistency diagnostics, and structured summaries. It
depends on the existing Project Brain runtime parser and a minimal `DocumentSource` port. A Node
filesystem implementation remains in `src/infrastructure/blueprint-reader`.

Every required Markdown document declares a stable `builderai-document` type and version header.
Headers and prose define structure and policy only; `project-brain.json` remains the sole owner of
mutable project state. Unknown documents are warnings, while missing, duplicate, malformed,
incompatible, conflicting, and duplicated-state findings invalidate the read result.

## Consequences

The reader can operate over local files or future sources without changing core policy, and every
interpretation is reproducible without an AI provider. Document format evolution now requires explicit
version support. Markdown parsing intentionally supports the approved contract rather than arbitrary
Markdown semantics.

## Security and privacy impact

Documents are untrusted data and are never executed or used to trigger network access. The local
adapter constrains reads to the configured project root. Size and archive limits remain required before
remote or user-controlled project ingestion is approved.

## Rollout and reversal

CI reads the current repository through the production adapter and exercises malformed, missing,
duplicate, conflicting, and incompatible inputs through in-memory sources. Replacing the port or parser
requires contract and compatibility tests. Reversal would remove deterministic project understanding
and is not supported; incompatible formats require a migration ADR.
