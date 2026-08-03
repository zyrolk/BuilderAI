# ADR-020: Bounded, zero-mutation-only reclaim of a preparation after a failed Apply attempt

- **Status:** Accepted
- **Date:** 2026-08-01
- **Owners:** BuilderAI architecture
- **Related:** ADR-011 (Safe File Apply boundary), ADR-014 (Local MVP runtime composition), ADR-016
  (Change Planner Workspace Visibility port), ADR-019 (Bounded execution service retry for provider
  outages). Partially supersedes ADR-014's "Completed outcomes are idempotently replayed for the
  preparation lifetime" clause, only for the narrow zero-mutation-failure case defined below; every other
  ADR-014 constraint, and every ADR-011 constraint, is unchanged.

## Context

`WorkspaceRuntimeService.approveAndApply()` claims one stored, approved Project Change Plan, calls
`FileApplyEngineService.apply()` once, and — before this change — unconditionally called
`InMemoryPreparationStore.complete()` afterward, regardless of the resulting status. `complete()` is a
one-way, permanent transition: a completed record is replayed idempotently forever, and `claim()` never
invokes Apply again for that `preparationId`. Separately, an exception escaping the `try` block (an
internal contract-violation class of failure, not a domain outcome) calls `store.fail()`, which deletes
the record outright.

In practice, `FileApplyEngineService.apply()` and `VerificationEngineService.verify()` do not throw for
ordinary domain failures — preflight rejection, first-operation failure, partial application, and
verification failures are all represented as a resolved result with a status field, never a thrown
error. The consequence: every one of those domain outcomes — including a preflight rejection or a
first-operation failure that touched the filesystem zero times — became permanently terminal and
replay-only, exactly like a fully successful Apply. Retrying the already-approved, still-valid plan was
never possible; the only way to get a new Apply attempt was an entirely new `prepare()` call, re-running
Context Builder, Prompt Orchestrator, the AI provider, Response Processor, and Change Planner, even when
nothing about the plan itself was wrong — for example, a preflight conflict the operator has since
resolved, or a momentary filesystem error (`ENOSPC`, `EMFILE`) on the very first operation.

Because `src/core/file-apply` remains deliberately non-transactional (ADR-011: no rollback, completed
operations are not undone after a later failure), "safe to retry" cannot be defined at the granularity of
"resume the remaining operations." A plan that has already created, updated, or deleted at least one file
cannot be blindly re-run: retrying a completed `CREATE_FILE`/`DELETE_FILE` is caught by preflight (which
rejects the whole retry, not just the already-done operation), but retrying a completed `UPDATE_FILE` is
not caught by preflight at all — its only precondition, target-exists-as-a-regular-file, is still true
after a successful update — so a blind retry would silently rewrite the same content a second time,
masking any legitimate change that happened to the file in between. Safe retry can therefore only be
defined at the granularity of the whole Apply attempt having mutated nothing.

## Decision drivers

- Filesystem safety: never retry an Apply attempt that may have already mutated the filesystem.
- No duplicate mutations, and no replay of a partially-applied plan under any circumstance.
- Preserve deterministic Safe File Apply semantics: no rollback, no transactions, no resume-from-partial,
  no selective operation replay, no weakening of preflight.
- Avoid re-running the AI pipeline unnecessarily when a retry is provably safe.
- Minimal, launch-ready complexity: no new provider-style automatic retry loop; the caller decides.
- Preserve existing concurrency protection and the original preparation TTL unchanged.

## Considered options

A. Allow bounded retry of the same preparation after any Apply failure, regardless of whether mutations
occurred.
B. Allow retry only when the previous `FileApplyResult` proves zero filesystem mutations occurred, and
require a full fresh preflight on every attempt.
C. Never retry Apply; preserve the failed result for diagnosis and always require a brand-new `prepare()`.
D. Any smaller/safer design than B.

## Decision

Use option B. A preparation record gains one additional lifecycle state, `RECLAIMABLE`, alongside the
existing `READY`, `APPLYING`, and `COMPLETED` states, plus an `attempts` counter incremented by every
`claim()`. After an Apply attempt, `WorkspaceRuntimeService.approveAndApply()` evaluates the new,
centralized `isZeroMutationFileApplyResult(applyResult)` predicate:

```
isZeroMutationFileApplyResult(result) =
    result.status === 'REJECTED'
  OR (result.status === 'FAILED'
      AND result.createdFiles.length === 0
      AND result.updatedFiles.length === 0
      AND result.deletedFiles.length === 0)
```

`REJECTED` is always zero-mutation because preflight completes before any mutation is attempted.
`FAILED` is zero-mutation only when every outcome array is empty, meaning the very first operation failed
before it could be recorded as applied. `PARTIALLY_APPLIED` and `APPLIED` are excluded by construction —
they can never satisfy this predicate — so they always fall through to the pre-existing, unconditional
`store.complete()` call, exactly as before this change. No new field was added to `FileApplyResult`: the
existing `status` plus the three outcome arrays are already sufficient to prove zero mutations, confirmed
during implementation.

When the predicate is true **and** the record's current `attempts` is below `MAXIMUM_APPLY_ATTEMPTS = 2`
(the original attempt plus at most one retry), `InMemoryPreparationStore.releaseForRetry()` transitions
the record from `APPLYING` back to `RECLAIMABLE` instead of `COMPLETED`. `claim()` treats `RECLAIMABLE`
identically to `READY`: the _same_, already-approved plan is claimed again, `attempts` increments, and
the caller receives the exact same computed `WorkspaceCompletion` from this attempt as it always did — no
response-shape change, no new error code. Nothing retries automatically; the caller (the same HTTP client
that already holds the `preparationId`) must invoke `approveAndApply(preparationId, true)` again, which
drives a genuine new `FileApplyEngineService.apply()` call with its complete, unmodified, fresh preflight.
If the predicate is true but `attempts` has already reached the maximum, or the predicate is false, the
record is completed permanently via the pre-existing `store.complete()` path, exactly as before.

The original `expiresAt`, set once by `save()`, is never read, reset, or extended by `releaseForRetry()`;
a reclaimable record still expires exactly on its original schedule, and `claim()`'s existing expiry
check applies to `RECLAIMABLE` records identically to `READY` ones. The exception-based `store.fail()`
path — reached only when `apply()` or `verify()` throws before producing a validated result, an internal
contract-violation class of failure distinct from every domain outcome above — is untouched: retry
eligibility is derived exclusively from a produced `FileApplyResult`, so an attempt that never produced
one can never become retryable. Concurrency protection is unaffected: `claim()` still rejects a concurrent
claim with `WORKFLOW_FAILED` whenever a record is `APPLYING`, regardless of which state it was claimed
from.

### Rejected alternatives

Option A (blanket retry after any failure) was rejected because it is unsafe by construction given the
non-transactional File Apply design: a `PARTIALLY_APPLIED` plan containing a completed `UPDATE_FILE`
operation could be silently re-applied (preflight has no way to detect that a regular file's content
already reflects a previous, successful update), risking clobbering any legitimate change made to that
file between attempts. It also conflicts directly with "no duplicate mutations" and "no replay of a
partially-applied plan."

Option C (never retry) was rejected as the default because it forces a complete, unnecessary AI
pipeline re-run for failures that have nothing to do with the plan being wrong — a resolved preflight
conflict or a transient filesystem blip on the very first operation — directly contradicting the goal of
avoiding unnecessary AI re-runs when a retry is provably safe. Option C is, however, retained unchanged
as the exact behavior for every case this decision does not carve out: `PARTIALLY_APPLIED`, `APPLIED`
(regardless of verification outcome), an exhausted zero-mutation-failure attempt budget, and any
exception-class failure before a `FileApplyResult` exists.

Option D (an automatic, provider-retry-style loop inside `approveAndApply`, mirroring ADR-019) was
considered and rejected as unnecessary additional complexity: Apply failures in the zero-mutation
category are typically not self-resolving on a short fixed delay the way a transient provider outage is
— a preflight conflict or a resource-exhaustion error usually needs operator intervention — so an
automatic in-process retry loop would rarely help. Making the existing `preparationId` simply reclaimable
and letting the caller explicitly re-invoke `approveAndApply` is the smaller change: it reuses the
existing claim/complete state machine with one additional state and one additional branch, rather than
introducing a second, provider-retry-shaped orchestration loop for a fundamentally different kind of
failure.

## Consequences

Positive:

- A preparation whose Apply attempt provably touched nothing (a resolved preflight conflict, or a
  transient zero-mutation execution failure) is no longer a dead end; the caller can retry the exact same
  approved plan without re-running the AI pipeline.
- `PARTIALLY_APPLIED` remains permanently terminal and replay-only, with zero risk of a silent duplicate
  or clobbering mutation — unchanged from before this decision.
- `APPLIED` remains permanently terminal regardless of verification outcome (Passed, Failed, or Partially
  Passed) — retrying "Apply" after the filesystem already matches the approved plan would be meaningless,
  and this decision does not change that.
- Every retry re-runs File Apply's complete, unmodified preflight; nothing about preflight is bypassed,
  weakened, or cached across attempts.
- The retry is bounded to exactly one extra attempt (two total) per `preparationId`, is never automatic,
  and never resets or extends the original preparation TTL.
- Concurrency protection, the exception-to-delete path, and every P0-1/P0-2/P0-3/P0-4/P1-5/P1-9 behavior
  are unaffected; no `WorkspaceVisibilityPort`, provider retry, Prepare API, or budget behavior changed.

Negative:

- The preparation store's lifecycle gains one additional state and one additional public method
  (`releaseForRetry`), a small increase in surface area for a store ADR-014 originally kept minimal.
- A caller that does not know to retry a zero-mutation failure sees no functional regression — the
  response is identical to before this change — but also does not automatically benefit from the new
  reclaim window unless it (or an operator) chooses to call `approveAndApply` again.

## Security and privacy impact

No new trust boundary, credential, or I/O path is introduced. A reclaimed attempt sends the exact same
plan through the exact same File Apply preflight and protected-path policy as the original attempt; no
additional data is exposed, logged, or persisted. The bounded attempt count (2 total) and the unmodified
TTL prevent an unbounded retry window or retry storm against the filesystem.

## Rollout and reversal

`src/application/workspace/in-memory-preparation.store.test.ts` covers the new `RECLAIMABLE` state,
attempt counting, the `MAXIMUM_APPLY_ATTEMPTS` bound, and TTL non-extension in isolation.
`src/application/workspace/workspace-runtime.service.test.ts` adds end-to-end coverage for: a
zero-mutation `REJECTED` result becoming reclaimable and later succeeding; a zero-mutation `FAILED`
result behaving identically; the third attempt never invoking File Apply once the maximum is reached;
`PARTIALLY_APPLIED` remaining terminal with zero additional mutations on replay; `APPLIED` remaining
terminal for Passed, Failed, and Partially Passed verification outcomes; and an internal contract-
violation exception never becoming retryable. Reversal means removing `releaseForRetry()` and the
`RECLAIMABLE` state from `InMemoryPreparationStore`, restoring the unconditional `store.complete()` call
in `WorkspaceRuntimeService.approveAndApply()`, and removing `isZeroMutationFileApplyResult` from
`src/core/file-apply`; every existing preparation and Apply Result contract is untouched, so reversal is
fully additive-safe.
