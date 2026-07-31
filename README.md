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
