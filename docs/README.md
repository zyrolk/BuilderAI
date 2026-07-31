# Documentation

[`project-brain.json`](../project-brain.json) is the sole source of mutable project truth. This
directory owns stable policy, interpretation, architecture, and engineering standards; it must not
repeat live Project Brain values.

- [Project constitution](project-constitution.md): authority, precedence, and mandatory change protocol.
- [Project blueprint](project-blueprint.md): vision, scope, requirements, stack, and folder ownership.
- [Project memory](project-memory.md): durable completed work, pending work, rules, and limitations.
- [Decision log](decision-log.md): accepted and superseded architectural decisions.
- [Progress log](progress-log.md): milestone, sprint, and task-completion semantics.
- [Task system](task-system.md): task contract, states, transitions, and invariants.
- [Domain glossary](domain-glossary.md): authoritative business and technical vocabulary.
- [Architecture](architecture.md): system boundaries, structure, runtime model, and decision rules.
- [Roadmap](roadmap.md): milestones, sequencing, and exit criteria.
- [Coding standards](coding-standards.md): implementation and review expectations.
- [AI rules](ai-rules.md): safe use of coding assistants and the boundary around product AI.
- [Security](security.md): threat model, controls, and incident expectations.
- [MVP v1.0 operations](mvp-v1.md): local runtime configuration, controls, and limitations.
- [Gemini local development](gemini-local-development.md): Google AI Studio setup and smoke-test checklist.
- [v1.0.0 release notes](release-notes/v1.0.0.md): release scope, evidence, and known limitations.
- [Gemini provider ADR](adr/0015-gemini-provider-adapter.md): isolated adapter and local selection decision.
- [ADR template](adr-template.md): format for durable architectural decisions.

Parse and read the canonical JSON, then read the seven Project Brain policy documents and the required
engineering policies before any code change. Required Blueprint Reader Markdown files declare a stable
`builderai-document` type and version header. These headers describe the document contract; they never
own mutable project facts. Tool prompts and conversations are not substitutes.

Documentation changes are reviewed with the same rigor as code. A decision that changes system
boundaries, security posture, data ownership, or a public contract requires an architecture decision
record (ADR).
