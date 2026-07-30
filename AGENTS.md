# Repository instructions for coding agents

Before changing code, parse and read the canonical `project-brain.json`, then read Project Brain policy
in this order:

1. `docs/project-constitution.md`
2. `docs/project-blueprint.md`
3. `docs/project-memory.md`
4. `docs/decision-log.md`
5. `docs/progress-log.md`
6. `docs/task-system.md`
7. `docs/domain-glossary.md`

Then read `docs/ai-rules.md`, `docs/architecture.md`, `docs/coding-standards.md`, and
`docs/security.md`. Mutable facts come only from `project-brain.json`; documentation must not duplicate
them. No tool-specific context overrides the canonical state or constitution.

- Do not implement product AI features unless the user explicitly approves a scoped proposal.
- Preserve unrelated work and keep changes within the requested capability.
- Use strict TypeScript and maintain the documented module boundaries.
- Do not add dependencies without documenting the need and review considerations.
- Run `npm run ci` before declaring implementation work complete.
- Mutate canonical Project Brain state only through explicit intent-based commands and add an ADR when
  a change alters a durable architectural decision.
- Do not begin the next sprint without explicit user approval.
