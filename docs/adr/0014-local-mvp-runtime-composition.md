# ADR-014: Compose MVP v1.0 as an explicit local-only operator runtime

- **Status:** Accepted
- **Date:** 2026-07-31
- **Owners:** BuilderAI architecture
- **Related:** Sprint 13 End-to-End Integration, Hardening and MVP Release

## Context

Sprints 1–12 established validated core contracts, one provider adapter, effect boundaries, and a
fail-closed interface. MVP v1.0 must connect those existing pieces without moving provider,
filesystem, process, or policy code into the browser or changing a core contract. Authentication,
multi-user authorization, durable workflow storage, sandboxed untrusted builds, rollback, deployment,
and Git automation remain outside the approved product scope.

## Decision

Add a server-only application composition under `src/application/workspace` and concrete local
adapters under `src/infrastructure`. Preparation reads and validates the configured project's
canonical Project Brain and documentation, derives one execution-scoped task from the bounded user
request, and passes the result through every existing package boundary. The derived task exists only
in request context and never replaces or persists canonical state.

Store each validated plan behind an opaque random preparation identifier in a bounded, expiring,
process-local store. The apply route accepts only that identifier plus explicit approval. The server
claims its own stored plan once, applies it through the existing engine, and invokes verification only
for an Applied result. Completed outcomes are idempotently replayed for the preparation lifetime.

Enable live behavior only when explicit server configuration is complete. Restrict route requests to
same-origin loopback JSON with bounded payloads. Keep OpenAI credentials server-only. Use a root-scoped
conditional Node filesystem adapter and fixed shell-free npm verification commands with a reduced
environment, active deadlines, bounded output, and no raw output exposure. Emit correlated structured
stage events without request or provider payloads.

## Consequences

The browser cannot substitute a different plan, bypass core validation, apply before review, or invoke
verification for a non-Applied result. Core remains provider, framework, storage, filesystem, and
runner implementation independent. Missing or invalid configuration preserves review mode.

The runtime is deliberately single-process and single-operator. In-memory preparations do not survive
restart or scale across instances. Loopback origin enforcement is not user authentication. Verification
executes trusted project package scripts and cannot guarantee operating-system sandboxing, no-network
execution, resource isolation, or complete descendant termination. Multi-file apply remains
non-transactional and has no rollback. These constraints block remote, shared, hosted, or
untrusted-project deployment but are explicit accepted limits for the local MVP release candidate.

## Security and privacy impact

Provider context may include selected source and documentation and leaves the machine only after a
local operator submits a request. Secrets are read by the server composition only, excluded from child
process environments and structured logs, and never returned by routes. Generated artifacts remain
untrusted until response, plan, apply, and verification validation completes. Protected paths remain
enforced by the existing non-removable policy.

## Rollout and reversal

The runtime is off by default. Disabling `BUILDERAI_LIVE_WORKFLOW_ENABLED` restores review-only behavior
without code changes. Integration tests use a deterministic provider transport, in-memory filesystem,
and controlled verification ports. Production adapters have containment and negative tests. Removing
the application, infrastructure, and route composition leaves all earlier core and UI contracts intact.
