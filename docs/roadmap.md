<!-- builderai-document
type: roadmap
version: 1
-->

# Roadmap Policy

## Canonical planning state

The current milestone, tasks, pending work, constraints, and completed sprint history live only in
[`project-brain.json`](../project-brain.json). This document defines how roadmap state is governed and
does not reproduce the current roadmap.

## Planning rules

- Plan outcomes rather than infrastructure output.
- Give every milestone measurable exit criteria and explicit non-goals.
- Represent executable delivery work as canonical tasks with acceptance criteria and dependencies.
- Record completed sprints only after quality gates and Project Brain synchronization pass.
- Add infrastructure only when an approved requirement needs it.
- Require a decision record for new durable boundaries, providers, data stores, or security posture.
- Do not infer approval for the next sprint from completion of the current sprint.

## Product AI gate

The presence of an AI-oriented product vision does not authorize AI implementation. Any future AI
milestone requires explicit stakeholder approval plus discovery covering user value, non-AI
alternatives, provider and data terms, evaluation, safety and abuse cases, human oversight, cost
limits, observability, incident handling, and rollback.

## Scope transition

At milestone close, update canonical Memory, Decisions, Progress, Tasks, and Glossary through their
explicit commands. The next milestone remains unauthorized until approval is recorded in canonical
state.
