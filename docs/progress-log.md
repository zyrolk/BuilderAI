<!-- builderai-document
type: progress-log
version: 1
-->

# Progress Log Policy

## Canonical record

Live milestone, sprint, and completion state is `progressLog` in
[`project-brain.json`](../project-brain.json). This document does not reproduce the current milestone,
completed sprints, task IDs, evidence, or dates.

## Responsibilities

The Progress Log records:

- The current delivery milestone.
- Append-only completed sprint records.
- The current index of completed task IDs.
- The last progress update timestamp.

## Mutation policy

Milestones and completed sprints use `ProgressLogService`. A sprint can be completed only when all
referenced tasks are already recorded as completed. Existing completed sprint records cannot be
removed, reordered, or rewritten.

Task commands maintain the completed-task index. Reopening a task removes it from that current index;
historical sprint records remain append-only.

A sprint closes only after scoped tasks, quality gates, canonical-state synchronization, and stakeholder
handoff are complete. The next sprint requires explicit approval.
