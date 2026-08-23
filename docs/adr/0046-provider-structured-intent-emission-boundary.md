# ADR-046: Provider Structured-Intent Emission Boundary (toolCalling:false)

- **Status:** Accepted (implementation authorized for provider structured-intent emission only; `toolCalling:false`)
- **Date:** 2026-08-23
- **Owners:** BuilderAI architecture
- **Related:** ADR-011 (Safe File Apply), ADR-012 (Verification), ADR-036 (Gated Agent Operating
  Layer), ADR-037 (Tool Registry), ADR-038 (Codebase Intelligence), ADR-039 (File Editing),
  ADR-040 (Controlled Terminal), ADR-041 (Controlled Git Write), ADR-042 (Bounded Server-Owned
  Agent Tool Loop), ADR-043 (Controlled Local Browser Observation), ADR-044 (Bounded AgentLoop
  Product Integration), ADR-045 (Bounded Operator Tool-Turn Product Surface)
- **Baseline:** `5213b04d8faf91953c1fbd9ce8248008fac1c38d` (P1-B B9 frozen)

## Context

P1-B B1–B9 delivered a frozen stack:

- policy-gated Tool Registry (B1–B5 + B7),
- proposal-only editing,
- catalog verification,
- controlled local Git,
- localhost-only browser observation,
- server-owned bounded Agent Tool Loop (B6 / ADR-042),
- AgentOperating product integration + authenticated HTTP `tool-turn` (B8 / ADR-044),
- and operator UI invocation of that existing B8 surface with live digests (B9 / ADR-045),

while providers remain `toolCalling: false`. Gate 2 → `approveAndApply` → FileApply remains the sole
source-file mutation path. Git write and browser observation remain distinct OPERATOR approvals.
`GIT_WRITE` remains outside the autonomous AgentLoop. CorrectionLoop remains separate and still
requires a **fresh Gate2** before any new FileApply.

ADR-042 defined the hybrid model:

> Provider reasoning + server-owned execution state machine.

B6–B9 shipped the **server execution** half and an **operator-preset** intent entry path. The B10
architecture audit found that production still lacks a bounded adapter from **provider output** to
**schema-validated structured tool intents**. Operator UI presets and crafted HTTP intents remain
valid; providers do not yet propose intents in product runtime. ADR-045 explicitly deferred
provider structured-intent emission to a future separate ADR.

Historical “B10 memory / parallel-agent / MCP / open-web / unbounded auto-fix” language **MUST
NOT** expand this slice. Those remain rejected automatic next steps.

B1–B9 contracts are **frozen**. This ADR defines the architectural boundary for provider
structured-intent emission before any implementation. Acceptance of this ADR (when later
authorized) does **not** by itself authorize implementation.

## Decision

**P1-B next product slice = Provider Structured-Intent Emission Boundary (`toolCalling: false`).**

Adopt:

> Provider may PROPOSE only schema-validated structured tool intents; the server alone validates,
> authorizes, executes, sanitizes, budgets, cancels, and persists — without enabling
> provider-native toolCalling and without a second tool execution engine.

### Critical statements

1. **`toolCalling` MUST remain `false` for every provider adapter.**
2. **No provider SDK may execute BuilderAI tools.**
3. **Provider output is DATA, never POLICY or AUTHORITY.**
4. **Existing AgentLoop remains the sole autonomous tool executor.**
5. **No new Tool Registry capability class is required or permitted for this slice.**
6. **ADR-045 operator tool-turn remains a valid, separate explicit execution surface.**
7. **Historical memory / parallel agents / MCP / open-web / unbounded auto-fix remain rejected.**

### Architecture boundary

```
Provider output (toolCalling:false; DATA only)
  → structured-intent extraction / parsing
  → strict schema validation
  → authority-field rejection
  → AgentOperating phase / policy validation
  → existing AgentLoop / ToolPolicyGate / WorkspaceAuthorization
  → existing B1–B7 tools (unchanged contracts)
  → bounded sanitized evidence / digests
  → status / Explain / UI projection
```

Never:

- Provider SDK native toolCalling callbacks or provider-side tool execution
- Provider → filesystem / shell / FileApply / Git write / browser / network directly
- Provider → mint Gate2 / Git / Browser authority or apply tokens
- Provider → override projectId / runId / phase / principal / lifecycle
- A second AgentLoop or ToolPolicyGate implementation
- Background / parallel autonomous agents
- Unbounded automatic continuation after a provider-assisted turn

### Why this slice (and not historical “B10”)

- ADR-042 already selected Option C (structured intents + server execution); the emission adapter
  is the incomplete half.
- B9 closed operator usability of the B8 API; it deliberately deferred provider emission.
- Memory tools, parallel agents, MCP, and open-web expand blast radius without completing the
  hybrid model already designed.
- Enabling `toolCalling: true` would move execution authority toward the provider and is rejected.

### Why `toolCalling` stays false

- Structured intents may be obtained via structured output, constrained decoding, or post-parse of
  provider text — **not** via SDK tool/function-calling execution loops.
- Even if a future vendor API offers tool hooks, BuilderAI **MUST NOT** register provider-side
  tool executors; all execution remains server-owned through AgentLoop.

## B1–B9 freeze

Implementation of this slice (when separately authorized) **MUST NOT** weaken or redefine:

- ADR-037–041 tool IDs and safety predicates
- ADR-042 AgentLoop budgets, serial execution, intent idempotency, restart fail-closed, sanitizer
- ADR-043 localhost-only BROWSER observation and distinct `browserObservationApproved` evidence
- ADR-044 AgentOperating / HTTP tool-turn composition and product entry semantics
- ADR-045 operator UI tool-turn surface (presets remain valid; not replaced)
- Provider `toolCalling: false`
- Gate2 → `approveAndApply` → FileApply sole source-file mutation
- `GIT_WRITE` outside autonomous AgentLoop
- CorrectionLoop as a separate path requiring fresh Gate2 before FileApply
- Trusted-local / workspace authorization patterns

## Trust boundaries

| Boundary                      | Authority                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| Provider                      | May propose `{ toolId, intentId, arguments }` only; never executes; never authorizes   |
| Structured-intent adapter     | Extracts/parses; never elevates privileges; never invents approvals                    |
| Intent validator              | Schema + authority-field rejection (existing `parseProviderStructuredToolIntent` law)  |
| AgentOperating                | Lifecycle / phase gates; run/project binding; never invents Gate2/Git/Browser approval |
| AgentLoop                     | Validate / authorize / execute / sanitize / budget / cancel / persist digests          |
| ToolRegistry / ToolPolicyGate | Registration + per-invoke phase/authz (unchanged)                                      |
| B1–B7 services                | Existing safe wrappers only                                                            |
| Operator UI (ADR-045)         | Separate explicit surface; may still submit operator-preset intents                    |
| HTTP tool-turn (ADR-044)      | Remains authenticated product entry for structured intents                             |

### Three distinct approvals (unchanged)

```
Gate2 → approveAndApply → FileApply     = sole SOURCE FILE mutation
Git OPERATOR approval                   = VCS HISTORY mutation only (outside autonomous loop)
Browser OPERATOR approval               = LOCALHOST OBSERVATION only
```

**Model output can NEVER grant** Gate2, Git OPERATOR approval, Browser OPERATOR approval, FileApply
authority, project authority, or lifecycle authority.

Rules:

- Provider-proposed intents **MUST NOT** include or imply `approved`, `operatorApproved`,
  `browserObservationApproved`, `applyAuthorizationToken`, `changePlan`, repository roots, cwd/env
  authority, or forged project/run binding.
- Browser observation, when required, still requires **explicit distinct** operator/server evidence
  (`browserObservationApproved === true`); never inferred from provider text or Gate2/Git.
- Soft tools continue under existing server policy; provider content remains DATA.

## Structured intent contract

Provider-proposed intents **MUST** be of the form:

```json
{
  "toolId": "search_repository",
  "intentId": "…",
  "arguments": {}
}
```

Allowed fields: `toolId`, `intentId`, `arguments` (or legacy `args` only if already accepted by the
existing validator — no new authority aliases).

The server **MUST** reject:

| Rejection class              | Examples                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Malformed schema             | non-object, missing/empty `toolId` or `intentId`, invalid argument shape                                                     |
| Unknown tools                | unregistered `toolId`                                                                                                        |
| Forbidden tools              | `file_apply`, `approve_and_apply`, `approveAndApply`, `run_shell`, `git_push`, `push`, `mcp_*`, `open_web`, `http_fetch`     |
| Forbidden capability classes | `WEB`; any new class not already in B1–B9                                                                                    |
| Authority fields             | `approved`, `operatorApproved`, `browserObservationApproved`, `applyAuthorizationToken`, `changePlan`, Gate2 review payloads |
| Binding / lifecycle forgery  | model-supplied `projectId`, `runId`, `phase`, principal, repository roots                                                    |
| Shell / env authority        | `cwd`, `env`, unrestricted command surfaces                                                                                  |
| Arbitrary URLs               | absolute URLs / external origins where B7 policy forbids them                                                                |
| Credentials                  | cookies, `storageState`, auth headers, API keys, secrets                                                                     |

Existing `parseProviderStructuredToolIntent` / AgentLoop / ToolPolicyGate laws remain authoritative;
this ADR does not invent a parallel validator that weakens them.

## Execution model

1. **Explicit trigger only.** A provider-assisted turn **MUST** be operator- or product-triggered
   (explicit API/UI action). No mount-time, poll-time, or background autonomous emission loop.
2. **Adapter proposes; AgentLoop executes.** Extracted intents feed the **existing**
   `AgentOperatingService.executeToolTurn` / AgentLoop `executeIntent` / `executeProviderTurn`
   path only.
3. **No second execution engine.** Browser/client and provider SDKs never execute tools.
4. **Budgets unchanged.** Reuse ADR-042 / ADR-043 defaults (tool calls, provider turns, identical
   repeats, wall-clock, B4 verification, B7 browser observation, concurrency = 1).
5. **Serial execution mandatory.** Concurrent tool execution for the same run remains rejected.
6. **`intentId` idempotency mandatory.** Replay returns prior digests; does not re-execute.
7. **Cancellation** remains fail-closed per existing support.
8. **Restart** remains hydrate-only: digests load; **never** auto-continue, auto-approve,
   auto-apply, auto-commit, or auto-browser-launch.
9. **No unbounded continuation.** One explicit provider-assisted turn (or explicitly bounded
   provider-turn batch under existing `maxProviderTurnsPerRun`) stops; further turns require a new
   explicit trigger.
10. **ADR-045 UI remains valid.** Operator presets are not removed; they are not the only entry
    once this slice is implemented, but they stay a first-class explicit surface.

## Phase / tool policy

Reuse existing B1–B9 AgentLoop / tool `allowedPhases` unchanged. This ADR **MUST NOT** widen them.

| Phase                   | Autonomous tool classes (existing)                                                 |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `UNDERSTANDING`         | SEARCH, READ, INSPECT                                                              |
| `PLANNING`              | SEARCH, READ, INSPECT, PLAN                                                        |
| `AWAITING_GATE2`        | SEARCH, READ, INSPECT, GIT_READ only — no automatic apply                          |
| `EXECUTING`             | **No tools**                                                                       |
| `VERIFYING`             | VERIFY, INSPECT, GIT_READ, BROWSER (BROWSER still needs browser OPERATOR evidence) |
| `DIAGNOSING`            | SEARCH, READ, INSPECT, VERIFY, BROWSER                                             |
| `CORRECTING`            | SEARCH, READ, INSPECT, PLAN — **no** automatic apply                               |
| `EXPLAINING` / terminal | **No** autonomous tool execution                                                   |

Hard bans unchanged: `GIT_WRITE` never in autonomous AgentLoop; no FileApply / approveAndApply /
generic shell / push / MCP / `WEB` tools. **No new AgentRun phases. No lifecycle bypass.**

## Persistence / evidence

### Persist / project (bounded, safe)

- runId, projectId, phase, toolId, intentId, status, timestamps
- bounded summary digests already produced by AgentLoop
- optional budget counters already exposed by B8 status/Explain
- existing artifact references where already allowed

### Never persist or expose via this slice

- raw provider payloads / transcripts as authority
- secrets, credentials, cookies, storageState, auth headers
- applyAuthorizationToken / Gate2 authority material
- ChangePlans / unifiedDiff as tool-turn payloads
- raw stdout / stderr / full HTML / HAR / unrestricted page bodies
- unrestricted screenshot binaries to the model or UI as authority

## Failure / recovery

| Condition                                       | Behavior                                                 |
| ----------------------------------------------- | -------------------------------------------------------- |
| Unauthenticated / unauthorized request          | Reject                                                   |
| Cross-project runId                             | Reject (404 / NOT_FOUND semantics)                       |
| Malformed / authority-bearing provider output   | Reject; no execution                                     |
| Unknown / forbidden tool                        | Reject                                                   |
| Invalid phase / EXECUTING / terminal            | Reject; no execution                                     |
| Missing browser OPERATOR evidence when required | Reject; no observation                                   |
| Budget / wall-clock exhaustion                  | Stop further turns; require explicit operator decision   |
| Cancellation / timeout                          | Abort; cleanup; fail closed                              |
| Tool-assisted new proposal                      | Still requires fresh Gate2 before FileApply              |
| Process restart                                 | Digest hydrate only; no silent continuation              |
| Prompt injection attempting elevation           | Treated as DATA; cannot grant approvals or bypass policy |

## Security requirements

- All provider-assisted traffic **MUST** use existing trusted-local + workspace authorization.
- Server determines authorization and execution context; provider cannot override phase, capability,
  project, or principal.
- Prompt injection **MUST NOT** elevate authority; tool results and provider text remain DATA.
- Cross-project binding remains server-owned.
- Sanitizer and digest-only persistence remain mandatory.
- No raw provider payload persistence as an authority channel.

## Compatibility

- **MUST** preserve ADR-037 through ADR-045.
- **MUST** keep ADR-045 operator tool-turn as a valid explicit surface.
- **MUST NOT** introduce a second tool execution path.
- **MAY** reuse existing:
  - `parseProviderStructuredToolIntent`
  - `AgentOperatingService.executeToolTurn` / `getToolEvidence`
  - `POST /api/workspace/agent/run/:runId/tool-turn`
  - `HttpAgentWorkflow.toolTurn`
  - AgentLoop budgets / persistence / sanitizer
- **MUST NOT** require redesign of AgentLoop, ToolPolicyGate, B1–B7 tools, Gate2/FileApply,
  CorrectionLoop, or B5 Git — except minimal adapter wiring if separately authorized.

## Alternatives considered

| Alternative                                          | Outcome                                      |
| ---------------------------------------------------- | -------------------------------------------- |
| Provider-native SDK `toolCalling: true`              | **Rejected**                                 |
| Unbounded auto-continue after provider intents       | **Rejected**                                 |
| Background / parallel autonomous agents              | **Rejected**                                 |
| MCP / open-web / WEB / arbitrary HTTP                | **Rejected**                                 |
| Historical memory-agent architecture as this slice   | **Rejected**                                 |
| Merge CorrectionLoop into AgentLoop                  | **Rejected** (ADR-045 freeze)                |
| Replace ADR-045 operator UI with provider-only entry | **Rejected** — both surfaces may coexist     |
| Expand UI presets only (no provider emission)        | Valid micro-step; **does not** close ADR-042 |
| Freeze/harden only                                   | Valid companion gate; **not** this boundary  |

## Test / Definition of Done (future implementation; not this ADR task)

Implementation (when separately authorized) **MUST** prove at least:

1. Structured intent schema validation for provider-produced intents.
2. Malformed provider output rejected without execution.
3. Authority-field rejection (Gate2 / Git / browser / apply tokens / binding / shell authority).
4. Forbidden tool rejection (FileApply, approveAndApply, shell, push, MCP, WEB).
5. `toolCalling: false` invariant unchanged on OpenAI / Gemini / OpenRouter (or equivalent).
6. Phase enforcement; EXECUTING and terminal phases reject tools.
7. Gate2 / Git / Browser approval isolation — model output never grants them.
8. Cross-project rejection.
9. `intentId` replay idempotency.
10. Existing budgets / serial concurrency / cancellation preserved.
11. Restart hydrate-only (no silent continue / approve / apply / commit / browser-launch).
12. Prompt-injection / data-only handling (no policy elevation).
13. ADR-045 operator tool-turn regression green.
14. B1–B9 regression suite green.
15. Full `npm run ci` green (format, lint, typecheck, coverage, audit, build).

### Definition of Done

1. ADR-046 **Accepted** before implementation begins.
2. Provider structured-intent emission remains `toolCalling: false`.
3. Server validates every provider-produced intent.
4. AgentLoop remains the sole execution path.
5. No new capability class.
6. All B1–B9 invariants preserved.
7. Full CI green after implementation.
8. **Separate explicit authorization** required before implementation (accepting this draft is not
   enough).

## Non-goals

- Provider-native `toolCalling: true`
- MCP
- open-web / WEB / arbitrary HTTP
- Generic shell
- Autonomous Git write / push
- FileApply or approveAndApply as tools
- Automatic Gate2 / Git / browser approval
- Unbounded auto-fix
- Background / parallel agents
- Memory-agent architecture
- CorrectionLoop merge into AgentLoop
- Historical unsafe “B10” interpretation
- New AgentRun phases
- New Tool Registry capability classes
- Weakening of ADR-037–045 contracts

## Consequences

### Positive

- Completes the ADR-042 hybrid model without enabling SDK toolCalling.
- Increases product usefulness beyond operator presets while keeping server execution authority.
- Reuses B6–B9 validators, budgets, HTTP surface, and digests.

### Negative / costs

- Introduces a prompt-injection / proposal surface that **MUST** be tested and fail-closed.
- Requires careful product UX so provider-assisted turns stay explicitly triggered.
- Does not by itself deliver memory, parallel agents, or open-web (and must not be used as cover
  for those).

### Neutral

- ADR-045 operator presets remain; operators may still choose manual tools.
- CorrectionLoop, Gate2, and Git/browser approvals remain unchanged product rituals.

## Implementation authorization

Drafting or even **Accepting** this ADR does **not** authorize implementation.

Implementation requires a **separate explicit user authorization** that names this ADR and the
frozen baseline commit. Until then: no application code, no tests as implementation work, no
commit of product changes under this ADR’s authority.
