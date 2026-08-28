# ADR-047: Bounded Operator Tool Planning Projection (P1-C Slice 2 — Context → Plan Quality)

- **Status:** Accepted
- **Date:** 2026-08-28
- **Owners:** BuilderAI architecture
- **Related:** ADR-024 (Operator-initiated iteration feedback loop), ADR-036 (Gated Agent Operating
  Layer), ADR-038 (Codebase Intelligence), ADR-042 (Bounded Server-Owned Agent Tool Loop),
  ADR-044 (Bounded AgentLoop Product Integration Boundary), ADR-045 (Bounded Operator Tool-Turn
  Product Surface), ADR-046 (Provider Structured-Intent Emission Boundary)
- **Baseline:** `bdde80c97a49a9ea41b4126a3ef47a2140fc30fc` (P1-C Slice 1 — Investigate Before Plan)

## Context

P0, P1-A, P1-B B1–B10, D+B provider-assisted reliability/observability, A+D operational closure,
and P1-C Slice 1 are complete and frozen.

P1-C Slice 1 introduced explicit operator investigation before planning:

```
UNDERSTANDING
  → operator tool turn (B8/B9/B10 entry)
  → AgentLoop
  → B1/B2 tools
  → bounded evidence
  → UI evidence display
  → explicit Plan
```

Planning remains the existing P1-A discrete lifecycle:

```
AgentOperating.plan()
  → P0 InvestigationHandoffFeedback
  → WorkspaceRuntimeService.prepare()
  → ContextBuilder / PromptOrchestrator
  → ProviderExecution (toolCalling:false)
  → ChangePlannerService
  → Gate2
```

ADR-044 established bounded digest-oriented persistence for AgentLoop evidence.
ADR-045 established operator tool-turn UI and digest visibility without prepare ingestion.
Slice 1 deliberately kept operator tool evidence as operator/UI context only.

The P1-C Slice 2 architecture audit concluded that digest-only `BoundedToolEvidenceRecord` is
insufficient to improve subsequent `prepare()` context, and that crossing the prepare boundary
requires an explicit architectural decision before implementation.

## Problem

Current persisted `BoundedToolEvidenceRecord` (ADR-044) stores identity metadata and a
`summaryDigest` (a digest of the tool summary string). It does **not** retain planning-useful
structured fields such as:

- bounded logical path hints,
- existing vs candidate path classification,
- search hit counts,
- relevant file counts,
- readiness status,
- truncation indicators.

Sanitized `ToolResult.structured` exists at tool execution time but is not written into durable
AgentLoop evidence in a form usable at `plan()` time after restart/hydrate.

Therefore operator investigation currently improves operator visibility but does **not** improve
the server's subsequent `prepare()` context or ChangePlan relevance upstream of Gate2.

This problem **MUST NOT** be solved by:

- re-running tools during `plan()` (implicit auto-continue; violates explicit operator-triggered
  investigation),
- accepting client-supplied planning context (expands client authority / trust boundary),
- passing raw `ToolResult` payloads into `prepare()` (security, privacy, boundedness),
- feeding tools directly into `ChangePlannerService` (bypasses existing prepare pipeline),
- bypassing Gate2,
- changing provider `toolCalling:false`.

## Decision drivers

- Improve plan quality using operator B1/B2 investigation without weakening frozen safety boundaries.
- Reuse existing prepare/context machinery (`iterationPathHints`, bounded prepare-intent patterns).
- Preserve Gate2 → `approveAndApply` → FileApply as the sole source-file mutation path.
- Keep provider output DATA-only; no provider-native tool execution.
- Maintain backward compatibility for runs without operator investigation or v1 evidence files.
- Fail closed: operator context is supplemental DATA, never authority.

## Decision

**P1-C Slice 2 = Bounded Operator Tool Planning Projection.**

BuilderAI **WILL** introduce a bounded, server-derived **`OperatorToolPlanningProjection`**, created
from already-sanitized B1/B2 tool structured output at evidence-write time.

The projection is **DATA only**.

At plan time:

```
AgentOperating.plan()
  → resolve P0 InvestigationHandoffFeedback
  → hydrate operator planning projections
  → build OperatorToolPlanningContext
  → deterministically merge P0 + operator context
  → existing WorkspaceRuntimeService.prepare()
  → existing ContextBuilder / PromptOrchestrator
  → provider DATA-only execution (toolCalling:false)
  → ChangePlannerService
  → Gate2
```

**No second planner is introduced.**

**No direct tool → ChangePlanner path is introduced.**

**No Gate2 semantics change.**

Acceptance of this ADR does **not** by itself authorize implementation; Slice 2 implementation
requires separate explicit authorization.

## Architecture flow

### Slice 1 (unchanged)

```
UNDERSTANDING
  → POST …/tool-turn | …/provider-tool-turn
  → AgentOperating.executeToolTurn / executeProviderAssistedToolTurn
  → AgentLoop → ToolPolicyGate → B1/B2 tools
  → BoundedToolEvidenceRecord (+ optional planningProjection after Slice 2)
  → GET …/run/:runId → toolLoop (UI)
  → explicit Plan (POST …/plan, body {})
```

### Slice 2 (additive)

```
Evidence write (server, at tool turn completion):
  ToolExecutor → sanitizeToolStructured → assertNoForbiddenToolResultPayload
  → extract OperatorToolPlanningProjection (B1/B2 only)
  → attach optional planningProjection to BoundedToolEvidenceRecord
  → persist tool-loop-evidence.json

Plan (server, explicit operator):
  AgentOperating.plan()
  → P0 handoff + OperatorToolPlanningContext merge
  → prepare(goal, mergedServerInput)
  → [existing prepare pipeline unchanged through Gate2]
```

Never:

- Client → supply planning hints on `POST …/plan`
- Provider → persist or supply planning projection
- Operator projection → Gate2 approval, apply tokens, or FileApply
- Operator projection → ChangePlannerService direct input (bypass prepare)
- `plan()` → auto-execute tools

## OperatorToolPlanningProjection

Per evidence record, optional, server-derived only. Conceptual contract (implementation types may be
refined during Slice 2 while remaining within these constraints):

```typescript
interface OperatorToolPlanningProjection {
  readonly projectionSchemaVersion: 1;
  readonly sourceRunId: string;
  readonly toolId: string;
  readonly intentId: string;
  readonly phase: AgentRunPhase;
  readonly status: AgentLoopTurnStatus;
  readonly recordedAt: string;

  readonly pathHints?: readonly string[];
  readonly existingPathHints?: readonly string[];
  readonly candidatePathHints?: readonly string[];

  readonly searchHitCount?: number;
  readonly relevantFileCount?: number;
  readonly readinessStatus?: string;
  readonly truncated?: boolean;

  readonly provenance: 'OPERATOR_TOOL_TURN';
  readonly summaryDigest: string;
}
```

**Distinctions:**

| Artifact                          | Role                                           | Authority                       |
| --------------------------------- | ---------------------------------------------- | ------------------------------- |
| P0 `InvestigationHandoffFeedback` | Automatic investigation at `startRun()`        | DATA → prepare                  |
| P1-C operator tool evidence       | Explicit B1/B2 turns                           | DATA → UI; projection → prepare |
| `OperatorToolPlanningProjection`  | Bounded extract of sanitized structured output | DATA → prepare only             |
| `ChangePlan`                      | Provider → ChangePlanner output                | DATA until Gate2                |
| Gate2 / apply tokens              | Human mutation boundary                        | POLICY — never in projection    |

Per-record caps **MUST** align with existing bounded limits (e.g.
`ITERATION_FEEDBACK_LIMITS.MAX_PATH_HINTS`, string caps from investigation/prepare helpers).
Per-projection serialized size **MUST** be capped (implementation chooses a conservative limit ≤2 KB
per record unless a stricter existing constant applies).

## OperatorToolPlanningContext

Ephemeral aggregate built **server-side in `AgentOperating.plan()`** — not persisted separately,
not accepted from HTTP:

- `records`: projections from hydrated evidence (typically `UNDERSTANDING` phase operator turns)
- `mergedPathHints`, `mergedExistingPathHints`, `mergedCandidatePathHints` (post-merge)
- `provenanceSummary`: bounded deterministic narrative (≤800 characters)
- `truncated`: whether operator portion was truncated during merge

## Persistence strategy

**Recommended (MVP):** add optional `planningProjection?` to each `BoundedToolEvidenceRecord`.

**Do NOT** create a second planning persistence store for MVP.

Population occurs at evidence-write time in AgentLoop (after successful sanitization), using
tool-specific extractors limited to operator B1/B2 investigation tools in Slice 2 scope.

Persistence **MUST** extend existing `assertNoForbiddenPersistedKeys` guards; forbidden keys at
persist time **MUST** fail closed (reject persist or drop projection — implementation chooses one
documented behavior; dropping projection for a single record while keeping digest evidence is
preferred over failing the entire tool turn when projection extraction fails).

## Schema / version compatibility

- **AgentLoop schema v1:** remains readable; records without `planningProjection` are valid.
- **AgentLoop schema v2:** additive; optional `planningProjection` on each record.
- Bump `AGENT_LOOP_SCHEMA_VERSION` from `1` → `2` additively.
- `projectionSchemaVersion: 1` inside projection for forward evolution.
- **No migration script** is required.
- Old runs without projections **MUST** plan with P0 behavior only (current semantics).
- Malformed projections on individual records **MUST** degrade gracefully (skip record projection;
  do not fail entire plan).

## Deterministic merge rules

Merge occurs **only** in `AgentOperating.plan()` before calling `WorkspaceRuntimeService.prepare()`.

### P0 precedence

P0 `InvestigationHandoffFeedback` **always retains semantic precedence**. Operator context is
**supplemental**. Operator context **MUST NOT** weaken, remove, or override P0 classifications or
summaries.

### Existing paths

- Union P0 and operator `existingPathHints`.
- If the same path is classified differently, **P0 classification wins**.

### Candidate paths

- Union P0 and operator `candidatePathHints`.
- If a candidate is verified as existing in the repository index at plan time, it **MAY** be promoted
  to existing (same rule family as P0 external-target prepare helpers).

### General path hints

Order:

1. P0 `pathHints`, preserving existing rank/order from P0 handoff.
2. Operator hints not already present.
3. Deterministic ordering for operator records: `recordedAt` ascending, then `intentId` lexicographic.

### Deduplication

- Use existing path normalization conventions (`normalizeProjectPath` / prepare confidentiality
  filters).
- Deduplicate deterministically.

### Limits

- Reuse `ITERATION_FEEDBACK_LIMITS.MAX_PATH_HINTS` (8).
- **Do not silently raise** the existing cap in Slice 2.
- If truncation is necessary: preserve P0 hints first; truncate operator hints first (latest /
  lowest-priority operator records dropped first).

### Task / provenance text

- P0 investigation content (`investigationSummary`, `buildInvestigationPrepareIntentBlock` semantics)
  **remains first**.
- Operator content is appended as bounded DATA with wording equivalent to:
  **"Operator tool investigation (read-only; not applied)"**.
- Operator content **MUST NOT** override P0 semantics.

## Server-only rule

`POST /api/workspace/agent/run/:runId/plan` **remains unchanged**. Request body **MUST** remain
empty of planning-context fields (existing `assertNoClientAuthorityFields` posture).

The server reconstructs planning context exclusively from:

- `AgentRun` server state,
- persisted operator evidence (hydrated AgentLoop),
- server-side P0 investigation handoff resolution,
- server-side sanitization and projection extraction.

A client **cannot** choose, forge, remove, or elevate planning hints.

Implementation **MAY** use an internal server-only discriminated prepare input (e.g.
`OPERATOR_TOOL_PLANNING_MERGE`) composed inside `AgentOperating.plan()`. Such a type **MUST NOT** be
exposed through HTTP or accepted from provider output.

## Security and trust boundaries

| Boundary                 | Rule                                                          |
| ------------------------ | ------------------------------------------------------------- |
| Client / HTTP            | No planning context on plan route; merge server-only          |
| Provider                 | DATA-only; `toolCalling:false`; never writes projection       |
| AgentLoop                | Executes tools; does not call prepare                         |
| AgentOperating           | Orchestrates merge at `plan()`; no new mutation path          |
| prepare / ContextBuilder | Receives merged path hints and bounded task augmentation only |
| ChangePlanner            | Unchanged position in pipeline                                |
| Gate2 / FileApply        | Unchanged; projection cannot authorize apply                  |

Operator context is **DATA**. It **MUST NEVER** become authority.

Path hints **MUST NOT** authorize FileApply. Planning context **MUST NOT** approve Gate2, Git write,
or browser observation. Projection **MUST NOT** transition AgentRun phase.

## Sanitization and forbidden data

Projection **MUST** be produced only from sanitized structured tool data (`sanitizeToolStructured`,
`assertNoForbiddenToolResultPayload`) at evidence-write time.

The ADR **explicitly prohibits** persistence of:

- raw provider output,
- raw `ToolResult` blobs,
- file contents,
- file previews,
- stdout / stderr,
- credentials,
- cookies,
- browser state,
- Gate2 tokens,
- `applyAuthorizationToken`,
- approval state (`approved`, `operatorApproved`, `browserObservationApproved`, etc.),
- `ChangePlan`,
- `gate2Review`,
- client-supplied planning context,
- shell / cwd / env,
- arbitrary unbounded JSON.

Existing ADR-037 / ADR-044 forbidden-key posture **MUST** be preserved and extended for projection
fields.

## Prepare-boundary integration

Operator context enters the **existing** prepare machinery:

- `iterationPathHints` (merged, filtered via prepare confidentiality),
- bounded prepare-intent / task-text augmentation (mirror P0
  `buildExternalTargetInvestigationPreparePlan` / `buildInvestigationPrepareIntentBlock` patterns),

**Do NOT introduce:**

- a second planner,
- direct ChangePlanner input from tool evidence,
- direct Gate2 input from tool evidence,
- a new mutation path.

Preferred integration point: **`AgentOperatingService.plan()`** feeding existing
`WorkspaceRuntimeService.prepare()` second argument (or internal server-only composition wrapper).

## Tool scope (Slice 2)

Projection extraction is limited to **operator B1/B2 investigation tools** (e.g.
`search_repository`, `inspect_readiness`, `retrieve_relevant_context`, `find_related_files`,
`inspect_file_outline`, `inspect_imports`, and other read-only B1/B2 tools phase-allowed in
`UNDERSTANDING`).

**Preserved rejections:**

- no `toolCalling:true`,
- no autonomous tool loop expansion,
- no auto tool execution during `plan()`,
- no BROWSER tools in projection extractors for Slice 2 MVP,
- no WEB, GIT_WRITE, MCP,
- no memory,
- no parallel or background execution.

## Alternatives considered

| Option                                   | Description                       | Verdict                                                           |
| ---------------------------------------- | --------------------------------- | ----------------------------------------------------------------- |
| **A. UI-only evidence**                  | Slice 1 status quo                | Safe but **insufficient** for plan quality                        |
| **B. Raw tool results into planning**    | Persist/pass full `ToolResult`    | **Rejected** — security, privacy, boundedness                     |
| **C. Bounded server-side projection**    | This ADR                          | **Selected**                                                      |
| **D. Re-run tools during `plan()`**      | Hidden investigation at plan time | **Rejected** — violates explicit operator-triggered investigation |
| **E. Client-submitted planning context** | Plan body carries hints           | **Rejected** — client authority forgery                           |

## Testing strategy

Slice 2 implementation **MUST** include (no large telemetry system):

| Area                   | Requirement                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| Projection persistence | v2 records persist bounded projection; forbidden keys rejected                                     |
| Hydrate compatibility  | v1 evidence hydrates; plans with P0-only fallback                                                  |
| Sanitizer              | Projection extractors consume post-sanitizer structured only                                       |
| Merge                  | Deterministic P0/operator merge; duplicate paths; P0 precedence                                    |
| Truncation             | Operator hints truncated before P0 when over cap                                                   |
| Restart                | Hydrated projections used after process restart                                                    |
| Legal paths            | `startRun → plan()` without investigation remains valid                                            |
| Frozen benchmarks      | P1-A, P1-B, P1-C Slice 1 composition tests remain green                                            |
| Gate2 safety           | Zero FileApply before Gate2 approval                                                               |
| Plan quality           | Benchmark using existing signals: path-hint → ChangePlan operation overlap and/or `PrepareOutcome` |

## Migration / backward compatibility

- v1 evidence files: valid; no projection; `plan()` behaves as today (P0 handoff only).
- v2 evidence without operator turns: same as today.
- Partial/malformed projection on a record: skip that projection; do not fail entire plan.
- **No server-mandatory investigation gate** before plan.
- No migration script required.

## Risks

| Risk                            | Mitigation                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| Projection drift from sanitizer | Single extract path from post-sanitizer structured                                     |
| P0/operator hint conflict       | Documented precedence; P0 wins                                                         |
| Weak plan-quality uplift        | Measure via overlap / `PrepareOutcome`; safety preserved regardless                    |
| Schema creep                    | `projectionSchemaVersion`; strict caps                                                 |
| ADR-044 “digests only” wording  | ADR-047 explicitly adds bounded planning projection as an allowed persistence category |

## Explicit non-goals

- Memory / cross-run context
- Parallel or background agents
- MCP, WEB, LSP, embeddings / vector DB
- Multi-turn auto-continue or auto tool re-run at plan
- Provider `toolCalling:true`
- Autonomous Git write / push
- New Tool Registry capability classes
- Server-mandatory investigation before plan
- Client-submitted planning context
- Raw provider output or file content persistence
- Feeding Gate2 or ChangePlanner directly from tool payloads
- Correction-path operator merge (deferred unless separately scoped)

## Consequences

### Positive

- Operator B1/B2 investigation can improve prepare scope and ChangePlan relevance without new
  execution engines.
- Reuses proven P0 handoff → `iterationPathHints` → ContextBuilder path.
- Server-only merge preserves B8/B10 trust boundaries.
- Additive schema; old runs remain valid.

### Negative

- AgentLoop evidence schema grows; implementation and test burden increases.
- Plan-quality improvement is probabilistic (provider may ignore hints).
- ADR-044 persistence wording requires careful documentation sync (projection is not raw payload).

### Neutral

- Slice 1 UI/workflow unchanged.
- HTTP routes unchanged.
- Gate2/FileApply unchanged.

## Relationship to related ADRs

| ADR     | How ADR-047 extends without weakening                                                                                                                                              |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **024** | Reuses iteration path-hint and bounded feedback patterns; operator projection is a new DATA source into the same prepare hint machinery, not a new feedback kind from apply/verify |
| **036** | Extends `AgentOperating.plan()` orchestration; does not duplicate ChangePlan on AgentRun or bypass Gate2                                                                           |
| **038** | Uses B2 bounded structured fields as projection source; does not add LSP/embeddings or new capability classes                                                                      |
| **042** | Adds optional projection at evidence write; preserves budgets, serial execution, idempotency                                                                                       |
| **044** | Extends digest persistence with an additional **bounded planning projection** category; does not persist raw ToolResult or provider output                                         |
| **045** | Extends operator evidence from UI-only to server-side prepare input; does not change HTTP tool-turn authority model                                                                |
| **046** | Provider remains `toolCalling:false` and DATA-only; projection comes from executed server tools, not provider proposals                                                            |

## Rollout and reversal

1. Accept ADR-047 (this document).
2. Implement Slice 2 only under separate authorization.
3. Validate with composition benchmarks and full `npm run ci`.
4. Reversal: stop merging operator context in `plan()`; v2 evidence with projections becomes inert
   (P0-only planning); no Gate2/FileApply behavior change required.
