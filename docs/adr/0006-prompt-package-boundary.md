# ADR-006: Insert one deterministic Prompt Package boundary

- **Status:** Accepted
- **Date:** 2026-07-30
- **Owners:** BuilderAI architecture
- **Related:** Sprint 5 Prompt Orchestration Foundation

## Context

The Context Package is optimized for governed project understanding, not for direct provider
consumption. Allowing future adapters to format Context Packages independently would duplicate prompt
policy, create provider-specific structures, and make ordering, budgeting, safety, and output contracts
inconsistent. The Sprint 4 request contract also carried a Context Package and a second task copy,
creating avoidable drift risk at the future provider boundary.

## Decision drivers

- One provider-independent prompt object.
- Deterministic structure and ordering.
- Versioned template evolution.
- No duplicated task or instruction truth.
- Exact, enforceable prompt budgets.
- Explicit structured output expectations.
- No provider syntax, execution, network, credentials, streaming, or tools.

## Considered options

1. Let each provider adapter format the Context Package.
2. Build one provider-specific prompt string in the application layer.
3. Transform the Context Package into one versioned, structured Prompt Package before the provider
   boundary.

## Decision

Use option 3. `src/core/prompt-orchestrator` accepts one validated Context Package, selects a validated
template version through a catalog port, and builds independent System, Architecture, Task, Rules,
Context, Output Contract, and Safety sections in canonical order. The package is structured data and
contains no provider formatting.

System, Task, Architecture, Rules, Output Contract, and Safety are mandatory. Context is optional and
may be removed as one atomic section when the configured character budget cannot hold the complete
package. Every omission is recorded; mandatory content is never truncated. The budget equals the exact
serialized package length. Runtime validation rejects unsupported versions, missing or duplicate
sections, invalid order, duplicated instructions and records, broken references, invalid omissions,
and malformed output contracts.

The AI Provider request contract now carries one Prompt Package rather than the source Context Package
and duplicate task. Operational timeout, cancellation, execution mode, capability, and response
constraints remain outside the prompt object.

## Consequences

Future adapters receive one deterministic, bounded prompt contract and cannot reinterpret raw project
context independently. Templates can evolve through explicit integer versions without introducing
provider syntax. Prompt construction remains testable and side-effect free.

The current template family fixes one canonical section order and allows only Context to be optional.
A future schema change is required for granular context omission or alternate section structures.
Prompt quality evaluation and any execution behavior remain separately approved work.

## Security and privacy impact

Prompt content may contain sensitive or adversarial project text. Construction performs no execution,
networking, persistence, logging, interpolation, or external disclosure. Governance and safety sections
remain mandatory. A future execution boundary must add authorization, classification, redaction,
injection defenses, provider review, retention, telemetry, and incident controls.

## Rollout and reversal

Tests cover template selection and versions, deterministic composition, section ownership, budgeting,
ordering, duplicates, references, configuration, package validation, and output contracts. The provider
request validator accepts only Prompt Packages. Breaking package or template rules require a new schema
version and migration ADR. Removing this boundary would restore provider-specific prompt policy and is
not supported.
