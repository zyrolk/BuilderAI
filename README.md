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

## OpenAI provider boundary

Sprint 7 supplies one server-side `AIProvider` implementation under `src/providers/openai`. Its model,
timeouts, character limits, and output-token limit are explicit validated configuration; no default
model is selected. The API key must be obtained by a future server-only composition root from an
approved secret manager and passed explicitly to `createOpenAIProvider`. The adapter does not read
environment variables, and it is not connected to a route, UI, automatic workflow, or live CI test.

## Response processing boundary

`src/core/response-processor` converts a correlated completed provider response and Execution Result
into one versioned, normalized, manifest-backed Response Package. It supports only source,
documentation, configuration, test, and patch artifacts and performs no filesystem, Git, network,
persistence, telemetry, execution, or project-modification operation. A valid package is reviewable
output data, not authorization to apply changes.

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
one versioned Passed, Failed, or Partially Passed report. The foundation provides no concrete process
runner, framework integration, networking, Git, rollback, deployment, or automatic repair; a report is
verification evidence, not authorization for another effect.
