<!-- builderai-document
type: project-constitution
version: 1
-->

# BuilderAI Project Constitution

## Authority

[`project-brain.json`](../project-brain.json) is the sole canonical source of mutable BuilderAI project
state. It owns the current Blueprint, Memory, Decision Log, Progress Log, Tasks, and Domain Glossary.
Runtime consumers must load it through `loadCanonicalProjectBrain`, which applies the production
schema and returns a defensive copy.

The Project Brain documentation contains stable governance, field semantics, and mutation policy only:

1. [Project blueprint](project-blueprint.md)
2. [Project memory](project-memory.md)
3. [Decision log](decision-log.md)
4. [Progress log](progress-log.md)
5. [Task system](task-system.md)
6. [Domain glossary](domain-glossary.md)

Documentation must never repeat live milestones, tasks, decisions, technology versions, completion
state, glossary entries, or other mutable facts from the canonical file. Operational manifests such as
`package.json` remain authoritative for executable dependency versions; the canonical Brain references
those manifests rather than copying their values.

Every contributor and automated tool must read and validate `project-brain.json`, then read this
constitution and the relevant policy documents, before changing code.

## Precedence

1. This constitution governs process and invariants.
2. Accepted decisions in canonical state govern architectural choices.
3. All other mutable project facts come from canonical state.
4. Policy documents explain field meaning but do not override canonical values.

Any conflict must be resolved before implementation. Chat history, generated plans, test fixtures, and
tool-specific memory are never project authority.

## Non-negotiable principles

1. Understand canonical project context before implementation.
2. Keep the core independent of AI models, vendors, UI frameworks, databases, and delivery platforms.
3. Validate untrusted state before domain use or storage.
4. Preserve immutable project identity and append-only historical records.
5. Mutate state only through explicit intent-based commands.
6. Apply SOLID and Clean Architecture only where boundaries provide real isolation.
7. Use strict TypeScript, explicit errors, deterministic tests, and optimistic concurrency.
8. Never weaken validation, typing, tests, or security controls to make a change pass.
9. Do not implement AI, chat, LLM, code-generation, or automation capabilities without an approved
   milestone and decision.
10. Do not begin the next sprint without explicit stakeholder approval.

## Change protocol

Before implementation:

1. Parse the canonical Project Brain successfully.
2. Confirm the task, scope, acceptance criteria, constraints, ownership, and dependencies.
3. Resolve ambiguity affecting architecture, security, behavior, or cost.

During implementation:

1. Use an explicit command for every runtime Project Brain mutation. Changes to the repository-owned
   canonical bootstrap file are reviewed patches that must express the same named intent and pass the
   production parser in CI.
2. Preserve project ID, schema version, decisions, completed work, completed sprints, and task identity.
3. Record durable architectural choices as new decision records.
4. Keep changes inside declared ownership boundaries.

At completion:

1. Run all repository quality gates.
2. Update canonical mutable state through an approved command or its reviewed repository-patch
   equivalent while no durable adapter exists.
3. Report verification and remaining risks.
4. Wait for approval before expanding scope.
