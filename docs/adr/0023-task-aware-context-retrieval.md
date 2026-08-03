# ADR-023: Task-aware deterministic context retrieval

- **Status:** Accepted
- **Date:** 2026-08-02
- **Owners:** BuilderAI architecture
- **Related:** ADR-004 (Context Builder boundary), ADR-018 (Context/Prompt budget invariant),
  ADR-022 (Expanded repository indexing)

## Context

Phase 1 (ADR-022) expanded the candidate path catalog to include schemas, tests, alternate source
roots, and root configuration files. Phase 2 must select the most relevant files for a task from
potentially thousands of candidates while preserving deterministic, bounded, provider-independent
behavior.

The pre-Phase-2 retrieval model had confirmed defects:

- Scored Project Brain modules flooded the seed set with every file under a module path.
- Lexical overlap required exact token matches with threshold ≥ 2, missing auth/admin/schema paths.
- Reads occurred in seed order for all module files until the read budget exhausted.
- No content-aware reranking or size-aware admission existed.

Embeddings, vector databases, and additional provider exploration calls were explicitly out of scope
for an internal single-operator local tool at this stage.

## Decision drivers

- Materially improve cross-cutting feature retrieval (e.g. reviews touching auth, orders, schema,
  API, admin, tests) without expanding character budgets.
- Preserve deterministic behavior before any provider call.
- Keep Project Brain optional; incomplete `folderOwnership` must not break retrieval.
- Preserve ADR-018 budgets (`maxCharacters` 95,000, `maxFiles` 12, Prompt 120,000).
- Remain testable with explicit named scoring weights.
- Do not execute repository content or weaken Phase 1 discovery/security boundaries.

## Decision

Use layered **deterministic local retrieval** inside `DependencyResolutionService` and supporting
modules under `src/core/context-builder/internal/`.

### Pipeline

1. **Global path-only ranking** across the full Phase 1 catalog.
2. **Bounded read shortlist** (`READ_SHORTLIST_CAPACITY = 36`) with optional category floors.
3. **Content-aware reranking** after reads (bounded content overlap cap).
4. **Bounded dependency expansion** from top 8 parents by combined score.
5. **Size-aware ranking** using `effectiveScore = combinedScore / (baseLogFactor + largeFilePenalty)`.
6. **Measured greedy file admission** in `ContextBuilderService` against
   `maxCharacters - CONTEXT_PACKAGE_RESERVED_HEADROOM_CHARACTERS` (5,000), preserving ADR-018
   headroom without raising character budgets.
7. Existing Context Builder limits (`maxFiles = 12`, character budget enforcement) remain downstream.

### Scoring weights (`CONTEXT_RETRIEVAL_SCORING`)

| Signal                                        | Weight        |
| --------------------------------------------- | ------------- |
| Token overlap                                 | 1             |
| Path segment match                            | 2 per segment |
| Filename/stem match                           | 3             |
| Generic role hint (when task category active) | 2             |
| Module boost (only when base score ≥ 1)       | 3             |
| Schema/special file boost (conditional)       | 5             |
| Test file boost (test-primary tasks only)     | 3             |
| `package.json` boost (conditional)            | 2             |
| Content overlap                               | 1 (cap 5)     |
| Import inheritance decay                      | 0.8           |

**Tie-break:** higher score → shorter path → lexicographic path.

### Task categories (generic inference only)

`DATABASE`, `API`, `AUTH_ADMIN`, `TESTS`, `UI` — inferred from conservative keyword sets. Categories
influence ranking and shortlist floors; they are not hard requirements.

Category floors replace the lowest-ranked shortlist slot when a strong candidate exists and the
category is active. Test shortlist floors apply only for **test-primary** tasks (explicit testing
intent such as “add tests for …”), not incidental “update tests as needed” mentions. `.fixture.`
paths score zero unless testing is the task focus.

### Project Brain module behavior change

**Old:** every file under a scored module became a read seed.

**New:** module membership applies a bounded boost (+3) only when the file already has base path
relevance (`baseScore >= 1`).

### Read budget

`DEFAULT_CONTEXT_LIMITS.maxSourceReads` increases from **24 → 36**.

`READ_SHORTLIST_CAPACITY` is fixed at **36** and is independent of per-request read-limit overrides
used in tests.

Unchanged: `maxSourcePaths = 15,000`, `maxFiles = 12`, `maxCharacters = 95,000`.

### Rejected alternatives

- **Embeddings / vector search:** rejected — unnecessary complexity, non-deterministic, external
  infrastructure, not justified for current internal goal.
- **Additional provider exploration call:** rejected — cost, non-determinism, scope creep.
- **Raising `maxFiles` / `maxCharacters`:** rejected — selection quality first; ADR-018 regression
  tests must continue to pass without budget changes.

## Consequences

Positive:

- Cross-cutting tasks can retrieve schema, auth, orders, API, admin, and test exemplars in one
  bounded selection pass.
- Module flooding removed; read budget spent on globally ranked candidates.
- Large weakly relevant files penalized without excluding critical large files outright.
- Fully regression-tested with representative repository fixtures.

Negative:

- Explicit heuristic weights require tuning as new layouts appear; mitigated by fixture tests.
- Relative import expansion remains limited (no `@/` alias resolver in Phase 2).
- Shortlist/floor heuristics may still miss unconventional paths until Phase 1 extra roots or future
  retrieval tuning.

## Security and privacy impact

No change to trust boundaries. Repository content remains untrusted data read through
`ProjectFileSource` under existing containment rules. No code execution, no `.env` discovery, bounded
reads/files preserved.

## Rollout and reversal

Regression tests in `src/core/context-builder/services/context-retrieval.test.ts` and
`src/infrastructure/blueprint-reader/context-prompt-budget.integration.test.ts` guard behavior.
Reversal restores module flooding seed logic and `maxSourceReads = 24`.

## Project Brain follow-up

Record this decision in the canonical decision log through the normal intent-based Project Brain
command path after merge; do not hand-edit `project-brain.json`.
