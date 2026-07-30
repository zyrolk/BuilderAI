<!-- builderai-document
type: decision-log
version: 1
-->

# Decision Log Policy

## Canonical record

Live decisions are `decisionLog` in [`project-brain.json`](../project-brain.json). This document does
not reproduce decision entries or statuses.

## Responsibilities

Record a decision when a change affects durable architecture, system boundaries, data/security posture,
dependencies, schema compatibility, or expensive-to-reverse behavior. Each record contains context,
the decision, rationale, alternatives, consequences, status, importance, and timestamp.

Statuses are `PROPOSED`, `ACCEPTED`, `SUPERSEDED`, and `REJECTED`.

## History policy

The Decision Log is append-only. Existing entries cannot be removed, reordered, or rewritten through
a supported commit. Corrections and supersession require a new record; the detailed supersession
relationship and lifecycle remain a separately tracked High-priority improvement.

Use [the ADR template](adr-template.md) for decisions affecting multiple capabilities, security or data
posture, public contracts, or costly migration.
