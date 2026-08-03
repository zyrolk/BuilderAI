# ADR-019: Bounded single-retry orchestration in the execution services for transient provider outages

- **Status:** Accepted
- **Date:** 2026-08-01
- **Owners:** BuilderAI architecture
- **Related:** ADR-007 (Execution Engine lifecycle), ADR-008 (OpenAI Responses adapter), ADR-015 (Gemini
  provider adapter), ADR-014 (Local MVP runtime composition), ADR-018 (Context/Prompt/provider budget
  invariant). Partially supersedes the "one attempt only, ever" system-level behavior described in ADR-008
  and ADR-015; both ADRs' SDK-level "no retry" decisions remain fully in force and unchanged.

## Context

Every layer of the current pipeline was configured for exactly one provider attempt, end to end.
`WorkspaceRuntimeService.prepare()` builds its `ExecutionRequest` with `failureStrategy: 'FAIL_FAST'` and
`retry: { maximumRetries: 0, delayStrategy: 'NONE', ... }`. `GeminiExecutionService`/`OpenAIExecutionService`
drove a single linear happy path — `create → ... → reserveExecution → provider.execute() → complete` — and
on any provider error simply propagated it without ever calling the Execution Engine's own `retry()`/`fail()`
lifecycle methods, so a failed attempt left its snapshot stranded in `EXECUTING` instead of reaching a
terminal state. The official SDKs are already configured with retries disabled (`maxRetries: 0` for OpenAI,
`retryOptions: { attempts: 1 }` for Gemini, per ADR-008/ADR-015) specifically so the Execution Engine's own
retry policy would be the single decision owner — but nothing ever exercised that policy at runtime, so a
single transient network blip or provider-side 5xx/429 failed the entire preparation immediately with no
recovery path, even though `RetryPolicyService`, `TimeoutPolicyService`, and the `EXECUTING → QUEUED` retry
transition already existed, fully tested, and unused.

## Decision drivers

- Launch reliability: a single transient `PROVIDER_UNAVAILABLE` failure (network blip, momentary 5xx/429)
  should not immediately fail an otherwise-successful preparation.
- At most 1–2 bounded retries; never retry permanent, configuration, or validation failures.
- No hidden duplicate mutations: exactly one logical execution identity, one `ExecutionRequest`, one reused
  `PromptPackage`, across every attempt.
- Provider-neutral core architecture: the Execution Engine remains the sole retry-policy decision owner; SDK
  retries stay disabled; no provider contract changes.
- Minimal complexity: no speculative retry infrastructure, no jitter, no exponential backoff, no new
  configuration surface beyond what launch requires.
- Observable, bounded attempts: retry storms and unbounded latency multiplication must be structurally
  impossible.
- The overall execution timeout budget must remain single and non-resettable: a retried attempt must never
  receive a fresh full timeout.

## Considered options

A. Use the existing Execution Engine retry-policy decision (`RetryPolicyService`/`ExecutionEngineService`)
and drive the actual retry loop — including the delay wait and cancellation check — imperatively inside
`GeminiExecutionService`/`OpenAIExecutionService`, immediately below the Engine.
B. Re-enable SDK-level retries (`maxRetries`/`retryOptions.attempts` > 1) and let the OpenAI/Gemini SDKs
retry internally.
C. Move retry orchestration into `WorkspaceRuntimeService.prepare()`, re-invoking
`providerExecution.execute()` (and therefore the whole Execution Engine lifecycle, including a fresh
`ExecutionRequest`/`executionId`) on failure.
D. Any smaller/safer design than A.

## Decision

Use option A. `GeminiExecutionService.execute()` and `OpenAIExecutionService.execute()` now loop: on a
provider failure, they translate the caught `AIProviderError` to an `ExecutionFailure` and call the existing
`ExecutionEngineService.retry()` — the same pure decision API ADR-007 already defined and tests already
covered, now finally invoked. Only `PROVIDER_UNAVAILABLE` is treated as retryable (`TIMEOUT`,
`CONTRACT_VIOLATION`, `INVALID_CONFIGURATION`, `CANCELLED`, and `UNSUPPORTED_CAPABILITY` are not).
`WorkspaceRuntimeService.createExecutionRequest()` sets `failureStrategy: 'RETRY_THEN_FAIL'`,
`retry: { maximumRetries: 1, delayStrategy: 'FIXED', baseDelayMs: 300, maximumDelayMs: 300,
retryableErrorCodes: ['PROVIDER_UNAVAILABLE'] }` — exactly one retry, exactly two total provider attempts,
a small deterministic fixed delay, no jitter, no exponential growth.

When `decision.shouldRetry` is `true`, the service waits out the fixed delay (via a plain `setTimeout`,
racing it against the request's cancellation subscription — cancellation firing during the wait resolves
first and skips the second provider call entirely), then loops back to `beginPreparation → markReady →
reserveExecution` on the _same_ snapshot lineage, so `attempt`, `revision`, and `history` accumulate
correctly and the retry path is exactly `EXECUTING → QUEUED → PREPARING → READY → EXECUTING`, per ADR-007's
existing transition graph. The same `ExecutionRequest` object (and therefore the same `executionId` and the
same `PromptPackage` reference) is reused verbatim across every attempt; nothing is rebuilt, and the
provider only ever sees `request.prompt` by reference, not a clone. When `decision.shouldRetry` is `false`
(non-retryable failure or retry limit reached), the service now calls `ExecutionEngineService.fail()` before
rethrowing the original, un-modified provider error — the snapshot always reaches a terminal state
(`FAILED`) instead of being left stranded in `EXECUTING`, while external callers observe exactly the same
error type and message as before this change.

Before every attempt — the first and the retried one — the service computes the remaining timeout budget
via the existing `TimeoutPolicyService.assess()` (using the same `startsAt: 'QUEUED'` reference point the
Engine already uses for timeout decisions) and caps that attempt's `AIProviderRequest.timeoutMs` to
`min(remainingMs, configuration.maximumTimeoutMs)`. This is the same single, non-resettable budget declared
once in the `ExecutionRequest.policy.timeout`; a retried attempt only ever receives what is left of it, never
a fresh full duration. Immediately after the delay wait — and before committing to loop back for the retried
attempt — the service re-assesses the same timeout policy; if the budget is already exhausted, it calls
`ExecutionEngineService.markTimedOut()` instead of retrying and rethrows the original provider error, so an
execution can never silently run longer than its declared budget just because a retry was scheduled.

### Rejected alternatives

Option B (SDK-level retries) was rejected because it was the exact failure mode ADR-008 and ADR-015
deliberately closed off: the SDK cannot see or honor the Execution Engine's failure-strategy, error-code
allowlist, cancellation state, or the single overall timeout budget, so it would silently compete with — and
could multiply latency far beyond — the Engine's own policy. It would also make retry behavior invisible to,
and untestable through, the Execution Engine's already-proven decision API.

Option C (retry from `WorkspaceRuntimeService`) was rejected because re-invoking
`providerExecution.execute()` means re-running the _entire_ Execution Engine lifecycle from `create()`
onward, which would mint a new internal snapshot lineage (a fresh `attempt`/`revision`/`history` sequence)
for what is supposed to be one logical execution, and would require either rebuilding the `ExecutionRequest`
(risking a fresh `PromptPackage` or a new provider-facing identity) or leaking Engine-internal retry
decisions up into the application layer, which is exactly the ownership split ADR-007 rejected when it kept
the generic transition primitive private to the Engine's own service.

Option D was not chosen over A because option A already satisfies every stated constraint (bounded count,
single timeout budget, single identity, provider-neutral core, no SDK retries, no speculative
infrastructure) with the smallest possible change: it adds one loop and two small private helpers to each
already-existing execution service, and one policy literal to `WorkspaceRuntimeService`, touching no
contracts.

## Consequences

Positive:

- A single transient `PROVIDER_UNAVAILABLE` failure (momentary network blip, 429, or 5xx) no longer fails an
  otherwise-successful `prepare()` call; the existing, previously-unused Execution Engine retry policy is now
  exercised in production.
- `TIMEOUT`, `CONTRACT_VIOLATION`, `INVALID_CONFIGURATION`, `CANCELLED`, and `UNSUPPORTED_CAPABILITY` failures
  are never retried and fail exactly as before, with the same rethrown error type.
- A failed execution's snapshot always reaches a terminal state (`FAILED` or `TIMED_OUT`); it is never left
  stranded in `EXECUTING`.
- The overall execution timeout budget cannot be reset or multiplied by a retry: every attempt is capped to
  whatever remains of the one declared budget, and an execution that has already exhausted its budget is
  terminated via the existing timeout lifecycle rather than attempting a doomed second call.
- Cancellation is honored during the retry delay; a cancelled execution never issues a second provider call.
- Gemini and OpenAI behavior remains fully symmetrical: both execution services implement the identical
  retry loop, error-to-failure mapping, and timeout-capping logic.
- SDK-level retries remain disabled and untouched (`maxRetries: 0` for OpenAI, `retryOptions: { attempts: 1 }`
  for Gemini); no provider contract, Response Processor, Change Planner, File Apply, or
  `WorkspaceVisibilityPort` behavior changed.

Negative:

- The retry loop and the `AIProviderError → ExecutionFailure` mapping are duplicated once per provider
  execution service (rather than factored into a shared module), matching this codebase's existing
  convention of fully independent, self-contained provider modules with zero cross-provider imports; a
  future third provider would repeat this same small, well-tested pattern.
- A worst-case preparation can now take up to roughly one attempt's provider latency, plus the 300ms fixed
  delay, plus a second attempt's latency, bounded by the single overall timeout budget — a bounded, explicit,
  and intentional trade-off in exchange for surviving one transient outage.

## Security and privacy impact

No new trust boundary, credential, or I/O path is introduced. The same `PromptPackage` is sent to the same
provider on a retried attempt; no additional data is exposed, logged, or persisted. Cancellation semantics
are preserved and strengthened (a cancelled execution can no longer issue a second provider call after the
first fails).

## Rollout and reversal

`src/providers/gemini/test/execution-retry.test.ts` and `src/providers/openai/test/execution-retry.test.ts`
cover: retry-then-succeed, retry-exhausted-then-`FAILED`, each non-retryable error code, cancellation during
the retry delay, timeout-budget capping and exhaustion, execution/prompt identity reuse, and unchanged SDK
retry settings (covered by the pre-existing `configuration-and-errors.test.ts` /
`configuration-and-transport.test.ts` assertions, which this change does not touch).
`src/application/workspace/workspace-runtime.service.test.ts` adds an end-to-end integration test proving
`WorkspaceRuntimeService.prepare()` transparently recovers from one transient provider outage. Reversal means
restoring `WorkspaceRuntimeService.createExecutionRequest()`'s `FAIL_FAST`/`maximumRetries: 0` policy and
reverting the two execution services to their single linear happy path; nothing here is destructive or
data-affecting.

**Update (ADR-029):** For correction prepares that fail attempt 1 with `OUTPUT_TRUNCATED`, attempt 2 may apply
deterministic scope compaction instead of repeating the identical oversized request. All other ADR-019 retry
invariants remain unchanged. See ADR-029.
