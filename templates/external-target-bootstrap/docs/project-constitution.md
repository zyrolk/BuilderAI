<!-- builderai-document
type: project-constitution
version: 1
-->

# Target Project Constitution

## Authority

The target repository owns its architecture, development rules, and optional `project-brain.json`.
BuilderAI reads this constitution and `docs/ai-rules.md` before making changes. When present,
`.builderai/target-project.json` supplies project identity for external-target sessions.

## Precedence

1. This constitution governs process and non-negotiable principles.
2. `docs/architecture.md` governs module boundaries and scope.
3. `docs/ai-rules.md` governs AI-assisted development behavior.
4. Package manifests remain authoritative for build and test commands.

## Non-negotiable principles

1. Do not weaken authentication, authorization, or secret handling.
2. Do not modify protected paths without explicit operator approval.
3. Preserve unrelated work and keep changes within the requested scope.
4. Run the project's build and test commands before declaring work complete.

## Change protocol

1. Read architecture and AI rules before editing files.
2. State assumptions when repository evidence is incomplete.
3. Report exact validation commands and outcomes in the handoff.
