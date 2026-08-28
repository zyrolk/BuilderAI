# P1-B B1–B10 Production Freeze

- **Status:** Frozen for production hardening
- **Current HEAD (ops baseline):** `76d12de5a41246ae36ebc86077084eac3cf60081`
- **Current HEAD commit:** `P1-B: Add provider-assisted turn reliability and observability`
- **Feature-complete B10 tip:** `efd4a7bedec1155bd1b3d7aac4258e1ba3a57960`
  (`P1-B: Add Provider Structured-Intent Emission Boundary`)
- **Windows npm spawn EINVAL fix:** `326507d4a840de9f0a9087a2dd5351cfcae15c1d`
  (`P1-B: Fix Windows npm process resolution`)
- **ADRs frozen:** ADR-037 through ADR-046
- **Implementations frozen:** B1 through B10 + D+B observability (within ADR-046)
- **Date:** 2026-08-28 (Option A+D ops closure on baseline `76d12de`)

## Ancestry (frozen baseline chain)

```
efd4a7b  B10 provider structured-intent emission
   ↓
326507d  Windows npm process resolution (spawn EINVAL fix)
   ↓
16c9790  Freeze documentation
   ↓
7a3d16b  Ops closure (hardening smoke + doc sync)
   ↓
76d12de  D+B provider-assisted reliability + observability
```

The frozen product baseline is B1–B10 / ADR-037–046 plus digest-only D+B extensions at `76d12de`.
Further slices that expand autonomy, network threat surface, or mutation authority require a
**new ADR** and **separate explicit authorization**.

## Freeze statement

P1-B B1–B10 is a **closed hybrid stack**. This freeze does **not** authorize ADR-047, memory
agents, parallel/background agents, MCP, open-web/WEB, unbounded auto-continue, or provider-native
`toolCalling: true`.

## Invariants (must not weaken)

1. Providers remain `toolCalling: false` (OpenAI / Gemini / OpenRouter).
2. Provider may **propose** structured intents only; server alone executes tools.
3. Sole tool executor: `AgentOperating` → `AgentLoop` → ToolRegistry / ToolPolicyGate.
4. Sole source-file mutation: Gate2 → `approveAndApply` → FileApply.
5. `GIT_WRITE` remains outside the autonomous AgentLoop.
6. Browser observation requires distinct `browserObservationApproved` (≠ Gate2, ≠ Git).
7. `EXECUTING` is completely tool-free.
8. Serial tool execution; budgets; `intentId` idempotency; concurrency rejection; cancel fail-closed.
9. Restart is **hydrate-only** (digests); never silent continue / approve / apply / commit / browser-launch.
10. No FileApply / approveAndApply / shell / push / MCP / WEB tools in AgentLoop.
11. No second tool execution engine; UI is an untrusted HTTP client.
12. CorrectionLoop remains separate and still requires a **fresh Gate2** before FileApply.

## Product surfaces (frozen)

| Surface               | Path / entry                                     | Role                                           |
| --------------------- | ------------------------------------------------ | ---------------------------------------------- |
| B8 operator tool-turn | `POST /api/workspace/agent/run/:runId/tool-turn` | Operator-supplied structured intents           |
| B9 operator UI        | AgentRunPanel → `HttpAgentWorkflow.toolTurn`     | Explicit presets only                          |
| B10 provider-assisted | `POST …/provider-tool-turn` + UI button          | Provider proposes; server validates + executes |
| Gate2 apply           | existing approve path                            | Sole mutation                                  |

## Governed workflow benchmark (Option D)

Repeatable composition benchmark (no second engine):

- **Test:** `src/application/workspace/agent-operating/p1b-governed-workflow-benchmark.composition.test.ts`
- **Benchmark ID:** `p1b-governed-workflow-v1`
- **Happy path:** UNDERSTANDING → PLANNING → AWAITING_GATE2 → VERIFYING → COMPLETED (1 Gate2 cycle, 1 FileApply)
- **Correction path:** verify fail → CORRECTING → fresh AWAITING_GATE2 → re-apply → COMPLETED (2 Gate2 cycles, 2 FileApply)
- **Reuses:** `createAgentCompositionHarness` (P1-A Step 6 infrastructure)

Run: `npx vitest run src/application/workspace/agent-operating/p1b-governed-workflow-benchmark.composition.test.ts`

## Hardening checklist (operators / release)

Recorded **2026-08-28** on baseline `76d12de`. Live trusted-local UI sessions require a running
Next.js workspace; items marked **NOT RUN (live)** use automated composition/route regression instead.

| Item                                   | Result                     | Evidence                                                                                         |
| -------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------ |
| `npm run ci` green on `76d12de`        | **PASS** (post Option A+D) | Full CI exit 0 after implementation                                                              |
| Operator tool-turn smoke               | **PASS (automated)**       | `b8-agentloop-product.composition.test.ts`, `b8-tool-turn.route.test.ts`                         |
| Provider-assisted tool-turn            | **PASS (automated)**       | `b10-provider-structured-intent.composition.test.ts`, `b10-provider-tool-turn.route.test.ts`     |
| Cross-project runId → 404              | **PASS (automated)**       | B8/B10 route tests                                                                               |
| EXECUTING rejects tool-turn paths      | **PASS (automated)**       | `b8-agentloop-product.composition.test.ts`, `b10-provider-structured-intent.composition.test.ts` |
| Authority forgery rejected             | **PASS (automated)**       | `p1b-b1-b10-production-hardening.smoke.test.ts`, B8/B10 route helpers                            |
| Cancel / restart hydrate-only          | **PASS (automated)**       | `p1a-step6-e2e.composition.test.ts` E2E-4/E2E-5                                                  |
| Gate2 checkbox ≠ browser observation   | **PASS (automated)**       | `agent-run-panel.test.tsx`                                                                       |
| Hardening smoke suite                  | **PASS (automated)**       | `p1b-b1-b10-production-hardening.smoke.test.ts` (5 tests)                                        |
| Governed workflow benchmark            | **PASS (automated)**       | `p1b-governed-workflow-benchmark.composition.test.ts` (2 tests)                                  |
| Live trusted-local UI operator session | **NOT RUN (live)**         | Requires manual operator + running dev server; not executed in this closure                      |
| Live Playwright browser observation    | **NOT RUN (live)**         | Requires loopback server; deferred per freeze safety policy                                      |

## Explicit non-goals under this freeze

- ADR-047 multi-turn auto-continue
- Memory / parallel / MCP / WEB / open-web
- Unbounded background agents
- `toolCalling: true`
- New Tool Registry capability classes
- Autonomous Git write / push
- Merging CorrectionLoop into AgentLoop
- B11 feature implementation as memory/parallel/MCP

## Related operator docs

- `docs/trusted-local-operator-runbook.md` — Gate2 / apply / verification
- `docs/agent-tool-turn-operator-runbook.md` — B8/B9/B10 tool turns, cancel, restart
