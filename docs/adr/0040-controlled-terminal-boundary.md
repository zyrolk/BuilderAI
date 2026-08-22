# ADR-040: Controlled Terminal Boundary (P1-B B4)

- **Status:** Accepted
- **Date:** 2026-08-21
- **Owners:** BuilderAI architecture
- **Related:** ADR-012 (Verification Pipeline), ADR-014 (Local MVP Runtime), ADR-036 (Agent
  Operating Layer), ADR-037 (Tool Registry), ADR-038 (Codebase Intelligence), ADR-039 (File Editing)

## Context

B1–B3 delivered a policy-gated Tool Registry, codebase intelligence, and proposal-only edit tools.
Agents still cannot invoke allowlisted verification commands. Production already has a hardened
npm-only executor (`SafeVerificationRunner`) with cwd confinement, env allowlisting, output bounds,
cancellation, and process-tree termination. B4 must expose that capability to agents **without**
introducing an unrestricted shell or a second process engine.

## Decision drivers

- Reuse `SafeVerificationRunner` and existing verification command descriptors.
- Catalog-only commands: no free-form shell strings, argv, `npx`, `node`, Git, PowerShell, or bash.
- Preserve FileApply as the sole ChangePlan / source-mutation path (Gate 2 → `approveAndApply`).
- Keep B1–B3 tool contracts frozen; extend policy only for catalog-only `VERIFY` tools.
- Keep provider adapters at `toolCalling: false`; no autonomous agent loop.
- Tool results must remain sanitizer-safe (no raw `stdout` / `stderr` keys).

## Decision

**P1-B B4 = Controlled Terminal (catalog → SafeVerificationRunner).**

### Flow

```
Tool call (commandId from catalog)
  → Tool Registry policy gate (VERIFY exception)
  → ControlledTerminalService
  → VerificationCommandDescriptor factories (existing)
  → SafeVerificationRunner.execute (existing; internal only)
  → sanitizer-safe structured result (digests + diagnosticSummary)
```

### Tools (additive)

- `run_verification_command` — run one catalog command id (`VERIFY`, `readOnly`, `HIGH`, `PREPARE`)
- `inspect_verification_catalog` — list available catalog entries for the workspace (`INSPECT`)

### Catalog command ids

Only:

- `npm-ls-omit-dev-json`
- `npm-run-build`
- `npm-run-test`
- `npm-run-lint`
- `npm-run-typecheck`
- `npm-run-format`

Lint / typecheck / format resolve to discovered package.json script **names** from the existing
allowlist candidates. Missing scripts → policy rejection (no spawn).

### Registry policy extension

Allow `capabilityClass: VERIFY` **only when** all hold:

- `readOnly: true` — means no FileApply / no APPLY / no Gate2 bypass (not “zero process side effects”)
- `riskLevel: HIGH`
- `authorizationAction: PREPARE`
- `requiresGate2: false`
- `approvalRequirement: NONE`

Continue rejecting: free-form terminal, `MUTATE`, `APPLY`, `readOnly: false`, FileApply wiring,
provider tool execution, Git write, MCP, browser autonomy.

### Timeout posture

Tool definition timeout remains within the registry maximum (`1..120_000` ms). Stage timeout and
output bounds reuse verification defaults. No unbounded execution.

### Mutation-safety

Process side effects from allowlisted npm scripts (e.g. `dist/` from `build`) are privileged
evidence I/O, not ChangePlan application. FileApply remains the sole authoritative source writer.
The Tool Registry and Controlled Terminal modules must not import or call FileApply /
`approveAndApply`.

### Residual risks (accepted)

- npm script **bodies** are not sandboxed; only script **names** and fixed argv are allowlisted.
- Network isolation remains `disabled-unsupported` (declared, not OS-enforced).
- Scripts may read secrets from disk (e.g. `.env`); env vars passed to the child remain allowlisted.

## Consequences

### Positive

- Agents can gather verification evidence through the same hardened runner used by apply/verify.
- No second spawn stack; unrestricted shell remains forbidden.

### Negative / accepted limits

- Not a general terminal; only the frozen catalog.
- Tool-facing diagnostics are digests/summaries, not full streams.

## B4 non-goals

- Unrestricted / generic shell or free-form argv
- New process engine
- Provider `toolCalling: true` / autonomous tool loops
- B5 Git write, MCP, browser autonomy, background agents
- Exposing `SafeVerificationRunner` as a raw terminal tool
- Replacing VerificationEngine or CorrectionLoop
- Weakening B1–B3 contracts

## Security and privacy impact

- Trusted-local authorization via existing workspace auth (`PREPARE` / `INVESTIGATE` / `READINESS`).
- Env allowlist + forbidden-key heuristics unchanged.
- Tool sanitizer continues to strip `stdout` / `stderr` / `*Excerpt` keys; B4 uses
  `diagnosticSummary` + digests instead.

## Rollout and reversal

- Ship ADR-040, ControlledTerminalService, two tools, `createB4TerminalRegistry`, policy exception,
  and T1–T14 composition/security tests.
- Reversal: stop registering B4 tools; SafeVerificationRunner and verification ports remain intact.
