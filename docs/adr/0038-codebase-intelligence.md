# ADR-038: Codebase Intelligence (P1-B B2)

- **Status:** Accepted
- **Date:** 2026-08-21
- **Owners:** BuilderAI architecture
- **Related:** ADR-022 (Expanded indexing), ADR-023 (Task-aware retrieval), ADR-036 (Agent
  Operating Layer), ADR-037 (Tool Registry), P0/P1-A/B1 frozen baselines

## Context

B1 delivered a policy-gated Tool Registry with read-only proof tools (`search_repository`,
`read_source_file`, `inspect_readiness`) under ADR-037. Repository understanding still relies on
substring search, path ranking, shallow relative-import expansion, and Context Builder budgets.

The B2 architecture audit selected **Option A — Smallest Viable Codebase Intelligence**: improve
shared retrieval, fix lexicographic inventory truncation before scoring, and add bounded
READ/SEARCH/INSPECT tools—without LSP, embeddings, mutation, or an agent loop.

## Decision drivers

- Materially improve relevant-file discovery on large repositories.
- Reuse investigation search, path relevance, evidence expansion, Context Builder scoring,
  `ProjectFileSource`, and confidentiality—do not fork parallel systems.
- Keep B1 tool IDs and contracts stable.
- Preserve Gate 2 / FileApply / `toolCalling: false` / no autonomous loop.

## Considered options

1. **Option A — Smallest viable** — Shared retrieval + inventory fix + related/context/outline/import
   tools. **Selected.**
2. **Option B — Durable token index** — Deferred unless Option A fails measured latency DoD.
3. **Option C — LSP / TS Language Service / embeddings** — Rejected for B2 (cost, scope, ADR-023).

## Decision

**P1-B B2 = Codebase Intelligence (Option A).**

### What B2 is

- Shared retrieval foundation used by investigation and B2 tools.
- Relevance-first inventory selection (no blind lexicographic pre-truncation before scoring).
- Services: `RelatedFilesService`, `RelevantContextService`, `FileOutlineService`, import inspection.
- Additive registry factory `createB2IntelligenceRegistry` = B1 tools unchanged + B2 tools.
- B2 tools (read-only): `find_related_files`, `retrieve_relevant_context`, `inspect_file_outline`,
  `inspect_imports`.

### What B2 is not

- Not B3 file editing / mutation / FileApply dependency.
- Not Gate 2 changes, terminal, Git write, MCP, browser autonomy.
- Not provider `toolCalling`, not an autonomous agent loop.
- Not LSP / TypeScript Language Service / AST program analysis.
- Not embeddings / vector DB.
- Not a durable token index (deferred).
- Not a second search, filesystem, authorization, sanitization, ledger, or verification stack.
- Not PathCatalogCache unless listing is measured as a bottleneck (not added speculatively).

### Safety invariants

1. All B2 tools: `readOnly: true`, SEARCH/READ/INSPECT only, `requiresGate2: false`,
   `approvalRequirement: NONE`, never `APPLY`.
2. Tool Registry must not depend on FileApply, mutating FileSystemPort APIs, or provider SDK tool
   execution.
3. FS reads go through caller-supplied `ProjectFileSource` (confidentiality-wrapped in production).
4. Model-facing results remain bounded and sanitized (ADR-037 forbidden-key posture).
5. B1 tool IDs/behavior remain stable; B2 is additive.

### Definition of Done (measurable)

1. **Recall:** ≥3 scripted goals (API, test, schema/config); planted targets in top-K (K≤16).
2. **Boundedness:** Hard file/read/character caps; no full-repo model payloads.
3. **Scale:** Completes within timeouts; does not scan beyond hard caps; fixture ≥2 000 paths.
4. **Inventory regression:** High-relevance file beyond former lexical 15k cutoff remains selectable.
5. **Safety:** FileApply calls = 0; `toolCalling: false`; forbidden keys absent; protected paths denied.
6. **Reuse:** Existing search/context/FS/confidentiality infrastructure.
7. **B1 freeze:** Existing B1 proof-tool tests pass unchanged.

## Consequences

### Positive

- Agents (and investigation) can discover related files and bounded context more reliably.
- Large-repo blind spot from lex-pre-truncation is closed.

### Negative / accepted limits

- Regex outline only—no true symbol graph or find-references.
- Relative imports only (same as today).
- No durable code index in B2.

## Security and privacy impact

- No new mutation or network surface.
- Same sanitization / confidentiality / authorization boundaries as B1.
- Mutation trust boundary unchanged: Gate 2 + FileApply only.

## Rollout and reversal

- Ship services + B2 registry factory + tests; leave HTTP/UI loop out of B2.
- Reversal: stop registering B2 tools; B1 registry and P0/P1-A remain intact.
