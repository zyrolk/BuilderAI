# ADR-008: Isolate the first provider behind the OpenAI Responses adapter

- **Status:** Accepted
- **Date:** 2026-07-31
- **Owners:** BuilderAI architecture
- **Related:** Sprint 7 First AI Provider Adapter

## Context

BuilderAI now owns provider-neutral Prompt Package, AI Provider, and Execution Engine contracts but has
no concrete provider. The first integration must prove those boundaries without moving vendor SDK
types, credentials, transport behavior, or response assumptions into core. It must also prevent the
official SDK's automatic retry behavior from competing with Execution Engine policy.

## Decision drivers

- Integrate exactly one provider through the existing `AIProvider` port.
- Use the non-streaming OpenAI Responses API with structured JSON output.
- Keep the model configurable and avoid a hard-coded model policy.
- Validate configuration, credentials, mapped requests, raw responses, structured output, and the
  final BuilderAI exchange.
- Keep retries, lifecycle state, and final Results governed by existing core services.
- Add no tools, functions, files, images, history, background work, UI, persistence, or telemetry.

## Considered options

1. Call the REST endpoint directly from BuilderAI core.
2. Add OpenAI-specific fields to the core provider request and response models.
3. Use the official OpenAI Node SDK only inside an isolated provider transport and map through existing
   core contracts.
4. Build a multi-provider routing layer while adding the first provider.

## Decision

Use option 3. `src/providers/openai` owns OpenAI configuration, credentials, SDK transport, request and
response mappers, raw-response and structured-output validation, error translation, and a single-call
Execution Engine integration service. Core imports nothing from this adapter.

The provider ID is `openai-responses`. The model is a required runtime configuration value; BuilderAI
does not choose or silently upgrade it. The official SDK is configured with `maxRetries: 0`. Calls set
`stream: false`, `background: false`, `store: false`, disable truncation, expose no tools, and request a
JSON Schema text format. The current provider-neutral Output Contract describes only top-level field
types, so the mapper uses non-strict provider-side schema enforcement and performs authoritative
runtime validation after JSON parsing. Tightening nested output schemas requires a future versioned
Output Contract, not provider-specific core fields.

Credentials are injected explicitly and validated for presence. The adapter never reads environment
variables, stores credentials in configuration, logs them, or includes them in errors. The SDK transport
bridges the existing cancellation subscription to one request-scoped abort signal and applies the
request timeout. No provider or adapter retry is performed.

## Consequences

The complete architecture can execute one validated Prompt Package and return one validated BuilderAI
response and Execution Result without changing core contracts. OpenAI-specific change remains isolated,
and tests can replace the network client with a deterministic transport double.

There is no live API test in CI because CI must not require credentials, spend money, or disclose
repository context. Model compatibility and production account configuration require a separately
controlled smoke test before release. Nested strict structured output, multi-provider routing,
streaming, tools, files, images, history, persistence, telemetry, and automatic execution retries remain
out of scope.

## Security and privacy impact

The adapter creates the first external disclosure boundary. Callers must authorize and classify every
Prompt Package before invocation. Requests disable API-side storage but this is not a substitute for an
approved OpenAI organization retention policy or data-processing review. Raw responses and structured
content remain untrusted and are validated before crossing into core. Error mapping emits stable
BuilderAI errors without returning provider payloads or credentials.

## Rollout and reversal

Unit and integration tests use an in-memory transport double and cover configuration, mapping,
validation, errors, cancellation, SDK retry settings, contract enforcement, and lifecycle integration.
The full CI pipeline must pass. Reversal removes only `src/providers/openai` and the `openai` dependency;
core contracts remain unchanged.
