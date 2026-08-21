# ADR-036: Gated Agent Operating Layer (P1-A)

- **Status:** Accepted
- **Date:** 2026-08-21
- **Owners:** BuilderAI architecture
- **Related:** ADR-011 (Safe File Apply), ADR-012 (Verification), ADR-014 (Local MVP composition),
  ADR-024 (Iteration feedback), ADR-025 (Feature decomposition), P0-1→P0-10 trusted-local foundation

## Context

P0-1 through P0-10 established a trusted-local MVP with a gated fixed pipeline: investigate → prepare →
Gate 2 → server-authoritative apply → verification → optional browser verification → bounded
correction → durable workflow ledger / recovery.

The operator UX (`WorkspaceShell` + discrete HTTP APIs) currently stitches that lifecycle together.
The product direction requires a Cursor-level (or better) software-engineering workflow while
preserving BuilderAI’s safety architecture:

Provider → Structured Plan → Server Validation → Gate 2 / Approval → Controlled Mutation →
Verification → Correction → Durable Recovery → Workflow Ledger / Evidence

The missing piece is a **unified server-owned AgentRun** plus a later step orchestrator that wraps
existing P0 capabilities. Free Cursor-style autonomous tool loops are explicitly out of scope for
P1-A.

## Decision drivers

- Preserve Gate 2 as the mandatory human mutation boundary.
- Preserve a single mutation path (`approveAndApply` → FileApply).
- Avoid duplicate verification, correction, ledger, or recovery systems.
- Keep existing prepare/apply HTTP APIs backward compatible.
- Prefer the smallest orchestration metadata model before adding HTTP/UI/tooling.
- Fail closed on invalid orchestration transitions and restart.

## Considered options

1. **Enable provider tool-calling and a free agent loop** — Rejected for P1-A: bypasses Gate 2,
   invites unconstrained shell/FS tools, and conflicts with P0 security posture.
2. **Replace WorkspaceRuntimeService with a new agent runtime** — Rejected: unnecessary redesign of
   the P0 foundation.
3. **Gated Agent Operating Layer that orchestrates existing P0 services** — Selected: thin session +
   (later) step runner; mutation remains Gate 2 → FileApply.

## Decision

**P1-A = Gated Agent Operating Layer.**

### What P1-A is

- A server-owned `AgentRun` (orchestration metadata) and, in later P1-A steps, a step orchestrator
  that calls existing application services in lifecycle order.
- A mandatory interruption at Gate 2 before any target mutation.
- A wrapper around existing Understand / Plan / Execute / Test / Browser / Diagnose / Correct /
  Verify / Explain capabilities already implemented in P0 services and routes.

### What P1-A is not

- Not a replacement for `WorkspaceRuntimeService`.
- Not a replacement for `CorrectionLoopService`.
- Not a replacement for the Workflow Ledger.
- Not a second mutation journal or second recovery system.
- Not unrestricted provider tool calling.
- Not an arbitrary shell capability.
- Not a Git mutation capability.
- Not automatic approval or automatic APPLY.
- Not a free Cursor-style autonomous tool loop (deferred to a later P1 phase).

### Safety invariants

1. Only the existing server-authoritative `approveAndApply` / FileApply path may mutate the target.
2. Gate 2 remains the mandatory human mutation boundary.
3. No automatic approval; no automatic APPLY.
4. Provider adapters remain non-tool-calling for P1-A (`toolCalling: false`).
5. Existing prepare/apply APIs remain backward compatible.
6. `AgentRun` may reference `investigationId`, `featurePlanId`, `preparationId`, `workflowId`, and
   `correctionWorkflowId` but must not duplicate those workflows’ authoritative state.
7. `AgentRun` must not authorize APPLY, hold an authoritative ChangePlan, approve Gate 2, mutate
   files, execute arbitrary commands, or bypass existing authorization.
8. Cancellation of an AgentRun must delegate to existing cancellation infrastructure (later steps);
   Step 1 only models CANCELLED state without inventing a new cancel bus.
9. Restart must never convert `AWAITING_GATE2` into automatic approval or APPLY.
10. Workflow Ledger remains the authoritative durable event/evidence mechanism for prepare/apply/
    recovery; AgentRun persists only minimal orchestration metadata under the existing workflow
    state root.

### Incremental delivery (P1-A steps)

| Step | Deliverable                                                      | Status   |
| ---- | ---------------------------------------------------------------- | -------- |
| 0    | This ADR                                                         | Complete |
| 1    | Minimal `AgentRun` model, transitions, persistence, tests        | Complete |
| 2    | `AgentOperatingService` orchestration over existing P0 services  | Complete |
| 3    | Agent HTTP API (`/api/workspace/agent/run…`)                     | Complete |
| 4    | Agent UI (`AgentRunPanel` in WorkspaceShell)                     | Complete |
| 5    | Deterministic `ExplainArtifact` + GET `/explain`                 | Complete |
| 6    | Full E2E validation (success, correction, Gate 2, cancel/reload) | Complete |
| 7    | Production sign-off / final audit (trusted-local scope)          | Complete |

## Consequences

### Positive

- Clear product path toward a unified agent workflow without weakening P0 controls.
- Existing services remain the source of truth for investigate/prepare/apply/verify/correct/ledger.
- Restart-safe Gate 2 pause is modeled without auto-continue.
- Operators can run a governed AgentRun from WorkspaceShell with mandatory Gate 2 and deterministic Explain.

### Negative / accepted limits

- Preparations remain process-local; AgentRun references may dangle after restart until preparation
  is re-created (same limitation as today’s prepare store).
- Free tool-calling autonomy remains unavailable (deferred beyond P1-A).
- Browser verification in P1-A E2E uses the existing stub port rather than live Playwright.
- Concurrent execute protection is process-local, not a distributed lock.
- Protected-profile stale apply-token paths are outside the trusted-local E2E matrix.

### Neutral

- Documentation that still describes “no agents” for older sprints is superseded for P1-A only in the
  gated sense defined here; unrestricted agent autonomy remains forbidden.

## Security and privacy impact

- New asset: `AgentRun` JSON under the existing `.builderai-runtime` workflow state root.
- Must not persist secrets, provider raw output, credential-bearing prompts, file contents, or raw
  browser bodies.
- Trust boundary unchanged: loopback trusted-local / existing workspace authorization.
- Mutation trust boundary unchanged: Gate 2 + FileApply.

## Rollout and reversal

- P1-A Steps 0–7 are complete for trusted-local scope: AgentRun, AgentOperatingService, HTTP, UI,
  deterministic Explain, E2E validation, and this sign-off.
- Composition is wired through `local-feature-workflow-runtime` without replacing FileApply or
  verification engines.
- Reversal: stop writing AgentRun / ExplainArtifact files; disable Agent UI/routes; prepare/apply
  paths remain intact.
