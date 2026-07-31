# BuilderAI MVP v1.0 Operations

## Release profile

BuilderAI v1.0 is a local, trusted-project, single-operator release candidate. The dashboard and review
interface are safe to run without provider configuration. Live preparation, file application, and
verification are opt-in and fail closed.

This profile is not approved for public hosting, shared workstations, untrusted repositories, or
multi-instance operation. Those deployments require authentication, authorization, durable
idempotency, distributed concurrency control, isolated runners, no-network enforcement, recovery, and
operational audit storage.

## Server configuration

Required live settings:

| Variable                          | Purpose                                     |
| --------------------------------- | ------------------------------------------- |
| `BUILDERAI_LIVE_WORKFLOW_ENABLED` | Must equal `true` to leave review mode      |
| `BUILDERAI_PROJECT_ROOT`          | Absolute root of the trusted target project |
| `BUILDERAI_AI_PROVIDER`           | Exactly `openai` or `gemini`                |

Only the selected provider's settings are required:

| Provider | Credential       | Model          |
| -------- | ---------------- | -------------- |
| OpenAI   | `OPENAI_API_KEY` | `OPENAI_MODEL` |
| Gemini   | `GEMINI_API_KEY` | `GEMINI_MODEL` |

`GEMINI_API_KEY` is the recommended Google AI Studio variable. Do not use client-visible variables or
set `GOOGLE_GENAI_USE_VERTEXAI`; this local adapter targets the Gemini Developer API, not Vertex AI.
`gemini-3.5-flash` is the recommended current default for local free-tier testing, while the model name
remains explicit so operators can respond to Google availability and quota changes without code edits.

Optional settings are range validated:

| Variable                                  | Default | Supported range        |
| ----------------------------------------- | ------: | ---------------------- |
| `BUILDERAI_PROVIDER_TIMEOUT_MS`           |  120000 | 1,000–600,000 ms       |
| `BUILDERAI_PROVIDER_MAX_TIMEOUT_MS`       |  120000 | 1,000–600,000 ms       |
| `BUILDERAI_PREPARATION_TTL_MS`            |  900000 | 60,000–3,600,000 ms    |
| `BUILDERAI_MAX_PREPARATIONS`              |      50 | 1–500                  |
| `BUILDERAI_VERIFICATION_TIMEOUT_MS`       |  600000 | 10,000–1,800,000 ms    |
| `BUILDERAI_VERIFICATION_MAX_OUTPUT_BYTES` | 1000000 | 1,024–10,000,000 bytes |

Provider input, output character, and output-token limits also have bounded environment overrides in
`local-runtime-configuration.ts`. Do not store real values in Git, screenshots, logs, issue text, or
client-visible variables.

Changing provider requires only environment configuration and a development-server restart. Remove the
unselected provider's secret from the local environment rather than retaining unnecessary credentials.

## Operator workflow

1. Start BuilderAI on loopback and confirm the workspace says `Runtime connected`.
2. Submit a scoped request. Preparation may send the selected Context Package to the configured
   provider, but performs no filesystem change.
3. Inspect every operation, target path, warning, and risk in the Change Plan.
4. Check the explicit approval control only if the plan is acceptable.
5. Review Apply Result. A Rejected, Failed, or Partially Applied result never starts verification.
6. Review all four Verification Report stages. A failed or partial report requires manual diagnosis;
   BuilderAI performs no repair, Git, rollback, or deployment action.

## Failure and recovery

- A missing or invalid configuration leaves the UI in review mode.
- A preparation expires and becomes unusable after its TTL or server restart.
- An in-flight duplicate approval is rejected; a completed duplicate returns the original evidence.
- A preflight failure performs zero file changes.
- A runtime mutation failure may leave earlier operations applied. Stop, inspect the Apply Result,
  reconcile manually, and restore through existing project recovery procedures.
- Verification timeouts and command failures are reported without raw command output.

## Release verification

Run `npm run ci` from a clean dependency installation. CI checks formatting, ESLint, strict TypeScript,
all tests with coverage thresholds, production dependency audit, and the standalone production build.
Run the full dependency audit separately and review the documented development-only exception in
`security.md`.
