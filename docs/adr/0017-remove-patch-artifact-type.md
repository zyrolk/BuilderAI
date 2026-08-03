# ADR-017: Remove PATCH from the closed artifact contract

- **Status:** Accepted
- **Date:** 2026-08-01
- **Owners:** BuilderAI architecture
- **Related:** ADR-009 (Response Package boundary), ADR-010 (Project Change Plan boundary), ADR-016
  (Change Planner Workspace Visibility port)

## Context

ADR-009 closed the Response Package artifact contract to `SOURCE_FILE`, `DOCUMENTATION`,
`CONFIGURATION`, `TEST`, and `PATCH`. ADR-010 then closed the Project Change Plan to exactly three
exact-result operations (`CREATE_FILE`, `UPDATE_FILE`, `DELETE_FILE`) and, because a patch is not an
exact-result operation, made `ChangePlannerService` unconditionally reject any artifact of type `PATCH`.

This produced a contract mismatch rather than a deliberate two-stage rejection: the Response Processor
and the Gemini structured-output schema both advertised `PATCH` as an accepted, well-formed artifact
type, while the Change Planner rejected every `PATCH` artifact unconditionally. A provider could return
a `PATCH` artifact that passed every Response Processor validation rule (safe path, non-empty
description, valid checksum, valid `change-operation` intent) and only fail once it reached the Change
Planner. This wasted a full request/response cycle, produced a confusing "valid-looking package,
rejected plan" failure mode with no way to recover the intended change, and left the true contract only
discoverable by reading `ChangePlannerService` source, not the Response Processor or provider schema.

## Decision drivers

- Launch reliability: a provider response that is well-formed by the advertised contract should not
  predictably fail two layers downstream.
- Deterministic, exact-result behavior: every artifact BuilderAI accepts must become one deterministic
  `CREATE_FILE`, `UPDATE_FILE`, or `DELETE_FILE` operation with complete target content, never an
  inferred or computed result.
- Safety and reviewability: a human reviewing a Project Change Plan must see the exact final file
  content, not a diff/patch fragment whose effect depends on unseen current file state.
- Minimal architectural complexity: prefer removing an unused, contract-violating type over adding new
  transformation or interpretation logic to any boundary.
- Avoid hidden transformations: no boundary should silently reinterpret one artifact type as another.
- Compatibility with Safe File Apply's existing exact-content write/delete semantics (ADR-011), which
  have no patch-application capability today.

## Considered options

1. Remove `PATCH` from the artifact contract entirely and require `CREATE_FILE`/`UPDATE_FILE`/
   `DELETE_FILE` artifacts to carry complete file content, so every artifact the Response Processor
   accepts is already guaranteed to become a valid Change Plan operation.
2. Keep `PATCH` in the provider contract but normalize it into a deterministic `UPDATE_FILE` operation
   before the Change Planner sees it.
3. Add native patch support through the Change Planner and Safe File Apply Engine (parse, validate, and
   apply a patch format against current file content).

## Decision

Use option 1. `PATCH` is removed from `RESPONSE_ARTIFACT_TYPES` (`src/core/response-processor`) and from
the Gemini structured-output artifact type enum (`src/providers/gemini/mapper/gemini-request.mapper.ts`),
so the Response Processor now rejects a `PATCH` artifact as an unsupported type before a Response Package
can even be constructed — the same point every other unsupported type is already rejected. The Change
Planner's `ChangeOperationBase.artifactType` field is widened from `Exclude<ResponseArtifactType, 'PATCH'>`
back to the full `ResponseArtifactType`, because that type union itself no longer contains `PATCH`; the
now-unreachable `artifact.type === 'PATCH'` rejection branch in `ChangePlannerService` is deleted as dead
code. `ProjectChangePlanValidator` now checks `artifactType` against the shared `RESPONSE_ARTIFACT_TYPES`
constant exported by the Response Processor instead of maintaining its own separately hardcoded four-item
list, so the two boundaries cannot drift out of sync again.

Option 2 was rejected: normalizing a patch into an `UPDATE_FILE` operation requires computing or trusting
a resulting file's full content from a diff against assumed current content, which the Change Planner
cannot verify (it is effect-free and, even with the optional ADR-016 `WorkspaceVisibilityPort`, only
checks existence, never content). This would silently convert a possibly-stale or malformed patch into an
operation a reviewer would see as if it were the provider's own exact-content intent — precisely the
hidden transformation this system's human-approval model exists to prevent.

Option 3 was rejected as materially higher complexity and risk for no approved requirement: it would add
patch parsing/validation to a core module ADR-010 deliberately kept minimal and effect-free, would require
Safe File Apply (ADR-011) to read and apply a patch against live file content instead of writing an exact
provided value, and would introduce a new class of failure modes (context-line mismatches, encoding drift,
partial application) inside the one component responsible for atomic, revalidated, exact-content writes.
No current requirement depends on partial-file patch application; every existing use case is satisfied by
complete `CREATE_FILE`/`UPDATE_FILE` content.

## Consequences

Positive:

- Every closed artifact type the Response Processor accepts can now deterministically become exactly one
  valid Change Plan operation; there is no longer a class of well-formed-but-doomed provider output.
- The Change Planner's artifact-type validation is now sourced from the same `RESPONSE_ARTIFACT_TYPES`
  constant the Response Processor already exports, removing a second hardcoded list that could silently
  drift from the real contract.
- Rejection of an unsupported artifact type happens at the earliest boundary (Response Processor) instead
  of two layers downstream, giving faster, clearer feedback.

Negative:

- A provider must now express every change as complete file content; there is no supported way to
  request a smaller diff-style edit. This was already true in practice (the Change Planner rejected every
  `PATCH` artifact before this change), so no existing working behavior regresses.
- Native patch application remains a real, plausible future capability (for example, to reduce output
  token cost on large-file edits) but is explicitly out of scope here and requires its own approved
  proposal, ADR, and Safe File Apply design before any provider, prompt, or contract change reintroduces
  it.

## Security and privacy impact

This change is contract-narrowing only: it removes an artifact type, adds no new capability, I/O, or
trust boundary, and does not touch Safe File Apply's write/delete semantics, protected-path enforcement,
or the Change Planner's effect-free posture. It reduces attack surface slightly by eliminating one
previously-reachable-but-guaranteed-to-fail code path in `ChangePlannerService`.

## Rollout and reversal

`src/core/response-processor/test/artifact-validation.test.ts` asserts the four remaining closed types
are accepted and that `PATCH` is now rejected as an unsupported artifact type.
`src/core/change-planner/test/plan-generation.test.ts` asserts a `PATCH`-typed artifact is rejected as a
Response Package validation error surfaced through the Change Planner, end to end.
`src/providers/gemini/test/mapping-provider-execution.test.ts` asserts the Gemini structured-output schema
no longer advertises `PATCH`. Reversal would require re-adding `PATCH` to `RESPONSE_ARTIFACT_TYPES` and the
Gemini enum and reinstating an explicit rejection branch (or building real support) in the Change
Planner; nothing in this change is destructive or data-affecting, so reversal is a pure code change.
