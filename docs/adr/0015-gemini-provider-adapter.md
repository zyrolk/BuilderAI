# ADR-015: Add Gemini through the existing provider port

## Status

Accepted

## Context

BuilderAI already integrates OpenAI through the provider-neutral `AIProvider` contract. Local
development also needs Google AI Studio's Gemini API without coupling core, UI, or application workflow
contracts to another SDK or creating provider routing behavior.

## Decision drivers

- Preserve every existing core contract and the OpenAI integration.
- Select one local provider using server configuration only.
- Keep credentials, SDK types, wire models, and network behavior outside core and browser code.
- Preserve single-response structured output and existing Execution Engine policy.
- Fail closed on malformed output, quota, availability, cancellation, or configuration errors.

## Considered options

1. Add Gemini fields and selection logic to the core provider contract.
2. Replace OpenAI with Gemini.
3. Implement an isolated Gemini adapter and choose one provider in the local server composition root.
4. Add a dynamic multi-provider router with fallback.

## Decision

Use option 3. `src/providers/gemini` implements the unchanged `AIProvider` interface. Its sole SDK
transport uses `@google/genai`; all request/response models, validators, mappers, and error translation
remain inside that provider boundary. It sends one non-streaming, text-only, structured JSON request and
declares only capabilities actually used by BuilderAI.

`BUILDERAI_AI_PROVIDER` must be exactly `openai` or `gemini`. The server composition constructs only the
selected adapter and requires only that provider's API key and model. `GEMINI_API_KEY` and
`GEMINI_MODEL` are the Gemini settings. No client code, core service, registry, automatic fallback, or
runtime routing decision selects a provider.

The Gemini SDK's retry attempts are fixed at one, including the original request. The adapter requires a
single `STOP` candidate, structured response text, validated usage metadata, valid JSON, and conformance
to the Prompt Package Output Contract. Existing BuilderAI validation remains authoritative.

## Consequences

Positive:

- Local operators can use either OpenAI or Gemini without code changes.
- Core remains provider-independent and OpenAI behavior remains intact.
- Tests use injected transports and perform no external calls.
- Errors, cancellation, timeouts, limits, and structured output retain one BuilderAI contract.

Negative:

- A second provider-specific mapper and execution composition service must evolve with its SDK.
- The official Gemini SDK expands the production dependency graph and must remain audit-reviewed.
- Free-tier quota, regional availability, and provider data terms can block or constrain local testing.
- Switching configuration requires restarting the local server.

## Security and privacy

The API key is server-only and excluded from Git, client bundles, metadata, logs, and errors. Google
free-tier content handling may permit submitted data to improve Google products, so free-tier use is
restricted to non-sensitive test projects unless a separate privacy and provider-terms review approves
more. No raw response body or credential crosses the adapter boundary.

## Verification and reversal

Unit and integration tests cover closed configuration, mapping, validation, contract enforcement,
cancellation, timeout/error translation, no-retry behavior, and Execution Engine integration. CI and a
credentialed local smoke test are required for release evidence. Reversal removes the Gemini provider,
its SDK dependency, the `gemini` composition branch, and its settings; OpenAI and all core contracts
remain usable.
