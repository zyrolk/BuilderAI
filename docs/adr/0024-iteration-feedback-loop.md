# ADR-024: Operator-initiated iteration feedback loop

- **Status:** Accepted
- **Date:** 2026-08-02
- **Owners:** BuilderAI architecture
- **Related:** ADR-012 (Verification output boundary / P1-8), ADR-021 (PARTIALLY_APPLIED verification
  eligibility), ADR-018 (Context/Prompt budget invariant), ADR-023 (Task-aware context retrieval)

## Context

After Apply and Verify, an operator may need to submit an explicit correction request. Before Phase 3,
the next Prepare carried only operator text and freshly retrieved repository context. Structured
apply and verification evidence from the immediately previous iteration was not available to the
model.

Phase 3 must close that gap for a single-operator local development tool without introducing
persistent conversation history, automatic repair, or budget increases.

## Decision drivers

- Preserve human approval before every Apply.
- Preserve ADR-012 / P1-8 verification output boundaries.
- Preserve ADR-018 budgets (`maxCharacters` 95,000, Prompt 120,000, provider 200,000, `maxFiles` 12).
- Preserve fresh Phase 1 discovery and Phase 2 retrieval on every Prepare.
- Keep the client untrusted; normalize and validate on the server.
- Support explicit correction only; normal Prepare must remain unchanged.

## Decision

Adopt **Option C**: optional `iterationFeedback` on Prepare, server-authoritative normalization, a
Prompt **`ITERATION`** section (not ContextPackage), and bounded Phase 2 path-hint ranking.

### Operator-initiated correction model

1. Operator completes implement → apply → verify (or a terminal apply outcome with safe evidence).
2. Operator explicitly chooses **Fix verification failures** (or equivalent explicit action).
3. UI builds a bounded `IterationFeedback` payload from the cached immediately previous completion.
4. Prepare accepts `{ request, iterationFeedback? }`.
5. Server normalizes/validates feedback, runs fresh retrieval/planning, and renders Prompt ITERATION.
6. Operator reviews and explicitly approves before Apply.

No automatic feedback attachment. No persistent session history. No Project Brain transient storage.

### IterationFeedback contract (schemaVersion 1, kind CORRECTION)

Allowed evidence:

- Apply status enums and bounded repository-relative logical paths (created/updated/deleted/skipped)
- Bounded apply errors/warnings with validated codes and safe messages (≤ 240 characters)
- Optional verification status, ordered stage summaries, bounded top errors, P1-8 safe scalar stage
  metadata (≤ 8 entries)
- Optional `sourcePreparationId`, optional `priorRequestSummary` (≤ 500 characters)

Explicitly excluded:

- Raw stdout/stderr, command lines, shell invocations, environment values, secrets
- Absolute/system paths, stack traces, adapter exception text
- Captured source/test output, complete prior provider artifacts/ResponsePackage/ProjectChangePlan
- Arbitrary unbounded metadata, UI conversation history

Hard bounds:

- Total normalized serialized feedback ≤ 4,000 characters
- ≤ 20 paths per apply category, ≤ 8 path hints, ≤ 8 stage metadata entries
- Immediately previous iteration only

### Prompt integration

Add optional **`ITERATION`** section after `TASK` and before `RULES`. Absent entirely for ordinary
Prepare. Present only when normalized feedback is supplied. Feedback stays out of ContextPackage.

### Fresh repository retrieval

Every correction Prepare reloads canonical Project Brain, rereads Blueprint, runs Phase 1 discovery
and Phase 2 task-aware retrieval, then Prompt construction and planning. Post-Apply filesystem state
is authoritative; prior ContextPackage contents are never reused.

### Phase 2 path hints

Derive ≤ 8 unique safe logical path hints from normalized feedback. Apply
`ITERATION_PATH_HINT_BOOST = 2` only when a candidate already has `baseScore >= 1`. Hints reorder
eligible candidates only; they do not bypass safety, eligibility, or read/admit limits.

### PARTIALLY_APPLIED semantics (ADR-021)

Feedback distinguishes successful created/updated/deleted paths from skipped/failed paths and apply
errors. Prompt instructions state that only listed successful operations should be assumed present.

### Approval gate

Correction Prepare produces a new preparation only. Apply without explicit approval still fails with
`APPROVAL_REQUIRED`.

## Rejected alternatives

- Full persistent session/conversation history
- Automatic injection of the last completion into every Prepare
- Expanding raw verification output beyond P1-8
- UI-generated natural-language-only feedback without structured normalization
- Increasing ContextPackage or Prompt budgets to carry feedback

## Consequences

- Template `builderai-standard` version 2 adds optional ITERATION section ordering.
- Prepare API remains backward compatible when `iterationFeedback` is omitted.
- Phase 2 retrieval gains a bounded hint boost without a second retrieval algorithm.
- Tests must cover normalization bounds, fresh retrieval, prompt integration, and approval invariants.
