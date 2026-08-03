# ADR-025: Feature Decomposition Workflow

## Status

Accepted — 2026-08-01

## Context

BuilderAI needs a human-controlled workflow that turns a high-level feature request into a sequence of dependency-aware implementation tasks without introducing autonomous multi-step execution, Project Brain mutation, or a second implementation engine.

Phase 4 adds:

- a dedicated decomposition provider call with its own bounded context/output contract,
- a validated `FeaturePlan` / `FeatureTask` workflow model,
- durable repository-local persistence under `.builderai/feature-plans/`,
- Gate 1 (FeaturePlan approval) and Gate 2 (existing ChangePlan approval),
- reuse of the existing prepare → apply → verify → Phase 3 correction pipeline for each task.

## Decision

### Dedicated decomposition call

Implement one provider-neutral decomposition execution type separate from the normal implementation output contract.

Input:

- bounded high-level feature request (≤ 4,000 characters),
- bounded decomposition context (hard limit 15,000 serialized characters).

Output:

- structured planning data only (`title`, `summary`, `tasks`),
- no file artifacts, commands, filesystem operations, or automatic mutations.

Rejected: monolithic implementation, rule-only decomposition, and combined decomposition+implementation responses.

### Bounded decomposition context

Build the smallest useful architecture-aware context from Project Brain, Blueprint analysis, repository path summary, and selected root configuration facts such as `package.json` scripts/framework hints.

Do not send the full implementation `ContextPackage`, arbitrary source files, all repository paths verbatim, Phase 3 evidence, raw provider output, or environment values.

### FeaturePlan / FeatureTask schemas

`FeaturePlan` schemaVersion 1 fields:

- `featurePlanId`, `sourceRequest`, `title`, `summary`, `status`, `tasks`, `createdAt`, `updatedAt`, optional `activeTaskId`

`FeatureTask` fields:

- `taskId`, `title`, `objective`, `scope`, `dependencyIds`, `expectedAreas`, `acceptanceCriteria`, `order`, `status`, optional bounded `lastOutcome`

Hard limits:

- max 12 tasks
- max serialized plan size 16,000 characters
- max 4 dependencies per task
- max 8 `expectedAreas`
- max 6 acceptance criteria × 240 characters
- bounded outcome summary ≤ 500 characters

Validation is server-side; provider and persisted files are untrusted on read.

### Dual approval model

Gate 1: operator reviews/edits a DRAFT `FeaturePlan`, server revalidates, operator explicitly approves to `APPROVED`. Approval performs zero filesystem mutations and does not call the implementation provider.

Gate 2: each task execution still requires explicit ChangePlan approval before File Apply, unchanged from the ordinary workspace workflow.

Post-approval structural edits invalidate approval and require explicit re-approval.

### Durable local workflow persistence

Approved/in-progress plans persist atomically under `.builderai/feature-plans/{featurePlanId}.json`.

Persistence is repository-local, schema-versioned, validated on load, path-contained, and excluded from git via `.builderai/`.

In-memory caches may exist for runtime convenience, but durable snapshots are the continuity source across refresh/restart.

Rejected: UI-only persistence.

### FeaturePlan is not Project Brain state

`FeaturePlan` and `FeatureTask` are workflow state only. Do not write them to canonical `project-brain.json`.

For retrieval during task execution, inject bounded transient DONE shadow dependency tasks into the execution clone only. Never persist shadow tasks.

Rejected: Project Brain as execution log or persistent conversation history.

### DAG dependency semantics

Each plan contains a validated DAG:

- dependency IDs must reference tasks in the same plan,
- missing references and cycles are rejected,
- readiness is derived deterministically,
- execution is sequential only (no automatic parallelism).

`SKIPPED` dependencies do **not** silently satisfy downstream tasks. Operators must explicitly override skipped prerequisites before executing dependents.

`FAILED` tasks block dependents until resolved or overridden by workflow rules.

### Task lifecycle

Minimum lifecycle:

- `PENDING`, `READY`, `IN_PROGRESS`, `COMPLETED`, `FAILED`, `SKIPPED`

Semantics:

- `PENDING → READY` only when dependencies are satisfied,
- `READY → IN_PROGRESS` only through explicit operator execution,
- `IN_PROGRESS` remains throughout Phase 3 correction attempts on the same task,
- `COMPLETED` normally requires verification `PASSED`,
- `PARTIALLY_PASSED` requires explicit operator acknowledgement,
- `PARTIALLY_APPLIED` never auto-completes a task.

### Reuse existing implementation pipeline

Feature task execution reuses:

`WorkspaceRuntimeService.prepareFeatureTask()` → Context Builder → Prompt Orchestrator → Provider → Response Processor → Change Planner → human ChangePlan approval → File Apply → Verification → Phase 3 correction.

Task input supplies bounded title/objective/scope/acceptance criteria and dependency context. The entire `FeaturePlan` is not injected into every implementation prompt.

Rejected: automatic next-task execution, background workers, and a second implementation engine.

### Phase 2 retrieval integration

Use task objective, scope, acceptance criteria, expectedAreas, and bounded completed dependency summaries to improve retrieval by generalizing existing path-hint boosting.

`expectedAreas` are safe repository-relative hints only. They may influence ranking but never bypass minimum score/safety, force read, or force admission.

Fresh Phase 1 + Phase 2 retrieval remains mandatory for every task execution and correction.

### Phase 3 correction integration

Correction remains attached to the same `FeatureTask` (`IN_PROGRESS` throughout). Downstream tasks stay unavailable while a prerequisite task is unresolved.

The existing bounded `IterationFeedback` model is preserved.

### Security / trust boundaries

- decomposition output and persisted plan files are untrusted on read,
- `.builderai/feature-plans` is path-contained with symlink/traversal rejection,
- all new routes use the trusted local request boundary,
- decomposition performs no repository code execution,
- plan approval and task binding perform no automatic filesystem mutation,
- existing File Apply and explicit apply approval boundaries remain unchanged.

## Consequences

Positive:

- operators gain a reviewable, sequential feature workflow without autonomous agents,
- continuity survives refresh/restart via durable local snapshots,
- existing P0/P1 reliability, budget, and verification boundaries remain intact,
- ordinary `POST /api/workspace/prepare { request }` behavior stays backward compatible.

Trade-offs:

- workflow state lives outside Project Brain and must be managed explicitly,
- skipped/failed dependency handling requires operator acknowledgement,
- decomposition quality still depends on provider output validation and bounded context.

## Alternatives rejected

- monolithic single-shot implementation for large features,
- rule-only decomposition without a dedicated provider call,
- combined decomposition + implementation provider response,
- Project Brain as execution log,
- UI-only persistence,
- automatic task execution after Gate 1 or Gate 2,
- persistent provider conversation history,
- parallel task execution.
