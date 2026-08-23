# ADR-045: Bounded Operator Tool-Turn Product Surface (P1-B B9)

- **Status:** Accepted (implementation authorized for Option A only)
- **Date:** 2026-08-23
- **Owners:** BuilderAI architecture
- **Related:** ADR-011 (Safe File Apply), ADR-012 (Verification), ADR-036 (Gated Agent Operating
  Layer), ADR-037 (Tool Registry), ADR-038 (Codebase Intelligence), ADR-039 (File Editing),
  ADR-040 (Controlled Terminal), ADR-041 (Controlled Git Write), ADR-042 (Bounded Server-Owned
  Agent Tool Loop), ADR-043 (Controlled Local Browser Observation), ADR-044 (Bounded AgentLoop
  Product Integration)
- **Baseline:** `fd287594a5462e650fe364f1d372b9df38d8207d` (P1-B B8 frozen)

## Context

P1-B B1–B8 delivered a frozen library + product integration stack:

- policy-gated Tool Registry (B1–B5 + B7),
- proposal-only editing,
- catalog verification,
- controlled local Git,
- localhost-only browser observation,
- server-owned bounded Agent Tool Loop (B6),
- and **B8** wiring of AgentLoop + `createB7BrowserRegistry` into AgentOperating, authenticated
  HTTP `tool-turn`, and Explain/status digest projection,

while providers remain `toolCalling: false`. Gate 2 → `approveAndApply` → FileApply remains the sole
source-file mutation path. Git write and browser observation remain distinct OPERATOR approvals.
`GIT_WRITE` remains outside the autonomous AgentLoop. CorrectionLoop remains separate and still
requires a **fresh Gate2** before any new FileApply.

The B9 architecture audit found that B8 closes the composition/API gap, but operators still cannot
invoke tool turns from the AgentRun UI. `HttpAgentWorkflow.toolTurn` exists; the AgentRun panel
does not call it. Live digests are available via status/Explain APIs but are not fully surfaced as
an in-run operator control surface.

Historical ADR language referred to “B9 memory system / parallel-agent architecture” (ADR-039 /
ADR-044 non-goals). That phrase **must not** expand into memory-agent tools, parallel agents, MCP,
open-web, provider-native toolCalling, or unbounded auto-fix. The B9 audit selected the narrowest
useful product need: **bounded operator tool-turn product surface** — UI invocation of the
**existing** authenticated B8 tool-turn API without new capability classes or autonomy expansion.

B1–B8 contracts are **frozen**. This ADR defines the architectural boundary for B9 before any
implementation. Acceptance of this ADR (when later authorized) does **not** by itself authorize
implementation.

## Decision

**P1-B B9 = Bounded Operator Tool-Turn Product Surface.**

Adopt:

> Operator-triggered UI invocation of the existing authenticated B8 tool-turn API, with live
> bounded digest visibility — without new capability classes, without provider structured-intent
> emission, and without expanding mutation or network threat surface.

### Critical statements

1. **B9 is a product surface over B8, not a new tool execution engine.**
2. **No new Tool Registry capability class is required or permitted for B9.**
3. **UI requests are untrusted DATA;** server AgentOperating + AgentLoop remain authoritative.
4. **Gate 2, Git OPERATOR, and Browser OPERATOR approvals remain three distinct boundaries.**
5. **Provider structured-intent emission is out of scope** and requires a future separate ADR if
   ever justified.
6. **Historical “B9 memory / parallel agents” remains rejected** for this product slice.

### Architecture boundary

```
Operator UI (authenticated)
  → structured tool intents (operator-supplied; schema-validated server-side)
  → existing B8 POST /api/workspace/agent/run/:runId/tool-turn
  → AgentOperatingService.executeToolTurn
  → AgentLoopService (unchanged budgets / phase / serial / idempotency / cancel)
  → ToolRegistry / ToolPolicyGate / WorkspaceAuthorization
  → existing B1–B7 tools (unchanged contracts)
  → bounded sanitized digests
  → live AgentRun status / Explain / UI projection
```

Never:

- UI → filesystem / shell / FileApply / Git / browser / network directly
- UI → mint Gate2 / Git / Browser authority or apply tokens
- UI → bypass AgentOperating phase policy or invent a second mutation engine
- Provider SDK native toolCalling callbacks
- New AgentLoop or ToolPolicyGate implementation

### Why redefine B9 away from “memory / parallel agents”

- ADR-044 freezes B9 memory/parallel-agent architecture as a non-goal for B8 and beyond without a
  new justification.
- The immediate product gap after B8 is operator usability of an already-shipped HTTP surface.
- Memory tools, parallel agents, MCP, and open-web expand blast radius without closing the UI gap.

### Why provider structured-intent emission is deferred

- Closing the UI surface does not require providers to invent intents.
- Schema-validated provider intent emission is a separate trust and injection boundary and **MUST**
  be a future ADR if pursued — **not** ADR-045 scope.
- Providers remain `toolCalling: false`.

### Why CorrectionLoop stays separate

- Tool-assisted diagnosis/planning via UI tool turns may occur in allowed phases under existing
  B6/B7 policy.
- Any new source proposal still requires prepare → **AWAITING_GATE2** → explicit human approval →
  `approveAndApply` → FileApply.
- B9 **MUST NOT** merge CorrectionLoop into AgentLoop or auto-apply after tool turns.

## B1–B8 freeze

Implementation of B9 (when separately authorized) **MUST NOT** weaken or redefine:

- ADR-037–041 tool IDs and safety predicates
- ADR-042 AgentLoop budgets, serial execution, intent idempotency, restart fail-closed, sanitizer
- ADR-043 localhost-only BROWSER observation and distinct `browserObservationApproved` evidence
- ADR-044 AgentOperating / HTTP tool-turn composition and product entry semantics
- Provider `toolCalling: false`
- Gate2 → `approveAndApply` → FileApply sole source-file mutation
- `GIT_WRITE` outside autonomous AgentLoop
- Distinct Gate2 ≠ Git OPERATOR ≠ Browser OPERATOR approvals
- Existing phase allowlists (including EXECUTING tool-free)

## B9 MVP scope

When implementation is later authorized, B9 **MUST**:

1. Allow the operator to invoke the **existing** B8 tool-turn from the AgentRun UI.
2. Keep UI requests authenticated and **run- / project- / principal-bound**.
3. Ensure the UI **cannot** bypass AgentOperating phase policy (server remains authoritative).
4. Ensure the UI **cannot** supply authority fields (ChangePlan, apply tokens, forged approvals,
   shell/cwd/env, etc.).
5. Ensure the UI **cannot** implicitly authorize Gate2, Git, or Browser.
6. Keep browser observation approval **explicit and distinct** when BROWSER tools are invoked.
7. Make tool evidence digests visible in live run UI and/or status/Explain surfaces.
8. Expose **no** raw tool payloads (stdout/stderr, HTML, HAR, secrets, ChangePlans, tokens).
9. Introduce **no** new tool execution engine.
10. Introduce **no** new capability class.

B9 implementation **MAY** reuse existing:

- `POST /api/workspace/agent/run/:runId/tool-turn`
- `AgentOperatingService.executeToolTurn` / `getToolEvidence`
- `HttpAgentWorkflow.toolTurn` (or equivalent thin client)
- existing GET run status `toolLoop` digests and Explain `toolLoop` section

B9 implementation **MUST NOT** require redesign of AgentLoop, ToolPolicyGate, B1–B7 tools, or
CorrectionLoop.

## Trust boundaries

| Boundary              | Authority                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| Operator UI           | Displays digests; submits authenticated structured intents; never authoritative for approvals      |
| HTTP tool-turn (B8)   | Authenticates; rejects forged authority; binds run/project                                         |
| AgentOperating        | AgentRun lifecycle authority; phase gates for tool turns; never invents Gate2/Git/Browser approval |
| AgentLoop             | Validate / authorize / execute / sanitize / budget / cancel / persist digests                      |
| ToolRegistry / Policy | Registration + per-invoke phase/authz (unchanged)                                                  |
| B1–B7 services        | Existing safe wrappers only                                                                        |
| Provider              | Remains `toolCalling: false`; **not** the B9 intent source                                         |

## Authorization model

Three distinct approvals remain authoritative:

```
Gate2 → approveAndApply → FileApply     = sole SOURCE FILE mutation
Git OPERATOR approval                   = VCS HISTORY mutation only (outside autonomous loop)
Browser OPERATOR approval               = LOCALHOST OBSERVATION only
```

Rules for the B9 UI surface:

- Gate2 approval **MUST NOT** authorize Git write or browser observation.
- Git `operatorApproved` **MUST NOT** authorize browser observation or Gate2 apply.
- `browserObservationApproved` **MUST NOT** authorize Gate2 apply or Git write.
- The UI **MUST NOT** send `approved`, `operatorApproved`, `applyAuthorizationToken`, `changePlan`,
  or equivalent authority fields on tool-turn requests.
- Browser observation, when required, **MUST** remain an explicit distinct operator signal (e.g.
  dedicated UI control mapped only to `browserObservationApproved`), never inferred from Gate2 or
  Git.
- Soft tools continue under existing server policy; UI cannot elevate privileges via prompt text or
  tool-result content (DATA, never POLICY).

## Phase / tool policy

Reuse ADR-042 / ADR-043 / ADR-044 allowlists unchanged. The UI **MUST NOT** widen them.

| Phase                   | Autonomous tool classes (MVP)                                                         |
| ----------------------- | ------------------------------------------------------------------------------------- |
| `UNDERSTANDING`         | SEARCH, READ, INSPECT (existing B6 policy)                                            |
| `PLANNING`              | SEARCH, READ, INSPECT, PLAN (existing B6 policy)                                      |
| `AWAITING_GATE2`        | SEARCH, READ, INSPECT, GIT_READ only — no proposal mutation toward automatic apply    |
| `EXECUTING`             | **No tools**                                                                          |
| `VERIFYING`             | VERIFY, INSPECT, GIT_READ, BROWSER (BROWSER still requires browser OPERATOR evidence) |
| `DIAGNOSING`            | SEARCH, READ, INSPECT, VERIFY, BROWSER                                                |
| `CORRECTING`            | SEARCH, READ, INSPECT, PLAN — **no** automatic apply                                  |
| `EXPLAINING` / terminal | **No** autonomous tool execution                                                      |

Hard bans unchanged: `GIT_WRITE` never in autonomous AgentLoop; no FileApply / approveAndApply /
generic shell / push / MCP / `WEB` tools.

## Budgets, serial execution, replay, cancellation, restart

Inherit ADR-042 / ADR-043 / ADR-044 without loosening:

- concurrency = 1 (serial)
- existing max tool calls / provider turns / repeats / wall-clock / B4 / B7 browser budgets
- `intentId` idempotent replay returns prior digests
- concurrent turns for the same run rejected
- cancellation aborts in-flight tool execution per existing support
- restart hydrates digests only; **never** auto-approve, auto-apply, auto-commit, auto-browser,
  or silently resume an in-flight tool turn

## Persistence / evidence

### Persist / project (bounded, safe)

- runId, projectId, phase, toolId, intentId, status, timestamps
- bounded summary digests already produced by AgentLoop
- optional budget counters already exposed by B8 status/Explain
- existing artifact references where already allowed

### Never persist or expose via B9 UI

- secrets, credentials, cookies, storageState, auth headers
- applyAuthorizationToken / Gate2 authority material
- ChangePlans / unifiedDiff as tool-turn payloads
- raw stdout / stderr / full HTML / HAR / unrestricted page bodies
- unrestricted screenshot binaries to the model or UI as authority
- raw provider payloads

## Failure / recovery

| Condition                                       | Behavior                                      |
| ----------------------------------------------- | --------------------------------------------- |
| Unauthenticated / unauthorized UI request       | Reject                                        |
| Cross-project runId                             | Reject (404 / NOT_FOUND semantics)            |
| Invalid phase / EXECUTING / terminal            | Reject; no execution                          |
| Malformed intents / forged authority fields     | Reject                                        |
| Missing browser OPERATOR evidence when required | Reject; no observation                        |
| Budget / wall-clock exhaustion                  | Stop further turns; require operator decision |
| Cancellation / timeout                          | Abort; cleanup; fail closed                   |
| Tool-assisted new proposal                      | Still requires fresh Gate2 before FileApply   |
| Process restart                                 | Digest hydrate only; no silent continuation   |

## Security requirements

- All tool-turn UI traffic **MUST** use existing trusted-local + workspace authorization patterns.
- Server determines authorization and execution context; UI cannot override phase or capability.
- Prompt injection / tool-result text **MUST** remain DATA and cannot elevate privileges.
- No raw tool output leakage in UI or Explain.
- No new public generic tool-execution endpoint beyond existing B8 tool-turn semantics.
- No credentials / OAuth / cookie persistence for browsing or tools.

## API / UI integration boundary

### Allowed

- AgentRun UI control(s) that call existing B8 `tool-turn` with operator-supplied structured intents.
- Explicit distinct control for `browserObservationApproved` when invoking BROWSER tools.
- Live projection of bounded digests from GET run status and/or Explain surfaces.
- Reuse of `HttpAgentWorkflow.toolTurn` (or equivalent) without widening the HTTP contract.

### Forbidden

- Client-minted Gate2 / Git / apply authority.
- Unauthenticated tool execution.
- Provider SDK toolCalling callbacks.
- UI “auto-continue” that skips Gate2 / Git / browser OPERATOR gates.
- New HTTP APIs that register MCP / WEB / shell / push / FileApply tools.
- Provider-driven autonomous multi-turn loops without operator tool-turn triggers (out of scope).

### Backward compatibility

- Existing agent routes (start / plan / approve / cancel / explain / tool-turn) remain valid.
- B9 is **additive** UI/product surface over B8; discrete P1-A lifecycle remains usable without
  tool turns.
- B1–B8 tool IDs and schemas remain stable.

## Test / Definition of Done (future implementation; not this ADR task)

B9 implementation is complete only when all are true:

1. This ADR is accepted and implementation is separately authorized.
2. Operator can invoke existing B8 tool-turn from AgentRun UI for a live AgentRun.
3. Requests remain authenticated and run/project/principal bound; cross-project rejected.
4. UI cannot bypass phase policy; EXECUTING and terminal phases reject tools.
5. UI cannot supply authority fields; forged fields rejected.
6. Browser approval remains explicit and distinct when required; Gate2/Git do not imply it.
7. Bounded digests visible in live UI and/or status/Explain; no raw payloads.
8. No new capability class; no second execution engine.
9. Providers remain `toolCalling: false`; no provider structured-intent emission in B9.
10. Gate2 → FileApply sole writer; `GIT_WRITE` outside autonomous loop; CorrectionLoop separate.
11. Budgets, serial concurrency, `intentId` replay, cancel, restart fail-closed preserved.
12. B1–B8 regression suite + full `npm run ci` green.

## Non-goals

Freeze for B9 (ADR-045):

- Provider-native `toolCalling`
- Provider autonomous tool execution / structured-intent emission (future ADR only)
- MCP / arbitrary MCP execution
- Open-web browsing / generic `WEB` / arbitrary HTTP
- Memory-agent architecture
- Parallel autonomous agents / background agents
- Unbounded auto-fix
- Auto Gate2 / auto FileApply / auto Git / auto browser approval
- Generic shell / Git push / autonomous Git write inside AgentLoop
- Credentials / OAuth / cookie persistence
- CorrectionLoop merge into unbounded AgentLoop
- New Tool Registry capability classes
- New Git AgentRun phases

## Rejected alternatives

| Option                                             | Status                                       |
| -------------------------------------------------- | -------------------------------------------- |
| Historical B9 memory / parallel-agent architecture | **Rejected** for this slice (ADR-044 freeze) |
| Provider structured-intent emission in B9          | **Deferred** (separate future ADR)           |
| Provider-native `toolCalling: true`                | **Rejected**                                 |
| MCP / open-web / unbounded auto-fix                | **Rejected**                                 |
| Deep CorrectionLoop↔AgentLoop merge                | **Rejected** for B9                          |
| Bounded operator tool-turn product surface         | **Proposed**                                 |

## Consequences

### Positive

- Operators can use already-shipped B8 tool turns from the product UI.
- Reuses frozen AgentLoop/HTTP contracts without expanding threat surface.
- Clarifies that product “B9” is UI surface, not memory/parallel/auto-fix.

### Negative / accepted limits

- Operators must supply structured intents (no provider intent emission in this ADR).
- Tool turns remain operator-triggered within budgets; not a background agent.
- Git write and browser observation still need distinct OPERATOR evidence.
- Correction still requires human Gate2 for every new FileApply.

## Migration and rollout

- Ship this ADR as **Proposed** first; implement UI wiring only after explicit implementation
  approval and (if required by process) ADR acceptance.
- Additive rollout: existing discrete agent routes and B8 tool-turn HTTP remain valid.
- Reversal: remove or disable UI tool-turn controls; B8 libraries and HTTP remain intact.

## Rollout and reversal

- Implementation may add AgentRun UI controls, digest projections, and thin client wiring only as
  required by this ADR.
- Reversal does not remove B1–B8 or the B8 tool-turn API; it only disconnects or hides the UI
  surface.
