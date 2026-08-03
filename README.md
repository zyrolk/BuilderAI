# BuilderAI

BuilderAI uses a validated, model-independent Project Brain to govern engineering work. Read
[`project-brain.json`](project-brain.json) for current project state and
[`docs/project-constitution.md`](docs/project-constitution.md) for its governing rules.

## Prerequisites

- Node.js 24 (see `.nvmrc`)
- npm 11+

## Local development

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`.

## Quality commands

| Command                    | Purpose                                              |
| -------------------------- | ---------------------------------------------------- |
| `npm run format:check`     | Check deterministic formatting                       |
| `npm run lint`             | Run ESLint with zero warnings allowed                |
| `npm run typecheck`        | Run strict TypeScript validation                     |
| `npm test`                 | Run the test suite once                              |
| `npm run test:coverage`    | Run tests with coverage thresholds                   |
| `npm run audit:production` | Block high-severity production dependency advisories |
| `npm run build`            | Create the production Next.js build                  |
| `npm run ci`               | Run the same quality gates used by CI                |

## Documentation

Start with the [documentation index](docs/README.md). Architecture decisions, delivery sequencing,
engineering standards, AI-assisted development rules, and security expectations live there.

## Contribution flow

1. Branch from the default branch.
2. Keep changes focused and include tests for observable behavior.
3. Run `npm run ci` locally.
4. Open a pull request and complete its risk and validation sections.

See [coding standards](docs/coding-standards.md) for the full definition of done.

## MVP v1.0 workflow

BuilderAI v1.0 composes the established architecture on the server:

```text
Project Brain → Blueprint Reader → Context Builder → Prompt Orchestrator
→ Execution Engine → configured AI Provider → Response Processor → Change Planner
→ explicit human approval → File Apply Engine → Verification Engine → final report
```

The dashboard remains available without credentials. Live workflow composition is disabled by
default and is intentionally limited to a trusted, single-operator, loopback environment. It is not
approved for an internet-facing or untrusted-project deployment.

To enable the local runtime, set these server-only environment variables before `npm run dev` or
`npm start`:

```text
BUILDERAI_LIVE_WORKFLOW_ENABLED=true
BUILDERAI_PROJECT_ROOT=<absolute path to the trusted project>
BUILDERAI_AI_PROVIDER=<openai, gemini, or openrouter>
```

Then configure only the selected provider:

```text
# OpenAI
OPENAI_API_KEY=<server-only secret>
OPENAI_MODEL=<explicit supported model identifier>

# Gemini API / Google AI Studio
GEMINI_API_KEY=<server-only Google AI Studio secret>
GEMINI_MODEL=gemini-3.5-flash

# OpenRouter (Chat Completions via OpenAI SDK transport)
OPENROUTER_API_KEY=<server-only secret>
OPENROUTER_MODEL=<explicit supported model identifier>
# OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
# OPENROUTER_HTTP_REFERER=<optional attribution URL>
# OPENROUTER_APP_TITLE=<optional attribution title>
```

Optional bounded settings are documented in [MVP operations](docs/mvp-v1.md). Never prefix secrets
with `NEXT_PUBLIC_`. The runtime accepts same-origin loopback requests only, retains approved plans in
memory for 60 minutes by default, applies the server-held plan rather than browser data, and returns
generic external errors.

## Provider boundaries

OpenAI remains available under `src/providers/openai`. Gemini local development support lives under
`src/providers/gemini`. OpenRouter lives under `src/providers/openrouter` and uses Chat Completions
transport through the existing `openai` npm package with a configurable OpenRouter base URL. All three
implement the unchanged core `AIProvider` port, accept the same validated Prompt Package, return the same
provider-neutral response, disable adapter/SDK retries, and keep their wire models and official SDK imports
isolated. The server composition root selects exactly one adapter from `BUILDERAI_AI_PROVIDER`; no core
service or browser component performs provider routing.

Provider models, timeouts, character limits, and output-token limits are explicit validated
configuration. Credentials are loaded only by the server composition root and passed to the selected
factory; adapters do not read environment variables. Never prefix either API key with `NEXT_PUBLIC_`.
For a Google AI Studio free-tier project, `gemini-3.5-flash` is the recommended current local test model,
but quotas and availability are controlled by Google and may vary by project and region.

## Response processing boundary

`src/core/response-processor` converts a correlated completed provider response and Execution Result
into one versioned, normalized, manifest-backed Response Package. It supports only source,
documentation, configuration, and test artifacts (ADR-017 removed patch artifacts from the contract)
and performs no filesystem, Git, network, persistence, telemetry, execution, or project-modification
operation. A valid package is reviewable output data, not authorization to apply changes.

## Project change planning boundary

`src/core/change-planner` converts a validated Response Package into a deterministic Project Change
Plan containing explicit create, update, and delete intents, source references, ordering, risks,
warnings, and exact summaries. It does not inspect or modify the repository, and every plan states
that real project preconditions remain unverified. A plan is review data, not permission to apply it.

## Safe file apply boundary

`src/core/file-apply` applies validated Project Change Plans through a root-scoped filesystem port.
It validates and inspects the complete plan before mutation, enforces mandatory and configurable
protected paths, rejects symlinks, and returns an exact Apply Result. The engine performs no Git,
build, test, network, deployment, or rollback behavior; execution-time partial application is reported
explicitly rather than hidden.

## Build and verification boundary

`src/core/verification` accepts only a validated Applied File Apply Result and runs Project,
Dependency, Build, and Test stages in fixed order through separate ports. It validates and normalizes
every stage result, continues after contained stage failures to preserve complete evidence, and derives
one versioned Passed, Failed, or Partially Passed report. The local v1.0 composition supplies fixed
npm-based adapters outside core with root containment, no shell, reduced environment, active time
limits, bounded output, and safe result metadata. A report remains evidence, not authorization for
another effect.

## BuilderAI interface

The dashboard at `/` loads live project status through the canonical Project Brain parser. The project
workspace at `/workspace` presents request input, conversation updates, deterministic progress, an
explicit plan approval checkpoint, and readable Response Package, Change Plan, Apply Result, and
Verification Report tabs.

The workspace stays in visible review mode unless the local server runtime is explicitly and validly
configured. When enabled, it communicates through same-origin route handlers, requires plan review and
explicit approval, and never accepts a browser-supplied plan as execution authority. See
[release notes](docs/release-notes/v1.0.0.md) for release scope and limitations.
