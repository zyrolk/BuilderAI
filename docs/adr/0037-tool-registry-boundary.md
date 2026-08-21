# ADR-037: Tool Registry Boundary (P1-B B1)

- **Status:** Accepted
- **Date:** 2026-08-21
- **Owners:** BuilderAI architecture
- **Related:** ADR-011 (Safe File Apply), ADR-012 (Verification), ADR-036 (Gated Agent Operating
  Layer), P0 trusted-local foundation, P1-A Agent Operating Layer

## Context

P1-A delivered a gated Agent Operating Layer (`AgentRun`, `AgentOperatingService`, HTTP, UI,
ExplainArtifact) while preserving the P0 safety model: server-authoritative mutation, Gate 2,
FileApply as sole writer, verification policy, correction bounds, ledger, and recovery.

P1-B will eventually allow an agent to reason over goals by selecting controlled capabilities
(tools), observing sanitized results, and continuing. Free provider tool-calling loops, terminal
execution, Git mutation, MCP, browser autonomy, and direct filesystem mutation remain forbidden
until later phases with separate ADRs.

B1 needs the **smallest safe Tool Registry** that can wrap existing read/inspect services without
becoming a second mutation path.

## Decision drivers

- Preserve Gate 2 and `approveAndApply` → FileApply as the only target mutation path.
- Reuse existing authorization, confidentiality, cancellation, and digest/sanitization patterns.
- Prefer wrapping existing services over rebuilding search, verification, ledger, or recovery.
- Keep provider adapters at `toolCalling: false` for B1.
- Avoid speculative abstractions and an agent loop in B1.

## Considered options

1. **Enable provider `toolCalling: true` and let SDKs execute tools** — Rejected: bypasses
   BuilderAI policy and invites unconstrained FS/shell execution.
2. **New mutation tools that call FileApply directly** — Rejected: creates a second mutation path
   and violates ADR-011 / ADR-036.
3. **Server-owned Tool Registry that policy-gates wrappers over existing safe services** —
   Selected: catalog + executor only; B1 proof tools are read-only SEARCH / READ / INSPECT.

## Decision

**P1-B B1 = Tool Registry boundary.**

### What B1 is

- A minimal `ToolDefinition` / `ToolCallIntent` / `ToolExecutionContext` / `ToolResult` contract.
- A `ToolRegistry` that registers handlers and rejects mutating / Gate-2 / APPLY-class tools.
- A policy-gated `ToolExecutor` that:
  - validates phase allowlists,
  - authorizes via `WorkspaceAuthorizationService`,
  - enforces timeout and `ExecutionCancellationToken`,
  - sanitizes results (Explain / activity forbidden-key posture),
  - attaches digests for auditability.
- Bounded proof tools only:
  - `search_repository` (SEARCH)
  - `read_source_file` (READ)
  - `inspect_readiness` (INSPECT)

### What B1 is not

- Not an agent tool-calling loop / `AgentLoopService`.
- Not provider-native tool execution (`toolCalling` remains `false`).
- Not FileApply, terminal, Git write, MCP, browser, verification-runner, or correction tools.
- Not a second Gate 2, ledger, recovery, search, or provider-retry stack.
- Not automatic approval or APPLY.
- Not HTTP/UI product surface for tools (may be added later).

### Safety invariants

1. Tool Registry **must not** depend on `FileApplyEngineService`, `FileSystemPort`, or any direct
   target mutation API.
2. Registered B1 tools must be `readOnly: true`, `requiresGate2: false`, `approvalRequirement:
   NONE`, and must not use authorization action `APPLY`.
3. Capability classes `MUTATE`, terminal, Git write, WEB, and BROWSER are unavailable in B1.
4. Provider adapters remain `toolCalling: false`; the registry is never invoked by provider SDKs.
5. Tool results must not embed forbidden payloads (`fileContents`, `promptPackage`, raw
   stdout/stderr keys, `unifiedDiff`, `providerResponse`, apply tokens, ChangePlans, secrets).
6. Path reads for SEARCH/READ must go through caller-supplied `ProjectFileSource` (expected to be
   `PrepareConfidentialityBoundary` in production composition).
7. Cancellation and timeouts produce deterministic terminal statuses; partial success is fail-closed
   unless a tool explicitly documents otherwise (B1 tools do not).
8. Idempotency / concurrency controls for B1 are process-local only (same class of limit as P1-A
   execute locking).
9. Future mutation-related tools (post-B1) may only produce proposals bound to preparation / Gate 2;
   they still must not call FileApply.

### Preferred future provider entry (not enabled)

```
Provider structured tool intent
  → Agent layer
  → Tool Registry + policy
  → existing safe service
  → sanitized ToolResult / evidence refs
  → observation (later loop)
```

Never: Provider → filesystem / shell / FileApply.

## Consequences

### Positive

- Clear choke point for future agent capabilities without weakening P0 / P1-A.
- Proof tools demonstrate SEARCH / READ / INSPECT wrapping without product AI loop risk.
- Composition tests can regress “no FileApply dependency” and “no provider toolCalling”.

### Negative / accepted limits

- No autonomous multi-step tool loop in B1.
- Process-local idempotency only.
- Read excerpts remain bounded; not full-repo intelligence (B2+).

### Neutral

- `AgentOperatingService` remains the lifecycle orchestrator; a future loop service may call the
  registry but is out of B1 scope.

## Security and privacy impact

- New in-process capability catalog; no new network surface in B1.
- Tool outputs inherit sanitization / digest posture from Explain and activity history.
- Trust boundary unchanged: workspace authorization + confidentiality path filters.
- Mutation trust boundary unchanged: Gate 2 + FileApply only.

## Rollout and reversal

- Deliver types, registry, executor, three proof tools, and composition/regression tests.
- Reversal: stop registering/exporting the module; P0 / P1-A paths remain intact.
