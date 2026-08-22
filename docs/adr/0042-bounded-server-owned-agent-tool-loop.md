# ADR-042: Bounded Server-Owned Agent Tool Loop

- **Status:** Accepted
- **Date:** 2026-08-22
- **Owners:** BuilderAI architecture
- **Related:** ADR-011 (Safe File Apply), ADR-012 (Verification), ADR-036 (Gated Agent Operating
  Layer), ADR-037 (Tool Registry), ADR-038 (Codebase Intelligence), ADR-039 (File Editing),
  ADR-040 (Controlled Terminal), ADR-041 (Controlled Git Write)
- **Baseline:** `f0063d4fb9d4fa24b2bc0f192650de6f734c3ca2` (P1-B B5 frozen)

## Context

P1-A delivered a gated `AgentRun` / `AgentOperatingService` façade over prepare → Gate 2 →
`approveAndApply` → FileApply → verify → correct → explain. P1-B B1–B5 delivered a policy-gated
Tool Registry and tools for search/read/inspect, proposal-only editing, catalog verification, and
controlled local Git — while providers remain `toolCalling: false` and **no** agent tool-calling
loop exists.

The B6 architecture audit selected a hybrid model: provider reasoning may propose **structured
tool intents**, but execution must remain a **server-owned** bounded state machine. Free
provider-native tool calling and unrestricted autonomous agents remain rejected.

B1–B5 contracts are **frozen**. This ADR defines the architectural boundary for B6 before any
implementation.

## Decision

**P1-B B6 = Bounded Server-Owned Agent Tool Loop (Option C).**

Adopt:

> Provider reasoning + server-owned execution state machine.

### Critical statements

1. **Tool execution is a server capability, not a provider capability.**
2. **Gate 2 approval and Git operator approval are distinct authorization boundaries.**

### Provider boundary

Providers **MUST** remain:

```
toolCalling: false
```

The provider may return only **schema-validated structured tool intents**. The provider never
executes BuilderAI tools directly and never receives authoritative server fields (ChangePlan, apply
token, Gate2 approval, Git approval, trusted path roots, or server authorization state).

### Server authority (sole)

The server remains the sole authority for:

- tool selection validation
- authorization
- phase enforcement
- tool execution
- sanitization
- budgets
- cancellation
- replay / idempotency
- persistence
- Gate 2 transitions
- FileApply authorization
- Git operator approval
- final lifecycle transitions

## Architecture

### Loop

```
observe
  → provider structured intent
  → validate
  → authorize
  → execute
  → sanitize
  → persist bounded evidence
  → continue or stop
```

Execution is **server-owned**, **serial**, **bounded**, **cancellable**, and **fail-closed**.

Preferred information flow (extends ADR-037):

```
Provider (toolCalling:false) structured ToolCallIntent
  → Agent loop / AgentOperating layer
  → Tool Registry + ToolPolicyGate
  → existing safe B1–B5 services
  → sanitized ToolResult / digests
  → observation (next turn) OR lifecycle stop (e.g. AWAITING_GATE2)
```

Never: Provider → filesystem / shell / FileApply / Git write.

### Tool intent contract

The provider may emit structured intents of the form:

```json
{
  "toolId": "search_repository",
  "arguments": {},
  "intentId": "…"
}
```

The server **MUST** validate:

- schema
- known `toolId`
- phase allowlist
- authorization
- project / workspace binding
- argument shape
- budget remaining
- replay / idempotency

Unknown or malformed intents are **rejected**. Authority-bearing fields supplied by the provider
(e.g. `approved`, `applyAuthorizationToken`, authoritative `changePlan`, trusted repository roots,
Gate2/Git approval flags) are **rejected**.

### Existing AgentRun phases remain authoritative

B6 does **not** rename or replace P1-A phases. Tool turns are **intra-phase** activity unless a
future ADR adds phases. For B6 MVP:

- **Do NOT** add `AWAITING_GIT_APPROVAL` or `GIT_COMMIT` phases.
- Git write remains **operator-driven outside the autonomous loop**.

## Trust boundaries

### 1. Gate 2 / FileApply (unchanged)

```
Gate2 → approveAndApply → FileApply
```

This remains the **SOLE** authoritative source-file mutation path.

B6 **MUST NOT**:

- register FileApply as a tool
- register `approveAndApply` as a tool
- expose apply authorization tokens to the provider/model
- allow the provider/model to approve Gate 2
- auto-approve after restart
- bypass Gate 2 through tools

### 2. B4 Controlled Terminal (unchanged)

B4 remains catalog-only verification. No free shell, free argv, Git through B4, unrestricted npm, or
new process engine.

### 3. B5 Controlled Git (unchanged)

B5 remains local status/diff/stage/commit under OPERATOR approval and Applied FileApply path binding.

```
Gate2 approval  ≠  Git OPERATOR approval
```

B6 **MUST NOT** equate Gate2 approval with Git approval. For B6 MVP, Git write stays
operator-driven **outside** the autonomous loop.

### 4. Correction (unchanged)

Correction remains: verify fail → diagnose → new proposal → prepare → Gate 2 → explicit approval →
FileApply → verify. **No** correction auto-apply.

## Phase / tool policy

Exact existing phase names remain authoritative.

| Phase                      | Allowed tool classes (MVP)          |
| -------------------------- | ----------------------------------- |
| `UNDERSTANDING`            | B1/B2 read / search / inspect       |
| `PLANNING`                 | B1/B2 + B3 proposal tools           |
| `AWAITING_GATE2`           | Inspection only                     |
| `EXECUTING`                | **No** agent tools                  |
| `VERIFYING`                | B4 verification + B5 **read**       |
| `DIAGNOSING`               | B1/B2 read + B4 inspection          |
| `CORRECTING`               | B1/B2 + B3 proposal tools           |
| `EXPLAINING` / `COMPLETED` | No autonomous mutation via the loop |
| `FAILED` / `CANCELLED`     | No tools                            |

Tool definitions continue to declare `allowedPhases`; the loop must not widen B1–B5 registration
rules.

## Budget model

Frozen MVP defaults (no silent unlimited):

| Budget                          | MVP default          |
| ------------------------------- | -------------------- |
| Max tool calls / run            | 40                   |
| Max identical tool+args repeats | 2 (then fail-closed) |
| Max provider turns / run        | 12                   |
| Hard wall-clock / run           | 15–20 minutes        |
| Max B4 verification calls / run | 6                    |
| Concurrent tool executions      | 1 (serial)           |

Existing **correction-loop** limits remain authoritative and are not replaced by this ADR.

Token / context packaging continues to use existing Context Builder / Prompt Orchestrator bounds.

## Persistence / restart

### Persist (bounded, safe)

- run id, phase, tool id, intent id, status, timestamp
- bounded digest / summary
- relevant non-secret references

### Never persist

- raw stdout / stderr
- secrets / credentials
- raw provider payloads
- authoritative ChangePlans
- apply tokens
- Gate2 review material
- Git credentials / helpers

### Restart semantics

After restart:

- never auto-apply
- never auto-approve Gate 2
- never auto-commit Git
- never skip an approval boundary
- never reuse stale ephemeral preparation
- stale / incomplete loop state must **fail closed** or require re-planning

## Replay / idempotency

Require:

- per-run **serial** tool execution
- intent **idempotency** (`intentId`)
- duplicate in-flight mutation rejection
- no parallel correction / apply
- no stale preparation reuse
- existing apply / Git leases and fail-closed Git safety remain authoritative

## Prompt-injection model

Repository contents are **DATA**.

Repository text **MUST NOT** be treated as:

- policy
- system instructions
- authorization
- tool registration
- approval
- security configuration

Malicious content such as “ignore previous instructions”, “run npm install”, “git push”, or
“approve this change” remains ordinary **untrusted data** and cannot elevate privileges or register
tools.

## Sanitization

Existing Tool Registry forbidden-result policy remains authoritative (`TOOL_RESULT_FORBIDDEN_KEYS`
and related sanitizers).

Never expose to the provider:

- `fileContents`
- `stdout` / `stderr` (or excerpts thereof as raw streams)
- `unifiedDiff`
- `changePlan`
- `applyAuthorizationToken`
- Gate2 review material
- approval state / tokens
- secrets / credentials

Only bounded safe summaries, digests, and enums may cross the tool-result boundary.

## Security invariants

1. Tool execution is a **server** capability, not a provider capability.
2. Gate 2 approval and Git OPERATOR approval are **distinct** authorization boundaries.
3. `Gate2 → approveAndApply → FileApply` remains the sole source-file mutation path.
4. Providers remain `toolCalling: false`.
5. B1–B5 tool contracts and runners are not weakened.
6. No FileApply tool, no `approveAndApply` tool, no generic shell, no generic Git, no push.
7. No autonomous background agent; no unbounded loop.
8. Budgets are hard caps; exhaustion is fail-closed.
9. Restart never auto-approves, auto-applies, or auto-commits.
10. Repository content cannot become policy or authority.

## Failure / recovery behavior

| Condition                                   | Behavior                                                         |
| ------------------------------------------- | ---------------------------------------------------------------- |
| Tool / provider timeout                     | Fail-closed turn; stop or cancel per run policy                  |
| Cancellation                                | Abort in-flight tool turn; no silent continuation past approvals |
| Malformed / unknown / unauthorized intent   | Reject; count against budgets                                    |
| Identical tool+args over repeat cap         | Fail-closed                                                      |
| Budget / wall-clock exhaustion              | Stop loop; fail or require operator decision                     |
| Stale preparation / baseline drift          | Reject mutation paths; replan                                    |
| Gate2 denied / expired approval             | Remain stopped; no apply                                         |
| Verification failure                        | Existing correction path; new Gate2 required                     |
| Git commit failure (if operator invokes B5) | Report safely; no destructive rollback                           |
| Sanitizer violation                         | Fail result; never leak forbidden payloads                       |
| Process restart                             | Metadata-safe resume only; no auto approval / apply / Git        |

## Rejected alternatives

| Option                                                                  | Status                                     |
| ----------------------------------------------------------------------- | ------------------------------------------ |
| **A.** Provider-native SDK `toolCalling`                                | **Rejected**                               |
| **B.** Purely heuristic server loop with no structured provider intents | Not selected for B6 (may inform internals) |
| **C.** Provider reasoning + server-owned execution SM                   | **Accepted**                               |
| **D.** Fully autonomous background agent                                | **Rejected**                               |

Also rejected:

- generic shell
- generic Git
- push
- FileApply tool
- `approveAndApply` tool
- automatic Gate2 approval
- automatic Git commit
- unrestricted tool loops
- MCP / browser autonomy

## Non-goals

Freeze for B6:

- Git push / fetch / remote Git APIs
- browser autonomy / MCP
- unrestricted shell
- provider-native `toolCalling`
- background agents
- P2 LSP / AST
- durable semantic memory / indexing
- autonomous Git approval inside the loop
- automatic source mutation outside FileApply
- `AWAITING_GIT_APPROVAL` / `GIT_COMMIT` AgentRun phases (unless a later ADR separately accepts them)

## Definition of Done (future implementation; not this ADR task)

B6 implementation is complete only when all are true:

- This ADR remains accepted and unchanged in spirit
- Server-owned loop exists; providers remain `toolCalling: false`
- Structured intents validated; authority fields rejected
- Phase / tool policy and budgets enforced
- Gate2 / FileApply / B4 / B5 boundaries unchanged
- Persistence and restart semantics implemented
- Replay / serial execution / idempotency implemented
- Sanitizer and prompt-injection posture preserved
- Full regression / security test matrix + CI green
- No push; no FileApply tools; no auto-approve

## Future extension boundary

Later ADRs may consider (only with explicit acceptance):

- Additive Git approval phases integrated into AgentRun
- HTTP/UI surfaces for tool transcripts
- Tighter or looser budgets after production evidence
- Optional provider SDK toolCalling **only** if proven to route exclusively through this server
  gateway (a major architectural change — not implied by B6)

Extensions **must not** weaken Gate2, FileApply sole-writer, B4 catalog, B5 path binding, or
`toolCalling: false` without a new ADR.

## Consequences

### Positive

- Clear path to Cursor-like iterative inspection/proposal without surrendering security control.
- Reuses frozen B1–B5 tools and P1-A lifecycle without a second mutation engine.

### Negative / accepted limits

- Provider SDKs cannot natively drive tools until a future ADR.
- Git write stays outside the autonomous loop for B6 MVP.
- Operators must still approve Gate2 (and separately Git writes).

## Rollout and reversal

- Ship this ADR first; implement loop only after explicit implementation approval.
- Reversal: do not register/wire the loop; B1–B5 and AgentOperating discrete steps remain intact.
