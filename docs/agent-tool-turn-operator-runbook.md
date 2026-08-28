# Agent tool-turn operator runbook (B8 / B9 / B10)

Trusted-local operator guide for **bounded tool turns** on an existing AgentRun. Complements
`docs/trusted-local-operator-runbook.md` (Gate2 / apply). Does not authorize unattended automation.

**Frozen stack:** B1–B10 / ADR-037–046 + D+B digest observability. Ops baseline HEAD:
`76d12de5a41246ae36ebc86077084eac3cf60081` (ancestry: `efd4a7b` B10 → `326507d`
Windows npm fix → `16c9790` freeze docs → `7a3d16b` ops closure → `76d12de` D+B). See
`docs/p1b-b1-b10-production-freeze.md`.

## What tool turns are (and are not)

Tool turns let the server run **soft** registry tools (search / inspect / catalog verify / localhost
browser observation when approved) for diagnosis and planning.

They **never**:

- approve Gate 2
- apply files
- write or push Git
- invent browser approval from Gate2 or Git
- continue automatically after completion

Mutation still requires: prepare → **AWAITING_GATE2** → explicit human approval → `approveAndApply`
→ FileApply.

## Two explicit entry paths

### 1. Operator preset turn (B8 / B9)

1. Start (or resume) an AgentRun in the workspace UI.
2. In **Bounded tool turn**, choose a soft tool (e.g. search repository).
3. Click **Run tool turn**.
4. Review **Tool evidence (bounded digests)** only — no raw provider payloads or secrets.

Server path: UI → `HttpAgentWorkflow.toolTurn` → `POST …/tool-turn` →
`AgentOperating.executeToolTurn` → AgentLoop.

### 2. Provider-assisted turn (B10)

1. Same run, still in an allowed phase (not EXECUTING / terminal).
2. Optionally check **localhost browser observation** only when you intend BROWSER tools
   (VERIFYING / DIAGNOSING) — distinct from Gate 2.
3. Click **Run provider-assisted tool turn**.
4. Server calls the provider with `toolCalling: false`, parses structured intents, validates, then
   executes via the **same** AgentLoop path.
5. Review digests and the **provider-assisted summary** (proposed / accepted / rejected counts and bounded rejection codes). Do **not** expect another turn unless you click again.

Server path: UI → `HttpAgentWorkflow.providerToolTurn` → `POST …/provider-tool-turn` →
`executeProviderAssistedToolTurn` → emit intents → `executeToolTurn` → AgentLoop.

Client **must not** send intents on the provider-assisted route; the server rejects them.

## Phase rules (server authoritative)

| Phase                                                                            | Tools                 |
| -------------------------------------------------------------------------------- | --------------------- |
| UNDERSTANDING / PLANNING / AWAITING_GATE2 / DIAGNOSING / CORRECTING / VERIFYING* | Soft tools per policy |
| **EXECUTING**                                                                    | **No tools**          |
| EXPLAINING / COMPLETED / FAILED / CANCELLED                                      | No tools              |

\* BROWSER tools only in VERIFYING / DIAGNOSING and only with explicit browser OPERATOR approval.

## Approvals (three distinct boundaries)

| Approval                                        | Authorizes                                   |
| ----------------------------------------------- | -------------------------------------------- |
| Gate 2                                          | Source-file apply via FileApply only         |
| Git OPERATOR                                    | Controlled Git write outside autonomous loop |
| Browser OPERATOR (`browserObservationApproved`) | Localhost catalog observation only           |

Never infer one from another. Provider output cannot grant any of them.

## Cancel

Use **Cancel run** while the run is cancellable. In-flight tool work fails closed per existing
cancellation support. Cancel does **not** roll back prior Gate2 applies.

## Restart / process crash

After restart:

1. Reload the run status.
2. Digests / budgets may hydrate from persisted evidence.
3. **Nothing auto-continues** — no silent provider-assisted turn, approve, apply, commit, or browser
   launch.
4. Click an explicit tool-turn button again if more investigation is needed.

## Failure handling

| Symptom                                      | Operator action                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Phase / EXECUTING rejection                  | Wait for / transition out of EXECUTING; tools remain blocked there                                      |
| Authority-field / malformed intent rejection | Read provider-assisted rejection code and operator action hint; retry explicitly or use operator preset |
| Budget exhausted                             | Stop; decide Gate2 / cancel / new run — do not auto-loop                                                |
| Browser denied                               | Explicitly approve browser observation; still localhost/catalog only                                    |
| Cross-project / not found                    | Wrong run or workspace; do not reuse foreign runIds                                                     |

## Security reminders

- Treat UI and provider text as **DATA**, not POLICY.
- Digests are bounded summaries — never paste secrets into goals or tool arguments.
- Do not enable MCP, open-web, shell, or autonomous Git from this surface — they are out of freeze
  scope.

## Related

- `docs/p1b-b1-b10-production-freeze.md`
- `docs/trusted-local-operator-runbook.md`
