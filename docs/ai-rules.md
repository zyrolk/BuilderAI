<!-- builderai-document
type: ai-rules
version: 1
-->

# AI-assisted development rules

These rules govern coding assistants and automated agents working in this repository. They do not
authorize product AI capabilities.

## Required behavior

1. Read the canonical Project Brain, constitution, and six Project Brain policy documents, then the
   repository instructions and relevant supporting documentation, before changing files.
2. Preserve user-owned changes. Inspect Git state and never overwrite unrelated work.
3. Keep work within the stated scope. Ask for a decision when requirements materially affect product,
   architecture, security, cost, or irreversible external state.
4. State assumptions and validate them against repository evidence.
5. Use existing patterns and the smallest sufficient change. Do not add speculative abstractions,
   dependencies, services, or configuration.
6. Treat generated code as untrusted until it has been reviewed, typed, linted, tested, and built.
7. Never fabricate test results, tool output, citations, files, APIs, or completion status.
8. Do not expose secrets or personal data in prompts, logs, fixtures, commits, or responses.
9. Do not weaken security controls, tests, types, or lint rules merely to make a check pass.
10. Record consequential architectural decisions and synchronize memory, progress, tasks, vocabulary,
    and affected documentation.

## Prohibited actions without explicit approval

- Adding an AI model, SDK, provider, prompt, vector store, agent framework, or AI-facing endpoint.
- Sending repository content, customer data, credentials, or production telemetry to an external AI
  service.
- Running destructive commands, rewriting shared history, deploying, publishing packages, changing
  production data, or contacting external users.
- Auto-merging changes or bypassing branch protection and review controls.

## Verification and handoff

Agents must run checks proportionate to the change and report the exact commands and outcomes. If a
check cannot run, report why and the remaining risk. Handoffs summarize files changed, decisions,
known limitations, and the next concrete step.

## Product AI boundary

Product AI is a separate architectural concern. It requires discovery, evaluation criteria, threat
modeling, privacy and provider review, cost controls, human oversight, incident handling, and explicit
approval before implementation. See the AI feature gate in `roadmap.md`.
