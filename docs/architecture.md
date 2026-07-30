<!-- builderai-document
type: architecture
version: 1
-->

# Architecture

## Status and scope

This document defines the baseline architecture for the Project Brain and Blueprint Reader foundations.
The repository contains a deployable web shell, a framework-independent Project Brain core, and a
deterministic project-document reader. Authentication, durable persistence, external integrations,
application workflows, deployment automation, and AI capabilities remain out of scope until their
requirements and risks are approved.

## Architectural principles

1. **Ship vertical slices.** A capability includes its user experience, domain behavior, data access,
   observability, tests, and documentation.
2. **Default to server execution.** Use React Server Components unless browser state, effects, or web
   APIs require a Client Component.
3. **Keep domain logic framework-independent.** Next.js routes and components adapt inputs and
   outputs; they do not become the domain model.
4. **Validate at trust boundaries.** Treat HTTP input, environment variables, persistence results,
   and third-party responses as untrusted.
5. **Make secure behavior the default.** Least privilege, minimal data collection, deny-by-default
   authorization, and safe error handling are design constraints.
6. **Prefer reversible decisions.** Introduce infrastructure only when measured needs justify it and
   capture consequential decisions as ADRs.

## System context

The current system has one deployable unit: a Next.js web application. A browser communicates with
the application over HTTPS. The application renders the UI and will eventually expose server-side
use cases through Server Actions or route handlers. No database, queue, identity provider, or AI
provider is selected.

## Target source boundaries

```text
src/
  app/             Next.js routes, layouts, and route-local presentation
  components/      Reusable presentation components (when introduced)
  core/            Framework-independent domain policy and application contracts
  features/        Product capabilities grouped by business outcome
  lib/             Shared adapters and narrowly scoped technical utilities
  test/            Cross-suite test setup and fixtures
```

Dependencies flow inward: `app` may call `features`; features may call explicit ports in their own
boundary; adapters in `lib` may implement those ports. Domain modules must not import route modules
or browser-only code. Direct cross-feature imports require an ADR or refactoring into an explicitly
shared contract.

Only directories needed today are created. Empty speculative layers are avoided.

## Project Brain core

`src/core/project-brain` is a Clean Architecture boundary:

- `types` owns the versioned aggregate, finite states, and domain errors.
- `validators` owns structural and cross-record invariants.
- `schemas` parses unknown values and returns defensive copies.
- `services` owns Project Brain, decision, task, and progress use cases.
- `storage` owns the repository port and infrastructure adapters.

Dependencies point inward. The core imports no Next.js, React, AI, network, or database package.
Services depend on the storage port rather than an adapter. Every save uses an expected revision to
prevent lost updates. The in-memory adapter is non-durable and does not select a production database.

Root `project-brain.json` is the sole mutable Project Brain authority. The TypeScript aggregate and
runtime parser are its executable contract. Documents listed in `project-constitution.md` define stable
governance and field semantics without copying live state.

Application mutations are intent-based. Blueprint, Memory, Decision, Progress, Task, and Glossary
services build a candidate state, apply the production parser, and commit it with the expected revision.
The public query/initialization service exposes no arbitrary replacement operation. The repository
enforces immutable project identity and append-only decisions, completed work, and completed sprints.

## Blueprint Reader core

`src/core/blueprint-reader` owns deterministic project-document understanding. Its `DocumentSource`
port exposes only document listing and reading, so discovery, parsing, validation, relationship
analysis, consistency checks, and summary generation do not depend on a filesystem, framework,
storage engine, network, or AI provider. Supported documents declare stable type and version metadata;
mutable project facts continue to come only from `project-brain.json`.

The reader reports findings as typed diagnostics instead of inferring or silently repairing content.
Missing, duplicate, unknown, malformed, incompatible, conflicting, and duplicated-state conditions are
therefore observable to every caller. A result may contain a partial summary when canonical state is
valid, but any error diagnostic makes the result invalid.

`src/infrastructure/blueprint-reader` contains the Node filesystem adapter. It recursively enumerates
the repository `docs` boundary, reads UTF-8 content, and rejects traversal outside the configured
project root. Other adapters may implement the same port without changing reader policy.

## Rendering and API strategy

- Prefer static or server-rendered pages for read paths.
- Add `'use client'` at the smallest possible component boundary.
- Use route handlers for public HTTP contracts, webhooks, or non-UI clients.
- Use Server Actions only for UI-owned mutations and apply the same authentication, authorization,
  validation, rate-limiting, and auditing rules as any API endpoint.
- Return stable, typed error shapes at external boundaries; never expose internal stack traces.

## State and data

No durable persistence technology is chosen. The current foundation supplies only a repository port
and an in-memory adapter. A durable selection requires documented access patterns, consistency and retention
requirements, recovery objectives, residency constraints, and an ADR. Schema migrations must be
forward-compatible during deployment and have a tested recovery strategy.

Client state should be local by default. URL state is preferred for shareable navigation state.
Server state must not be copied into global client stores without a demonstrated need.

## Configuration

Configuration is supplied through environment variables and parsed once at process startup by a
typed validation module when variables are introduced. Secrets remain server-only and are never
prefixed with `NEXT_PUBLIC_`. Production fails closed when required configuration is missing.

## Observability

Before the first production workflow, add structured logs with request correlation, error reporting,
health/readiness signals, and service-level indicators for latency, failures, and availability. Logs
must exclude secrets and sensitive payloads. Product analytics require an approved data inventory and
consent model.

## Deployment model

CI produces a deterministic Next.js standalone build from the lockfile. The deployment platform must
provide HTTPS, immutable releases, managed secrets, health checks, rollback, and separate development,
staging, and production environments. Build once and promote the same artifact between environments.

## Quality attributes

- **Security:** controls in `security.md` are release requirements.
- **Reliability:** graceful failure, bounded retries, timeouts, idempotent mutations where applicable.
- **Performance:** budgets will be established from real user journeys; avoid unnecessary client
  JavaScript now.
- **Accessibility:** target WCAG 2.2 AA for product interfaces.
- **Maintainability:** strict typing, explicit boundaries, focused modules, and automated gates.

## Decision governance

Register every architectural decision in `decision-log.md`. Use `adr-template.md` for decisions that
are expensive to reverse or affect multiple capabilities. Every ADR records context, alternatives,
consequences, security impact, and rollout/reversal plans.
