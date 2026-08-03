# ADR-026: Gemini finishReason classification and decomposition architecture boundaries

- **Status:** Accepted
- **Date:** 2026-08-02
- **Owners:** BuilderAI architecture
- **Related:** ADR-015 (Gemini provider adapter), ADR-019 (Bounded execution-service retry),
  ADR-023 (Task-aware context retrieval), ADR-024 (Iteration feedback loop),
  ADR-025 (Feature decomposition workflow)

## Context

Phase 4 pilot preparation failed when Gemini returned non-`STOP` finish reasons. The adapter treated every
non-`STOP` value as a terminal `CONTRACT_VIOLATION` with no bounded retry path for output truncation.
Separately, feature decomposition lacked explicit architecture ownership guidance, allowing workflow-local
features to drift toward Project Brain paths even when the task did not change canonical governance.

## Decision drivers

- Filesystem mutations require semantically complete structured output; truncated generation cannot be
  treated as success even when partial text happens to parse as JSON.
- Retry behavior must remain bounded, deterministic, and inside the existing execution timeout budget.
- Policy and safety terminations must fail closed without exposing raw provider output.
- Decomposition must respect documented module ownership without hardcoding individual feature names.
- No increase to decomposition, prompt, or context budgets; no change to human approval gates.

## Decision

### Gemini finishReason taxonomy

| finishReason                                                             | Classification                        | Retry                                             |
| ------------------------------------------------------------------------ | ------------------------------------- | ------------------------------------------------- |
| `STOP`                                                                   | Successful completion                 | N/A                                               |
| `MAX_TOKENS`                                                             | `OUTPUT_TRUNCATED` truncation failure | At most one bounded retry inside existing timeout |
| `SAFETY`, `PROHIBITED_CONTENT`, `SPII`, `BLOCKLIST`, `RECITATION`        | Terminal provider policy failure      | No                                                |
| `MALFORMED_FUNCTION_CALL`, `OTHER`, `FINISH_REASON_UNSPECIFIED`, unknown | Terminal contract failure             | No                                                |
| Provider transport outage (`PROVIDER_UNAVAILABLE`)                       | Transient outage                      | Existing ADR-019 bounded retry unchanged          |

Rules:

- `STOP` remains the only successful completion reason.
- `MAX_TOKENS` is never accepted as success, even when returned text parses as valid JSON.
- Maximum one bounded retry for `OUTPUT_TRUNCATED`; a second truncation fails terminally.
- No blanket retry of `CONTRACT_VIOLATION`.
- Raw Gemini response text does not cross the provider boundary on truncation or policy failure.

Implementation:

- `ProviderOutputTruncatedError` (`OUTPUT_TRUNCATED`) in the core provider error taxonomy.
- `assertSuccessfulFinishReason()` in `src/providers/gemini/validators/gemini-finish-reason.ts`.
- `GeminiExecutionService`, `OpenAIExecutionService`, workspace runtime, and feature decomposition
  execution policies include `OUTPUT_TRUNCATED` alongside `PROVIDER_UNAVAILABLE` as retryable codes.

### Generic decomposition architecture boundaries

Add bounded `ownershipBoundaries` to `DecompositionContextPackage`, derived from architecture.md,
ADR-025, and Blueprint `folderOwnership` module summaries—not from hardcoded feature names.

The decomposition prompt instructs the model that:

- Project Brain is canonical durable governance, not generic workflow or transient execution state.
- `.builderai` may own local BuilderAI workflow persistence where appropriate.
- `src/application/workspace` owns workspace orchestration where architecture assigns it.
- UI/app/infrastructure areas follow documented responsibilities.
- `expectedAreas` must align with module ownership and task responsibility.
- Canonical Project Brain paths are proposed only when the task genuinely changes Project Brain
  governance, contracts, or state.

Phase 2 `iterationPathHints` remain hints only. Invalid `expectedAreas` are not silently rewritten
during task execution; existing path-safety and DAG validation remain unchanged.

## Consequences

Positive:

- Truncated Gemini output can recover once without weakening structured-output validation.
- Policy failures remain terminal and do not leak raw provider content.
- Decomposition receives explicit, bounded ownership guidance within the existing 15,000-character
  context budget.

Negative:

- A second consecutive truncation still fails preparation deterministically.
- Decomposition quality still depends on provider adherence; boundaries are guidance, not runtime
  rewriting of `expectedAreas`.

## Security and invariants

- Human approval gates unchanged (Gate 1 FeaturePlan, Gate 2 ChangePlan).
- No budget increases for decomposition context, prompt, or context packages.
- No autonomous repair loop or unlimited retries.
- `project-brain.json` remains the sole mutable Project Brain authority.

## Verification

Regression tests cover finishReason classification, bounded `MAX_TOKENS` retry, policy/non-retryable
contract failures, preserved `PROVIDER_UNAVAILABLE` behavior, timeout-budget reuse on retry, and
non-exposure of raw provider output. Decomposition tests cover bounded ownership boundaries, prompt
instructions, Project Brain vs workflow-local guidance, `.builderai` representation, context budget,
unchanged validation, and Phase 2 hint non-forcing behavior.

## Relationship to prior ADRs

- **ADR-015:** Refines the single-`STOP` success rule; adds explicit truncation retry without changing
  SDK-level retry disablement or structured-output authority.
- **ADR-019:** Extends retryable codes with `OUTPUT_TRUNCATED`; preserves single-timeout budget and
  maximum one retry semantics.
- **ADR-023:** Phase 2 path hints remain boost-only; decomposition boundaries do not force admission.
- **ADR-024:** Iteration feedback unchanged; no automatic expectedAreas repair at execution time.
- **ADR-025:** Adds ownership boundary context to decomposition without changing Gate 1/Gate 2 or
  `.builderai` persistence policy.
- **ADR-029:** Attempt 2 after `OUTPUT_TRUNCATED` on correction prepares applies deterministic scope
  compaction instead of repeating the identical oversized request.
