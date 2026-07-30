<!-- builderai-document
type: project-blueprint
version: 1
-->

# Project Blueprint Policy

## Canonical record

The live Blueprint is `blueprint` in [`project-brain.json`](../project-brain.json). This document does
not reproduce its values.

## Responsibilities

The Blueprint defines:

- Immutable project identity.
- Project name and vision.
- Outcome-oriented goals and success criteria.
- Planned product or platform features.
- Verifiable requirements and acceptance criteria.
- Constraints and rationale.
- Technology choices, referencing operational manifests for installed versions.
- Repository-relative folder ownership.

## Mutation policy

Blueprint changes use `BlueprintService` commands. Project identity has no mutation command and cannot
change after initialization. New goals, features, requirements, and constraints receive stable IDs.
Technology and folder-ownership assignments are revised only through their named commands.

Durable scope or architecture changes require a new accepted decision before the Blueprint command.
Breaking schema changes require a migration plan and ADR.

## Ownership semantics

Paths use repository-relative POSIX notation. An exact path has one owner. Ownership describes review
responsibility; it does not replace authorization or repository access control.
