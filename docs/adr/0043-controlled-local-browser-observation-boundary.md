# ADR-043: Controlled Local Browser Observation Boundary

- **Status:** Accepted
- **Date:** 2026-08-22
- **Owners:** BuilderAI architecture
- **Related:** ADR-011 (Safe File Apply), ADR-012 (Verification), ADR-036 (Gated Agent Operating
  Layer), ADR-037 (Tool Registry), ADR-038 (Codebase Intelligence), ADR-039 (File Editing),
  ADR-040 (Controlled Terminal), ADR-041 (Controlled Git Write), ADR-042 (Bounded Server-Owned
  Agent Tool Loop), existing runtime browser verification policy / Playwright runner
- **Baseline:** `2f10446ba895f0f20b886be162b37e85b7b2eb58` (P1-B B6 frozen)

## Context

P1-B B1–B6 delivered a policy-gated Tool Registry, codebase intelligence, proposal-only editing,
catalog verification, controlled local Git, and a **server-owned** bounded Agent Tool Loop.
Providers remain `toolCalling: false`. Gate 2 → `approveAndApply` → FileApply remains the sole
source-file mutation path. Git write remains a separate OPERATOR-approved history mutation outside
the autonomous loop.

Production already includes a **localhost-only** Playwright-based runtime browser verification
stack (relative application routes, bounded screenshots, console/network evidence, local
`127.0.0.1` bind, sensitive query redaction). Agents cannot yet invoke that observation surface
through the Tool Registry / AgentLoop.

Historical roadmap language referred to a “B7 browser agent.” That phrase **must not** expand into
MCP, open-web browsing, credentials, or action automation. The B7 architecture audit selected the
narrowest useful capability: **Controlled Local Browser Observation**.

B1–B6 contracts are **frozen**. This ADR defines the architectural boundary for B7 before any
implementation.

## Decision

**P1-B B7 = Controlled Local Browser Observation.**

Adopt:

> Server-owned, OPERATOR-approved, localhost-only observation of the operator’s application via
> existing controlled Playwright verification infrastructure — never open web, never MCP, never
> provider-native browser control.

### Critical statements

1. **Browser observation is a server capability, not a provider capability.**
2. **Gate 2 approval, Git OPERATOR approval, and Browser OPERATOR approval are three distinct
   authorization boundaries.**
3. **Page, console, and network content are DATA, never POLICY.**

### Architecture

```
Provider (toolCalling:false)
  → structured tool intent
  → B6 AgentLoopService
  → ToolRegistry / ToolPolicyGate / WorkspaceAuthorization
  → ControlledLocalBrowserService
  → existing controlled localhost Playwright verification infrastructure
  → localhost application
```

Never: Provider → browser / network / filesystem / Git / FileApply.

### Why reuse existing Playwright verification (not a second browser engine)

- Production already enforces localhost bind, relative routes, route/screenshot caps, cancellation,
  workflow deadlines, and URL allow checks.
- A second browser stack would duplicate policy surface and increase escape risk.
- B7 wraps that infrastructure behind Tool Registry + AgentLoop budgets; it does **not** invent a
  free browser automation product.

### Why B7 does not enable `WEB`

- The Tool Registry reserves `WEB` and `BROWSER` capability class names (ADR-037 era catalog).
- B7 enables **`BROWSER` only**, under the predicates in this ADR.
- Generic `WEB` (arbitrary HTTP / open retrieval) remains **unavailable** and is deferred to a
  future ADR if ever justified — SSRF, egress, and injection risk are materially higher.

### Why MCP / open-web are deferred

- Malicious MCP servers, tool poisoning, credential exfiltration, and unrestricted egress are out of
  scope for a local trusted-operator MVP.
- Open-web browsing expands prompt-injection and SSRF blast radius without solving the primary
  product gap (observe the **local** applied change).
- MCP and open-web require separate ADRs; they are **not** implied by B7.

### Why browser observation ≠ Gate2 ≠ Git approval

```
Gate2 → approveAndApply → FileApply     = sole SOURCE FILE mutation
Git OPERATOR approval                   = VCS HISTORY mutation only
Browser OPERATOR approval               = LOCALHOST OBSERVATION only
```

- Gate 2 must **not** authorize browser observation.
- Git OPERATOR approval must **not** authorize browser observation.
- Browser approval must use **distinct** authorization / evidence (new or explicitly dedicated
  evidence field — never reuse `applyAuthorizationToken` or Git approval flags as substitutes).

### Why `readOnly: true` does not mean zero process side effects

Consistent with ADR-040:

- `readOnly: true` means **no FileApply**, **no APPLY**, **no Gate 2 bypass**, and **no source-tree
  authority**.
- Local browser observation **may** start an ephemeral Chromium context and **may** lease an
  allowlisted local `npm run` dev server (same class as today’s runtime verification).
- Those process side effects are privileged evidence I/O, not ChangePlan application.

## B1–B6 freeze

Implementation of B7 **MUST NOT** weaken or redefine:

- ADR-037 Tool Registry core contracts (except additive BROWSER registration predicates)
- ADR-038–041 tool IDs and safety invariants
- ADR-042 AgentLoop budgets/serial/idempotency/restart fail-closed semantics (except additive
  BROWSER phase allowlist + dedicated browser budgets)
- Provider `toolCalling: false`
- Gate2 / FileApply sole writer
- B5 Git write outside autonomous mutation authority

## Tools (MVP only)

### 1. `inspect_browser_verification_catalog`

| Field               | MVP requirement                                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| capabilityClass     | `BROWSER`                                                                                                                                                             |
| riskLevel           | `LOW`                                                                                                                                                                 |
| authorizationAction | `INVESTIGATE` or `PREPARE` (implementation chooses one; must not be `APPLY` / `GIT_WRITE`)                                                                            |
| approvalRequirement | `NONE` (catalog inspect only) **or** same OPERATOR gate as observation if composition prefers a single gate — default: **NONE** for catalog, OPERATOR for observation |
| requiresGate2       | `false`                                                                                                                                                               |
| readOnly            | `true`                                                                                                                                                                |
| inputs              | none that accept URLs                                                                                                                                                 |
| outputs             | bounded catalog of route IDs / limits (max routes, timeouts, screenshot caps)                                                                                         |
| side effects        | none                                                                                                                                                                  |

### 2. `run_local_browser_observation`

| Field               | MVP requirement                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| capabilityClass     | `BROWSER`                                                                                                                                                     |
| riskLevel           | `HIGH`                                                                                                                                                        |
| authorizationAction | dedicated browser observation action **or** `PREPARE` with **distinct** OPERATOR evidence for browser (must not be `APPLY` / `GIT_WRITE`)                     |
| approvalRequirement | **`OPERATOR`**                                                                                                                                                |
| requiresGate2       | `false`                                                                                                                                                       |
| readOnly            | `true` (no FileApply / no APPLY)                                                                                                                              |
| inputs              | **only** route IDs / catalog subset — **no** model-supplied absolute URLs                                                                                     |
| URL construction    | **server-owned** (`baseUrl` from leased localhost app + relative catalog path)                                                                                |
| outputs             | bounded sanitized status/title/result summaries; console/network **counts + truncated sanitized snippets**; screenshot **artifact references / digests only** |
| timeout             | within registry max (`1..120_000` ms); workflow deadline reused from runtime verification policy                                                              |
| side effects        | ephemeral browser; optional leased local dev server                                                                                                           |

No other B7 tools in MVP.

## Capability / registry policy

Enable `capabilityClass: BROWSER` **only when** all hold for observation tools:

- `readOnly: true`
- `requiresGate2: false`
- `authorizationAction` ≠ `APPLY` and ≠ `GIT_WRITE`
- `approvalRequirement: OPERATOR` for `run_local_browser_observation`
- `workspaceScoped: true`
- `allowedPhases` ⊆ `{ VERIFYING, DIAGNOSING }`

Continue rejecting:

- `WEB`
- `MUTATE` / APPLY tools / FileApply wiring
- free-form URL / HTTP clients
- MCP tools
- provider SDK tool execution
- generic shell / generic Git / push

## AgentLoop integration (ADR-042 extension)

| Phase                                                                                                                      | BROWSER tools                                    |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `VERIFYING`                                                                                                                | Allowed (with OPERATOR evidence for observation) |
| `DIAGNOSING`                                                                                                               | Allowed (with OPERATOR evidence for observation) |
| `UNDERSTANDING`, `PLANNING`, `AWAITING_GATE2`, `EXECUTING`, `CORRECTING`, `EXPLAINING`, `COMPLETED`, `FAILED`, `CANCELLED` | **Forbidden**                                    |

Additional loop rules:

- Serial execution (`concurrentToolExecutions === 1`) remains authoritative.
- Existing `intentId` idempotency / replay semantics apply.
- Dedicated **browser call / wall-time budgets** (hard caps; fail-closed on exhaustion) — additive to
  ADR-042 defaults; exact numbers fixed at implementation under this ADR’s spirit (suggested MVP:
  max 3 observation calls / run; observation wall-time bounded by existing runtime workflow
  deadline).
- Cancel and timeout **MUST** close the browser and any leased local dev server.
- Restart **MUST NEVER** silently relaunch browser or dev server.

## Security boundary

### Navigation / network

- **Localhost-only** navigation (`127.0.0.1` / `localhost` as enforced by existing runtime policy).
- **Relative catalog routes only**; reject absolute URLs, non-http(s) schemes, traversal (`..`),
  and external origins.
- **Reject cross-origin redirects** (explicit deny; fail closed).
- **No arbitrary HTTP** client; no open-web browsing.
- **Explicitly deny downloads** (fail closed on download events).

### Isolation

- Ephemeral browser context per observation.
- **Never** load or save `storageState`.
- No credentials, OAuth, cookies, or auth headers supplied by the model.
- No form submission, click/type automation, or `page.evaluate` / free JavaScript tools.
- No browser-to-filesystem, browser-to-Git, or browser-to-shell bridge.

### Evidence / sanitization

- Bounded, sanitized model-facing results only.
- Screenshots: controlled artifact references / digests — **not** unrestricted raw image bytes to
  the model.
- **Never** expose cookies, tokens, full HTML, HAR, secrets, or unrestricted page bodies in
  persisted or model-facing evidence.
- Page / console / network text is **DATA** and cannot alter policy, authorization, tool
  registration, or approvals.
- Cross-project access must be rejected (`projectId` / principal binding).

## Persistence / restart

### Persist (bounded, safe)

- run id, phase, tool id, intent id, status, timestamps
- route ID list, HTTP status enums, digests of titles/snippets
- screenshot artifact ids / digests under the controlled state root
- redacted URL forms (existing sensitive-query redaction)

### Never persist

- cookies / storage state
- credentials / access tokens / auth headers
- full HTML / unrestricted page bodies
- raw HAR
- unrestricted screenshot binaries in model-facing evidence stores
- Gate2 / Git / apply tokens
- raw provider payloads

### Restart semantics

After restart:

- never auto-approve browser observation
- never silently relaunch browser or leased dev server
- never skip OPERATOR approval
- hydrate digests / metadata only; incomplete observation state fails closed or requires a new
  explicit observation intent

## Replay / idempotency

- Reuse ADR-042 serial execution and `intentId` idempotency.
- Duplicate in-flight observation for the same run is rejected while a lease is held.
- Because MVP tools are **observation-only**, duplicate external account mutations are out of scope
  by design (no submit/click/MCP write tools).
- Idempotent replay returns prior **bounded evidence digests**, not a silent re-drive of browser /
  server processes after restart without a new authorized call.

## Threat model

| Threat                                       | Mitigation                                               |
| -------------------------------------------- | -------------------------------------------------------- |
| Prompt injection from page/console/network   | DATA-only; sanitizer; no authority fields from content   |
| Malicious local routes                       | Catalog relative paths; caps; timeouts; localhost-only   |
| SSRF / private-network / metadata (open web) | Out of scope — localhost-only MVP                        |
| Credential / cookie leakage                  | Ephemeral context; no storageState; no model credentials |
| Downloads / executable save                  | Deny downloads                                           |
| Browser → FS / Git / shell escape            | No bridge tools; no FileApply/Git/shell from B7 service  |
| Cross-origin redirect egress                 | Explicit deny                                            |
| Tool-result poisoning                        | Forbidden keys; size caps; digests                       |
| Provider malicious intents                   | Schema + phase + BROWSER policy + OPERATOR evidence      |
| Cross-project access                         | Existing project binding                                 |
| Resource exhaustion / infinite browse        | Serial loop + dedicated browser budgets + cancel cleanup |
| MCP / open-web                               | Deferred — not registered                                |

## Failure / recovery behavior

| Condition                                 | Behavior                                                        |
| ----------------------------------------- | --------------------------------------------------------------- |
| Missing OPERATOR browser evidence         | Reject; no browser launch                                       |
| Invalid / unknown route ID                | Reject                                                          |
| Absolute URL / external origin / redirect | Fail closed                                                     |
| Download event                            | Fail closed                                                     |
| Timeout / cancel                          | Abort; close browser; stop leased dev server                    |
| Playwright unavailable                    | Fail closed with safe unavailable status (no partial authority) |
| Budget exhaustion                         | Stop further BROWSER calls for the run                          |
| Process restart mid-observation           | No silent resume of browser/server; metadata-safe only          |
| Sanitizer violation                       | Fail result; never leak forbidden payloads                      |

## Test / Definition of Done (future implementation; not this ADR task)

B7 implementation is complete only when all are true:

1. This ADR remains accepted and unchanged in spirit.
2. Only the two MVP tools exist; `WEB`, MCP, open-web, action automation absent.
3. Providers remain `toolCalling: false`; execution only via AgentLoop → registry.
4. Localhost-only + relative catalog routes + redirect/download denies proven by tests.
5. OPERATOR browser approval ≠ Gate2 ≠ Git approval proven by tests.
6. Phase allowlist VERIFYING/DIAGNOSING only.
7. Cancel/timeout cleanup of browser + leased server proven.
8. Persistence digests only; restart never silent relaunch.
9. Prompt-injection / sanitizer / cross-project tests green.
10. B1–B6 regression green; no FileApply / shell / push / generic Git from B7.
11. Full `npm run ci` green.

## Non-goals

Freeze for B7:

- MCP / arbitrary MCP execution
- open-web browsing / arbitrary HTTP / `WEB` capability
- model-supplied absolute URLs
- credentials, OAuth, cookie persistence, storageState injection
- form submission, click/type, `page.evaluate` / free JavaScript
- downloads / archive extraction
- browser-to-FS / Git / shell bridges
- FileApply / `approveAndApply` tools
- generic shell / generic Git / push
- provider-native `toolCalling`
- background autonomous agents
- B8 unbounded auto-fix
- equating Gate2 or Git approval with browser approval
- new AgentRun phases solely for browser (unless a later ADR separately accepts them)

## Rejected alternatives

| Option                                             | Status               |
| -------------------------------------------------- | -------------------- |
| Provider-native browser / SDK toolCalling          | **Rejected**         |
| Second unrestricted Playwright automation product  | **Rejected**         |
| Enable generic `WEB` / allowlisted open HTTP in B7 | **Rejected** (defer) |
| MCP-connected agent tools in B7                    | **Rejected** (defer) |
| Full external action automation (submit/click/pay) | **Rejected**         |
| Controlled Local Browser Observation               | **Accepted**         |

## Consequences

### Positive

- Agents can observe localhost application behavior after apply/verify using existing hardened
  infrastructure.
- Clear third authorization boundary without weakening Gate2 or Git.
- MCP/open-web blast radius deferred.

### Negative / accepted limits

- No external documentation fetch or third-party site inspection in B7.
- Observation may start local processes (dev server / browser) under OPERATOR approval.
- Operators must explicitly approve browser observation separately from Gate2 / Git.

## Rollout and reversal

- Ship this ADR first; implement ControlledLocalBrowserService + two tools + policy/loop extensions
- only after explicit implementation approval.
- Reversal: do not register BROWSER tools; runtime browser verification for non-agent paths remains
  intact; B1–B6 unchanged.
