# ADR-049: Governed Baseline Engineering Verification Probe (P1-D Slice 1)

- **Status:** Accepted
- **Date:** 2026-08-29
- **Owners:** BuilderAI architecture
- **Related:** ADR-012 (Verification Pipeline), ADR-036 (Gated Agent Operating Layer),
  ADR-040 (Controlled Terminal Boundary), ADR-042 (Bounded Server-Owned Agent Tool Loop),
  ADR-044 (Bounded AgentLoop Product Integration Boundary), ADR-045 (Bounded Operator Tool-Turn
  Product Surface), ADR-046 (Provider Structured-Intent Emission Boundary), ADR-047 (Bounded
  Operator Tool Planning Projection), ADR-048 (Bounded Gate2 Planning Provenance Review)
- **Baseline:** `4f3d08a85abc841678c53a8e1cb7d27478ed057a` (P1-C closure benchmark — governed operator
  workflow complete)

## Context

P0, P1-A, P1-B B1–B10, D+B provider-assisted reliability/observability, A+D operational closure,
and P1-C (Slices 1–3 plus closure benchmark) are complete and frozen at baseline `4f3d08a`.

P1-C closed the governed operator-assisted lifecycle:

```
startRun
  → UNDERSTANDING
  → operator B1/B2 investigation
  → bounded evidence + planningProjection (ADR-047)
  → plan()
  → P0 + operator deterministic merge
  → Gate2 planning provenance (ADR-048)
  → AWAITING_GATE2
  → explicit approval
  → EXECUTING (tool-free)
  → FileApply
  → VERIFYING
  → successful completion / EXPLAINING
```

P1-B B4 (ADR-040) already exposes catalog-only verification commands via
`run_verification_command` and `inspect_verification_catalog`, routed through
`ControlledTerminalService` → `SafeVerificationRunner`. B4 is production-implemented with existing
budgets, timeouts, output caps, sanitizer rules, and `PREPARE` authorization.

The P1-D Slice 1 architecture/readiness audit identified a **phase-policy gap**: operators cannot
run baseline build/test/lint probes during `UNDERSTANDING` before the first `plan()`. Catalog
listing (`inspect_verification_catalog`) already works in `UNDERSTANDING`; execution
(`run_verification_command`) is blocked by dual policy:

| Layer                                              | Current behavior                                                             |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| `AUTONOMOUS_LOOP_PHASE_CAPABILITIES.UNDERSTANDING` | `SEARCH`, `READ`, `INSPECT` only — **no `VERIFY`**                           |
| `run_verification_command.allowedPhases`           | `PLANNING`, `VERIFYING`, `DIAGNOSING`, `CORRECTING` — **no `UNDERSTANDING`** |

Additionally, `run_verification_command` declares `PLANNING`, but AgentLoop denies `VERIFY` during
`PLANNING` (`PHASE_CAPABILITY_DENIED`). That entry is **dead policy** and MUST be removed in Slice 1
implementation.

This gap prevents the smallest realistic engineering workflow on an existing codebase:

```
inspect workspace
  → baseline verification probe
  → investigate
  → plan
  → Gate2
  → explicit approval
  → FileApply
  → post-apply verification
  → COMPLETED
```

Crossing the **UNDERSTANDING verification execution** boundary requires an explicit architectural
decision. ADR-040 authorized B4 tools but did not extend `VERIFY` to `UNDERSTANDING`. ADR-042
explicitly excludes `VERIFY` from `UNDERSTANDING`. ADR-047 and ADR-048 are insufficient — they
govern planning projection and Gate2 provenance display, not baseline engineering probes.

## Problem

After P1-C, an operator can investigate with B1/B2 tools and list the verification catalog in
`UNDERSTANDING`, but **cannot execute** a bounded baseline build/test/lint probe before planning.
The agent must plan without knowing current engineering health, or wait until post-apply failure
reaches `DIAGNOSING` (where `VERIFY` is already permitted).

This problem **MUST NOT** be solved by:

- feeding verification evidence into `prepare()`, ChangePlanner, or P1-C operator planning merge,
- accepting client-supplied verification authority or diagnostics as planning input,
- exposing raw stdout/stderr or unbounded command output to models or clients,
- enabling provider-native tool calling,
- introducing a second verification subsystem or new catalog command IDs,
- weakening EXECUTING tool-free semantics,
- changing Gate2 approval semantics, FileApply, ChangePlanner, or P1-C merge/provenance,
- autonomous multi-cycle build/fix without operator Gate2 at each mutation.

## Decision drivers

- Close the pre-plan baseline engineering visibility gap using **existing B4 infrastructure only**.
- Preserve Gate2 → `approveAndApply` → FileApply as the sole authoritative source-file mutation path.
- Keep baseline verification evidence **observable only** — never planning authority.
- Preserve EXECUTING as tool-free.
- Preserve provider `toolCalling: false` and server-orchestrated operator tool turns.
- Reuse existing B4 budgets, sanitizer, PREPARE authorization, and ADR-040 residual-risk posture.
- Fail closed: verification probes do not bypass Gate2, FileApply, or approval state.
- Maintain full P1-C freeze — no changes to ADR-047/048 production artifacts.

## Decision

**P1-D Slice 1 = Governed Baseline Engineering Verification Probe.**

BuilderAI **WILL** authorize bounded, catalog-only `VERIFY` capability during `UNDERSTANDING` so
operators can assess existing project engineering health **before** the first `plan()`, using the
already-existing B4 verification infrastructure.

### Intended workflow (authorized)

```
UNDERSTANDING
  → inspect workspace (existing B1/B2)
  → baseline verification probe (new phase authorization; B4 reuse)
  → investigate (existing B1/B2)
  → plan() (unchanged P1-C path)
  → AWAITING_GATE2 (unchanged)
  → explicit approval (unchanged)
  → EXECUTING (tool-free; unchanged)
  → FileApply (unchanged)
  → VERIFYING / post-apply verification (unchanged)
  → COMPLETED
```

Baseline verification during `UNDERSTANDING` is **OBSERVABLE EVIDENCE ONLY**. It is **NOT** planning
authority.

---

## Authorized changes (P1-D Slice 1 implementation only)

Acceptance of this ADR **authorizes P1-D Slice 1 implementation only**. It does **not** authorize
P1-D Slice 2+, provider tool calling, or any item listed under Non-goals.

### 1. AgentLoop phase policy

Add `VERIFY` to `AUTONOMOUS_LOOP_PHASE_CAPABILITIES.UNDERSTANDING`:

```typescript
UNDERSTANDING: ['SEARCH', 'READ', 'INSPECT', 'VERIFY'],
```

**MUST NOT** add `VERIFY` to `EXECUTING`. `EXECUTING` remains `null` (tool-free).

**MUST NOT** add `VERIFY` to `PLANNING`. `PLANNING` remains
`['SEARCH', 'READ', 'INSPECT', 'PLAN']`.

All other phase capability entries remain unchanged unless explicitly listed here.

### 2. Tool phase policy — `run_verification_command`

Align `run_verification_command.allowedPhases` with effective AgentLoop policy:

```
UNDERSTANDING
VERIFYING
DIAGNOSING
CORRECTING
```

**Remove** the dead `PLANNING` entry. AgentLoop denies `VERIFY` in `PLANNING`; the tool definition
MUST NOT declare a phase the loop rejects.

`inspect_verification_catalog` requires **no** phase-policy change — it is already permitted in
`UNDERSTANDING` as `INSPECT`.

### 3. Existing B4 infrastructure reuse (no new subsystem)

Slice 1 **MUST** reuse without redefinition:

| Component                      | Reuse                                            |
| ------------------------------ | ------------------------------------------------ |
| `run_verification_command`     | Existing tool handler                            |
| `inspect_verification_catalog` | Existing tool handler                            |
| `ControlledTerminalService`    | Existing catalog → descriptor mapping            |
| `SafeVerificationRunner`       | Existing npm-only executor                       |
| Verification command catalog   | Existing six command IDs (ADR-040)               |
| B4 per-run budget              | `maxB4VerificationCallsPerRun` (default 6)       |
| Tool timeout                   | 120_000 ms (registry maximum)                    |
| Output limits                  | Existing ControlledTerminal / runner bounds      |
| Sanitizer                      | `sanitizeToolStructured`, forbidden keys         |
| Authorization                  | `PREPARE` via `ToolPolicyGate`                   |
| Path/cwd confinement           | `assertProjectRootConfinement`, project-root cwd |

No new verification subsystem, command IDs, or spawn engine.

### 4. Baseline verification semantics

Verification executed during `UNDERSTANDING`:

- is initiated by explicit operator tool turn (existing `POST …/tool-turn` path),
- runs through existing AgentLoop → ToolPolicyGate → B4 stack,
- produces bounded digest-oriented evidence (existing `BoundedToolEvidenceRecord`),
- informs operator review only,
- **MUST NOT** alter run phase, approval state, or mutation paths.

---

## Critical authority boundary

Baseline verification evidence **MUST NOT** feed:

| Consumer                                                     | Status        |
| ------------------------------------------------------------ | ------------- |
| `prepare()`                                                  | **Forbidden** |
| `ChangePlannerService`                                       | **Forbidden** |
| P0 `InvestigationHandoffFeedback`                            | **Forbidden** |
| `planningProjection` / `OperatorToolPlanningProjection`      | **Forbidden** |
| `buildOperatorToolPlanningContext()`                         | **Forbidden** |
| `mergeOperatorToolPlanningWithHandoff()`                     | **Forbidden** |
| Gate2 authority / `Gate2ReviewProjection` approval semantics | **Forbidden** |
| FileApply authorization / apply tokens                       | **Forbidden** |
| Approval state (`operatorApproved`, Gate2 cycles)            | **Forbidden** |
| Provider authority / structured-intent authority fields      | **Forbidden** |

Verification evidence is **informational / display-only** for this slice.

`extractOperatorToolPlanningProjection()` (ADR-047) **MUST** remain scoped to B1/B2 tool IDs only.
B4 verification tools **MUST NOT** produce `planningProjection`.

Any future **verification → planning authority** boundary (e.g., bounded diagnostic projection
into prepare context) requires a **separate ADR** and explicit user approval. ADR-049 does not
authorize it.

---

## EXECUTING boundary

**EXECUTING = tool-free.** This ADR preserves and MUST NOT weaken:

| Layer                                          | Protection                                 |
| ---------------------------------------------- | ------------------------------------------ |
| `AUTONOMOUS_LOOP_PHASE_CAPABILITIES.EXECUTING` | `null` → all tools forbidden               |
| `AgentOperatingService.executeToolTurn()`      | Rejects `EXECUTING` before loop invocation |
| AgentRunPanel                                  | Hides tool-turn controls in `EXECUTING`    |

No `VERIFY` capability may be added to `EXECUTING`.

---

## Existing B4 security boundaries (preserved)

Slice 1 **MUST** preserve all ADR-040 / B4 security boundaries:

- Catalog-only commands — no free-form shell, argv, cwd, env, or script fields in tool arguments
- No `npm install`, `npm ci`, or `npm update`
- Existing timeout and output caps
- Existing B4 per-run budget (`maxB4VerificationCallsPerRun`)
- Existing sanitizer — no raw `stdout`, `stderr`, or forbidden keys in tool/evidence payloads
- Existing `PREPARE` authorization via `ToolPolicyGate`
- Existing filesystem / project-root confinement
- No FileApply, Gate2 bypass, or APPLY authorization on B4 tools

**Accepted residual risk (unchanged from ADR-040):**

- Allowlisted npm **script bodies** are not sandboxed; only script **names** and fixed argv are
  controlled. Process side effects (e.g., `dist/` from `build`) are privileged evidence I/O, not
  ChangePlan application.
- `networkPolicy: 'disabled-unsupported'` — declared, not OS-enforced.
- Scripts may read secrets from disk; child environment remains allowlisted minimal.

---

## Provider boundary

Provider adapters **MUST** remain at `toolCalling: false`.

P1-D Slice 1 uses the existing **server-orchestrated operator tool-turn** architecture (ADR-044,
ADR-045). Provider-native autonomous tool calling is **not** authorized.

Provider structured-intent emission (ADR-046) may continue to propose B1/B2 tools in
`UNDERSTANDING`; extending B10 prompts to propose B4 verification in `UNDERSTANDING` is
**optional** and **not required** for Slice 1 MVP. Operator presets remain the primary entry path.

---

## UI boundary (authorized for implementation)

Slice 1 implementation **MAY** add additive AgentRunPanel presets during `UNDERSTANDING` for:

- `inspect_verification_catalog` (list available catalog entries)
- `run_verification_command` (bounded catalog command execution)

UI presets are **operator-requested** and **non-authoritative**. The client **MUST NOT** supply
verification authority, diagnostics as planning input, or bypass server phase policy.

If bounded diagnostic information (e.g., truncated `diagnosticSummary`) is surfaced in HTTP/UI
evidence views, it **MUST** remain **display-only** and **MUST NOT** become client or provider
authority.

---

## Evidence boundary

Verification results **MUST** remain bounded:

- Persisted evidence: existing `BoundedToolEvidenceRecord` schema (digest-oriented)
- No raw stdout, stderr, arbitrary command output, tokens, or unrestricted logs in persisted or
  HTTP-facing payloads
- Sanitizer forbidden-key rules unchanged
- No new evidence schema or durable cross-run store

Optional future display of bounded `diagnosticSummary` in HTTP evidence views is display-only and
does not expand planning or Gate2 authority.

---

## HTTP / API boundary

Slice 1 **MUST NOT** require a new API route. Reuse:

- `POST /api/workspace/agent/run/:runId/tool-turn` — operator intents
- Existing request shape: `{ intents: [{ toolId, intentId, arguments }] }`
- Existing rejection of client authority fields

No new persistence model.

---

## Required implementation sequence (after ADR acceptance)

Implementation **MUST NOT** begin until explicit authorization is provided. When authorized, follow
this sequence:

1. Phase policy update — add `VERIFY` to `UNDERSTANDING` in `AUTONOMOUS_LOOP_PHASE_CAPABILITIES`
2. Tool allowed-phase alignment — update `run_verification_command.allowedPhases`; remove dead
   `PLANNING`
3. Phase-policy unit tests — VERIFY allowed in `UNDERSTANDING`; VERIFY denied in `EXECUTING`
4. P1-D baseline verification composition benchmark (see below)
5. AgentRunPanel `UNDERSTANDING` presets (catalog + run verify)
6. Runbook update — `docs/agent-tool-turn-operator-runbook.md`
7. Optional bounded diagnostic display in HTTP/UI evidence (display-only)
8. Full `npm run ci`

---

## Required composition benchmark

Slice 1 implementation **MUST** include a composition benchmark proving:

```
startRun
  → UNDERSTANDING
  → baseline verification (run_verification_command)
  → investigation (B1/B2 operator tool turn)
  → plan()
  → AWAITING_GATE2
  → explicit approval ({ approved: true })
  → FileApply
  → post-apply verification
  → COMPLETED
```

**Required assertions:**

- `FileApply.calls === 0` at every checkpoint **before** explicit Gate2 approval
- Baseline verification occurs in `UNDERSTANDING` before `plan()`
- B4 evidence does **not** produce `planningProjection`
- Final verification status `PASSED` (or equivalent harness expectation)
- Phase sequence includes `AWAITING_GATE2` and tool-free `EXECUTING` path through approval

Benchmark may reuse existing composition harness patterns (P1-C closure benchmark). Real-target
fixture probing (e.g., zyro-style project) is recommended but not mandatory for Slice 1 MVP.

---

## Regression requirements

Future implementation **MUST** keep:

- [ ] All P1-C benchmarks green (`p1c-investigate-before-plan`, `p1c-context-to-plan-quality`,
      `p1c-closure-v1`)
- [ ] P1-C closure benchmark green
- [ ] B4 composition tests green
- [ ] Provider `toolCalling: false` (existing smoke/composition tests)
- [ ] EXECUTING tool-free (existing service + phase-policy tests)
- [ ] Branch coverage ≥ 80%
- [ ] `npm run ci` exit code 0

---

## Explicit non-goals

ADR-049 **does not** authorize:

- Provider-native tool calling (`toolCalling: true`)
- MCP integration
- Open-web / arbitrary HTTP tools
- Browser automation or DOM automation
- Autonomous Git push
- Verification → planning authority
- Verification → Gate2 authority
- Correction-path operator merge (ADR-047/048 deferred non-goal)
- Patch-level mutation or new mutation paths
- Autonomous multi-cycle build/fix without operator Gate2 at each mutation
- New verification command IDs or catalog expansion
- New persistence model or cross-run memory
- Client-supplied verification authority or diagnostics as planning input
- FileApply semantic or implementation changes
- ChangePlanner semantic or implementation changes
- Gate2 semantic or approval changes
- P1-C planning merge changes (`operator-tool-planning-context`, `operator-tool-planning-merge`)
- P1-C planning provenance changes (`gate2-planning-provenance.*`)
- Changes to `planningProjection` extraction scope (B1/B2 only)
- Reopening ADR-047 or ADR-048

---

## Definition of Done (implementation)

Slice 1 implementation is complete when:

- [ ] `VERIFY` permitted in `UNDERSTANDING`; denied in `EXECUTING`
- [ ] `run_verification_command.allowedPhases` aligned; dead `PLANNING` removed
- [ ] Composition benchmark proves baseline verify → investigate → plan → Gate2 → approve → apply →
      verify → COMPLETED with zero FileApply before approval
- [ ] B4 evidence does not produce `planningProjection`
- [ ] AgentRunPanel `UNDERSTANDING` presets for catalog + run verify (if UI slice included)
- [ ] Runbook updated
- [ ] No Gate2 / FileApply / ChangePlanner / P1-C merge / P1-C provenance changes
- [ ] Full `npm run ci` green; branch coverage ≥ 80%

---

## Consequences

### Positive

- Operators can assess baseline build/test/lint health before first Gate2 plan on existing projects.
- Reuses 100% of hardened B4 infrastructure — no second verification stack.
- Closes pre-plan engineering visibility gap without weakening mutation or approval boundaries.
- P1-C remains fully frozen.

### Negative

- Additional phase-policy surface area and composition tests.
- B4 budget consumption during investigation (max 6 calls/run).
- npm script body side effects remain an accepted residual risk (ADR-040).
- Diagnostic detail may require optional HTTP display work for full operator UX.

### Neutral

- Post-apply verification pipeline unchanged.
- Gate2 approval semantics unchanged.
- FileApply and ChangePlanner unchanged.
- P1-C operator planning projection and Gate2 provenance unchanged.

---

## Relationship to related ADRs

| ADR     | How ADR-049 extends without weakening                                                |
| ------- | ------------------------------------------------------------------------------------ |
| **036** | Adds read-only probe before plan; does not bypass Gate2 or auto-apply                |
| **040** | Extends B4 phase reach to UNDERSTANDING; does not expand catalog or weaken sanitizer |
| **042** | Extends phase capability map only; preserves EXECUTING tool-free and budgets         |
| **044** | Reuses existing tool-turn HTTP path; no new AgentLoop authority                      |
| **045** | May add UI presets; UI remains non-authoritative                                     |
| **046** | Provider remains DATA-only; no toolCalling change                                    |
| **047** | Baseline verify is not planning projection; B1/B2 merge boundary unchanged           |
| **048** | Gate2 provenance unchanged; verify evidence is not provenance input                  |

---

## Rollout and reversal

- Ship ADR-049, then implement Slice 1 per sequence above after explicit authorization.
- Reversal: remove `VERIFY` from `UNDERSTANDING` in phase map; restore prior
  `run_verification_command.allowedPhases`; remove UI presets and benchmark. B4 infrastructure
  remains intact.

---

**ADR-049 is Accepted and authorizes P1-D Slice 1 implementation only.**
