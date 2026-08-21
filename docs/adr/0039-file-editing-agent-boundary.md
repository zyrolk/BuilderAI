# ADR-039: File Editing Agent Boundary (P1-B B3)

- **Status:** Accepted
- **Date:** 2026-08-21
- **Owners:** BuilderAI architecture
- **Related:** ADR-011 (Safe File Apply), ADR-010 (Change Plan), ADR-036 (Agent Operating Layer),
  ADR-037 (Tool Registry), ADR-038 (Codebase Intelligence)

## Context

B1 delivered a read-only Tool Registry. B2 delivered codebase intelligence tools. File mutation
already exists behind Gate 2 → `approveAndApply` → `FileApplyEngineService`. B3 must let an agent
**propose** edits without creating a second mutation path.

## Decision drivers

- Preserve FileApply as sole target writer.
- Preserve Gate 2 as mandatory human approval before mutation.
- Reuse ChangePlanner, preparation store, approval binding, ledger, verification, correction.
- Keep B1/B2 tool contracts stable; extend policy only for proposal-only PLAN tools.
- Keep provider `toolCalling: false`; no autonomous agent loop.

## Decision

**P1-B B3 = File Editing Agent (Option A).**

### Flow

```
Edit Proposal DTO
  → ResponsePackage artifacts (change-operation metadata)
  → ChangePlannerService.plan
  → preparation store + Gate2 projection
  → explicit human approval
  → WorkspaceRuntimeService.approveAndApply
  → FileApplyEngineService.apply
```

### Tools (additive)

- `draft_edit_proposal` — stage create/update/delete intents (PLAN, readOnly)
- `inspect_edit_proposal` — sanitized proposal summary (INSPECT, readOnly)
- `commit_edit_proposal` — plan + prepare/store + Gate2 summary; **does not apply** (PLAN, readOnly)

### Registry policy extension

Allow `capabilityClass: PLAN` **only when** all hold:

- `readOnly: true`
- `authorizationAction: PREPARE`
- `requiresGate2: false`
- `approvalRequirement: NONE`

Continue rejecting: `MUTATE`, `APPLY`, `readOnly: false`, FileApply wiring, provider tool execution.

### Thin runtime helper

`WorkspaceRuntimeService.prepareFromResponsePackage` may commit a planner-produced plan into the
**existing** preparation store (same Gate2 / apply path). It must not mutate the target filesystem.

### Safety invariants

1. Tool Registry must not depend on FileApply, mutating FileSystemPort, or `approveAndApply`.
2. PROPOSAL ≠ APPLY; FileApply calls remain 0 until explicit approval.
3. Server owns preparationId, ChangePlan, Gate2 projection, apply tokens, baseline digests.
4. Tool results must not embed `changePlan`, `unifiedDiff`, apply tokens, or secrets.
5. Stale/drift fail-closed via existing preparation TTL / ledger baseline validation.
6. Correction requires a new proposal → Gate 2 → explicit approval again.
7. Providers remain `toolCalling: false`; no agent loop in B3.

### B3 non-goals

- B4 terminal, B5 Git write, B6 tool-calling loop, B7 browser agent, B8 unbounded auto-fix
- B9 new memory system, B10–B11 parallel/background agents
- LSP/AST, second mutation engine, auto-approval, provider toolCalling

## Consequences

### Positive

- Agents can draft multi-file edits while reusing P0/P1-A safety architecture.
- Clear composition tests prove zero FileApply before approval.

### Negative / accepted limits

- Commit still requires operator Gate 2 (by design).
- Proposal content size remains bounded; not a free patch engine.

## Security and privacy impact

- No new mutation network surface beyond existing prepare/apply.
- Same confidentiality, protected-path, and sanitizer posture as B1/B2/agent routes.

## Rollout and reversal

- Ship ADR, proposal service, three tools, `createB3EditingRegistry`, runtime prepare-from-package
  helper, and composition tests.
- Reversal: stop registering B3 tools; prepare/apply paths remain intact.
