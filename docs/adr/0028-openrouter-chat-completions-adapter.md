# ADR-028: Add OpenRouter through an isolated Chat Completions adapter

## Status

Accepted

## Context

Phase 4 pilot recovery requires an alternate provider when Gemini is unavailable. OpenRouter exposes an
OpenAI-compatible Chat Completions API, but BuilderAI's existing OpenAI adapter uses the OpenAI Responses
API (`client.responses.create()`). OpenRouter does not support that surface, so changing the OpenAI base URL
alone cannot route traffic to OpenRouter without breaking the existing OpenAI integration.

## Decision drivers

- Preserve OpenAI Responses and Gemini adapters unchanged.
- Add a third, isolated provider for manual operator selection only.
- Require structured JSON schema output; BuilderAI runtime validation remains authoritative.
- Reuse the existing `AIProviderError` taxonomy and ADR-019 bounded retry semantics.
- Keep credentials server-side and out of logs, HTTP responses, plans, and client bundles.
- Fail closed when OpenRouter is selected without a valid API key or explicit model.

## Considered options

1. Reuse the OpenAI Responses adapter with an OpenRouter base URL.
2. Convert the OpenAI adapter into a generic OpenAI-compatible adapter shared by OpenAI and OpenRouter.
3. Implement a dedicated `src/providers/openrouter` adapter using the OpenAI npm package for Chat
   Completions transport only.
4. Add automatic provider fallback when the selected provider is unavailable.

## Decision

Use option 3. `src/providers/openrouter` implements the unchanged `AIProvider` port. Its sole SDK transport
uses the existing `openai@7.2.0` package with a configurable OpenRouter base URL and
`chat.completions.create()`. It does not use the OpenAI Responses API.

`BUILDERAI_AI_PROVIDER` may equal `openrouter`. The server composition constructs only the selected adapter
and requires only that provider's settings:

- `OPENROUTER_API_KEY` (required)
- `OPENROUTER_MODEL` (required; no hardcoded free-model default)
- `OPENROUTER_BASE_URL` (optional; defaults to `https://openrouter.ai/api/v1`)
- `OPENROUTER_HTTP_REFERER` and `OPENROUTER_APP_TITLE` (optional attribution headers)

There is no automatic fallback, registry, or runtime routing beyond the explicit environment selection
(ADR-015 pattern).

Structured output is mandatory. The request mapper maps the Prompt Output Contract to Chat Completions
`response_format: { type: 'json_schema', ... }`. There is no silent fallback to plain JSON mode. BuilderAI
structured-output validation after the provider response remains authoritative.

Finish-reason policy (aligned with ADR-026 semantics for Gemini):

- `stop` → success
- `length` → `OUTPUT_TRUNCATED` (retryable under ADR-019)
- `content_filter` and other unsupported reasons → terminal `CONTRACT_VIOLATION`

SDK retries remain disabled (`maxRetries: 0`). `OpenRouterExecutionService` reuses ADR-019 bounded retry
orchestration: retry only `PROVIDER_UNAVAILABLE` and `OUTPUT_TRUNCATED`, at most one retry (two total
attempts), with each attempt capped to the remaining non-resettable execution timeout budget.

Provider and SDK errors map into the existing `AIProviderError` hierarchy:

- 429 / transient 5xx / network availability → `PROVIDER_UNAVAILABLE`
- 401 / 403 / invalid configuration → `INVALID_CONFIGURATION`
- timeout → `TIMEOUT`
- abort/cancellation → `CANCELLED`
- invalid structured response → `CONTRACT_VIOLATION`

Raw provider response bodies are not exposed in error messages.

## Consequences

Positive:

- Operators can select OpenRouter for Phase 4 recovery without modifying OpenAI or Gemini code paths.
- Chat Completions and Responses API concerns stay separated at the adapter boundary.
- Tests use injected transports; CI requires no live OpenRouter credential.

Negative:

- A third adapter duplicates some mapper/validator structure already present in OpenAI and Gemini.
- Model availability and pricing depend on OpenRouter and the operator's chosen `OPENROUTER_MODEL`.

## Relationship to prior ADRs

- **ADR-015:** Same manual single-provider selection pattern; OpenRouter is a third exhaustive branch.
- **ADR-019:** Reuses bounded single-retry execution-service orchestration and timeout-budget capping.
- **ADR-026:** Finish-reason classification mirrors Gemini's STOP/MAX_TOKENS/policy taxonomy for Chat
  Completions `finish_reason` values.
- **ADR-027:** Unrelated to provider selection; Phase 4 task completion invariants are unchanged.

## Security

`OPENROUTER_API_KEY` is loaded only by the server composition root and passed to the adapter factory. It
must never appear in logs, HTTP responses, FeaturePlans, ChangePlans, Project Brain, pilot logs, or client
bundles.

## Validation

Automated tests cover configuration, request/response mapping, structured JSON schema output, finish-reason
policy, error mapping, ADR-019 retry behavior, secret redaction, and runtime provider selection. Live
OpenRouter smoke tests remain a separate operator-controlled step after mocked CI validation passes.
