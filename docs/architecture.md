<!-- builderai-document
type: architecture
version: 1
-->

# Architecture

## Status and scope

This document defines the baseline architecture for the Project Brain, Blueprint Reader, Context
Builder, Prompt Orchestrator, AI Provider Adapter, Execution Engine, first OpenAI provider, Response
Processor, Project Change Planner, Safe File Apply Engine, Build and Verification Engine, and Minimal
BuilderAI UI. The repository contains a deployable web interface, framework-independent cores, one isolated external adapter
that can perform a validated non-streaming Responses API call, a pure boundary that packages returned
artifacts, an effect-free planner, a two-phase filesystem effect boundary, and a fixed verification
pipeline behind ports. Authentication, durable application state, multi-provider routing, streaming,
tools, files, images, history, background work, telemetry, live privileged UI execution, Git operations,
automatic repair, transactional rollback, deployment automation, authentication, billing,
collaboration, provider selection, a concrete production filesystem adapter, and concrete project,
dependency, build, or test runners remain out of scope.

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
use cases through Server Actions or route handlers. No database, queue, identity provider, or product
workflow is selected. The OpenAI Responses API is the only implemented provider boundary and is not
wired to a route, UI, background worker, or automatic invocation path.

## Target source boundaries

```text
src/
  app/             Next.js routes, layouts, and route-local presentation
  components/      Reusable presentation components (when introduced)
  core/            Framework-independent domain policy and application contracts
  features/        Product capabilities grouped by business outcome
  lib/             Shared adapters and narrowly scoped technical utilities
  providers/       Isolated external AIProvider implementations
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

## Context Builder core

`src/core/context-builder` transforms validated Project Brain state, a valid Blueprint Reader result,
a current task reference, and a `ProjectFileSource` port into one versioned Context Package. It imports
no filesystem, framework, storage, network, automation, or model integration. Callers implement the
port for an approved source; the core lists paths first and reads content only after selection.

Selection uses explicit task-dependency and relative-import graphs first, then deterministic lexical
relevance for goals, modules, decisions, pending risks, documents, and source-file seeds. Camel-case,
kebab-case, and prose terms are normalized consistently. Weak single-term matches do not select an
item. The package declares the canonical priority order from constitution through related source files.

The Context Package carries structured project identity, milestone, current and related tasks, goals,
constraints, architecture, modules, files, decisions, coding standards, risks, blockers, and relevant
policy documents. It does not contain another raw Project Brain snapshot. Duplicate content is removed
with an omission record; duplicate references, conflicting reader state, unsafe paths, missing
governance, and invalid references are rejected.

Character, file, document, source-path, and source-read limits are explicit inputs. Optional context is
removed from the lowest canonical priority upward when necessary. Mandatory governance and task
context is never truncated; construction fails when the mandatory package cannot fit. The recorded
character count is the exact serialized JSON length, making the bound testable by any downstream
consumer.

## AI Provider Adapter core

`src/core/ai-provider` defines the only contract through which a future provider adapter may become
visible to BuilderAI. The core depends on the existing Prompt Package contract but imports no provider
SDK, framework, storage adapter, network client, credentials, environment configuration, or provider
implementation.

The versioned port exposes an immutable descriptor and a request/response signature. Capabilities are
explicit booleans plus a maximum context size measured in characters. Requests contain one validated
Prompt Package, execution mode, output and capability constraints, timeout, a provider-neutral
cancellation signal, and scalar metadata. Providers do not receive the source Context Package or a
second task copy. The signal exposes current state and a subscription boundary, but this foundation
provides no signal or execution implementation. Responses use discriminated artifact types and carry
diagnostics, warnings, timing statistics, character-based prompt usage, and scalar metadata. Exchange
validation rejects identity drift, output-limit violations, incorrect prompt accounting, and missing
required artifact kinds.

The in-memory registry stores only references and immutable descriptor/configuration snapshots. It
validates registration, rejects duplicate identities and post-registration descriptor drift, lists
enabled descriptors deterministically by priority and ID, and discovers compatible providers without
invoking them. Compatibility accounts for configured policy, execution mode, timeout, Context Package
size, required artifacts, and required capabilities. Configuration is deliberately closed: endpoints,
credentials, environment lookups, and implementation-specific settings are not part of the core
contract.

The core does not execute a request. Concrete adapters and invocation workflows remain outside this
boundary and require separate design, security, privacy, reliability, and operational decisions.

## Prompt Orchestrator core

`src/core/prompt-orchestrator` is the sole boundary allowed to transform a validated Context Package
into a versioned Prompt Package. It imports no provider SDK, framework, storage adapter, network client,
credential, environment configuration, streaming abstraction, tool executor, or execution workflow.
Prompt Packages are structured objects; this core does not render provider syntax or concatenate a
provider-specific prompt string.

Each package contains independent, discriminated System, Architecture, Task, Rules, Context, Output
Contract, and Safety sections in one canonical order. Identity and governance instructions appear in
System; architecture and module ownership in Architecture; the current task, goals, and constraints in
Task; coding and AI policies in Rules; relevant supporting project records in Context; the structured
response schema in Output Contract; and invariant handling rules in Safety. Source documents consumed
as instructions are excluded from Context, and instruction identity and normalized content are
deduplicated deterministically.

Templates have independent schema, identity, and positive integer version fields. A storage-independent
catalog port supplies candidates; selection validates every template, rejects duplicate identity/version
pairs, honors an exact requested version, or selects the highest version deterministically. Template
sections must retain the canonical order. Only Context is optional in the current schema; governance,
task, architecture, rules, output, and safety sections are mandatory.

Prompt budgets use exact serialized character counts. When the complete package exceeds its configured
limit, the optional Context section is removed atomically and recorded with its identity, kind, reason,
and estimated size. Mandatory sections are never truncated; construction fails if they cannot fit.
Runtime validation covers package and template versions, structure, required sections, ordering,
duplicates, task and module references, metadata, omissions, exact budget accounting, and the output
contract. Prompt construction does not authorize execution or external disclosure.

## Execution Engine core

`src/core/execution-engine` is the only core boundary allowed to coordinate a future execution
lifecycle. It accepts one validated Prompt Package inside a versioned Execution Request and imports no
framework, storage adapter, provider implementation, SDK, network client, HTTP API, credentials,
environment configuration, queue, timer, tool executor, or runtime cancellation implementation.

Execution state is an immutable versioned snapshot with stable identity, attempt count, revision,
timestamps, and append-only transition history. The closed lifecycle is Created, Validated, Queued,
Preparing, Ready, Executing, Completed, Failed, Cancelled, and Timed Out. Executing is a reserved state
only; entering it performs no invocation. When an active reserved attempt fails, an explicit retry
decision may return it directly from Executing to Queued; otherwise it transitions to terminal Failed.
All other unlisted transitions are illegal, and terminal snapshots cannot be reopened. The
application-facing service exposes intent-specific lifecycle commands; its raw transition primitive is
private so callers cannot bypass retry, timeout, or cancellation policy.

Execution Policy is closed and provider-neutral: priority, validation mode, failure strategy, bounded
retry policy, and timeout policy. Retry evaluation returns only an allow/deny decision, next attempt,
and calculated delay; it does not sleep or schedule. Timeout evaluation compares caller-supplied ISO
timestamps against the configured lifecycle start and does not create timers. Cancellation is a
read-only token and subscription port supplied by a future runtime; this foundation implements no
active signal. Terminal Results are versioned and contain validated diagnostics, timing, usage and
artifact placeholders, errors, and scalar metadata.

Every public lifecycle service validates its request or snapshot and returns defensive copies. Runtime
queueing, clocks, waiting, deadline enforcement, persistence, recovery, concurrency, idempotency,
provider selection and invocation, streaming, tools, telemetry, and external disclosure remain outside
this core and require separately approved adapters and controls.

## OpenAI Responses provider

`src/providers/openai` implements the existing `AIProvider` port without changing any core contract.
Its SDK transport is the only source module that imports the official OpenAI package. Configuration,
credentials, request and response mappers, raw-response and structured-output validators, error
translation, and the Execution Engine integration remain inside the adapter boundary.

The request mapper serializes the validated Prompt Package without mutation and requests one JSON
Schema response. It explicitly disables streaming, background execution, API-side storage,
truncation, parallel tool calls, and SDK retries; it supplies no tools, files, images, or conversation
identifier. The provider-neutral Output Contract currently describes top-level field types only, so
provider-side schema enforcement is non-strict and BuilderAI runtime validation is authoritative.
Responses must be completed, structurally valid, valid JSON, compatible with the Output Contract, and
within the originating request limits before they become BuilderAI artifacts.

`OpenAIExecutionService` is a narrow composition service. It advances the existing Execution Engine
through legal states, maps one Execution Request to one provider request, invokes the adapter once,
and constructs one validated terminal Result. It does not implement retry scheduling, routing,
persistence, or background execution. The SDK enforces the per-call timeout, while the existing
cancellation subscription is bridged to one request-scoped abort signal. A live API test is excluded
from CI to avoid credentials, spend, and external disclosure; a controlled pre-release smoke test and
provider data-retention review remain operational gates.

## Response Processor core

`src/core/response-processor` is the sole boundary allowed to transform a correlated, completed
`AIProviderResponse` and terminal `ExecutionResult` into a versioned Response Package. It depends
only on provider-neutral and execution contracts. It imports no provider implementation, SDK,
framework, filesystem, Git client, storage adapter, network client, telemetry service, or project
mutation workflow.

One `STRUCTURED_DATA` provider artifact owns the generated-artifact candidate list. The processor
does not add full content to Execution Result placeholders or retain raw provider payloads in the
package. It validates completion state, request/execution identity, prompt and output accounting,
provider-to-execution artifact placeholders, and shared metadata before extracting candidates.
Generated artifact types are closed to Source File, Documentation, Configuration, Test, and Patch.
Logical paths must be safe repository-relative POSIX paths and are unique under case-insensitive
comparison.

Normalization converts line endings to LF, canonicalizes artifact, diagnostic, warning, and metadata
ordering, and returns defensive copies. Configurable limits bound artifact count, individual and
aggregate UTF-8 byte sizes, metadata entries, and metadata string length. An injectable checksum port
keeps the policy independently testable; the default implementation uses Web Crypto SHA-256. The
deterministic Artifact Manifest records each normalized path, type, checksum, UTF-8 size, and metadata.
Integrity verification recomputes every checksum and size and rejects missing, duplicated, reordered,
or inconsistent entries.

The Response Package is evidence, not authority. Construction and validation perform no I/O and do
not authorize writing files, applying patches, running generated code or tests, changing Git state,
persisting output, or contacting another service. Human review, authorization, path containment,
conflict handling, atomic application, rollback, secret scanning, and audit controls belong to a
separately approved future capability.

## Project Change Planner core

`src/core/change-planner` is the sole boundary allowed to transform a validated Response Package into
a versioned Project Change Plan. It imports provider-neutral Response Processor contracts but no
provider implementation, SDK, framework, filesystem, Git client, storage adapter, network client,
build tool, test runner, rollback mechanism, or project mutation workflow.

Every generated artifact must explicitly declare `change-operation` metadata as Create File, Update
File, or Delete File. The planner does not infer path existence because it has no project-state or
filesystem port. It consequently adds an `UNVERIFIED_PROJECT_STATE` warning to every plan. Create and
update operations contain the exact normalized desired content; delete operations contain no content
and require an empty source artifact. Patch artifacts are rejected because patch application is not
an exact-result file operation in the closed plan contract.

Operations preserve Response Package version, execution identity, logical path, artifact type,
description, checksum, and UTF-8 size as provenance. Validation rejects unsafe paths, unsupported
intent, duplicate operation identifiers, case-insensitive path aliases, conflicting operation kinds,
file/tree prefix conflicts, noncanonical ordering, invalid metadata, summary drift, and broken source
references. The canonical safety-oriented order is create, update, then delete, followed by stable
logical-path ordering.

Plans contain one change set, exact path summaries, structured deterministic risks, inherited response
warnings, and scalar metadata. Planning performs no I/O and does not authorize an effect. Verifying
real path existence, content preconditions, symlinks, permissions, repository policy, conflict-free
application, atomic writes, rollback, secret scanning, Git changes, or build and test outcomes requires
a separately approved capability.

## Safe File Apply Engine core

`src/core/file-apply` is the only core boundary allowed to translate a validated Project Change Plan
into create, update, and delete filesystem effects. It imports no provider implementation, framework,
Node filesystem API, Git client, process runner, network client, build tool, test runner, deployment
adapter, telemetry service, or rollback mechanism. Filesystem and monotonic-clock behavior enter only
through explicit ports.

Apply is two phase. The engine first revalidates the complete plan, operation limit, canonical order,
duplicates, conflicts, paths, metadata, and summaries. It then checks mandatory and configured
protected-path rules and inspects every target and create-parent through the filesystem port. Create
requires an absent target and existing regular parent directory; update and delete require an existing
regular file. Symlinks and other entry kinds are rejected. Any validation or inspection error returns
a Rejected result with zero mutations.

Mandatory case-insensitive rules protect `.git`, environment-file prefixes, `project-brain.json`,
`AGENTS.md`, and `.github/workflows`. Callers may add exact, subtree, or path-prefix rules but cannot
remove mandatory protection. The filesystem port contract requires root containment, ancestor symlink
rejection, and conditional create-if-absent, update-if-regular-file, and delete-if-regular-file methods
so state changes between preflight and mutation fail closed.

After preflight, operations execute sequentially in the validated create-update-delete plan order.
Execution stops at the first adapter failure. The versioned Apply Result records actual created,
updated, deleted, and skipped paths, warnings, stable errors, duration, and metadata. Because rollback
is not implemented, a failure after earlier success returns Partially Applied and preserves completed
effects; every valid-plan result states this limitation explicitly.

The current core supplies the port and an in-memory test adapter, not a production Node filesystem
adapter or composition root. Production use still requires caller authorization, a root-scoped adapter
conformance suite, operating-system containment tests, expected-current-content checks, locking,
recovery, audit evidence, and operator controls.

## Build and Verification core

`src/core/verification` accepts only a File Apply Result that passes its existing production validator
and has Applied status. Rejected, Failed, Partially Applied, or malformed inputs invoke no verification
capability. The module imports no framework, filesystem, process runner, network client, Git client,
deployment adapter, provider implementation, storage implementation, or automatic repair behavior.

The pipeline is closed and sequential: Project Validation, Dependency Validation, Build Validation,
then Test Validation. Each capability has a dedicated port; the monotonic time source is also a port.
Every stage receives a defensive context containing the accepted apply evidence and affected files.
All stages run once for accepted input, even after an earlier failure, so the report contains complete
verification evidence rather than a fail-fast subset.

Port output is untrusted. Each result is runtime validated for closed structure, Passed or Failed
status consistency, bounded and unique findings, and bounded scalar metadata, then normalized into
canonical order. Thrown adapters and invalid adapter results become generic failed stages without
leaking implementation details and do not suppress later stages.

The versioned Verification Report contains the four ordered stage results, exact flattened warnings
and errors, total duration, and defensive metadata. Overall Passed requires every stage to pass,
Failed means no stage passed, and Partially Passed represents mixed evidence. The report validator
recomputes ordering, status, stage consistency, and flattened findings so summary drift cannot cross
the boundary.

Only ports and controlled test doubles exist in this foundation. Production composition requires
authorized and project-contained runner adapters, command allowlists, sandboxing, active deadlines,
resource and output limits, process-tree termination, no-network enforcement, redaction, conformance
tests, and restricted audit evidence. A Verification Report is evidence; it does not authorize repair,
Git, rollback, deployment, or another workflow.

## Minimal BuilderAI UI

`src/app` owns the Next.js dashboard and project workspace routes. Server components load current
project identity, vision, milestone, completion, ownership, and activity only through
`loadCanonicalProjectBrain`, so UI source does not duplicate mutable Project Brain facts. Route
composition passes a small presentation view to `src/ui/workspace`.

The dashboard summarizes project status, architecture stages, latest delivery activity, and the entry
point to the workspace. The responsive workspace separates project and workflow context, request and
conversation interaction, deterministic progress, and typed result evidence into clear regions. Its
right panel presents Response Package, Project Change Plan, File Apply Result, and Verification Report
contracts without reinterpreting their business rules.

Client components depend on `WorkspaceWorkflowPort`, a UI-owned application seam over those existing
contracts. Preparation produces a response and plan. A distinct acknowledgement and approval action is
required before apply. Only an Applied result may proceed to verification. The UI displays safe generic
failures and retains available evidence when a workflow stops.

The shipped route intentionally supplies no runtime implementation. It clearly reports review mode and
disables execution because authentication, authorization, production filesystem and verification
adapters, and their operational controls are not approved. Controlled ports are injected only by tests
to exercise workflow transitions. A future server-only composition can implement the port without
changing core or presentation contracts, after its security prerequisites are approved.

The interface uses semantic landmarks, headings, lists, tables, form labels, live status regions,
native controls, keyboard-operable tabs, visible focus, responsive layouts, and no decorative motion.

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

Provider configuration and credentials are explicit constructor inputs and are validated before an
SDK client is created. The adapter does not read environment variables or rely on the SDK's implicit
environment lookup. A future server-only composition root may load credentials from the deployment
secret manager and inject them; secrets must never use `NEXT_PUBLIC_`, enter canonical state, logs,
errors, tests, or client bundles. Production fails closed when required configuration is missing.

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
