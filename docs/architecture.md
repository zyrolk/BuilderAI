<!-- builderai-document
type: architecture
version: 1
-->

# Architecture

## Status and scope

This document defines the baseline architecture for the Project Brain, Blueprint Reader, Context
Builder, Prompt Orchestrator, AI Provider Adapter, Execution Engine, OpenAI, Gemini, and OpenRouter
providers, Response
Processor, Project Change Planner, Safe File Apply Engine, Build and Verification Engine, and Minimal
BuilderAI UI. The repository contains a deployable web interface, framework-independent cores, isolated external adapters
that can perform one validated non-streaming provider call, a pure boundary that packages returned
artifacts, an effect-free planner, a two-phase filesystem effect boundary, and a fixed verification
pipeline behind ports. Authentication, durable application state, multi-provider routing, streaming,
tools, files, images, history, background work, telemetry, live privileged UI execution, Git operations,
automatic repair, transactional rollback, deployment automation, authentication, billing,
collaboration, dynamic or multi-provider routing, a concrete production filesystem adapter, and concrete project,
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
workflow is selected. OpenAI Responses and Google Gemini adapters implement the same core port. The
trusted local composition chooses exactly one through server configuration; core and UI code remain
provider-independent.

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

`src/infrastructure/project` implements the local `ProjectFileSource` adapter used by Context Builder.
It discovers candidate repository-relative source and configuration paths under explicit default scan
roots (`src/`, `app/`, `prisma/`, monorepo roots, test roots, and others documented in ADR-022),
plus an enumerated root-level configuration allowlist (`package.json`, `tsconfig*.json`, framework
and tooling configs). Discovery applies extension and directory denylists, skips missing roots without
error, rejects env files and lockfiles, and never follows symlinked directories outside the project
root. An optional `BUILDERAI_EXTRA_SOURCE_SCAN_ROOTS` environment variable adds safe relative roots
for unusual layouts. Listing produces a bounded candidate catalog (`maxSourcePaths`, default 15,000);
Context Builder still selects and reads only a small subset (`maxSourceReads`, `maxFiles`) under the
calibrated character budget (ADR-018).

## Context Builder core

`src/core/context-builder` transforms validated Project Brain state, a valid Blueprint Reader result,
a current task reference, and a `ProjectFileSource` port into one versioned Context Package. It imports
no filesystem, framework, storage, network, automation, or model integration. Callers implement the
port for an approved source; the core lists paths first and reads content only after selection.

Selection uses explicit task-dependency and relative-import graphs first, then deterministic lexical
relevance for goals, modules, decisions, pending risks, documents, and source-file seeds. Camel-case,
kebab-case, and prose terms are normalized consistently. Weak single-term matches do not select an
item. The package declares the canonical priority order from constitution through related source files.

Source-file retrieval (ADR-023) ranks the full Phase 1 candidate catalog by path-only scoring (token
overlap with plural variants, path segments, filenames, generic role hints, conditional schema/test/config
boosts, and bounded Project Brain module boosts), reads a fixed shortlist of up to 36 paths, reranks with
bounded content overlap, expands relative imports from the top eight parents, and applies size-aware
admission before the existing `maxFiles` and character budgets apply.

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

Mandatory context consists of the structured canonical Project Brain fields selected for the package,
the typed current task, Project Constitution, AI rules, architecture summary, and coding standards.
The Task System document is optional supporting policy because the current task already carries the
validated executable task contract. Repeated Blueprint diagnostics are summarized by stable code, and
source-read exhaustion records one deterministic omission marker rather than repeating equivalent
budget evidence for every unread candidate. These rules bound context metadata without raising the
configured content limit or weakening canonical Project Brain authority.

The default character limit is calibrated from real-repository measurement, not an arbitrary round
number (ADR-018). Building a Context Package from the canonical Project Brain and a realistic
worst-case task saturates well below the configured default once every relevant file, document, and
decision is included, leaving explicit reserved headroom for governance-content growth so relevant
source files are not starved out by mandatory content alone. The Context Builder and Prompt
Orchestrator cores remain provider-unaware; the local workspace runtime composition root proves, at
startup, that the Context Builder budget, the Prompt Orchestrator budget, and the active AI provider's
`maximumInputCharacters` remain safely ordered with reserved headroom at each boundary, failing fast on
a misconfiguration instead of waiting for a live user request.

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

The default prompt budget is likewise calibrated from real-repository measurement against the
Context Builder's calibrated default, with explicit reserved headroom so the optional Context section
should not need to be dropped under real content (ADR-018). See the Context Builder core section above
for the composition-root invariant that keeps Context, Prompt, and provider budgets safely ordered.

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
through legal states, maps one Execution Request to one provider request, and constructs one validated
terminal Result. On a `PROVIDER_UNAVAILABLE` failure it invokes the Execution Engine's own existing
`retry()` decision and, when the decision allows it, waits out one small deterministic fixed delay
(bounded at exactly one retry — two total provider attempts) and drives the snapshot back through
`Queued → Preparing → Ready → Executing` before invoking the adapter again with the same Execution
Request, `executionId`, and Prompt Package; every non-retryable or exhausted failure reaches terminal
`Failed` before the original provider error is rethrown (ADR-019). It does not implement unbounded
retry, routing, persistence, or background execution, and it never grants a retried attempt a fresh
full timeout: every attempt's provider-call timeout is capped to whatever remains of the one overall
execution timeout budget, computed via the existing timeout policy, and cancellation is honored during
the retry delay. A live API test is excluded from CI to avoid credentials, spend, and external
disclosure; a controlled pre-release smoke test and provider data-retention review remain operational
gates.

## Google Gemini provider

`src/providers/gemini` is an additional `AIProvider` implementation and does not change a core contract.
Its transport is the only Gemini source module that imports `@google/genai`. The adapter owns its closed
configuration and credentials, deterministic Prompt Package mapping, JSON Schema request, SDK transport,
raw-response and structured-output validation, error translation, and Execution Engine integration.

The mapper submits one text-only `generateContent` request with one candidate, temperature zero,
`application/json`, the provider-neutral Output Contract expressed as JSON Schema, and no tools, files,
images, streaming, chat history, or function calling. SDK retries are explicitly limited to the original
attempt (`attempts: 1`) so the existing Execution Engine remains the sole retry-policy decision owner;
`GeminiExecutionService` orchestrates the same bounded, single-retry, timeout-budget-capped sequence
described for `OpenAIExecutionService` above, symmetrically (ADR-019). Runtime validation is
authoritative even when Gemini accepts the schema.

Because Prompt Output Contract version 1 models array fields only at the top level, the Gemini mapper
adds provider-side nested JSON Schema for the existing generated-artifact fields, supported artifact
types, required description, and explicit change-operation metadata. This is request mapping—not a new
core model—and the Response Processor and Change Planner validators remain authoritative.

The Gemini adapter requires a completed `STOP` candidate, text, and internally consistent token usage;
it rejects blocked, missing, truncated, malformed, non-JSON, and Output Contract-incompatible responses.
Cancellation is bridged to an abort signal and each call receives the validated timeout. Provider bodies,
credentials, and SDK errors are converted to the existing BuilderAI error taxonomy before crossing the
boundary.

The local composition reads `BUILDERAI_AI_PROVIDER` and constructs only `openai`, `gemini`, or
`openrouter` through an exhaustive server-side branch. This is static configuration selection, not a
provider registry, router, fallback, or multi-provider workflow. OpenAI and Gemini support and behavior
are unchanged.

## OpenRouter Chat Completions provider

`src/providers/openrouter` is a third isolated `AIProvider` implementation (ADR-028). Its sole SDK
transport reuses the existing `openai` npm package with a configurable OpenRouter base URL and
`chat.completions.create()`; it does not use the OpenAI Responses API. The adapter maps the Prompt Output
Contract to Chat Completions `response_format.json_schema`, enforces `finish_reason` policy (`stop`,
`length` → retryable truncation, policy reasons → terminal contract violation), and keeps BuilderAI
structured-output validation authoritative after the provider response.

`OpenRouterExecutionService` reuses the same bounded single-retry, timeout-budget-capped orchestration
described for the other execution services (ADR-019). Credentials and optional attribution headers are
explicit constructor inputs validated before any network call.

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
Generated artifact types are closed to Source File, Documentation, Configuration, and Test (per
ADR-017, which removed Patch from the contract). Logical paths must be safe repository-relative POSIX
paths and are unique under case-insensitive comparison.

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
provider implementation, SDK, framework, Git client, storage adapter, network client, build tool, test
runner, rollback mechanism, or project mutation workflow. It never performs asynchronous I/O and never
authorizes a filesystem effect.

Every generated artifact must explicitly declare `change-operation` metadata as Create File, Update
File, or Delete File. Create and update operations contain the exact normalized desired content; delete
operations contain no content and require an empty source artifact. The Patch artifact type no longer
exists anywhere in the artifact contract (ADR-017): the Response Processor rejects it before a Response
Package can even be constructed, so every artifact the planner ever sees can deterministically become
one exact-result operation. Native patch application remains an unapproved future capability.

The planner may optionally accept one synchronous, read-only `WorkspaceVisibilityPort` (per ADR-016),
supplied through the constructor or a `plan()` call, exposing only `directoryExists` and `fileExists`.
When no port is supplied, the planner still cannot infer path existence and every plan carries an
`UNVERIFIED_PROJECT_STATE` warning, exactly as ADR-010 defined. When a port is supplied, `plan()` rejects
a create target that already exists or whose parent directory is missing, and rejects an update or
delete target that does not exist, mirroring the Safe File Apply Engine's own preflight rules; the plan
then carries a `PARTIALLY_VERIFIED_PROJECT_STATE` warning stating plainly that only target existence was
checked and that symlinks, permissions, content drift, and concurrent changes remain unverified. The port
is read-only, resolves through `lstat` so it never follows symlinks, and cannot create, modify, or delete
anything; it is a best-effort early signal only, and it never replaces Safe File Apply's own authoritative
revalidation.

Operations preserve Response Package version, execution identity, logical path, artifact type,
description, checksum, and UTF-8 size as provenance. Validation rejects unsafe paths, unsupported
intent, duplicate operation identifiers, case-insensitive path aliases, conflicting operation kinds,
file/tree prefix conflicts, noncanonical ordering, invalid metadata, summary drift, and broken source
references. The canonical safety-oriented order is create, update, then delete, followed by stable
logical-path ordering.

Plans contain one change set, exact path summaries, structured deterministic risks, inherited response
warnings, and scalar metadata. Verifying content preconditions, permissions, repository policy,
conflict-free application, atomic writes, rollback, secret scanning, Git changes, or build and test
outcomes still requires a separately approved capability; only existence preconditions are covered by
the optional visibility port, and only Safe File Apply may act on them.

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

The core still supplies only the port. MVP v1.0 adds a local Node adapter under `src/infrastructure`,
with root containment, ancestor symlink rejection, conditional operations, and negative integration
tests. The local single-operator profile does not resolve authentication, expected-current-content
hashes, multi-writer locking, transactional recovery, or durable audit evidence; those remain gates for
remote, shared, or untrusted-project use.

## Build and Verification core

`src/core/verification` accepts only a File Apply Result that passes its existing production validator
and actually mutated the workspace — Applied or Partially Applied status. Rejected, Failed (both always
zero-mutation under the validated File Apply Result contract), or malformed inputs invoke no verification
capability (P1-7, ADR-021). The module imports no framework, filesystem, process runner, network client,
Git client, deployment adapter, provider implementation, storage implementation, or automatic repair
behavior.

The pipeline is closed and sequential: Project Validation, Dependency Validation, Build Validation,
then Test Validation. Each capability has a dedicated port; the monotonic time source is also a port.
Every stage receives a defensive context containing the accepted apply evidence and affected files.
All stages run once for accepted input, even after an earlier failure, so the report contains complete
verification evidence rather than a fail-fast subset.

Post-apply correction planning (ADR-052) may parse already-bounded, redacted stage excerpts into
`BoundedFailureDiagnostic` records. Those records are server-derived planning DATA only: they do not
persist raw stdout/stderr, they do not expand FileApply or correction mutation scope, unsupported
commands (including `npm-run-build`) fall back to existing prose diagnostics, and fresh Gate2
approval remains mandatory before any correction apply.

Port output is untrusted. Each result is runtime validated for closed structure, Passed or Failed
status consistency, bounded and unique findings, and bounded scalar metadata, then normalized into
canonical order. Thrown adapters and invalid adapter results become generic failed stages without
leaking implementation details and do not suppress later stages.

The versioned Verification Report contains the four ordered stage results, exact flattened warnings
and errors, total duration, and defensive metadata. Overall Passed requires every stage to pass,
Failed means no stage passed, and Partially Passed represents mixed evidence. The report validator
recomputes ordering, status, stage consistency, and flattened findings so summary drift cannot cross
the boundary.

MVP v1.0 supplies local npm runner adapters outside core. Commands and arguments are fixed, invoked
without a shell, rooted in the configured project, time bounded, output bounded, and given a reduced
environment; raw output is never exposed through report metadata. The profile accepts only trusted
project scripts. OS sandboxing, complete resource and process-tree isolation, guaranteed no-network
execution, authentication, and durable audit evidence remain gates for remote or untrusted use. A
Verification Report is evidence; it does not authorize repair, Git, rollback, deployment, or another
workflow.

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
required before apply. Only a result that actually mutated the workspace — Applied or Partially Applied —
proceeds to verification; a Rejected or Failed result stops before verification (P1-7, ADR-021). The UI
displays safe generic failures and retains available evidence when a workflow stops.

The shipped route remains in review mode by default. With explicit valid local configuration, a client
adapter calls server-only route handlers. Preparation returns review evidence plus an opaque expiring
identifier; the validated plan remains in a bounded process-local store. Approval sends only that
identifier and a true acknowledgement. The server claims its own plan and applies it. Verification then
runs for any result that actually mutated the workspace — Applied or Partially Applied; a Rejected or
Failed result, which the validated File Apply Result contract guarantees mutated nothing, never reaches
verification (P1-7, ADR-021). An Apply attempt whose result proves zero filesystem mutations occurred —
Rejected, or Failed with every created, updated, and deleted list empty — leaves the preparation
reclaimable rather than terminal, bounded to at most one further explicit attempt (two total) and never
automatic; the caller must invoke approval again with the same identifier, which triggers a genuine new
File Apply call with a complete fresh preflight (P1-6, ADR-020). The original expiry is never reset or
extended by a reclaim. Every other outcome — Partially Applied (now carrying its own verification
evidence), or Applied regardless of the verification result — and a zero-mutation failure that has
already used both attempts remain permanently terminal and are replayed idempotently for the preparation
lifetime, exactly as before.

The route accepts bounded same-origin loopback JSON only and returns generic no-store errors. This is a
single-operator local profile, not authentication or project authorization. Public, shared,
multi-instance, and untrusted-project operation remains prohibited until the security prerequisites in
`security.md` are implemented.

## MVP v1.0 composition

`src/application/workspace` is the application orchestration layer. It depends inward on existing core
services and outward on narrow provider, source, filesystem, verification, clock, identifier, and
logging capabilities. It does not duplicate validation or business policy. A bounded request becomes
an execution-scoped task layered over a defensive canonical Project Brain clone; it is never persisted
or treated as canonical mutable state.

`src/infrastructure/workspace` is the server composition root. It alone reads runtime environment
configuration and provider credentials. `src/app/api/workspace` owns the HTTP boundary, and
`src/ui/workspace/http-workspace-workflow.ts` owns browser transport and revalidates every typed result.
Neither provider credentials nor provider SDK construction crosses into the client graph.

The complete prepared path is Project Brain → Blueprint Reader → Context Builder → Prompt Orchestrator
→ Execution Engine → configured AI Provider → Response Processor → Change Planner. The effect path is explicit
approval → File Apply Engine → Verification Engine → final report. Each arrow crosses the previously
defined validated contract; composition does not bypass or replace any core service.

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
environment lookup. The local server-only composition root loads required values and injects them;
secrets must never use `NEXT_PUBLIC_`, enter canonical state, logs, errors, tests, or client bundles.
The runtime fails closed when required configuration is missing.

## Observability

The local workflow emits structured request correlation, stage outcome, duration, and stable error
codes while excluding secrets and sensitive payloads. Health/readiness signals, durable restricted log
storage, alerting, and service-level indicators remain prerequisites for a hosted runtime. Product
analytics require an approved data inventory and consent model.

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
