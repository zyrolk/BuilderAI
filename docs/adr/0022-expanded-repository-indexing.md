# ADR-022: Expanded repository indexing for ProjectFileSource

- **Status:** Accepted
- **Date:** 2026-08-01
- **Owners:** BuilderAI architecture
- **Related:** ADR-004 (Context Builder boundary), ADR-018 (Context/Prompt budget invariant), ADR-014
  (Local MVP runtime composition)

## Context

Large real websites and applications keep AI-relevant material outside a single `src/` tree: root
tooling configs, Prisma/Drizzle schemas, migrations, tests, monorepo package roots, and alternate
framework source directories (`app/`, `pages/`, etc.). The local `NodeProjectFileSource` adapter
previously scanned only `<projectRoot>/src` with a narrow extension set, so Context Builder's
candidate path catalog could not represent those files even though downstream selection and read
limits (`maxSourceReads`, `maxFiles`, character budgets) were already bounded.

The Large-Project Capability Audit identified this as a Phase 1 blocker distinct from Phase 2
task-aware retrieval improvements.

## Decision drivers

- Expand **discovery only**; do not change Context Selection scoring or inclusion limits.
- Preserve containment, symlink rejection, and fail-closed path validation.
- Keep deterministic, testable indexing with explicit allowlists rather than repository-wide JSON
  discovery.
- Maintain backward compatibility for existing `src/`-based repositories without configuration.
- Avoid invalidating ADR-018 character budgets; the catalog limit (`maxSourcePaths`) may increase
  independently because it counts candidate paths in metadata, not serialized context content.

## Considered options

1. Keep `src/`-only scanning and defer all other layouts to manual operator hints.
2. Configurable scan roots only, with extension filtering inside each root.
3. Repository-wide recursive scan with global extension allowlisting.
4. **Hybrid (chosen):** default scan roots + explicit root-level configuration allowlist + extension
   allowlist + directory denylist, with one optional environment escape hatch for extra roots.

## Decision

Use option 4.

`src/infrastructure/project/project-source-index-policy.ts` defines the durable indexing policy:

- **Default scan roots:** `src`, `app`, `pages`, `components`, `lib`, `server`, `api`, `prisma`,
  `drizzle`, `migrations`, `tests`, `test`, `__tests__`, `scripts`, `apps`, `packages`. Missing
  roots are skipped without error.
- **Root configuration allowlist:** explicitly named files/patterns at repository depth 0 only
  (`package.json`, `tsconfig*.json`, framework/tool configs, etc.). Arbitrary repository-root JSON
  is not discovered.
- **Extensions inside scan roots:** existing set plus `.cjs`, `.prisma`, and `.sql`. General `.md`
  discovery remains excluded; governance markdown continues through Blueprint Reader.
- **Directory denylist:** existing ignores plus common generated/cache/output directories (`build`,
  `out`, `.turbo`, `.cache`, `.vercel`, `.nuxt`, `.svelte-kit`, etc.).
- **File denylist:** `.env`, `.env.*`, lockfiles, and other explicitly excluded names.
- **`public/` and `static/`** are not default scan roots and are blocked from
  `BUILDERAI_EXTRA_SOURCE_SCAN_ROOTS`.

`NodeProjectFileSource` implements traversal/read behavior against that policy. Before recursing into
a directory it uses `lstat` to skip symlink directories. `readSourceFile()` retains existing
containment and per-segment symlink rejection.

**Configuration escape hatch:** `BUILDERAI_EXTRA_SOURCE_SCAN_ROOTS` accepts a comma-separated list of
safe repository-relative paths validated conservatively (no `..`, no absolute paths, blocked roots
rejected, deduplicated, capped at 32 additional roots).

**Catalog limit:** `DEFAULT_CONTEXT_LIMITS.maxSourcePaths` increases from **5,000** to **15,000**.
`maxSourceReads` (24), `maxFiles` (12), and `maxCharacters` (95,000) are unchanged.

### Rejected alternatives

Option 1 was rejected because it leaves the confirmed large-project visibility blocker intact.

Option 3 was rejected because repository-wide scanning over-discovers docs, assets, and lockfile
adjacent noise, duplicates Blueprint Reader boundaries, and makes deterministic bounding harder.

## Consequences

Positive:

- Candidate catalogs for real web/app repositories now include schemas, root configs, tests, and
  common alternate source roots while selection remains bounded in Context Builder.
- Existing `src/`-only repositories continue to work without operator configuration.
- Policy constants are centralized, testable, and documented.

Negative:

- Larger candidate catalogs increase listing work on each prepare (acceptable for the internal local
  tool).
- Repositories with more than 15,000 discovered candidates still fail closed with
  `CONTEXT_SIZE_EXCEEDED`; further policy tuning may be required for pathological trees.
- Discovering a path does not imply it will be selected for AI context (Phase 2 retrieval remains
  separate work).

## Security and privacy impact

Traversal remains confined to `projectRoot`. Symlink skipping/hardening, env-file exclusion, and
safe relative path validation are preserved. Expanded discovery does not authorize execution,
network access, or disclosure of discovered content. Lockfiles and env files are excluded from the
catalog.

## Rollout and reversal

Unit tests in `src/infrastructure/project/` cover roots, allowlists, exclusions, symlinks,
determinism, extra roots, and the 15,000-path catalog boundary. The existing
`context-prompt-budget.integration.test.ts` regression guard proves ADR-018 character budgets remain
intact. Reversal means restoring `src/`-only scanning, removing the policy module, and lowering
`maxSourcePaths` to 5,000.

## Project Brain follow-up

Record this decision in the canonical decision log through the normal intent-based Project Brain
command path after merge; do not hand-edit `project-brain.json`.
