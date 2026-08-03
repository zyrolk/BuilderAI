# ADR-029: Adaptive OUTPUT_TRUNCATED retry compaction

- **Status:** Accepted
- **Date:** 2026-08-03
- **Owners:** BuilderAI architecture
- **Related:** ADR-019 (Bounded execution-service retry), ADR-024 (Iteration feedback loop),
  ADR-026 (Gemini finishReason classification), ADR-027 (Mandatory verification stages)

## Context

Phase 4 Task-2 correction prepares failed with `OUTPUT_TRUNCATED` when Gemini returned
`finishReason === MAX_TOKENS`. ADR-019 introduced a single bounded retry for transient provider
failures including `OUTPUT_TRUNCATED`, but attempt 2 reused the identical oversized generation
request. Both attempts therefore hit the same output limit without narrowing scope.

Cycle-1 success proved the task fits within 5,679 / 16,000 output tokens when scope is appropriate.
The blocker is retry semantics, not model capacity or timeout configuration.

## Evidence

- Task-2 correction prepare at 180s timeout: ~140s duration, terminal `OUTPUT_TRUNCATED`.
- Duration pattern (~2 × ~70s + retry delay) indicates both attempts exhausted output tokens.
- Explicit two-file correction guidance in the prompt did not help because attempt 2 repeated the
  same request.
- ADR-026 correctly classifies `MAX_TOKENS` as retryable `OUTPUT_TRUNCATED` and never accepts
  truncated content.

## Decision drivers

- Preserve ADR-019 retry invariants: maximum one retry, two total attempts, non-resettable timeout
  budget starting at `QUEUED`, attempt 2 receives only remaining timeout.
- Preserve ADR-026: `STOP`-only successful completion; truncated content never parsed into artifacts.
- Preserve ADR-024 correction semantics: authoritative feedback paths define correction scope.
- Preserve ADR-027 Gate 2 and verification lifecycle; no task-state mutation from retry logic.
- Provider-neutral policy ownership; no provider timeout, token limit, or model changes.
- Fail closed on unsafe paths; never derive allowlist from provider output.

## Decision

Introduce **adaptive OUTPUT_TRUNCATED retry compaction** via a provider-neutral
`TruncationRetryCompactionService` in the prompt-orchestrator core.

### First attempt (correction output bounding)

For CORRECTION prepares with a non-empty safe allowlist derived from `IterationFeedback.apply`
paths, attempt 1 applies **deterministic output bounding** without mutating the canonical
`ExecutionRequest.prompt`:

- `boundingActive = true`, `compactionActive = false`
- Option B schema limits (`logicalPath` enum, `artifacts.maxItems`, `diagnostics.maxItems = 1`,
  `summary.maxLength = 1000`)
- Provider-neutral post-response allowlist validation
- No `OUTPUT_TRUNCATION_RETRY` prompt overlay on attempt 1

Ordinary/non-correction prepares (no `ITERATION` section or empty/unsafe allowlist) remain
unchanged on attempt 1.

### Attempt-2 compaction trigger

Apply compaction on attempt 2 **only when all** of the following hold:

1. Previous failure code is `OUTPUT_TRUNCATED`.
2. This is the existing allowed single retry (attempt 2, retry budget remaining).
3. Prompt contains an `ITERATION` section (correction prepares).
4. A valid bounded artifact allowlist can be derived from normalized correction feedback paths.
5. Remaining execution timeout is greater than zero (enforced by existing retry gate).

For `PROVIDER_UNAVAILABLE`, preserve the current identical-request retry with no compaction.

### Allowlist derivation

Derive the allowlist **only** from authoritative normalized correction feedback paths:

- `feedback.apply.updatedPaths`
- `feedback.apply.createdPaths`
- `feedback.apply.deletedPaths`

Requirements:

- POSIX normalize (`\` → `/`, trim, drop `./` prefix)
- Deduplicate
- Deterministic sort (`localeCompare`)
- Maximum 8 paths
- Reject unsafe paths via `isSafeLogicalPath`
- Reject absolute paths, traversal, `.env` / secret / credential paths, `project-brain.json`,
  `src/core/project-brain/`, `node_modules/`

If no safe allowlist can be derived, disable compaction and fall back to existing retry semantics
(identical prompt).

### Attempt-2 prompt overlay

Do **not** mutate the canonical `ExecutionRequest` in place. Create an attempt-local prompt overlay
via `resolveAttempt()` that appends deterministic `OUTPUT_TRUNCATION_RETRY` guidance to the
`ITERATION` section:

```
OUTPUT_TRUNCATION_RETRY:
The previous provider attempt exceeded the output limit.
Emit artifacts ONLY for the following approved paths:
<allowlist>
Emit at most <N> artifacts.
Do not emit unchanged contextual files.
Keep diagnostics minimal.
Each UPDATE_FILE artifact must still contain the complete resulting file content.
```

Do not include raw prior provider output.

Any attempt-local PromptPackage transformation must recompute derived prompt-budget accounting
(`budget.characters` via the same self-referential `JSON.stringify` fixpoint used during normal
PromptPackage construction) before provider execution. Compacted prompts that exceed
`budget.maximumCharacters` fail closed without a provider call.

### Schema and post-response enforcement

For Gemini compacted retries, constrain `artifacts[].logicalPath` to the approved allowlist via JSON
Schema `enum` when compaction metadata is present. **Enum alone was insufficient** for Task-2-sized
corrections: attempt 2 also bounds output cardinality in schema:

- `artifacts.maxItems = allowlist.length`
- `diagnostics.maxItems = 1`
- `summary.maxLength = 1000` (compacted attempt 2 only)

Do **not** impose `content.maxLength` on artifact bodies; complete `UPDATE_FILE` contents remain
mandatory.

For all providers, **mandatory post-response validation** rejects:

- any artifact whose `logicalPath` is outside the allowlist
- artifact count greater than `allowlist.length`
- duplicate `logicalPath` values (fail closed; no silent deduplication)
- more than one diagnostic entry
- summary longer than 1000 characters when compaction is active

Out-of-scope or over-cardinality artifacts cannot reach an accepted ChangePlan.

### Timeout and retry invariants

- Maximum one retry / two total provider attempts (unchanged).
- Single non-resettable execution timeout budget starting at `QUEUED` (unchanged).
- Attempt 2 timeout capped to remaining budget (unchanged).
- `CONTRACT_VIOLATION`, `TIMEOUT`, and `CANCELLED` remain terminal with no retry (unchanged).

### Security and Gate 2

Protected-path and security rules remain authoritative. Gate 2 remains mandatory. Ordinary
first-pass / non-correction prepares remain unchanged.

### Provider applicability

`TruncationRetryCompactionService` is injected into Gemini, OpenAI, and OpenRouter execution
services. Compaction logic is not duplicated per provider.

## Consequences

### Positive

- Correction retries narrow scope deterministically instead of repeating oversized generation.
- Task-2 two-file corrections can succeed within existing token and timeout limits.
- Security and lifecycle invariants preserved.

### Negative / trade-offs

- Compaction depends on authoritative feedback paths; empty or unsafe paths disable compaction.
- Schema-level cardinality bounding is Gemini-specific; OpenAI/OpenRouter rely on post-response
  validation for the same invariants.

## Rollback strategy

Remove `TruncationRetryCompactionService` wiring from execution services and revert attempt-2
prompt overlay. Retry behavior returns to ADR-019 identical-request semantics.

## Relationships

| ADR     | Relationship                                                                         |
| ------- | ------------------------------------------------------------------------------------ |
| ADR-019 | Extends retry behavior for `OUTPUT_TRUNCATED` only; all other retry rules unchanged  |
| ADR-024 | Allowlist sourced from iteration feedback paths                                      |
| ADR-026 | Compaction activates only after `OUTPUT_TRUNCATED`; truncated content never accepted |
| ADR-027 | No change to verification gates or task completion lifecycle                         |
