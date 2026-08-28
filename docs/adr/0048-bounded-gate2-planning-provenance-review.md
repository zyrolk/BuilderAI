# ADR-048: Bounded Gate2 Planning Provenance Review (P1-C Slice 3)

- **Status:** Accepted
- **Date:** 2026-08-28
- **Owners:** BuilderAI architecture
- **Related:** ADR-024 (Operator-initiated iteration feedback loop), ADR-036 (Gated Agent Operating
  Layer), ADR-042 (Bounded Server-Owned Agent Tool Loop), ADR-044 (Bounded AgentLoop Product
  Integration Boundary), ADR-045 (Bounded Operator Tool-Turn Product Surface), ADR-046 (Provider
  Structured-Intent Emission Boundary), ADR-047 (Bounded Operator Tool Planning Projection)
- **Baseline:** `054916b8bc21fcaf6d3593dd67bc81d8426288fe` (P1-C Slice 2 — Context → Plan Quality)

## Context

P0, P1-A, P1-B B1–B10, D+B provider-assisted reliability/observability, A+D operational closure,
P1-C Slice 1 (Investigate Before Plan), ADR-047, and P1-C Slice 2 (Bounded Operator Tool Planning
Projection) are complete and frozen.

P1-C Slice 2 closed the **Context → Plan** server boundary:

```
AgentOperating.plan()
  → resolve P0 InvestigationHandoffFeedback
  → hydrate persisted operator planningProjection
  → build OperatorToolPlanningContext
  → deterministically merge P0 + operator context (ADR-047)
  → WorkspaceRuntimeService.prepare()
  → ContextBuilder / PromptOrchestrator
  → ProviderExecution (toolCalling:false)
  → ChangePlannerService
  → Gate2ReviewProjection
```

Operator B1/B2 investigation can now improve subsequent `prepare()` context and ChangePlan
relevance upstream of Gate2.

The P1-C Slice 3 architecture/readiness audit concluded that Slice 2 improved plan inputs
invisibly at the mandatory Gate2 pause. At `AWAITING_GATE2`, the operator currently sees aggregate
Gate2 summary counts and bounded tool digests, but **cannot** reliably verify:

1. whether P0 investigation context contributed to planning,
2. whether operator investigation context contributed to planning,
3. which hints survived the deterministic P0 + operator merge,
4. which merged hints overlap planned operation logical paths,
5. which merged hints did not overlap the resulting ChangePlan.

That gap is a **product/trust boundary** at Gate2 review, not a prepare-quality gap. Crossing the
Gate2 **display** boundary requires an explicit architectural decision before implementation.

ADR-047 explicitly scoped Slice 2 to prepare-ingestion only and listed Gate2 product-surface
changes as out of scope.

## Problem

After Slice 2, planning context merge occurs server-side in `AgentOperating.plan()`, but the merge
result and attribution are consumed only by `WorkspaceRuntimeService.prepare()`. They are **not**
retained for operator review at Gate2.

Current operator-visible surfaces at `AWAITING_GATE2`:

| Surface                       | What it shows                                     | What it omits                       |
| ----------------------------- | ------------------------------------------------- | ----------------------------------- |
| POST `…/plan` `gate2Review`   | Operation count, diff character count, truncation | Logical paths, planning provenance  |
| AgentRunPanel Gate2 section   | Same summary counts                               | P0 vs operator attribution, overlap |
| GET `…/run/:runId` `toolLoop` | Bounded tool digests                              | `planningProjection` path hints     |
| Explain `toolLoop` section    | Digests only                                      | Merge provenance, path overlap      |

The operator must approve Gate2 without visibility into how investigation context influenced the
planned ChangePlan.

This problem **MUST NOT** be solved by:

- feeding tool evidence or provenance into Gate2 approval authority,
- accepting client-supplied provenance (expands client authority / trust boundary),
- exposing raw `ToolResult`, structured tool payloads, or file contents,
- re-running tools during `plan()` (violates explicit operator-triggered investigation),
- changing Gate2 approval semantics, FileApply, or ChangePlanner validation,
- introducing durable provenance persistence (unnecessary for current Gate2 lifecycle),
- exposing full unified diffs through AgentRunPanel as part of this slice (separate concern).

## Decision drivers

- Close the Gate2 **review trust gap** opened by Slice 2 plan-quality improvements.
- Preserve Gate2 → `approveAndApply` → FileApply as the sole source-file mutation path.
- Keep provenance **DATA-only**; never authority.
- Reuse existing Slice 2 merge semantics without redefinition.
- Reuse existing ephemeral Gate2 evidence lifecycle (no new durable store).
- Fail closed: provenance is display/audit only; malformed inputs degrade gracefully.
- Maintain backward compatibility for runs without operator investigation.

## Decision

**P1-C Slice 3 = Bounded Gate2 Planning Provenance Review.**

BuilderAI **WILL** introduce a bounded, server-derived, read-only **`Gate2PlanningProvenanceReview`**
assembled after planning and exposed at the mandatory `AWAITING_GATE2` product pause.

The artifact is **DATA only** — display and audit — and **MUST NOT** become an authority input.

At plan time (after existing prepare pipeline completes):

```
P0 InvestigationHandoffFeedback
        +
persisted operator planningProjection
        ↓
existing deterministic Slice 2 merge (ADR-047; unchanged)
        ↓
WorkspaceRuntimeService.prepare()
        ↓
ChangePlanner
        ↓
Gate2ReviewProjection
        ↓
assembleGate2PlanningProvenance()   ← new; pure, deterministic
        ↓
ephemeral AgentRun evidence
        ↓
pauseAtGate2()
        ↓
bounded POST …/plan response
        ↓
AgentRunPanel Gate2 display
```

**No second planner is introduced.**

**No prepare pipeline change.**

**No Gate2 approval semantic change.**

**No FileApply change.**

**No provider capability change.**

Acceptance of this ADR **authorizes P1-C Slice 3 implementation only**. It does **not** authorize
any later slice, correction-path operator merge, memory, MCP, WEB, parallel agents, autonomous Git,
provider `toolCalling:true`, or Gate2 authority changes.

## Architecture flow

### Slice 2 prepare pipeline (unchanged)

```
AgentOperating.plan()
  → P0 handoff + OperatorToolPlanningContext merge
  → prepare(goal, mergedServerInput)
  → [existing prepare pipeline through Gate2ReviewProjection]
```

### Slice 3 (additive display only)

```
After prepare succeeds (server, in AgentOperating.plan()):
  assembleGate2PlanningProvenance({
    handoff,
    operatorContext,
    mergedHandoff,          // output of mergeOperatorToolPlanningWithHandoff
    gate2Review             // preparation.gate2Review
  })
  → optional planningProvenance on AgentRunEphemeralEvidence
  → returned on AgentOperatingPlanResult / pauseAtGate2
  → bounded field on POST …/plan response
  → AgentRunPanel Gate2 subsection (display only)
```

Never:

- Client → supply `planningProvenance` on `POST …/plan` or any route
- Provenance → Gate2 approval, apply tokens, or FileApply
- Provenance → ChangePlannerService or prepare input
- Provenance → provider execution or AgentLoop policy
- Provenance → durable AgentRun JSON or new persistence store
- `plan()` → auto-execute tools

## Gate2PlanningProvenanceReview

Per plan cycle, optional, server-derived only. Conceptual contract (implementation types may be
refined during Slice 3 while remaining within these constraints):

```typescript
interface Gate2PlanningProvenanceReview {
  readonly schemaVersion: 1;

  readonly hasP0Context: boolean;
  readonly hasOperatorContext: boolean;

  readonly p0PathHintCount: number;
  readonly operatorPathHintCount: number;
  readonly mergedPathHintCount: number;
  readonly plannedOperationCount: number;
  readonly plannedPathOverlapCount: number;
  readonly unmatchedMergedHintCount: number;

  readonly p0OnlyPathHints: readonly string[];
  readonly operatorOnlyPathHints: readonly string[];
  readonly mergedPathHints: readonly string[];
  readonly matchedPlannedPaths: readonly string[];
  readonly unmatchedMergedPathHints: readonly string[];

  readonly truncated: boolean;
}
```

**Distinctions:**

| Artifact                          | Role                                     | Authority                    |
| --------------------------------- | ---------------------------------------- | ---------------------------- |
| P0 `InvestigationHandoffFeedback` | Automatic investigation at `startRun()`  | DATA → prepare               |
| `OperatorToolPlanningProjection`  | Bounded operator B1/B2 extract (ADR-047) | DATA → prepare               |
| `Gate2PlanningProvenanceReview`   | Post-plan display of merge + overlap     | **DATA → display only**      |
| `Gate2ReviewProjection`           | Planned operation diffs for Gate2 review | DATA until explicit approval |
| Gate2 / apply tokens              | Human mutation boundary                  | POLICY — never in provenance |

### Bounds

- Reuse `ITERATION_FEEDBACK_LIMITS.MAX_PATH_HINTS` (current cap: **8**) for every path list.
- Normalize paths using existing repository conventions (`normalizeProjectPath` / prepare
  confidentiality filters).
- Deduplicate deterministically.
- **Counts** represent full cardinality **before** display-list truncation.
- `truncated: true` when any bounded list is truncated.
- The artifact **MUST NOT** contain:
  - raw tool output,
  - file contents,
  - unified diffs,
  - previews,
  - stdout / stderr,
  - credentials / secrets,
  - provider response,
  - prompt package,
  - Gate2 token,
  - approval state,
  - `ChangePlan` object.

## Attribution rules

Attribution **MUST** be computed by a **pure, deterministic** assembler. The assembler **MUST NOT**
redefine or modify ADR-047 merge semantics; it **MUST** consume the existing merge result.

### P0 paths

Union of P0 handoff `pathHints`, `existingPathHints`, and `candidatePathHints`, normalized and
deduplicated.

### Operator paths

Derived from `OperatorToolPlanningContext` (operator planning context **before** final merged
attribution labels), using the same normalized path unions as Slice 2 context building.

### P0-only

P0 paths minus operator paths.

### Operator-only

Operator paths minus P0 paths.

### Merged

Use the **already-existing** Slice 2 deterministic merge result (`mergedHandoff` from
`mergeOperatorToolPlanningWithHandoff`): union of merged `pathHints`, `existingPathHints`, and
`candidatePathHints`.

### Planned overlap

Compare normalized merged path hints against:

`gate2Review.operationDiffs[].logicalPath`

Then derive:

- `matchedPlannedPaths` — intersection,
- `unmatchedMergedPathHints` — merged minus matched,
- `plannedPathOverlapCount` — cardinality of matched set.

### P0 precedence (preserved from Slice 2)

- P0 semantics **cannot** be weakened.
- Shared paths retain **P0** attribution (appear in P0 contribution; not operator-only).
- Operator context is **supplemental**.
- Operator context **cannot** authorize mutation.
- Operator context **cannot** remove or downgrade P0 hints.

### Malformed / missing inputs

- Missing operator projections: degrade to P0-only provenance; do not fail plan.
- Malformed projections on individual records: skip per ADR-047; provenance reflects valid records
  only.
- Missing P0 handoff: degrade to operator-only provenance when operator context exists.
- Neither source: provenance **MAY** be omitted or report zero counts with both flags false.

## Storage

Provenance is stored **only** in existing process-local **`AgentRunEphemeralEvidence`**, consistent
with the current Gate2 review lifecycle (`gate2Review`, `preparationId`, `expiresAt`).

**Do NOT** introduce durable provenance persistence in this slice.

**Do NOT** add fields to persisted `AgentRun` JSON for provenance.

Existing restart limitations remain unchanged: after process restart while `AWAITING_GATE2`,
ephemeral Gate2 review material (including provenance) may be unavailable — same accepted limit as
today for in-memory preparation and ephemeral evidence (ADR-036).

Assembly **SHOULD** occur once in `AgentOperating.plan()` immediately after prepare succeeds, when
all inputs are present, and be read from ephemeral in `pauseAtGate2()` without reassembly.

## Server-only rule

`POST /api/workspace/agent/run/:runId/plan` request body **MUST** remain unchanged. Existing
`assertNoClientAuthorityFields` posture **MUST** be preserved. Client-supplied planning provenance
**MUST** be rejected if present.

The server reconstructs provenance exclusively from:

- server-side P0 investigation handoff resolution,
- persisted operator evidence (hydrated AgentLoop),
- the existing Slice 2 merge output,
- `preparation.gate2Review` from the completed prepare cycle.

A client **cannot** choose, forge, remove, or elevate planning provenance.

## HTTP boundary

Authorize an **additive** optional field on the existing POST `…/plan` response:

```typescript
planningProvenance?: Gate2PlanningProvenanceReview
```

**No new route.**

The HTTP response **MUST** use explicit field selection / bounded serialization (mirror
`toBoundedToolEvidenceHttpView` — never spread internal objects).

Implementation **SHOULD** add `toGate2PlanningProvenanceHttpView()` in `agent-route-helpers.ts`.

`applyAuthorizationToken` **MUST** remain a separate top-level response field; it **MUST NOT** appear
inside `planningProvenance`.

GET `…/run/:runId` status **MAY** remain unchanged in Slice 3 MVP (pre-existing reload limitation
for Gate2 summary persists).

## UI boundary

Authorize a **display-only** subsection in the existing **AgentRunPanel** Gate2 section showing:

- P0 investigation: yes / no (`hasP0Context`)
- Operator investigation: yes / no (`hasOperatorContext`)
- P0 / operator / merged path hint counts
- planned path overlap count
- unmatched merged hint count
- capped path lists (`p0OnlyPathHints`, `operatorOnlyPathHints`, `matchedPlannedPaths`,
  `unmatchedMergedPathHints` as appropriate)
- truncation notice when `truncated: true`

**Do NOT** change:

- approval checkbox or button,
- approval semantics,
- Gate2 authorization flow,
- FileApply flow.

**Do NOT** expose full unified diffs as part of this slice.

**Do NOT** introduce a new navigation flow.

## Correction path

`planCorrection()` **does not** gain operator-tool merge semantics in this slice (ADR-047 non-goal
remains deferred).

If provenance is assembled for a correction plan, it **MUST** reflect the **actual** correction
planning input (`buildIterationFeedbackFromCompletion`) rather than inventing operator attribution.

Correction-path operator merge remains **deferred** unless separately scoped by a future ADR.

## Security and trust boundaries

| Boundary                | Rule                                                             |
| ----------------------- | ---------------------------------------------------------------- |
| Client / HTTP           | No provenance on request; response-only bounded projection       |
| Provider                | DATA-only; `toolCalling:false`; never writes provenance          |
| AgentLoop               | Executes tools; does not assemble provenance                     |
| AgentOperating          | Assembles provenance after prepare; no new mutation path         |
| prepare / ChangePlanner | Unchanged; provenance is output of prepare, not input            |
| Gate2 / FileApply       | Unchanged; provenance cannot authorize apply                     |
| Explain (optional)      | May later consume ephemeral provenance; not required for Slice 3 |

Provenance is **DATA**. It **MUST NEVER** become authority.

Provenance **MUST NOT**:

- be accepted from clients,
- be passed to `executeAfterApproval` or `approveAndApply`,
- be passed to FileApply,
- be used as an authority field,
- alter Gate2 approval semantics,
- alter execution phase transitions,
- alter provider capabilities or AgentLoop execution policy,
- alter ToolPolicyGate decisions.

### Frozen boundaries (Slice 3 implementation MUST NOT change)

- Gate2 approval contract
- `approveAndApply`
- FileApply
- AgentLoop execution policy
- ToolPolicyGate
- provider `toolCalling:false`
- ChangePlanner validation
- Slice 2 merge semantics (`operator-tool-planning-merge.ts`)
- P0 prepare semantics (`WorkspaceRuntimeService.prepare()`)

### Forbidden data in provenance

The artifact and HTTP projection **MUST NOT** include:

- `unifiedDiff`, `fileContents`, `content`, `preview`, `excerpt`, `lineText`,
- `stdout`, `stderr`,
- raw `ToolResult` or structured tool payload,
- `applyAuthorizationToken`, `approved`, `operatorApproved`, `browserObservationApproved`,
- `changePlan`, `gate2Review`, `baselineDigest`,
- `providerResponse`, `promptPackage`,
- credentials, cookies, env, cwd, shell, command, argv,
- client-supplied provenance.

Existing ADR-044 / ADR-047 forbidden-key posture **MUST** be preserved in tests.

## Alternatives considered

| Option                                         | Description                            | Verdict                                                 |
| ---------------------------------------------- | -------------------------------------- | ------------------------------------------------------- |
| **A. UI-only digests**                         | Slice 1/2 status quo at Gate2          | **Rejected** — insufficient for planning provenance     |
| **B. Raw tool-result exposure**                | Show structured tool output at Gate2   | **Rejected** — violates bounded/sanitized architecture  |
| **C. Re-run tools during `plan()`**            | Recompute context at plan time         | **Rejected** — violates explicit operator investigation |
| **D. Client-submitted provenance**             | Plan body carries attribution          | **Rejected** — client authority forgery                 |
| **E. Durable provenance store**                | New persisted provenance artifact      | **Rejected** — unnecessary for current Gate2 lifecycle  |
| **F. Full diff in AgentRunPanel**              | Wire Gate2DiffView into agent workflow | **Rejected** — separate concern; out of Slice 3 scope   |
| **G. Bounded server-derived Gate2 provenance** | This ADR                               | **Selected**                                            |

## Testing strategy

Slice 3 implementation **MUST** include (no large telemetry system):

### Unit (`assembleGate2PlanningProvenance`)

| Case                         | Requirement                                   |
| ---------------------------- | --------------------------------------------- |
| P0-only                      | `hasP0Context=true`; operator counts zero     |
| Operator-only                | `hasOperatorContext=true`; P0 counts zero     |
| P0 + operator                | Both flags; correct attribution lists         |
| Duplicate paths              | Deduped deterministically                     |
| P0 precedence                | Shared paths not in `operatorOnlyPathHints`   |
| Planned overlap              | `matchedPlannedPaths` ∩ planned logical paths |
| Unmatched paths              | `unmatchedMergedPathHints` correct            |
| Truncation                   | `truncated=true` when lists exceed cap        |
| Malformed/missing projection | Graceful degradation; plan not failed         |

### HTTP

| Case                       | Requirement                                |
| -------------------------- | ------------------------------------------ |
| Bounded response           | Path lists capped; counts full cardinality |
| Explicit field picking     | No spread of internal objects              |
| Forbidden fields absent    | Serialized response walk                   |
| Client-supplied provenance | Rejected on POST body                      |

### Composition

```
start → operator B1/B2 tool turn → plan → provenance → Gate2
```

Verify:

- provenance exists on plan / pause result,
- operator path attribution present,
- deterministic overlap with planned operation paths,
- zero FileApply before Gate2 approval.

### Regression

Existing tests **MUST** remain green:

- P1-A E2E (`p1a-step6-e2e.composition.test.ts`)
- P1-B governed workflow benchmark
- P1-C Slice 1 (`p1c-investigate-before-plan.composition.test.ts`)
- P1-C Slice 2 (`p1c-context-to-plan-quality.composition.test.ts`)
- AgentLoop persistence
- Gate2 review tests
- agent route tests
- AgentRunPanel tests

## Migration / backward compatibility

- Runs without operator investigation: provenance **MAY** show P0-only or be omitted.
- Runs without P0 handoff paths: provenance **MAY** show operator-only or be omitted.
- Re-plan from `AWAITING_GATE2`: ephemeral provenance overwritten on each `plan()` cycle.
- **No migration script** required.
- **No AgentRun schema version bump** required.

## Risks

| Risk                                   | Mitigation                                                        |
| -------------------------------------- | ----------------------------------------------------------------- |
| Provenance drift from merge rules      | Single assembler consuming merge output; do not reimplement merge |
| Operator misreads overlap as guarantee | Document as audit signal only; provider may ignore hints          |
| Ephemeral loss on restart              | Same accepted limit as Gate2 summary today; no new promise        |
| Schema creep                           | `schemaVersion: 1`; strict caps                                   |
| ADR-047 Gate2 unchanged wording        | ADR-048 explicitly adds display-only provenance category          |

## Explicit non-goals

- Memory / cross-run context
- Parallel or background agents
- MCP, WEB, LSP, embeddings / vector DB
- Provider `toolCalling:true`
- Autonomous Git write / push
- New Tool Registry capability classes
- Server-mandatory investigation before plan
- Client-submitted planning provenance
- Raw provider output or file content in provenance
- Feeding Gate2 or ChangePlanner from provenance
- Correction-path operator merge (deferred unless separately scoped)
- Durable provenance persistence
- Full unified diff exposure in AgentRunPanel
- GET status route provenance (optional future; not required for Slice 3 MVP)
- Explain artifact provenance extension (optional future; not required for Slice 3 MVP)

## Definition of Done (implementation)

Slice 3 implementation is complete when:

- [ ] Pure deterministic `assembleGate2PlanningProvenance()` with bounded schema
- [ ] Provenance assembled server-side in `AgentOperating.plan()` (and correction plan path when
      applicable)
- [ ] Stored in ephemeral `AgentRunEphemeralEvidence`; read in `pauseAtGate2()`
- [ ] Additive `planningProvenance` on POST `…/plan` response via bounded HTTP view
- [ ] No client provenance input accepted
- [ ] AgentRunPanel Gate2 display-only subsection
- [ ] Zero authority expansion; no Gate2 semantic changes; no FileApply changes; no provider
      capability changes
- [ ] Composition proof: investigation → plan → provenance → Gate2 → zero FileApply before approval
- [ ] Full `npm run ci` green; branch coverage ≥ 80%

## Consequences

### Positive

- Operators can verify investigation → merge → plan alignment at the mandatory Gate2 pause.
- Closes the review trust gap opened by Slice 2 without weakening safety boundaries.
- Reuses existing Slice 2 merge and ephemeral Gate2 lifecycle.
- Additive HTTP response; old clients ignore new field.

### Negative

- Additional assembler, tests, and UI surface area.
- Overlap metrics are audit signals, not guarantees of provider behavior.
- Ephemeral provenance unavailable after restart (same class of limitation as today).

### Neutral

- Slice 2 prepare pipeline unchanged.
- Gate2 approval semantics unchanged.
- FileApply unchanged.

## Relationship to related ADRs

| ADR     | How ADR-048 extends without weakening                                                                          |
| ------- | -------------------------------------------------------------------------------------------------------------- |
| **036** | Adds display-only material at Gate2 pause; does not bypass Gate2 or auto-apply                                 |
| **044** | Provenance reads persisted projections; does not expose raw ToolResult                                         |
| **045** | Extends operator visibility from digests to planning attribution at Gate2; does not change tool-turn authority |
| **046** | Provider remains DATA-only; provenance is post-prepare server assembly                                         |
| **047** | Consumes Slice 2 merge output for display; does not modify merge semantics, prepare input, or Gate2 authority  |

## Rollout and reversal

1. Accept ADR-048 (this document).
2. Implement Slice 3 under this authorization.
3. Validate with composition benchmarks and full `npm run ci`.
4. Reversal: stop assembling and returning provenance; Gate2/FileApply/prepare behavior unchanged.

## Final statement

**ADR-048 is Accepted and authorizes P1-C Slice 3 implementation only.**

It does **not** authorize any later slice, correction-path operator merge, memory, MCP, WEB, parallel
agents, autonomous Git, provider tool calling, or Gate2 authority changes.
