<!-- builderai-document
type: ai-rules
version: 1
-->

# Fixture AI Rules

## Required behavior

1. Read architecture and constitution before editing files.
2. Preserve unrelated work and use the smallest sufficient change.
3. Report exact validation commands and outcomes.

## Prohibited actions without explicit approval

- Editing `server/secrets/`.
- Running destructive commands.
- Bypassing tests or lint rules.

## Verification and handoff

Run `npm run build` and `npm test` when executable code changes.
