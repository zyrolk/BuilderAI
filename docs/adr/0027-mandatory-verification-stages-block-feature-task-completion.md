# ADR-027: Mandatory Verification Stages Block FeatureTask Completion

## Status

Accepted — 2026-08-02

## Context

ADR-025 allows a FeatureTask to reach `COMPLETED` when verification is `PARTIALLY_PASSED` and the operator explicitly acknowledges the partial pass.

Phase 4 fresh pilot evidence showed this rule is unsafe for implementation tasks:

- task-2 completed with overall `PARTIALLY_PASSED` while `TEST_VALIDATION` failed,
- provider-generated TypeScript with syntax errors was applied,
- repository CI (`format:check`, `lint`, `typecheck`, `test`, `build`) broke after completion.

The verification engine derives `PARTIALLY_PASSED` whenever at least one stage passes and at least one stage fails. All current stages (`PROJECT_VALIDATION`, `DEPENDENCY_VALIDATION`, `BUILD_VALIDATION`, `TEST_VALIDATION`) are deterministic mandatory gates. Acknowledging partial pass must not override a failed mandatory stage.

## Decision

### Mandatory-stage completion rule

A FeatureTask must **not** transition to `COMPLETED` when any mandatory verification stage is `FAILED`.

Mandatory stages are the current verification pipeline stages:

- `PROJECT_VALIDATION`
- `DEPENDENCY_VALIDATION`
- `BUILD_VALIDATION`
- `TEST_VALIDATION`

`FeatureWorkflowService.completeTask()` enforces this through bounded stage evidence carried in the task outcome (`verificationStages`).

Rules:

- `verificationStatus: PASSED` with all mandatory stages `PASSED` → completion allowed.
- Any mandatory stage `FAILED` → completion rejected, even when `acknowledgePartialPass: true`.
- `verificationStatus: PARTIALLY_PASSED` requires bounded `verificationStages`; if any mandatory stage failed, completion is rejected.
- `verificationStatus: FAILED` → completion rejected.

`PARTIALLY_PASSED` remains a valid **reporting** status on `VerificationReport`, but it no longer authorizes completion while a mandatory stage failed.

The current model has no explicitly non-blocking verification stages. Future non-blocking stages would require an explicit allow-list before acknowledgement could bypass them.

### Completed-task correction reopen

Correction in ADR-025 assumes the task remains `IN_PROGRESS`. When a completed task must be repaired, operators may explicitly reopen it:

- `COMPLETED → IN_PROGRESS` through `reopenTaskForCorrection()`,
- dependent tasks that were `READY`/`IN_PROGRESS` revert to `PENDING`,
- the same `featurePlanId` + `taskId` then reuses the existing Phase 3 correction prepare path.

No automatic reopen. No filesystem mutation on reopen.

## Relationship to ADR-025

ADR-025 remains authoritative for decomposition workflow, dual approval, persistence, and correction attachment.

This ADR **narrows** ADR-025 task completion semantics:

| ADR-025 rule                                                  | ADR-027 update                                                             |
| ------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `PARTIALLY_PASSED` may complete with explicit acknowledgement | Acknowledgement cannot override a failed mandatory verification stage      |
| Correction stays on same task while `IN_PROGRESS`             | Completed tasks may be explicitly reopened to `IN_PROGRESS` for correction |

## Consequences

Positive:

- implementation tasks cannot be marked complete while deterministic CI gates fail,
- pilot recovery can reuse Phase 3 correction without silent manual edits,
- UI and API carry bounded stage evidence for auditability.

Trade-offs:

- operators must reopen completed tasks before correction,
- `PARTIALLY_PASSED` can no longer complete tasks under the current four-stage pipeline.

## Alternatives rejected

- special-casing Activity History only,
- weakening verification or auto-correcting failed stages,
- allowing manual source edits as the primary recovery mechanism,
- treating transitive `PARTIALLY_PASSED` as sufficient without stage evidence.
