<!-- builderai-document
type: architecture
version: 1
-->

# Architecture

## Status and scope

This document describes the target application's architecture for BuilderAI external-target
development. It must explain the major modules, runtime boundaries, and what is in scope for local
AI-assisted changes.

## Architectural principles

1. Keep domain logic separate from delivery adapters.
2. Validate untrusted input at every trust boundary.
3. Preserve existing security controls and protected areas.
4. Prefer the smallest change that satisfies the requested task.

## Target source boundaries

```text
src/        Application UI and client-facing modules
server/     API handlers and server-only integrations
tests/      Automated tests and fixtures
docs/       Project-owned documentation consumed by BuilderAI
.builderai/ External-target bootstrap manifest (required)
```

Protected paths and ownership rules are declared in `.builderai/target-project.json`.
