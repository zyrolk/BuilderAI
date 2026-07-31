# ADR-005: Use a closed provider-neutral adapter contract

- **Status:** Accepted; request prompt payload amended by ADR-006
- **Date:** 2026-07-30
- **Owners:** BuilderAI architecture
- **Related:** Sprint 4 AI Provider Adapter Foundation

## Context

BuilderAI may support different AI providers in the future, but coupling core policy to a provider SDK,
transport, credential shape, execution workflow, or provider-specific configuration would make the core
non-portable and allow integrations to bypass the Context Package boundary. Sprint 4 authorizes only
the architecture needed to describe and discover future adapters.

## Decision drivers

- Provider and framework independence.
- One validated input boundary based on the Context Package.
- Explicit, discoverable capabilities and limits.
- Closed configuration without credentials or endpoints.
- Deterministic discovery without execution side effects.
- Typed failures and independently testable runtime contracts.

## Considered options

1. Add provider SDK abstractions directly to BuilderAI services.
2. Use an open dictionary for provider-specific configuration and payloads.
3. Define a versioned, closed core port with provider-neutral request, response, capability,
   configuration, registry, compatibility, and error contracts.

## Decision

Use option 3. `src/core/ai-provider` owns the `AIProvider` port, discriminated request and response
contracts, capability descriptor, configuration policy, typed error taxonomy, runtime validators,
compatibility service, and in-memory registry. Character counts are used for capacity and usage because
they are deterministic. ADR-006 subsequently inserts the Prompt Package boundary: current requests
accept one versioned Prompt Package rather than the source Context Package and duplicate task.

Configuration accepts only enablement, deterministic priority, timeouts, execution modes, and required
capabilities. Validators reject undeclared fields. Registration snapshots validated descriptors and
configuration, rejects duplicate or mismatched identities, and never invokes the provider. The port's
execution signature describes the boundary a future adapter must implement, but no production adapter
or execution service exists in this sprint.

## Consequences

BuilderAI core code can discover future adapters and reason about compatibility without importing or
knowing their implementation. Request/response drift and capability mismatches fail with typed errors.
Provider-specific options cannot leak into the core configuration. A future adapter will need a
separate boundary for its SDK, transport, credentials, streaming behavior, and operational controls.

The cancellation signal exposes provider-neutral state and subscription contracts. Active signal
creation, propagation, cleanup, and deadline enforcement remain responsibilities of a future approved
execution orchestrator.

## Security and privacy impact

The closed schema reduces accidental credential and endpoint exposure. Context and response artifacts
remain sensitive, untrusted data. The contract does not authorize logging, persistence, networking, or
external disclosure. Any future provider integration requires data classification, redaction,
authorization, threat modeling, provider review, retention policy, and incident controls.

## Rollout and reversal

Runtime validators and unit tests cover capabilities, configuration, request/response contracts,
exchange invariants, registry behavior, compatibility, descriptor drift, and typed errors. Breaking
contract changes require a new contract version and migration ADR. Removing the boundary would permit
provider coupling in core code and is not supported.
