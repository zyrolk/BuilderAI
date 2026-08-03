# ADR-021: Verification eligibility is "actually mutated the workspace", not "Applied only"

- **Status:** Accepted
- **Date:** 2026-08-01
- **Owners:** BuilderAI architecture
- **Related:** ADR-011 (Safe File Apply boundary), ADR-012 (Verification pipeline boundary), ADR-014
  (Local MVP runtime composition), ADR-020 (Bounded zero-mutation Apply retry). Supersedes only ADR-012's
  decision driver "Accept only the existing validated File Apply Result with Applied status" and the
  corresponding Decision-section clause "Invalid, Rejected, Failed, or Partially Applied inputs invoke no
  verification port." Every other ADR-012 constraint — the fixed four-stage pipeline, port contracts,
  status derivation, evidence-completeness guarantee, and "no automatic repair" boundary — is unchanged
  and remains fully in force.

## Context

`VerificationEngineService.verify()` hard-rejected every `FileApplyResult` whose `status` was not exactly
`APPLIED`, throwing a typed `VerificationValidationError` for `REJECTED`, `FAILED`, and — critically —
`PARTIALLY_APPLIED` as well. `WorkspaceRuntimeService.approveAndApply()`, `HttpWorkspaceWorkflow.verify()`,
and `WorkspaceShell.handleApproval()` each independently re-derived and enforced the same "Applied only"
rule on the client and server sides. The practical effect: a plan where some operations mutated the
filesystem and a later operation then failed — `PARTIALLY_APPLIED`, File Apply's own documented,
non-transactional outcome for exactly this situation (ADR-011: "completed operations are not rolled
back") — left real, live mutations on disk with **zero** automated Project/Dependency/Build/Test signal.
The workflow still completed successfully (HTTP 200, no thrown error); an operator had to notice
`applyResult.status: 'PARTIALLY_APPLIED'` on their own to realize no verification evidence exists for the
files that were actually changed. This was true reliability/safety gap, not a UX nuance: the exact
situation verification exists to catch (a project now in a real, mutated, unverified state) was the one
situation verification was never invoked for.

## Decision drivers

- Verification evidence must exist whenever real filesystem mutations occurred, because that is exactly
  when an automated Project/Dependency/Build/Test signal is most valuable.
- `REJECTED` and `FAILED` must remain excluded: the validated `FileApplyResult` contract (`FileApplyResultValidator`'s
  relationship rules) already guarantees both always have zero applied files, so there is nothing on disk
  to verify.
- Do not change File Apply semantics, the `FileApplyResult` contract, or introduce rollback, transactions,
  or automatic repair.
- Do not weaken the core Verification Engine's own input validation boundary; every non-eligible or
  malformed input must still be rejected with the same typed error behavior as before.
- Do not synthesize, fake, or convert a `PARTIALLY_APPLIED` result into an `APPLIED`-shaped one to satisfy
  the old gate; a Verification Report must always be evidence about a real File Apply outcome.
- Preserve P1-6 (ADR-020): `PARTIALLY_APPLIED` must remain permanently terminal and non-retryable
  regardless of whether it now carries a `VerificationReport`.
- Minimal, deterministic, centralized change: one predicate, reused at every enforcement point, rather
  than four independently-drifting conditionals.

## Considered options

A. Fix only `WorkspaceRuntimeService.approveAndApply()`'s call-site condition.
B. Introduce one centralized `isVerificationEligibleFileApplyResult(result)` predicate — true exactly for
`APPLIED` and `PARTIALLY_APPLIED` — and apply it consistently at the core Verification Engine's input
gate, the application orchestration call site, and both UI-layer gates that re-derive the same rule.
C. Leave the core boundary untouched; have `WorkspaceRuntimeService` synthesize a placeholder or
"skipped" verification report for `PARTIALLY_APPLIED` instead of running real verification.
D. Any smaller/safer design than B.

## Decision

Use option B. `src/core/file-apply/types/file-apply.ts` gains one new exported predicate:

```
isVerificationEligibleFileApplyResult(result) =
  result.status === 'APPLIED' || result.status === 'PARTIALLY_APPLIED'
```

Eligibility is derived exclusively from `status`, never from `skippedFiles` or any other indirect field.
This is exact and complete because the validated `FileApplyResult` contract's own relationship
invariants (`FileApplyResultValidator.validateRelationships`) already guarantee: `REJECTED` and `FAILED`
always have `createdFiles.length + updatedFiles.length + deletedFiles.length === 0`, and
`PARTIALLY_APPLIED` always has that sum greater than zero. "Actually mutated the workspace" and "status is
`APPLIED` or `PARTIALLY_APPLIED`" are therefore the same statement under this contract.

The predicate replaces the single `value.status !== 'APPLIED'` check inside
`VerificationEngineService.acceptSuccessfulApplyResult()` — the exact same typed
`VerificationValidationError` (`INVALID_APPLY_RESULT` at `$.status`) is still thrown for every ineligible
or malformed input, with the same "reject before invoking any port" guarantee ADR-012 established; only
the boundary of what counts as eligible moved. The same predicate replaces
`WorkspaceRuntimeService.approveAndApply()`'s `applyResult.status === 'APPLIED'` ternary guard,
`HttpWorkspaceWorkflow.verify()`'s cached-report gate, and `WorkspaceShell.handleApproval()`'s early-stop
condition, so all four enforcement points move in lockstep from one source of truth. No other part of the
verification pipeline changes: `VerificationContext.affectedFiles` was already derived purely from
`createdFiles`/`updatedFiles`/`deletedFiles` (never from `skippedFiles`), so a `PARTIALLY_APPLIED`
context already reports exactly the files that were genuinely mutated and nothing else; every
infrastructure verification adapter (`NodeProjectValidator`, `NodeBuildRunner`, `NodeTestRunner`,
`BoundedNpmCommandRunner`) already ignores the context entirely and runs the same whole-project `npm`
commands regardless of apply outcome, so verification behavior for a newly-eligible `PARTIALLY_APPLIED`
input is identical in every respect to the existing `APPLIED` path.

`PARTIALLY_APPLIED` remains exactly as terminal and non-retryable as ADR-020 defined: it is never
zero-mutation (`isZeroMutationFileApplyResult` in `src/core/file-apply` continues to exclude it by
construction), so `WorkspaceRuntimeService.approveAndApply()` still always calls the preparation store's
unconditional `complete()` for it, never `releaseForRetry()`. The only change is that the
`WorkspaceCompletion` object passed to `complete()` — and therefore replayed on every subsequent call —
now also carries a real `verificationReport` when one was produced. A `VerificationReport` attached to a
`PARTIALLY_APPLIED` result does not mean Apply succeeded; it means the project state that actually exists
on disk after a partial Apply now has real build/test evidence, exactly as it would for a fully `APPLIED`
result. This does not imply, authorize, or trigger any repair, rollback, or further mutation — File Apply
already reached its own terminal, non-transactional outcome before verification ever runs.

### Rejected alternatives

Option A was rejected because the core Verification Engine's own gate would still throw for
`PARTIALLY_APPLIED` even if the application layer tried to call it — fixing only the caller does not
reach the actual root cause and would convert a silent skip into an unhandled validation error.

Option C (synthesize a placeholder/"skipped" report) was rejected because it manufactures evidence not
backed by a real build/test run, directly undermining ADR-012's own founding principle that "a
Verification Report is evidence." A fabricated report could be mistaken for genuine verification and is
strictly worse than the current gap, not a fix for it.

Option D was not chosen over B because B is already the smallest change that reaches every point the
verified root cause actually requires: one predicate, four call sites updated to use it, zero changes to
the `FileApplyResult` contract, the four-stage pipeline, port contracts, `VerificationContext` shape, or
any infrastructure adapter.

## Consequences

Positive:

- A `PARTIALLY_APPLIED` Apply attempt — real, live-project mutations left by a mid-plan failure — now
  always produces real Project/Dependency/Build/Test evidence, closing the exact gap the original
  `PARTIALLY_APPLIED` warning ("some files were mutated, then a later operation failed") was silently
  leaving unchecked.
- `REJECTED` and `FAILED` continue to be rejected by the core Verification Engine with the identical typed
  error as before; nothing changes for either.
- `APPLIED` behavior is byte-for-byte unchanged: the predicate returns `true` for `APPLIED` exactly as the
  old literal check did.
- `PARTIALLY_APPLIED` remains permanently terminal and non-retryable per ADR-020; a second
  `approveAndApply()` call for the same `preparationId` still replays the cached completion (now including
  its `VerificationReport`) without invoking File Apply or Verification a second time.
- The UI (`HttpWorkspaceWorkflow`, `WorkspaceShell`) surfaces the same real evidence the server already
  computed, without any new network call: the existing single combined `/api/workspace/apply` response
  already carries `verificationReport` when eligible, and the client-side `verify()` method remains a pure
  cache read.
- No new verification stage, port, or infrastructure behavior was introduced.

Negative:

- Verification now runs, and consumes verification time/resources (build, test), for a strictly larger
  set of Apply outcomes than before — a partially-applied plan that previously terminated immediately
  after Apply now also waits for the full four-stage verification pipeline. This is the explicit, intended
  trade-off: real mutations now always get real evidence.
- Four call sites (one core, one application, two UI) had to move together to fully close the gap, rather
  than a single-file change — a direct consequence of the original gap having been independently
  re-implemented four times instead of centralized once.

## Security and privacy impact

No new trust boundary, credential, or I/O path is introduced. Verification for a `PARTIALLY_APPLIED`
result runs the exact same four ports (`NodeProjectValidator`, `NodeDependencyValidator`,
`NodeBuildRunner`, `NodeTestRunner`) against the exact same project root as an `APPLIED` result already
does; no adapter behavior changes based on `FileApplyResult.status`.

## Rollout and reversal

`src/core/verification/test/input-and-configuration-validation.test.ts` now asserts only `REJECTED` and
`FAILED` are rejected by the core gate; `src/core/verification/test/successful-verification.test.ts` adds
coverage for a `PARTIALLY_APPLIED` input running the complete pipeline and for `affectedFiles` reflecting
only the actually-mutated files, never `skippedFiles`. `src/application/workspace/workspace-runtime.service.test.ts`
extends the existing P1-6 `PARTIALLY_APPLIED` regression test to assert a real `verificationReport` is
produced on the first attempt and neither File Apply nor Verification runs again on replay, and adds
explicit `verificationReport: undefined` assertions to the existing zero-mutation `REJECTED`/`FAILED`
regression tests. `src/ui/workspace/test/workflow-transitions.test.tsx` adds a `PARTIALLY_APPLIED` case
proving the UI proceeds into verification and renders the real report, and a `FAILED` case proving the UI
still stops before verification exactly as `REJECTED` already did. Reversal means restoring the single
`status !== 'APPLIED'` (or `=== 'APPLIED'`) literal check at all four sites and removing
`isVerificationEligibleFileApplyResult`; no `FileApplyResult`, `VerificationReport`, or preparation-store
contract is affected, so reversal is fully additive-safe.
