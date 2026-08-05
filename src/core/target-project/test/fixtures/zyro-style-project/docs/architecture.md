<!-- builderai-document
type: architecture
version: 1
-->

# Architecture

## Status and scope

Synthetic Zyro-style full-stack fixture with client UI, API server, and automated tests. Used only for
BuilderAI external-target onboarding validation.

## Architectural principles

1. Keep UI code in `src/` and HTTP handlers in `server/`.
2. Validate request payloads at API boundaries.
3. Do not modify `server/secrets/` from automated sessions.

## Target source boundaries

```text
src/     Client application modules
server/  API handlers and server-only code
tests/   Automated tests
```
