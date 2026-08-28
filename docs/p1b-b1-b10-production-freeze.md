# P1-B B1–B10 Production Freeze

- **Status:** Frozen for production hardening
- **Freeze tip (ops baseline):** `7a3d16b410eb6ada68313f72d1b655a1108e6b98`
- **Freeze tip commit:** `P1-B: Finalize B1-B10 Production Hardening`
- **Feature-complete B10 tip:** `efd4a7bedec1155bd1b3d7aac4258e1ba3a57960`
  (`P1-B: Add Provider Structured-Intent Emission Boundary`)
- **Windows npm spawn EINVAL fix:** `326507d4a840de9f0a9087a2dd5351cfcae15c1d`
  (`P1-B: Fix Windows npm process resolution`)
- **ADRs frozen:** ADR-037 through ADR-046
- **Implementations frozen:** B1 through B10
- **Date:** 2026-08-23 (freeze docs authored); ops closure works **FROM** tip `16c9790`

## Ancestry (frozen baseline chain)

```
efd4a7b  B10 provider structured-intent emission
   ↓
326507d  Windows npm process resolution (spawn EINVAL fix)
   ↓
16c9790  Freeze documentation
   ↓
7a3d16b  Ops closure (hardening smoke + doc sync)
```

Ops closure / hardening proceeds from freeze tip `7a3d16b`. The frozen product baseline stays B1–B10 / ADR-037–046 with the ancestry above.

Provider-assisted turn reliability + bounded observability (D+B) may extend B10 operator UX without new ADRs when it remains digest-only and `toolCalling:false`.

## Freeze statement

P1-B B1–B10 is a **closed hybrid stack**. Further product slices that expand autonomy, network
threat surface, or mutation authority require a **new ADR** and **separate explicit authorization**.

This freeze does **not** authorize ADR-047, memory agents, parallel/background agents, MCP,
open-web/WEB, unbounded auto-continue, or provider-native `toolCalling: true`.

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

## Hardening checklist (operators / release)

- [ ] `npm run ci` green on freeze tip `7a3d16b`
- [ ] Operator tool-turn smoke (UNDERSTANDING / AWAITING_GATE2 soft tool)
- [ ] Provider-assisted tool-turn smoke (`toolCalling:false`, no client intents)
- [ ] Cross-project runId → 404 / NOT_FOUND
- [ ] EXECUTING rejects both tool-turn paths
- [ ] Authority forgery rejected (approved / apply token / browser on intent / projectId / runId / phase)
- [ ] Cancel aborts; restart shows digests only (no auto-continue)
- [ ] Gate2 checkbox never enables browser observation
- [ ] Hardening smoke suite:
      `src/application/workspace/agent-operating/p1b-b1-b10-production-hardening.smoke.test.ts`

## Explicit non-goals under this freeze

- ADR-047 multi-turn auto-continue
- Memory / parallel / MCP / WEB / open-web
- Unbounded background agents
- `toolCalling: true`
- New Tool Registry capability classes
- Autonomous Git write / push
- Merging CorrectionLoop into AgentLoop
- B11 feature implementation under ops closure

## Related operator docs

- `docs/trusted-local-operator-runbook.md` — Gate2 / apply / verification
- `docs/agent-tool-turn-operator-runbook.md` — B8/B9/B10 tool turns, cancel, restart
