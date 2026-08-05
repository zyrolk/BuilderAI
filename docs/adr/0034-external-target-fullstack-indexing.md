# ADR-0034: External-target full-stack indexing and context coverage

## Status

Accepted

## Context

ADR-0033 enabled external-target onboarding, but Context Builder discovery and selection remained
too narrow for cross-stack features spanning React UI, Express routes/services, shared contracts,
tests, and configuration. Checkpoint 2 must improve relevance-oriented coverage without unbounded
scanning or silent scope expansion (ADR-031 remains authoritative).

## Decision

1. **Scan policy:** extend default scan roots with `features`, `shared`, `client`, and `backend`.
   External-target manifests may optionally declare bounded `sourceRoots` and `staticSourceRoots`
   (`public`/`static` only) with validated relative paths, textual extension filtering, and binary
   exclusion.

2. **Context retrieval:** infer cross-stack categories from domain keywords while respecting
   backend-only or frontend-only task focus. Apply category floors, domain-directory and basename
   affinity scoring, bounded import traversal, nearby-test discovery, and explicit path extraction
   shared between scope planning and dependency resolution.

3. **Admission quotas:** raise `maxFiles` from 12 to 16 with separate implementation/test/config
   quotas so one category cannot consume the entire budget.

4. **Selection evidence:** attach deterministic `selectionEvidence` metadata (explicit path, task
   keyword, source category, related import, nearby test) without exposing prompt internals.

Supporting/reference files may enter context without becoming preferred update paths. HARD scope still
requires explicit "only" instructions per ADR-031.

## Consequences

- External targets such as Zyro.lk can surface frontend, backend, shared, and test evidence for
  cross-stack tasks within existing read and character budgets.
- `public/` and `static/` remain opt-in through manifest configuration; binaries stay excluded.
- BUILDERAI_SELF behavior is unchanged when the external-target profile is not selected.
- Operator iteration UX (Checkpoint 3) and Zyro-aligned verification guidance (Checkpoint 4) remain
  pending.
