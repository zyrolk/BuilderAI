# ADR-007: Use one pure append-only execution lifecycle

- **Status:** Accepted
- **Date:** 2026-07-30
- **Owners:** BuilderAI architecture
- **Related:** Sprint 6 Execution Engine Foundation

## Context

The Prompt Package and AI Provider port define stable data boundaries, but they do not define who owns
execution state, retry and timeout decisions, cancellation intent, or terminal results. Leaving those
rules to future provider adapters would create inconsistent lifecycles and couple core policy to
provider behavior. Adding a queue, timer, persistence, or invocation now would exceed the approved
foundation and prematurely select runtime infrastructure.

## Decision drivers

- One provider-independent orchestration boundary.
- Closed, deterministic, testable state transitions.
- Immutable execution identity and append-only history.
- Explicit bounded retry, timeout, priority, validation, and failure policy.
- Clear separation between policy decisions and runtime effects.
- No provider, SDK, network, credentials, tools, queue, timer, storage, or execution.

## Considered options

1. Let each future provider adapter own lifecycle and retry behavior.
2. Store a mutable status field without transition evidence.
3. Introduce a runtime queue and provider invocation service now.
4. Define one pure state-machine boundary and defer every effect to future adapters.

## Decision

Use option 4. `src/core/execution-engine` accepts a versioned request containing one validated Prompt
Package, metadata, closed policy, and cancellation port. It creates immutable versioned snapshots and
allows state changes only through the declared transition graph. Each change increments the revision,
records a monotonic timestamp, preserves execution identity, appends transition evidence, and counts
attempts only when entering the reserved Executing state. Its application-facing service exposes
intent-specific commands and keeps the generic transition primitive private, preventing direct requeue,
timeout, or cancellation paths from bypassing their policy checks.

Retry evaluation is a pure decision based on failure strategy, failure retryability, an error-code
allowlist, completed attempts, delay strategy, and cancellation state. Timeout evaluation compares an
explicit caller timestamp with the configured start transition. Neither service waits, schedules,
creates timers, or performs cancellation. Terminal Results can be constructed only from validated
Completed, Failed, Cancelled, or Timed Out snapshots and use placeholders for future usage and artifacts.
Retryable active attempts return directly from Executing to Queued through the retry command; Failed
remains terminal and can never be requeued.

## Consequences

Lifecycle invariants are centralized, deterministic, and independently testable. Future runtime and
provider adapters must consume these decisions rather than inventing their own state rules. State
history can support later auditing and persistence without committing to a storage technology.

The foundation does not queue work, enforce deadlines, actively cancel, invoke a provider, persist
snapshots, recover work, coordinate concurrency, guarantee idempotency, stream, execute tools, or emit
telemetry. Those capabilities require separate architecture, security controls, and approval.

## Security and privacy impact

Requests and Results may later contain sensitive prompt and provider data. This core performs no
logging, persistence, networking, external disclosure, or payload execution. Identity, history,
timestamps, and terminal-result consistency are validated. Runtime authorization, trusted clocks,
redaction, retention, concurrency, queue bounds, cancellation enforcement, and response isolation remain
mandatory before any provider can run.

## Rollout and reversal

Tests cover valid and illegal transitions, immutable history, attempt and revision accounting, retry
limits and delays, timeout boundaries, cancellation preconditions, request and policy validation, and
terminal Results. Breaking lifecycle or schema changes require a new version and migration ADR. Removing
the boundary would return lifecycle ownership to adapters and is not supported.
