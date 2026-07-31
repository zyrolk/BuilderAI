# Gemini Local Development

## Scope

This profile adds Google AI Studio's Gemini Developer API as a local alternative to OpenAI. It changes
no core contract and provides no routing, fallback, streaming, tools, files, images, or browser-side SDK.

## Configuration

Create or update the Git-ignored `.env.local` file:

```text
BUILDERAI_LIVE_WORKFLOW_ENABLED=true
BUILDERAI_PROJECT_ROOT=<absolute trusted project root>
BUILDERAI_AI_PROVIDER=gemini
GEMINI_API_KEY=<Google AI Studio API key>
GEMINI_MODEL=gemini-3.5-flash
```

`GEMINI_API_KEY` is the preferred server-only key variable for the Gemini Developer API. The adapter
does not read environment variables itself; the local server composition validates and injects the
selected provider's values. `GOOGLE_GENAI_USE_VERTEXAI` is intentionally unsupported because this
profile does not integrate Vertex AI.

The model is explicit rather than hard-coded. `gemini-3.5-flash` is the recommended current model for
local structured-output testing on eligible free-tier projects. Google controls per-project quota,
model availability, and regional access, so confirm current limits in AI Studio.

After changing `.env.local`, restart `npm run dev`; Next.js reads server environment configuration at
startup. The Workspace should display `Runtime connected`. Entering a non-empty scoped request enables
`Prepare change plan`.

## Safe smoke test

1. Use a non-sensitive test project; free-tier provider terms may allow submitted content to improve
   Google products.
2. Start BuilderAI on loopback only.
3. Open `/workspace` and confirm the configured runtime is connected.
4. Enter a narrowly scoped documentation-only request and select `Prepare change plan`.
5. Confirm a Response Package and Change Plan are displayed.
6. Do not approve Apply unless every operation is expected; preparation alone performs no file write.
7. Treat 429 quota, 403 credential/region, and 5xx availability failures as closed failures. BuilderAI
   does not fall back to OpenAI automatically.

## Troubleshooting

- `INVALID_CONFIGURATION` with HTTP 404 from Gemini can mean the configured model is unavailable to the
  API project. Use the current documented model ID; `gemini-2.5-flash` is unavailable to new users as of
  the recorded 2026-07-31 smoke test, while `gemini-3.5-flash` completed the local free-tier request.
- `PROVIDER_UNAVAILABLE` combined with `TypeError: fetch failed` and cause code `EACCES` means the local
  process cannot make outbound HTTPS requests. Run the trusted local server in an environment that
  permits the Gemini endpoint; do not add proxy or network behavior to BuilderAI core.
- `RESPONSE_PROCESSOR_VALIDATION_FAILED` means provider JSON passed the top-level Output Contract but a
  nested generated artifact violated the existing Response Processor contract. The Gemini request
  mapper supplies nested JSON Schema for `logicalPath`, `type`, `content`, `metadata.description`, and
  `metadata.change-operation`; keep its regression test aligned with those existing boundaries.
- Route messages remain intentionally redacted. Use the correlated server-side stable error code and
  reproduce with non-sensitive input; never log API keys or raw provider content.

To return to OpenAI, set `BUILDERAI_AI_PROVIDER=openai`, provide `OPENAI_API_KEY` and `OPENAI_MODEL`,
remove the Gemini secret from the local environment, and restart the server.
