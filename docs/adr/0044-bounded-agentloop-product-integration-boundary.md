# ADR-044: Bounded AgentLoop Product Integration Boundary (P1-B B8)

- **Status:** Accepted
- **Date:** 2026-08-23
- **Owners:** BuilderAI architecture
- **Related:** ADR-011 (Safe File Apply), ADR-012 (Verification), ADR-036 (Gated Agent Operating
  Layer), ADR-037 (Tool Registry), ADR-038 (Codebase Intelligence), ADR-039 (File Editing),
  ADR-040 (Controlled Terminal), ADR-041 (Controlled Git Write), ADR-042 (Bounded Server-Owned
  Agent Tool Loop), ADR-043 (Controlled Local Browser Observation)
- **Baseline:** `50908b0a45d0b294f8bb88385821c8e25f6c9865` (P1-B B7 frozen)

## Context

P1-B B1–B7 delivered a complete **library** capability stack:

- policy-gated Tool Registry (B1–B5 + B7),
- proposal-only editing,
- catalog verification,
- controlled local Git,
- localhost-only browser observation,
- and a **server-owned** bounded Agent Tool Loop (B6),

while providers remain `toolCalling: false`. Gate 2 → `approveAndApply` → FileApply remains the sole
source-file mutation path. Git write and browser observation remain distinct OPERATOR approvals.
`GIT_WRITE` remains outside the autonomous AgentLoop.

Production `AgentOperatingService`, authenticated agent HTTP routes, and operator UI still run the
**P1-A discrete lifecycle** (investigate → prepare → Gate2 → apply → verify → correct → explain).
They do **not** compose `createAgentLoopComposition` / `createB7BrowserRegistry` or expose phase-gated
tool turns. Tool evidence digests therefore never reach product Explain/UI surfaces.

Historical ADR language referred to “B8 unbounded auto-fix.” That phrase is an explicit
**non-goal** (ADR-039 / ADR-043). The B8 architecture audit selected a different, smaller product
need: **bounded AgentLoop product integration** — wire already-implemented loop and tools into the
production AgentOperating / HTTP / UI lifecycle without expanding autonomy or threat surface.

B1–B7 contracts are **frozen**. This ADR defines the architectural boundary for B8 before any
implementation.

## Decision

**P1-B B8 = Bounded AgentLoop Product Integration.**

Adopt:

> Wire the existing server-owned AgentLoop and B1–B7 registry into AgentOperating and authenticated
> product surfaces for phase-gated, budgeted, operator-visible tool turns — without unbounded
> auto-fix, background agents, MCP, open-web, or provider-native toolCalling.

### Critical statements

1. **B8 is orchestration and product exposure, not a new tool capability class.**
2. **Tool execution remains a server capability** (ADR-042); providers remain `toolCalling: false`.
3. **Gate 2, Git OPERATOR, and Browser OPERATOR approvals remain three distinct boundaries.**
4. **“B8 unbounded auto-fix” remains rejected**; this ADR redefines product B8 as integration only.
5. **Repository, page, console, network, and tool-result content remain DATA, never POLICY.**

### Architecture boundary

```
Provider (toolCalling:false)
  → structured tool intents (schema-validated)
  → AgentOperatingService (AgentRun lifecycle authority)
  → AgentLoopService (serial budgets / phase / idempotency / cancel)
  → ToolRegistry / ToolPolicyGate / WorkspaceAuthorization
  → existing B1–B7 services (unchanged contracts)
  → bounded sanitized ToolResult / digests
  → AgentRun tool evidence + optional Explain/UI projection
```

Never:

- Provider → filesystem / shell / FileApply / Git / browser / network directly
- Product HTTP/UI → bypass AgentLoop policy or invent a second mutation engine
- Tool content → policy, authorization, tool registration, or approval

### Production composition (required)

B8 implementation **MUST**:

1. Compose production AgentLoop via existing `createAgentLoopComposition` (or equivalent) using
   `createB7BrowserRegistry` (B1–B7 tools).
2. Integrate the loop into `AgentOperatingService` (or a thin façade it owns) so tool turns are
   **run-bound**, **project-bound**, and **phase-gated**.
3. Expose authenticated entrypoint(s) for tool turns (HTTP and/or internal service API used by UI).
4. Make bounded tool evidence/digests operator-visible via API and/or existing Explain/UI surfaces.

B8 implementation **MUST NOT** add a new Tool Registry capability class.

### Why redefine B8 away from “unbounded auto-fix”

- ADR-039/043 freeze unbounded auto-fix as a non-goal.
- Libraries already exist; the product gap is wiring and visibility.
- Expanding MCP/open-web/auto-fix before product glue increases blast radius without closing the
  actual operator gap.

### Why CorrectionLoop stays separate

- Correction remains: verify fail → diagnose → new proposal → prepare → **fresh Gate2** → explicit
  approval → FileApply → verify.
- Tool-assisted diagnosis/planning in `DIAGNOSING` / `CORRECTING` may use AgentLoop under existing
  phase policy, but **MUST NOT** auto-apply or reuse a prior Gate2 approval.
- B8 does not merge CorrectionLoop into AgentLoop as a single unbounded state machine.

## B1–B7 freeze

Implementation of B8 **MUST NOT** weaken or redefine:

- ADR-037–041 tool IDs and safety predicates (except additive product callers)
- ADR-042 AgentLoop budgets, serial execution, intent idempotency, restart fail-closed, sanitizer
- ADR-043 localhost-only BROWSER observation and distinct `browserObservationApproved` evidence
- Provider `toolCalling: false`
- Gate2 → `approveAndApply` → FileApply sole source-file mutation
- `GIT_WRITE` outside autonomous AgentLoop
- Distinct Gate2 ≠ Git OPERATOR ≠ Browser OPERATOR approvals

## Trust boundaries

| Boundary              | Authority                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------- |
| Provider              | Structured intents only; never authoritative for approvals, roots, tokens, or ChangePlans |
| AgentOperating        | AgentRun phase transitions; Gate2 pause; invoke apply via existing runtime                |
| AgentLoop             | Validate / authorize / execute / sanitize / budget / cancel / persist digests             |
| ToolRegistry / Policy | Registration + per-invoke phase/authz                                                     |
| B1–B7 services        | Existing safe wrappers only                                                               |
| Operator UI / HTTP    | Display evidence; submit authenticated turn requests; never deserialize authority         |

## Authorization model

Three distinct approvals remain authoritative:

```
Gate2 → approveAndApply → FileApply     = sole SOURCE FILE mutation
Git OPERATOR approval                   = VCS HISTORY mutation only (outside autonomous loop)
Browser OPERATOR approval               = LOCALHOST OBSERVATION only
```

Rules:

- Gate2 approval **MUST NOT** authorize Git write or browser observation.
- Git `operatorApproved` **MUST NOT** authorize browser observation or Gate2 apply.
- `browserObservationApproved` **MUST NOT** authorize Gate2 apply or Git write.
- Product tool-turn entrypoints **MUST** bind `runId`, `projectId`, and principal; reject
  cross-project access.
- Soft tools continue under existing PREPARE / INVESTIGATE / READINESS actions as registered.
- No FileApply / `approveAndApply` tools; no APPLY authorization on registry tools.

## Phase / tool policy

Reuse ADR-042 / ADR-043 autonomous allowlists. Product entrypoints **MUST NOT** widen them.

| Phase                                               | Autonomous tool classes (MVP)                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `UNDERSTANDING`                                     | SEARCH, READ, INSPECT (existing B6 policy)                                                  |
| `PLANNING`                                          | SEARCH, READ, INSPECT, PLAN (existing B6 policy)                                            |
| `AWAITING_GATE2`                                    | SEARCH, READ, INSPECT, GIT_READ only — **no** PLAN / proposal mutation via tools            |
| `EXECUTING`                                         | **No tools** (FileApply path only)                                                          |
| `VERIFYING`                                         | VERIFY, INSPECT, GIT_READ, BROWSER (BROWSER still requires browser OPERATOR evidence)       |
| `DIAGNOSING`                                        | SEARCH, READ, INSPECT, VERIFY, BROWSER according to existing diagnostic/BROWSER policy      |
| `CORRECTING`                                        | SEARCH, READ, INSPECT, PLAN according to existing read/plan policy — **no** automatic apply |
| `EXPLAINING` / `COMPLETED` / `FAILED` / `CANCELLED` | **No** autonomous tool execution                                                            |

Additional hard bans (unchanged):

- `GIT_WRITE` never in autonomous AgentLoop
- `file_apply` / `approve_and_apply` / generic shell / push / MCP / `WEB` never registered for loop

B8 **MUST NOT** add `AWAITING_GIT_APPROVAL` or `GIT_COMMIT` AgentRun phases.

## Budgets

Inherit ADR-042 / ADR-043 hard caps (no silent loosening in B8):

| Budget                              | MVP default                             |
| ----------------------------------- | --------------------------------------- |
| Max tool calls / run                | 40                                      |
| Max identical tool+args repeats     | 2 (then fail-closed)                    |
| Max provider turns / run            | 12                                      |
| Hard wall-clock / run               | 15–20 minutes (existing 15 min default) |
| Max B4 verification calls / run     | 6                                       |
| Max browser observation calls / run | 3                                       |
| Concurrent tool executions          | 1 (serial)                              |

Existing correction-loop attempt limits remain authoritative and are not replaced by this ADR.

## Persistence

### Persist (bounded, safe)

- AgentRun id, project id, phase, tool id, intent id, status, timestamps
- Bounded digests / summaries already produced by AgentLoop evidence
- Optional Explain/UI references to those digests (not raw payloads)

### Never persist (model-facing or durable product stores)

- Raw stdout / stderr / full HTML / HAR / unrestricted page bodies
- Cookies / storageState / credentials / auth headers / secrets
- Authoritative ChangePlans / apply tokens / Gate2 review material
- Raw provider payloads
- Unrestricted screenshot binaries to the model

## Restart behavior

After process restart:

- hydrate AgentRun + tool-loop digests only
- **never** auto-approve Gate2, Git, or browser observation
- **never** auto-apply FileApply
- **never** auto-commit Git
- **never** silently relaunch browser / leased local dev server
- **never** silently continue an in-flight tool turn past an approval boundary
- stale / incomplete loop state fails closed or requires a new explicit operator/product turn

## Replay / idempotency

- Reuse ADR-042 serial execution and `intentId` idempotency.
- Product entrypoints **MUST** reject concurrent tool turns for the same run.
- Idempotent replay returns prior bounded evidence; it **MUST NOT** re-drive side-effecting
  processes after restart without a new authorized call when restart semantics forbid it.
- No parallel correction / apply; existing apply locks remain authoritative.

## Cancellation

- Tool turns remain cancellable via existing `ExecutionCancellationToken` plumbing.
- Cancel **MUST** abort in-flight tool execution according to tool support flags.
- Cancel of browser observation **MUST** close browser and leased local dev server (ADR-043).
- Cancel **MUST NOT** invent approvals or continue past Gate2.

## Failure / recovery

| Condition                                            | Behavior                                                             |
| ---------------------------------------------------- | -------------------------------------------------------------------- |
| Malformed / unknown / unauthorized intent            | Reject; apply existing loop budget counting rules                    |
| Phase / capability denied                            | Reject; no execution                                                 |
| Missing Gate2 / Git / browser approval when required | Reject; no side effects                                              |
| Budget / wall-clock exhaustion                       | Stop further autonomous turns; require operator decision             |
| Cancellation / timeout                               | Abort; cleanup; fail closed                                          |
| Verification failure after apply                     | Existing correction path; **fresh Gate2** required for new FileApply |
| Sanitizer violation                                  | Fail result; never leak forbidden payloads                           |
| Corrupt tool evidence                                | Fail closed                                                          |
| Process restart                                      | Digest hydrate only; no silent continuation                          |

## Security threat model

| Threat                                      | Mitigation                                          |
| ------------------------------------------- | --------------------------------------------------- |
| Product route bypasses AgentLoop policy     | All turns must enter via AgentLoop + ToolPolicyGate |
| Soft integration skips Gate2                | EXECUTING remains tool-free; no FileApply tools     |
| Approval conflation (Gate2 / Git / Browser) | Distinct evidence fields preserved                  |
| Tool transcript leaks secrets / ChangePlans | Sanitizer + digest-only projection                  |
| Prompt injection via tool/page/repo text    | DATA-only; cannot elevate policy/authz              |
| Cross-project tool turns                    | projectId / principal binding                       |
| Budget bypass via new HTTP APIs             | Hard AgentLoop caps; fail closed                    |
| Restart auto-continue                       | Fail-closed hydrate semantics                       |
| Scope creep to MCP / open-web / auto-fix    | Explicit non-goals; registry continues to reject    |

## API / UI integration boundary

### Allowed

- Authenticated, run-bound tool-turn entrypoint(s) that accept structured intents and return bounded
  turn results / digests.
- Operator-visible tool transcript projections (API and/or Explain/UI) using digests/summaries.
- AgentOperating methods that delegate to `AgentLoopService.executeIntent` /
  `executeProviderTurn` with lifecycle context (`runId`, phase, projectRoot, principal, evidence,
  cancellation).

### Forbidden

- Browser-supplied authoritative ChangePlans, apply tokens, or approval minting.
- Unauthenticated tool execution.
- Provider SDK native toolCalling callbacks that execute tools outside AgentLoop.
- UI “auto-continue” that skips Gate2 / Git / browser OPERATOR gates.
- New public APIs that register or invoke MCP / WEB / shell / push / FileApply tools.

### Backward compatibility

- Existing agent HTTP routes (start / plan / approve / cancel / explain) remain valid.
- B8 is **additive**: discrete P1-A steps continue to work if tool turns are unused.
- Existing CorrectionLoop HTTP/session contracts remain valid; B8 must not require merging them.
- Existing B1–B7 tool IDs and schemas remain stable.

## Test / Definition of Done (future implementation; not this ADR task)

B8 implementation is complete only when all are true:

1. This ADR remains accepted and unchanged in spirit.
2. Production runtime composes AgentLoop + `createB7BrowserRegistry` (or equivalent B1–B7 registry).
3. AgentOperating (or owned façade) can execute phase-gated tool turns for a live AgentRun.
4. At least one authenticated product entrypoint performs run/project-bound turns.
5. Bounded tool evidence/digests are operator-visible (API and/or Explain/UI).
6. Providers remain `toolCalling: false`; no provider-native tool execution path.
7. EXECUTING rejects all tools; Gate2/FileApply sole writer proven.
8. `GIT_WRITE` still rejected by autonomous loop; Git/Browser/Gate2 approvals remain distinct.
9. Budgets, serial concurrency, `intentId` replay, cancel, and restart fail-closed proven via product
   path tests.
10. Correction still requires fresh Gate2 before any new FileApply after tool-assisted replan.
11. No MCP / WEB / shell / push / FileApply / approveAndApply tools registered.
12. B1–B7 regression suite + full `npm run ci` green.

## Non-goals

Freeze for B8:

- Unbounded auto-fix (historical “B8” label remains rejected)
- Background autonomous agents
- MCP / arbitrary MCP execution
- Open-web browsing / generic `WEB` capability
- Provider SDK `toolCalling`
- FileApply / `approveAndApply` tools
- Generic shell / generic Git / push
- Autonomous Git write inside the AgentLoop
- Auto Gate2 / auto Git approval / auto browser approval
- New Git AgentRun phases (`AWAITING_GIT_APPROVAL` / `GIT_COMMIT`)
- B9 memory system / parallel-agent architecture
- Merging CorrectionLoop into an unbounded tool-driven state machine
- New Tool Registry capability classes

## Rejected alternatives

| Option                                           | Status                                  |
| ------------------------------------------------ | --------------------------------------- |
| Provider-native `toolCalling: true`              | **Rejected**                            |
| Unbounded / background auto-fix as B8            | **Rejected** (ADR-039/043)              |
| MCP / open-web before product glue               | **Rejected** for B8                     |
| Deep CorrectionLoop↔AgentLoop merge in one slice | **Deferred** (complexity; not required) |
| Bounded AgentLoop product integration            | **Accepted**                            |

## Consequences

### Positive

- Operators can use iterative B1–B7 tools inside a live AgentRun through product surfaces.
- Reuses frozen loop/registry without expanding mutation or network threat surface.
- Clarifies that product “B8” is integration, not unbounded autonomy.

### Negative / accepted limits

- Tool turns remain manually/product-driven within budgets; not a background agent.
- Git write and browser observation still need distinct OPERATOR evidence.
- Correction still requires human Gate2 for every new FileApply.

## Migration and rollout

- Ship this ADR first; implement composition + AgentOperating/HTTP/UI wiring only after explicit
  implementation approval.
- Additive rollout: existing discrete agent routes keep working.
- Reversal: stop wiring AgentLoop into AgentOperating / product routes; B1–B7 libraries and P1-A
  lifecycle remain intact.

## Rollout and reversal

- Implementation may add runtime composition, AgentOperating delegation, authenticated turn
  entrypoints, and digest projections only as required by this ADR.
- Reversal does not remove B1–B7 or AgentLoop libraries; it only disconnects product callers.
