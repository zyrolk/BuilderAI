# ADR-018: Calibrated Context/Prompt budgets with a composition-time provider-headroom invariant

- **Status:** Accepted
- **Date:** 2026-08-01
- **Owners:** BuilderAI architecture
- **Related:** ADR-004 (Context Builder boundary), ADR-006 (Prompt Package boundary), ADR-005/0008/0015
  (AI Provider Adapter boundary and provider adapters), ADR-014 (Local MVP runtime composition)

## Context

Context Builder, Prompt Orchestrator, and the AI provider request mappers each enforce an independent,
character-based size limit: `DEFAULT_CONTEXT_LIMITS.maxCharacters` (Context Package,
`JSON.stringify(packageValue).length`), `DEFAULT_PROMPT_ORCHESTRATOR_CONFIGURATION.maximumCharacters`
(Prompt Package, same measurement), and each provider's `maximumInputCharacters`
(`JSON.stringify(request.prompt).length`, configured via `BUILDERAI_PROVIDER_MAX_INPUT_CHARACTERS`,
default 200,000). Nothing previously proved these three limits stayed in a safe order, and nothing proved
the smallest of them — Context Builder's default of 50,000 characters — actually left room for the content
it exists to select.

Measuring the canonical Project Brain, the real governance documents (`docs/project-constitution.md`,
`docs/ai-rules.md`, `docs/architecture.md`, `docs/coding-standards.md`), and a realistic worst-case
(4,000-character) task against the real repository showed the 50,000-character default saturating almost
immediately: mandatory-ish content alone (Project Brain fields, governance documents, the current task, and
whatever optional decisions/documents fit) consumed 48,000–49,600 characters, leaving 0.8%–2.3% headroom
and, in every measured case, zero surviving relevant source files — `ContextSizeService` removes files
first when trimming to fit a budget, so files were always the first and only casualty. Prompt Orchestrator
(75,000 characters) and the default provider limit (200,000 characters) were never the binding constraint;
they had ample unused headroom precisely because Context Builder had already discarded everything a real
request needed most.

Sweeping the same realistic worst-case scenario against a range of Context Builder ceilings showed the full
real candidate set (all 12 relevant files, all 8 candidate documents, all 20 relevance-scored decisions)
saturating at 83,833 characters; higher ceilings added pure headroom without retaining more content because
nothing more relevant existed to add. The resulting Prompt Package for that same saturated content measured
84,202 characters — a reformatting overhead of under 1% over the source Context Package.

## Decision drivers

- Launch reliability: mandatory governance/project context must fit within Context Builder's budget on real
  content, with source files surviving selection, not just in isolated small fixtures.
- Deterministic behavior: no token estimation, no provider-specific behavior in Context Builder or Prompt
  Orchestrator.
- Preserve mandatory governance/safety instructions intact; never summarize or truncate them.
- No silent dropping of critical instructions; the optional Context section should not need to be dropped
  under real content, and if it ever is, the drop must remain recorded as it already is today.
- Minimal architectural complexity and provider independence: Context Builder and Prompt Orchestrator must
  stay provider-unaware; any provider-aware check belongs in the infrastructure composition layer, not core.
- Fail fast: a misconfigured `BUILDERAI_PROVIDER_MAX_INPUT_CHARACTERS` must be caught at startup, not on a
  live user request.

## Considered options

A. One unified end-to-end budget derived from the active provider's effective input limit, replacing the
three independent layered budgets.
B. Keep layered budgets, recalibrate them from real measurement, and add an explicit reserved-headroom
invariant proving `Context budget < Prompt budget < provider maximumInputCharacters`, enforced at
composition time.
C. Dynamically trim or summarize mandatory governance content so it always fits regardless of budget.
D. Leave the layered budgets architecturally as-is and only raise the Context Builder number without any
cross-layer invariant.

## Decision

Use option B, combined with the safest minimal recalibration option D would have left incomplete on its
own.

`DEFAULT_CONTEXT_LIMITS.maxCharacters` (`src/core/context-builder/types/context-builder.ts`) is raised from
50,000 to **95,000**: the measured full-real-candidate saturation point (83,833 characters) plus roughly
11,000 characters (~12%) of reserved headroom for governance-content growth, chosen from the measured
saturation curve rather than an arbitrary round number.

`DEFAULT_PROMPT_ORCHESTRATOR_CONFIGURATION.maximumCharacters`
(`src/core/prompt-orchestrator/config/prompt-orchestrator-configuration.ts`) is raised from 75,000 to
**120,000**: the measured Prompt Package size at full saturation (84,202 characters) plus roughly 35,800
characters (~30%) of reserved headroom, comfortably above the worst case a 95,000-character Context Package
could produce even accounting for reformatting overhead many times larger than the under-1% actually
measured.

The default provider `maximumInputCharacters` (200,000, `BUILDERAI_PROVIDER_MAX_INPUT_CHARACTERS`) is left
unchanged; it already has 80,000 characters (40%) of headroom above the new Prompt Orchestrator budget.

A new module, `src/infrastructure/workspace/budget-invariant.ts`, defines two named reserved-headroom
constants (`MINIMUM_CONTEXT_TO_PROMPT_HEADROOM_CHARACTERS = 15_000`,
`MINIMUM_PROMPT_TO_PROVIDER_HEADROOM_CHARACTERS = 25_000`) and one function, `assertBudgetOrdering`, that
proves `Context budget + reserved headroom <= Prompt budget` and
`Prompt budget + reserved headroom <= provider maximumInputCharacters`, throwing a plain `Error` naming the
exact configured numbers on violation. `local-runtime-configuration.ts` calls it while resolving provider
settings, so `loadLocalWorkspaceRuntimeConfiguration()` — and therefore `createLocalWorkspaceRuntime()` —
fails immediately at composition time if an operator sets `BUILDERAI_PROVIDER_MAX_INPUT_CHARACTERS` too low,
before any request is ever prepared. Context Builder and Prompt Orchestrator import nothing about providers;
the invariant lives entirely in the infrastructure composition layer, reading only the two cores' already
-public default budgets and the resolved provider configuration.

A permanent regression test,
`src/infrastructure/blueprint-reader/context-prompt-budget.integration.test.ts`, builds a real Context
Package and Prompt Package from the canonical Project Brain, the real governance documents, real repository
source files, and a worst-case 4,000-character task, and asserts: Context Builder stays within its budget
with at least 5,000 characters of headroom; mandatory governance documents and coding standards remain
present; at least one real source file survives selection; Prompt Orchestrator stays within its budget with
at least 10,000 characters of headroom; the optional CONTEXT section is not dropped; and the serialized
provider input (`JSON.stringify(promptPackage).length`) stays below the Prompt budget plus the required
provider headroom.

### Rejected alternatives

Option A (unified end-to-end budget derived from the provider's limit) was rejected because it would make
Context Builder and/or Prompt Orchestrator provider-aware — a hard constraint of this work — or require a
new provider-independent abstraction layer to translate one provider-derived number back down through two
upstream, deliberately provider-unaware cores. It also removes the layered defense that currently lets
Context Builder and Prompt Orchestrator be validated and tested in complete isolation from any provider,
and it does not by itself solve the actual measured defect (files starving before any provider is
consulted); the provider limit was never the tight constraint.

Option C (dynamically trim/summarize mandatory governance/safety content) was rejected outright: it directly
violates the requirement that mandatory governance and safety instructions are never summarized or
truncated, it introduces non-deterministic content-dependent behavior into a system whose apply model is
exact-content and deterministic, and it does nothing to address the real defect, which was an under-sized
budget, not oversized mandatory content — the measured mandatory-ish content (~48,000–49,600 characters)
is a small fraction of what a well-calibrated budget can comfortably hold.

Option D (raise only the Context Builder number, with no explicit cross-layer invariant) was rejected as
incomplete: without a composition-time check, a future edit to either default, or an operator lowering
`BUILDERAI_PROVIDER_MAX_INPUT_CHARACTERS`, could silently reintroduce the same failure mode and would only
be discovered on a live user request producing `PROMPT_SIZE_EXCEEDED` or a provider contract violation.

## Consequences

Positive:

- Real Project Brain, governance-document, and source-file content now fits comfortably within Context
  Builder's budget with measured, documented headroom, and relevant source files reliably survive selection
  instead of being the first and only thing discarded.
- The safe ordering across all three budgets is proven at startup, not discovered on a live request; a
  misconfigured `BUILDERAI_PROVIDER_MAX_INPUT_CHARACTERS` now fails immediately with an actionable message.
- `PromptOrchestratorValidationError` and `ProviderContractViolationError` are now mapped to stable, typed
  422 responses by the Prepare API (`src/app/api/workspace/prepare/route.ts`), matching the existing
  `ContextBuilderValidationError`/`ResponseProcessorValidationError`/`ChangePlanValidationError` handling
  from ADR-014's Prepare API work instead of falling through to a generic 500.
- No token estimation infrastructure, no provider-awareness in Context Builder or Prompt Orchestrator, and
  no content truncation/summarization were introduced.

Negative:

- The Context Builder and Prompt Orchestrator budgets are larger, so a genuinely pathological request (for
  example, an unusually large number of highly-relevant real source files across a very large future
  repository) could still, in principle, reach the new ceilings sooner than it would have on an idealized
  unlimited budget. This is an accepted, bounded, and explicit trade-off; `CONTEXT_SIZE_EXCEEDED` and
  `PROMPT_SIZE_EXCEEDED` remain reachable and correctly reported failure modes, not silently masked ones.
- The reserved-headroom constants (15,000 and 25,000 characters) are deliberately conservative fixed
  numbers rather than a percentage or provider-context-window-derived value; if a future provider's
  effective limit is much smaller than 200,000 characters, an operator lowering
  `BUILDERAI_PROVIDER_MAX_INPUT_CHARACTERS` below 145,000 will now correctly fail composition and must be
  addressed by lowering the Prompt Orchestrator/Context Builder budgets in tandem (a follow-up decision, not
  silently absorbed).

## Security and privacy impact

This change alters no trust boundary, I/O path, or data-handling behavior. It only recalibrates size limits
and adds a startup-time arithmetic check plus two new typed-error-to-422 mappings that expose the same
structured validation-issue shape already returned for sibling validation errors, with no new information
disclosure.

## Rollout and reversal

`src/infrastructure/workspace/budget-invariant.test.ts` and the extended
`src/infrastructure/workspace/local-runtime-configuration.test.ts` prove the invariant holds for the current
defaults and fails fast for an under-configured provider limit.
`src/infrastructure/blueprint-reader/context-prompt-budget.integration.test.ts` is a permanent real-content
regression guard. `src/app/api/workspace/prepare/route.test.ts` covers both new error mappings. Reversal
would mean restoring the prior 50,000/75,000 defaults and removing `budget-invariant.ts` and its call site;
nothing in this change is destructive or data-affecting, so reversal is a pure code change.
