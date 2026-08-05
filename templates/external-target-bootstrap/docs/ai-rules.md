<!-- builderai-document
type: ai-rules
version: 1
-->

# AI-assisted development rules

These rules govern BuilderAI and other coding assistants working in this target repository.

## Required behavior

1. Read `docs/architecture.md`, this file, and `.builderai/target-project.json` before changing code.
2. Preserve unrelated work and stay within the requested scope.
3. Use existing patterns and the smallest sufficient change.
4. Never fabricate test results, tool output, or completion status.
5. Do not expose secrets in prompts, logs, fixtures, or commits.

## Prohibited actions without explicit approval

- Modifying protected paths listed in the target manifest.
- Running destructive commands or changing production infrastructure.
- Adding new external AI providers or sending repository content to third-party services.
- Bypassing tests, lint rules, or type checks to make validation pass.

## Verification and handoff

Run the project's build and test scripts when the change touches executable code. Report the exact
commands and outcomes. If a check cannot run, explain why and the remaining risk.
