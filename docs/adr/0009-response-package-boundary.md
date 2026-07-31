# ADR-009: Introduce one deterministic Response Package boundary

- **Status:** Accepted
- **Date:** 2026-07-31
- **Owners:** BuilderAI architecture
- **Related:** Sprint 8 Response Processing Foundation

## Context

BuilderAI can produce a validated provider response and terminal Execution Result, but provider artifacts
are transport-oriented and are not safe inputs to a future project-change workflow. The next boundary
must classify and normalize generated text, describe it in a deterministic manifest, and verify its
integrity without reading or writing files.

## Decision drivers

- Keep response processing provider, framework, storage, and transport independent.
- Preserve the terminal Execution Result as immutable execution provenance.
- Support only source file, documentation, configuration, test, and patch artifacts.
- Reject ambiguous structured output, duplicate logical paths, malformed metadata, and integrity drift.
- Make normalization, size accounting, ordering, and checksums deterministic.
- Perform no file, Git, network, persistence, telemetry, tool, or project mutation behavior.

## Considered options

1. Let every future project-change adapter interpret provider output independently.
2. Add generated-file models to the provider response contract.
3. Introduce one provider-neutral Response Package after provider and execution validation.
4. Write generated artifacts to a temporary directory while constructing a manifest.

## Decision

Use option 3. `src/core/response-processor` accepts a correlated, completed `AIProviderResponse` and
`ExecutionResult`. Generated artifact candidates come only from the single structured provider
artifact's `artifacts` array. The processor validates the closed artifact model, normalizes line
endings and ordering, creates an in-memory manifest, and verifies every manifest entry against the
normalized content before returning a defensive copy.

Logical paths are normalized repository-relative POSIX paths and are compared case-insensitively for
duplicate detection so a package remains safe across common filesystems. Artifact content remains
plain text and is never interpreted or executed. Metadata is scalar, bounded, and canonically ordered;
each artifact requires a non-empty `description` by default.

Manifest checksums use SHA-256 through a small checksum port and the platform Web Crypto
implementation. The checksum proves accidental or malicious package drift during processing; it is
not a signature, identity assertion, authorization decision, or permission to apply an artifact.

## Consequences

Future project-change capabilities receive one validated Response Package instead of provider wire
data. Provider and Execution Engine contracts remain unchanged, package creation is deterministic for
identical inputs, and no filesystem or Git capability is introduced.

The current nested artifact contract is validated by this boundary rather than the Prompt Output
Contract because that contract supports only top-level types. A future versioned nested output schema
may move rejection earlier, but it must not introduce provider-specific fields. Applying patches,
writing files, conflict resolution, authorization, review, rollback, and persistence remain separate
future decisions.

## Security and privacy impact

Provider output is untrusted even after transport validation. The processor rejects unsafe paths,
unsupported types, non-scalar metadata, duplicate paths, inconsistent execution identity, unexpected
manifest structure, checksum mismatch, and size-limit violations. It performs no external effects and
does not log package content.

## Rollout and reversal

Unit tests cover parsing, validation, normalization, ordering, checksums, limits, duplicates, metadata,
and end-to-end package construction. Reversal removes only `src/core/response-processor`; existing
provider and execution contracts remain compatible.
