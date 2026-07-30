<!-- builderai-document
type: project-memory
version: 1
-->

# Project Memory Policy

## Canonical record

Live Project Memory is `memory` in [`project-brain.json`](../project-brain.json). This document does not
repeat completed work, pending work, decisions, rules, timestamps, or current status.

## Responsibilities

Memory stores curated durable knowledge:

- Completed work as append-only records.
- Pending work that has not yet become immutable completion history.
- References to important decisions in the canonical Decision Log.
- Architectural rules that future work must respect.

Memory is not a transcript, log sink, or replacement for tasks. It should contain only information
that materially affects future implementation.

## Mutation policy

Memory changes use `MemoryService` commands:

- `ADD_PENDING_WORK`
- `RECORD_COMPLETED_WORK`
- `COMPLETE_PENDING_WORK`
- `ADD_ARCHITECTURAL_RULE`

Completed work cannot be removed or rewritten. Completing pending work removes the pending record and
appends a completion record atomically. Decision references are maintained by Decision Log commands.
