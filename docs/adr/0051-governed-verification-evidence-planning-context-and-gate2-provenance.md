# ADR-051: Governed Verification Evidence Planning Context and Gate2 Provenance

- **Status:** Accepted
- **Date:** 2026-08-29
- **Owners:** BuilderAI architecture
- **Related:** ADR-012 (Verification Pipeline), ADR-040 (Controlled Terminal Boundary),
  ADR-042 (Bounded Server-Owned Agent Tool Loop), ADR-044 (Bounded AgentLoop Product Integration
  Boundary), ADR-045 (Bounded Operator Tool-Turn Product Surface), ADR-047 (Bounded Operator Tool
  Planning Projection), ADR-048 (Bounded Gate2 Planning Provenance Review), ADR-049 (Governed
  Baseline Engineering Verification Probe), ADR-050 (Bounded Structured Verification Diagnostic
  Evidence)
- **Baseline:** `292baafbd2df2591e3c8ca838ac88c481739fbcf` (P1-D Slice 2 — persist bounded
  verification evidence)

## Context

P0, P1-A, P1-B B1–B10, D+B provider-assisted reliability/observability, A+D operational closure,
P1-C (Slices 1–3 plus closure benchmark), P1-D Slice 1 (ADR-049), and P1-D Slice 2 (ADR-050) are
complete and frozen at baseline `292baaf`.

ADR-049 authorized governed catalog-only `VERIFY` during `UNDERSTANDING` so operators can run
baseline build/test/lint probes **before** the first `plan()`.

ADR-050 authorized durable **`BoundedVerificationEvidence`** on AgentLoop schema **v3** — structured
status-only fields such as:

- `commandId`
- `stage`
- `executionStatus`
- `exitCode`
- `timedOut`
- `cancelled`
- `policyBlocked`
- `policyBlockCode`
- `outputLimited`

ADR-050 explicitly classified that evidence as **display/evidence only** and **MUST NOT** feed:

- `buildOperatorToolPlanningContext()`
- P0 `InvestigationHandoffFeedback`
- `mergeOperatorToolPlanningWithHandoff()`
- `WorkspaceRuntimeService.prepare()`
- ChangePlanner / provider planning prompts
- Gate2 planning provenance or approval
- FileApply

The P1-D Slice 3 architecture / readiness audit concluded **READY FOR ADR-051**: durable structured
evidence is now a safe prerequisite for a carefully bounded, server-derived planning-DATA channel,
provided Gate2 transparency is a co-requisite and all mutation controls remain frozen.

Crossing the verification → planning trust boundary requires an explicit architectural decision.
This ADR authorizes that decision only.

## Problem

After P1-D Slice 2, operators can persist and reload structured baseline verification statuses, but
the first governed plan still cannot consume that engineering baseline as bounded planning DATA:

```
UNDERSTANDING
  → inspect / baseline verification (B4)
  → durable verificationEvidence (v3)
  → plan()                    ← verification MUST NOT influence prepare today (ADR-050)
  → Gate2
  → explicit approval
  → FileApply
  → VERIFYING
  → COMPLETED
```

Operators therefore cannot yet obtain a governed plan that is aware — in a bounded, transparent way —
that e.g. build failed or typecheck passed before planning.

This problem **MUST NOT** be solved by:

- feeding raw `diagnosticSummary`, stdout/stderr, ToolResult, or free-form project prose into
  prepare / provider prompts,
- stuffing verification into `investigationSummary`, path hints, or correction iteration errors,
- overloading ADR-047 `OperatorToolPlanningProjection` / `planningProjection`,
- silently influencing planning without Gate2 provenance visibility,
- granting verification Gate2 approval, FileApply, or mutation authority,
- enabling provider-native tool calling or EXECUTING tools,
- implementing diagnostic parsers / path extraction in this slice,
- merging verification into `planCorrection()` automatically,
- bumping AgentLoop to schema v4 without a separate architecture review.

## Decision drivers

- Authorize the smallest safe verification → planning DATA boundary on top of ADR-050 evidence.
- Preserve Gate2 mandatory + FileApply sole mutation path + `toolCalling:false` + EXECUTING tool-free.
- Require Gate2 provenance transparency whenever verification influences a proposed plan.
- Keep P1-C path-hint / merge semantics conceptually frozen.
- Prefer plan-time derivation from persisted v3 evidence (no new durable planning projection by
  default).
- Treat repository/build/test output as **UNTRUSTED PROJECT-CONTROLLED DATA**.
- Fail closed: omit verification planning influence rather than hide it.

## Decision

**P1-D Slice 3 = Governed Verification Evidence Planning Context and Gate2 Provenance.**

BuilderAI **WILL** authorize a new server-derived, bounded, **plan-time-only** representation:

**`VerificationPlanningProjection`**

derived from persisted AgentLoop v3 **`BoundedVerificationEvidence`**, delivered through a
**dedicated prepare DATA channel**, and mirrored in **additive Gate2 planning provenance**.

```
persisted AgentLoop v3 verificationEvidence
        ↓
AgentOperatingService.plan()
        ↓
derive VerificationPlanningProjection (server, UNDERSTANDING-only)
        ↓
dedicated prepare DATA channel
        ↓
provider / ChangePlanner (DATA only; toolCalling:false)
        ↓
Gate2 provenance (mandatory transparency)
        ↓
explicit operator approval
        ↓
FileApply (sole mutation path)
```

### Authority semantics

| Role                                                                          | Status         |
| ----------------------------------------------------------------------------- | -------------- |
| Influence **content** of a proposed plan as bounded engineering baseline DATA | **Authorized** |
| Approve Gate2                                                                 | **Forbidden**  |
| Bypass Gate2                                                                  | **Forbidden**  |
| Authorize FileApply / mutation                                                | **Forbidden**  |
| Alter approval state                                                          | **Forbidden**  |
| Create a second mutation path                                                 | **Forbidden**  |
| Grant tool capability / EXECUTING tools                                       | **Forbidden**  |
| Authorize provider tool execution                                             | **Forbidden**  |

**Gate2 remains mandatory before every mutation.**
**FileApply remains the sole mutation path.**

Verification planning context is **advisory planning DATA**. It cannot override goal intent or
mutation authority.

## VerificationPlanningProjection

ADR-051 authorizes a bounded representation **semantically equivalent** to:

```
VerificationPlanningProjection
  schemaVersion: 1
  baselineStatus
  consideredCommandIds[]
  failedCommandIds[]
  blockedCommandIds[]
  timedOutCommandIds[]
  cancelledCommandIds[]
  succeededCommandIds[]?   // optional compact PASS visibility
```

Exact TypeScript field names may follow repository conventions. Semantic requirements are binding.

### Field constraints

- All command identifiers **MUST** be existing catalog-controlled verification command IDs
  (`ControlledTerminalCommandId` / equivalent).
- All statuses / classifications **MUST** be fixed server-controlled enums (or equivalent closed sets).
- **No arbitrary strings.**
- **No project-controlled prose.**
- Array sizes **MUST** be capped to the finite verification command catalog (unbounded aggregation
  forbidden).

### baselineStatus

Deterministic server-derived classification. Permitted conceptual values include:

- `NONE`
- `PASS`
- `FAIL`
- `BLOCKED`
- `TIMEOUT`
- `MIXED`

Exact implementation enum may vary if repository conventions require it. Classification **MUST**
remain deterministic and bounded.

### Successful baseline policy

Compact PASS visibility is allowed:

- overall `baselineStatus`
- failure / blocked / timeout / cancelled command lists
- optional succeeded command IDs

**MUST NOT** include raw successful command output or free-form prose summaries.

## Source phase — UNDERSTANDING only

Only verification evidence recorded during **`UNDERSTANDING`** may influence the **first plan**.

Evidence from **MUST NOT** feed this initial planning projection:

- `VERIFYING`
- `DIAGNOSING`
- `CORRECTING`
- `EXECUTING`
- `PLANNING`

Correction planning remains a **separate path** (see Correction isolation).

## Deterministic aggregation

P1-D Slice 2 persists every B4 verification evidence record. For planning, ADR-051 authorizes
deterministic aggregation:

### Source filtering

Include only records where:

- `toolId` is `run_verification_command`
- `phase` is `UNDERSTANDING`
- `verificationEvidence` is present and passes existing ADR-050 validation semantics

### Ordering

Sort deterministically by:

1. `recordedAt`
2. `intentId`

(or an equivalent stable repository-defined total order).

### Duplicate `commandId` handling

Use **latest valid UNDERSTANDING result per `commandId`**.

Earlier stale results for the same command **MUST NOT** override a newer result.

### Bounds

- Cap arrays to the finite verification command catalog.
- No repeated arbitrary history dumps.
- No cross-run aggregation.
- No cross-project aggregation.

## Forbidden planning data

`VerificationPlanningProjection` and any prepare / provider serialization of it **MUST NOT**
contain:

- `stdout` / `stderr`
- `diagnosticSummary`
- output excerpts / arbitrary tool output
- arbitrary project-controlled prose
- source snippets
- paths
- line / column locations
- stack traces
- environment values
- tokens / secrets
- URLs
- provider-generated strings
- client-generated strings
- raw `verificationEvidence` object serialization
- raw `ToolResult` serialization

Only validated bounded server-controlled tokens may enter the projection and its dedicated prepare
serialization.

## Prompt-injection boundary

Repository / build / test output remains:

**UNTRUSTED PROJECT-CONTROLLED DATA**

ADR-051 **MUST** prohibit inserting diagnostic output into:

- `investigationSummary`
- free-form iteration feedback
- provider instruction text
- unrestricted prompt prose

The planning projection **MUST** be constructed only from:

- catalog IDs
- enums
- booleans
- bounded numeric / server-controlled values

No free-form diagnostic text reaches provider planning in this slice.

## Ownership — separate from ADR-047

**Do NOT** extend or overload:

- `OperatorToolPlanningProjection`
- `planningProjection` on B1/B2 evidence

`VerificationPlanningProjection` is a **separate** planning-DATA concept.

P1-C search/read planning projection semantics remain **frozen**.

## Derivation strategy

**Prefer plan-time derivation** from persisted AgentLoop **v3** `verificationEvidence`.

**Do NOT** persist `VerificationPlanningProjection` unless a later implementation demonstrates a
strong architectural requirement and obtains a new architecture review.

Expected orchestration:

```
AgentOperatingService.plan()
  → hydrate / list evidence
  → deriveVerificationPlanningProjection(...)
  → existing P0 / B1 / B2 context path (unchanged semantics)
  → dedicated verification prepare DATA input
```

**No AgentLoop schema v4 is authorized by default.**

If implementation later proves schema v4 necessary: **STOP** and perform a new architecture review
rather than silently expanding this ADR.

Gate2 provenance may remain **ephemeral** consistent with ADR-048 unless existing architecture
requires otherwise.

**Do not** authorize cross-run verification planning memory.

## Prepare boundary

ADR-051 authorizes a **dedicated bounded prepare input field / channel** for verification planning
context.

**Do NOT** hide this data inside:

- `investigationSummary`
- path hints
- correction iteration errors
- arbitrary strings

The prepare input **MUST** keep verification engineering baseline data structurally separate from:

- P0 `InvestigationHandoffFeedback`
- B1/B2 `OperatorToolPlanningContext`
- correction feedback

Verification baseline status is advisory planning DATA only.

## P1-C compatibility

ADR-051 preserves P1-C semantics.

**Do NOT** overload or redesign:

- `operator-tool-planning-projection.ts`
- path-hint planning semantics
- P0 precedence rules
- B1/B2 `planningProjection` semantics
- `operator-tool-planning-merge.ts` path-merge rules

Future implementation may add **thin orchestration** around `plan()` and prepare input recognition
if required, but **MUST NOT** redesign P1-C.

**P1-C remains conceptually frozen.**

## Merge semantics

Verification planning context:

- **MUST NOT** override P0 path hints
- contains **no paths** in this slice
- **MUST NOT** create path authority

Its sole role is to tell planning:

> what bounded engineering baseline verification statuses were observed before planning

Examples (conceptual display / token forms — not free-form project prose):

```
build = FAILED
typecheck = PASSED
lint = TIMEOUT
```

This is **context**, not instruction and not mutation authority.

## Provider boundary

Provider remains **`toolCalling: false`**.

Provider receives only bounded serialized DATA derived from `VerificationPlanningProjection`.

Forbidden:

- provider-native tool execution
- raw verification output
- arbitrary diagnostic prose
- provider-generated verification authority

## Gate2 provenance — mandatory transparency

Any verification context that influences planning **MUST** be visible at Gate2.

Verification planning influence **MUST NOT** be hidden.

Extend Gate2 planning provenance **additively** with a bounded verification section equivalent to:

```
hasVerificationContext
verificationBaselineStatus
consideredCommandCount
failedCommandIds[]
blockedCommandIds[]
timedOutCommandIds[]
cancelledCommandIds[]
succeededCommandIds[]?
```

Exact implementation naming may differ. Semantic requirements are binding.

- No raw diagnostics
- No prose from project output
- No approval semantic change

### Gate2 UI

Minimal additive display is authorized, for example:

```
Baseline verification considered:
Build — FAILED
Typecheck — PASSED
Lint — TIMEOUT
```

Forbidden:

- diagnostics console
- new approval control
- Gate2 bypass
- mutation authority

### Transparency invariant

> Verification evidence may not influence the proposed plan unless its bounded influence is also
> represented in Gate2 planning provenance.

If provenance cannot be constructed, verification planning influence **MUST** be omitted rather than
hidden.

## Correction isolation

ADR-051 **MUST** prohibit automatic verification-planning merge into:

- `planCorrection()`
- correction iteration feedback
- correction prepare input
- correction Gate2 context

Slice 3 applies only to the initial:

**`UNDERSTANDING` → first plan**

flow.

Any future correction-path integration requires separate review / ADR.

## Client authority boundary

All Slice 3 planning / provenance data **MUST** be server-derived.

Clients **MUST NOT** submit or override:

- `VerificationPlanningProjection`
- `baselineStatus`
- command-status arrays
- verification planning context
- verification provenance
- verification approval authority

Future implementation **SHOULD** extend request rejectors where needed.

**No new client authority fields.**

## HTTP / API boundary

Preferred architecture:

- **no** new endpoint
- **no** new request authority fields
- **additive** plan / Gate2 response provenance only

Existing tool-turn and plan routes remain authoritative.

ADR-051 may authorize additive response fields for verification provenance.

## Persistence boundary

- No new AgentLoop durable planning projection required by default
- Use existing v3 `verificationEvidence` as the durable source
- Derive planning projection when `plan()` executes
- Gate2 provenance may remain ephemeral (ADR-048 pattern)
- No cross-run verification planning memory

## FileApply / ChangePlanner boundary

No change to:

- FileApply
- mutation transaction semantics
- approval contract
- ChangePlan authority
- ChangePlanner mutation permissions

Verification planning context may influence **proposed plan content only**.
It cannot authorize application of that plan.

## EXECUTING boundary

Preserve:

**`EXECUTING = tool-free`**

ADR-051 **MUST NOT** change phase capability policy.

No new VERIFY phase availability. No `VERIFY` capability on `EXECUTING`.

## Multi-verification bounds

Planning projection **MUST** remain bounded by the finite existing verification command catalog:

- no unbounded arrays
- no repeated arbitrary history
- no cross-run / cross-project aggregation
- no free-form summaries

## Consequences

### Positive

- First plan can consume bounded engineering baseline status without raw diagnostics.
- Gate2 operators see verification influence explicitly (ADR-048 transparency extended).
- ADR-050 evidence remains the durable source; no unnecessary schema v4.
- P1-C path-merge semantics stay frozen; verification is a sibling DATA channel.

### Negative / accepted costs

- Prepare / PromptOrchestrator need an additive dedicated channel (not free-form handoff prose).
- Gate2 provenance schema / UI must grow additively.
- Failure to build provenance must fail closed (omit influence), which may temporarily drop
  verification context from planning.

### Neutral

- Real failing fixture infrastructure is not required; stub ControlledTerminal failures may prove
  FAIL semantics in tests.
- Richer compiler / test diagnostic parsers remain explicitly out of scope.

## Future implementation sequence

**Do NOT implement under this authoring task.** When Slice 3 implementation is explicitly
authorized, proceed roughly as:

1. Add bounded `VerificationPlanningProjection` type
2. Add plan-time deterministic deriver
3. Filter to `UNDERSTANDING` verification evidence only
4. Implement latest-valid-result-per-`commandId` aggregation
5. Add dedicated server-only prepare input field / channel
6. Add bounded provider DATA serialization (catalog/enum tokens only)
7. Extend Gate2 planning provenance
8. Add minimal Gate2 UI
9. Extend client authority rejectors
10. Add lifecycle / security / isolation / composition tests
11. Run full `npm run ci` (exit 0; branches ≥ 80%)
12. Commit only after commit-readiness review

## Required future tests

### Projection

- `UNDERSTANDING` B4 evidence derives projection
- `VERIFYING` / `DIAGNOSING` / `CORRECTING` evidence ignored
- non-B4 evidence ignored
- latest result per `commandId` wins
- ordering deterministic
- arrays bounded
- unknown command / status fails closed

### Prompt safety

Prepare / provider input contains **no**:

- `diagnosticSummary`
- stdout / stderr
- arbitrary prose
- path data
- raw `ToolResult`
- raw `verificationEvidence` serialization

### Planning integration

Bounded projection reaches the **dedicated** prepare DATA channel (not `investigationSummary`).

### Gate2 provenance

Gate2 shows the exact bounded verification influence used for planning.

### Transparency negative

- If no verification projection is used: provenance **MUST NOT** falsely claim influence.
- If projection is used: provenance **MUST** exist.

### Client security

Client cannot submit / override verification planning context, `baselineStatus`, or verification
provenance.

### Correction isolation

`planCorrection()` remains unchanged with respect to verification planning merge.

### Mutation safety

- Pre-approval checkpoints: `FileApply.calls === 0`
- After explicit approval: `FileApply.calls === 1`

### Regression

Keep green:

- P1-C closure
- P1-D Slice 1 / Slice 2
- Gate2 tests
- FileApply tests
- provider `toolCalling:false`
- EXECUTING tool-free

## Composition benchmark requirement

Future benchmark should prove:

```
UNDERSTANDING
  → governed B4 verification
  → durable verificationEvidence
  → plan()
  → derived VerificationPlanningProjection
  → dedicated prepare DATA
  → provider / ChangePlanner
  → Gate2 provenance shows verification influence
  → FileApply = 0
  → explicit approval
  → FileApply = 1
  → post-apply verification
  → COMPLETED
```

Also prove:

- raw diagnostic text never reaches prepare
- client cannot inject projection
- `VERIFYING` / `DIAGNOSING` records ignored
- correction path remains isolated
- provider remains `toolCalling:false`
- EXECUTING remains tool-free

## Real fixture boundary

ADR-051 does **NOT** require diagnostic parsers or a special failing fixture.

A stub `ControlledTerminal` failure may be used where deterministic failure semantics are required
for planning-context tests.

Existing real zyro fixture coverage may remain for safe real B4 execution.

Do not expand Slice 3 into unrelated external-target infrastructure.

## Explicit non-goals

ADR-051 **MUST** exclude:

- `diagnosticSummary` → planning
- stdout / stderr → planning
- diagnostic parsers
- path extraction
- compiler / test line / column parsing
- free-form project prose in provider prompts
- extending ADR-047 `planningProjection`
- rewriting P1-C merge semantics
- correction-path verification planning
- provider `toolCalling:true`
- provider-native tools
- new VERIFY phases
- EXECUTING tools
- Gate2 bypass
- FileApply authority
- new mutation path
- autonomous build / fix loop
- MCP
- open web
- browser DOM automation
- autonomous Git push
- cross-run verification memory
- AgentLoop schema v4 unless separately reviewed
- evidence aggregation persistence
- full diagnostics console

## Follow-on boundary

ADR-051 is limited to:

```
structured verification evidence
  → bounded planning DATA
  → Gate2 transparency
```

It does **NOT** authorize richer compiler / test diagnostics.

It does **NOT** authorize autonomous debugging beyond existing governed correction behavior.

Those remain later capabilities under separate ADRs / reviews.

## Implementation authorization

Implementation **MUST NOT** begin until explicit authorization is provided. When authorized,
implementation follows the sequence above and remains within this ADR’s scope.

This ADR authoring task creates the decision record only:

- no source / test / UI / route / prepare / prompt / Gate2 / schema code changes
- no Slice 3 implementation
- no commit / push under authoring alone

## Status

**Accepted.**
)
