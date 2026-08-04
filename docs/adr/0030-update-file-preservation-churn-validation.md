# ADR-030: UPDATE_FILE preservation and churn validation at Change Plan time

- **Status:** Accepted
- **Date:** 2026-08-04
- **Owners:** BuilderAI architecture
- **Related:** ADR-010 (Project Change Plan boundary), ADR-011 (Safe File Apply boundary), ADR-016
  (Workspace Visibility port), ADR-017 (PATCH removal / full-file UPDATE semantics), ADR-020
  (bounded apply retry), ADR-021 (verification eligibility), ADR-024 (iteration feedback loop),
  ADR-029 (correction output bounding), pendingWork `authorize-artifact-application`

## Context

Smoke Test #2 demonstrated that BuilderAI's existing-project **UPDATE_FILE** workflow is functionally
sound: prepare → Gate 2 → apply → verification can succeed end-to-end. It also demonstrated a
recurring failure class during **correction** prepares: provider output can be schema-valid,
Response-Package-valid, and Change-Plan-valid while proposing a **full-file replacement** that
rewrites unrelated structure, removes existing DOM identifiers, drops accessibility attributes, and
breaks cross-file contracts with unchanged sibling files (for example HTML `id` renames while
`assets/app.js` remains untouched).

This is not a provider-transport defect alone. The current architecture **requires** full replacement
content for every `UPDATE_FILE` (ADR-017). The Change Planner optionally verifies target **existence**
through `WorkspaceVisibilityPort` (ADR-016) but never compares proposed content to workspace
**baseline** content. The Response Processor validates artifact shape and checksums of **proposed**
content only. Safe File Apply performs conditional overwrite without an **expected-current-content**
check (explicitly deferred for local MVP; see `authorize-artifact-application` pendingWork).
Verification runs only **after** apply and, for typical project scripts, catches some structural
regressions (missing DOM hooks) but not all semantic or accessibility preservation issues **before**
human approval.

Gate 2 correctly blocked unsafe Smoke Test #2 Phase 3 proposals, but only because the operator
inspected full proposed file bodies manually. The engine provides no deterministic preservation
signal to make that review reliable for owner self-use on existing projects.

## Problem

Define the failure class **UPDATE preservation violation**:

1. **Excessive full-file churn** — an `UPDATE_FILE` replaces most baseline content although the
   operator request implied a surgical change.
2. **Removed or renamed stable identifiers** — for HTML, `id="..."` values present in baseline
   disappear from proposed content without a co-update of dependent files.
3. **Removed accessibility attributes** — baseline `aria-*` attributes (including `aria-label`,
   `aria-labelledby`, `aria-live`) disappear from proposed markup.
4. **Removed imports/references** — baseline `script`, `link`, or module references disappear from
   proposed HTML/CSS/JS text (deterministic string-level detection only in v1).
5. **Unexpected large deletion** — proposed content deletes a large fraction of baseline lines while
   adding few replacements.
6. **Cross-file contract risk** — proposed HTML removes an `id` still referenced by literal
   `getElementById('...')` / `querySelector('#...')` in an **unchanged** indexed sibling source file
   (narrow v1 scope; not general static analysis).
7. **Workspace drift after prepare** — baseline captured at plan time may differ from disk at apply
   time (time-of-check/time-of-use). This ADR addresses **plan-time** detection only; apply-time
   enforcement is a separate slice of `authorize-artifact-application`.

**Out of scope for this failure class:** provider rate limits, invalid JSON schema, CREATE/DELETE
precondition violations (already handled), patch/diff artifacts (ADR-017 forbids reintroduction).

### Plan-time vs apply-time separation

| Concern                                                    | When                     | Owner                                     |
| ---------------------------------------------------------- | ------------------------ | ----------------------------------------- |
| Preservation/churn analysis vs baseline at prepare         | **Plan time**            | Change Planner (+ optional baseline port) |
| Expected baseline checksum recorded on operation           | **Plan time** (metadata) | Change Planner                            |
| Compare disk content to recorded baseline before overwrite | **Apply time** (future)  | Safe File Apply Engine                    |
| Build/test structural checks                               | **After apply**          | Verification Engine                       |

## Decision drivers

- Preserve ADR-017 **full-file replacement** semantics; do **not** reintroduce `PATCH` artifacts or
  hidden patch application.
- Preserve ADR-010 effect-free Change Planner core: no mutations, no provider coupling, synchronous
  planning.
- Keep provider adapters and Response Processor contracts **unchanged**; analysis runs after a
  validated Response Package is mapped to operations.
- Prefer **deterministic, provider-independent** analysis; no AI-based validator.
- Avoid false-positive **hard rejects** on legitimate redesigns where high churn is intentional.
- Make Gate 2 review materially safer for owner self-use without requiring a full IDE diff in v1.
- Align with, but do not fully implement, `authorize-artifact-application` expected-current-content
  goals.
- Remain backward compatible: callers without a baseline port keep today's behavior.

## Considered options

1. **Prompt-only stronger preservation instructions** — rejected as necessary but insufficient
   (Smoke Test #2 Phase 3 Attempt #2 proved prose and path bounding alone do not prevent rewrites).
2. **Extend `WorkspaceVisibilityPort` with `readFile()`** — rejected; ADR-016 deliberately exposes
   existence booleans only; mixing content I/O into "visibility" blurs semantics and encourages
   callers to treat partial reads as existence proofs.
3. **Separate read-only `WorkspaceBaselinePort` + deterministic analysis service** — **selected**.
4. **Patch/diff provider contract** — rejected (reverses ADR-017; introduces hidden transformation
   risk).
5. **Apply-time-only expected-content checks without plan-time analysis** — rejected as sole control;
   fails to improve Gate 2 review and pushes detection after approval intent.

## Decision

Adopt option 3. Introduce:

1. A new optional, synchronous, read-only **`WorkspaceBaselinePort`** in `src/core/change-planner`.
2. A pure **`UpdatePreservationAnalysisService`** that compares baseline text to proposed
   `UPDATE_FILE` content and emits deterministic metrics and findings.
3. Optional **`preservation` metadata** and **`baselineContentChecksum`** on `UPDATE_FILE` operations.
4. Plan-level **`warnings` / `risks`** derived from preservation findings using conservative
   severity mapping (warn-first; no churn-only hard rejects in v1).
5. A compact Gate 2 summary contract (UI slice deferred to implementation phase 3).

Provider output schema, Response Processor artifact types, and `CREATE_FILE` / `DELETE_FILE` semantics
are unchanged.

### WorkspaceBaselinePort (baseline content access)

New port (separate from ADR-016):

```typescript
export interface WorkspaceBaselineSnapshot {
  readonly logicalPath: string;
  readonly content: string;
  readonly checksum: ArtifactChecksum; // SHA-256 of normalized UTF-8 bytes
  readonly sizeBytes: number;
}

export interface WorkspaceBaselinePort {
  /**
   * Reads the current regular-file contents for planning-time comparison.
   * Returns null when the target is missing, not a regular file, is a symlink,
   * exceeds size limits, appears binary, or cannot be read deterministically.
   */
  readTextBaseline(logicalPath: string): WorkspaceBaselineSnapshot | null;
}
```

Infrastructure adapter (`NodeWorkspaceBaseline`) mirrors Safe File Apply containment rules:

- Resolve under configured workspace root; reject escape paths.
- Use `lstat` (do not follow symlinks); regular files only.
- UTF-8 text decode; if decoded content contains `\u0000`, treat as **binary** → return `null`.
- Configurable **`maximumBaselineBytes`** (default **524_288** / 512 KiB per file).
- Read failures return `null` (planner emits `PRESERVATION_BASELINE_UNAVAILABLE` warning; plan still
  produced).
- Deterministic: no network, no caching side effects across calls within one `plan()` invocation
  beyond explicit port implementation (adapter may read synchronously from disk each time).

`WorkspaceVisibilityPort` remains existence-only and unchanged.

### Preservation analysis (deterministic metrics)

For each `UPDATE_FILE` operation when `WorkspaceBaselinePort` is supplied:

1. Read baseline via port. If unavailable → warning `PRESERVATION_BASELINE_UNAVAILABLE`; skip metrics.
2. Normalize both baseline and proposed content: `\r\n` → `\n`, NFC Unicode normalization optional
   (v1: line-ending normalization only to match Response Processor behavior).
3. Compute:

| Metric                                           | Definition                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------ |
| `baselineBytes` / `proposedBytes`                | UTF-8 byte length after normalization                                          |
| `baselineLines` / `proposedLines`                | Split on `\n`; empty file = 0 lines                                            |
| `linesAdded` / `linesDeleted` / `linesUnchanged` | Line-level diff via deterministic LCS-based algorithm (pure, no external deps) |
| `churnRatio`                                     | `(linesAdded + linesDeleted) / max(baselineLines, 1)`                          |
| `similarityRatio`                                | `linesUnchanged / max(baselineLines, proposedLines, 1)`                        |

4. HTML-specific extractors when `logicalPath` ends with `.html` (case-insensitive):

- `removedHtmlIds` / `addedHtmlIds` — regex `\bid\s*=\s*["']([^"']+)["']` on baseline vs proposed.
- `removedAccessibilityAttributes` — attribute names matching `\baria-[a-zA-Z0-9-]+\b` present in
  baseline opening tags but absent in proposed (set difference of attribute **names**, not values).

5. Reference extractors (all text files, v1 minimal):

- `removedScriptReferences` — baseline `<script src="...">` or `from '...'` string literals missing
  from proposed (HTML/JS only, deterministic regex set documented in tests).

6. **Cross-file contract check (narrow v1):** when HTML update removes ids and plan does **not**
   include an UPDATE to a given sibling JS file, scan up to **`maximumCrossFileChecks`** (default **2**)
   unchanged `.js` files under `assets/` (if present on disk via baseline port) for literal
   `getElementById('id')`, `getElementById("id")`, `querySelector('#id')`. Emit
   `PRESERVATION_CROSS_FILE_REFERENCE_RISK` with the id and referencing path. **Defer** general static
   analysis, import graphs, and multi-language analysis.

No AI. No provider metadata. Same input → same output.

### Preservation findings representation

Attach optional **`preservation`** object to each `UPDATE_FILE` operation (validator allow-list
extended; absent on CREATE/DELETE and when port not configured):

```typescript
interface UpdatePreservationAssessment {
  readonly baselineContentChecksum?: ArtifactChecksum;
  readonly baselineBytes?: number;
  readonly proposedBytes?: number;
  readonly linesAdded?: number;
  readonly linesDeleted?: number;
  readonly linesUnchanged?: number;
  readonly churnRatio?: number; // 0..1 inclusive, rounded to 4 decimal places
  readonly similarityRatio?: number; // 0..1 inclusive, rounded to 4 decimal places
  readonly removedHtmlIds?: readonly string[];
  readonly addedHtmlIds?: readonly string[];
  readonly removedAccessibilityAttributes?: readonly string[];
  readonly crossFileReferenceRisks?: readonly {
    readonly removedId: string;
    readonly referencingLogicalPath: string;
  }[];
  readonly findings: readonly UpdatePreservationFinding[];
}

interface UpdatePreservationFinding {
  readonly code: PreservationFindingCode;
  readonly severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly message: string; // bounded, no raw file bodies
}
```

Also set optional top-level operation field:

- **`baselineContentChecksum`** — duplicate of `preservation.baselineContentChecksum` for apply-time
  consumers (Slice 4); checksum of **baseline at plan time**, distinct from existing `sourceChecksum`
  (proposed content checksum from Response Package manifest).

Serialized Change Plans remain **`schemaVersion: 1`**; new fields are optional extensions validated
only when present.

### Warning / rejection policy (conservative self-use)

**Default v1: warn-first. No hard reject for churn or preservation alone.**

| Condition                                                                                    | Severity | Plan effect                                                                             |
| -------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------- |
| Baseline unavailable for an UPDATE                                                           | MEDIUM   | Warning `PRESERVATION_BASELINE_UNAVAILABLE`                                             |
| `churnRatio >= 0.70`                                                                         | HIGH     | Warning `PRESERVATION_HIGH_CHURN_REWRITE` + Risk `HIGH_CHURN_REWRITE` (MEDIUM severity) |
| `0.40 <= churnRatio < 0.70`                                                                  | MEDIUM   | Informational warning `PRESERVATION_ELEVATED_CHURN`                                     |
| `churnRatio < 0.40`                                                                          | LOW      | No churn warning                                                                        |
| Any removed HTML id                                                                          | MEDIUM   | Warning `PRESERVATION_REMOVED_HTML_ID` (lists up to 8 ids)                              |
| Any removed `aria-*` name                                                                    | MEDIUM   | Warning `PRESERVATION_REMOVED_ARIA_ATTRIBUTE`                                           |
| Cross-file literal reference risk                                                            | HIGH     | Warning + Risk `PRESERVATION_CROSS_FILE_REFERENCE_RISK`                                 |
| `linesDeleted / max(baselineLines,1) >= 0.50` and `linesAdded / max(baselineLines,1) < 0.10` | MEDIUM   | Warning `PRESERVATION_LARGE_DELETION`                                                   |

**Hard rejects (unchanged from prior ADRs):** invalid Response Package, unsupported operations,
existence precondition violations (ADR-016), path/policy violations. Preservation analysis must **not**
reject a plan solely because churn is high.

**CRITICAL** severity is reserved for deterministic cross-file break (literal JS reference to removed
HTML id) where unchanged sibling file exists — still a **warning/risk**, not an automatic reject, so
Gate 2 remains the approval gate (ADR-024).

Legitimate redesigns with high churn remain allowed but are visibly flagged.

Thresholds live in **`ChangePlannerConfiguration.preservation`** (defaults above); tunable in tests.

### Expected baseline checksum and apply-time enforcement

- At **plan time**, when baseline read succeeds, record `baselineContentChecksum` on the operation.
- **`sourceChecksum`** continues to identify **proposed** content (unchanged provenance rule).
- **Apply-time compare-and-abort** (reject update when on-disk checksum ≠ `baselineContentChecksum`) is
  **explicitly deferred** to Slice 4 as part of `authorize-artifact-application`. This ADR only
  records the metadata required for that future enforcement.
- When apply-time enforcement is implemented, mismatch returns **`BASELINE_CONTENT_DRIFT`** (apply
  rejected; zero mutations for that operation) — addressing failure class **(7)**.

### Gate 2 UX contract (minimum, v1)

Prepare/ChangePlan consumers should receive enough structured data to render a **compact summary**
per UPDATE (full inline diff **not** required in v1):

- Baseline vs proposed checksums
- Churn and similarity percentages
- Lines added/deleted
- Removed HTML ids (truncated list)
- Preservation finding codes/severities
- HIGH churn indicator

`result-panel.tsx` `ChangePlanView` should list preservation summaries alongside existing operation
descriptions (implementation Slice 3). HTTP prepare responses already include full operation `content`
for manual review; preservation metadata reduces reliance on eyeballing entire files.

### Integration point

`ChangePlannerService.plan()` flow after `createOperations()`:

1. Existing Response Package validation and operation mapping (unchanged).
2. Existing `WorkspaceVisibilityPort` existence checks (unchanged).
3. **New:** for each `UPDATE_FILE`, if `WorkspaceBaselinePort` provided, run preservation analysis,
   attach `preservation` + `baselineContentChecksum`, merge findings into plan `warnings` / `risks`.
4. Existing conflict detection, ordering, summary, validator (extended allow-list).

Local runtime composition wires `NodeWorkspaceBaseline` alongside `NodeWorkspaceVisibility`
(`local-feature-workflow-runtime.ts`). Callers without baseline port: **byte-for-byte planning behavior
for preservation fields** (none emitted).

Correction workflow (ADR-024) and correction output bounding (ADR-029) unchanged; bounding limits
artifact paths, not churn.

## Alternatives considered (summary)

| Option                 | Why not                                            |
| ---------------------- | -------------------------------------------------- |
| PATCH artifacts        | ADR-017; hidden transformation; reviewability loss |
| Extend visibility port | Conflates existence booleans with content reads    |
| AI-based diff reviewer | Non-deterministic; provider-dependent              |
| Hard reject high churn | Blocks legitimate redesigns; false positives       |
| Full IDE diff UI now   | Out of scope; compact summary sufficient for v1    |

## Security implications

- Baseline port is **read-only**, root-scoped, size-bounded, symlink-aware — same trust model as
  ADR-016 adapter.
- Preservation messages must **not** embed secrets or large file bodies (bounded id/attribute lists
  only).
- Analysis does not expand which paths Apply may touch; protected-path policy remains in File Apply.
- No new external network surface.

## Backward compatibility

- Provider adapters: **unchanged**.
- Response Processor: **unchanged**.
- Without `WorkspaceBaselinePort`: plans identical to today except validator accepts optional fields on
  operations that aren't present.
- Activity History / preparation storage: optional fields pass through if already storing full
  ChangePlan JSON; consumers must ignore unknown fields (standard JSON forward compatibility).
- Existing tests remain valid; new tests cover preservation paths.

## Testing strategy

Deterministic unit tests (`UpdatePreservationAnalysisService`, planner integration):

1. Small surgical HTML attribute patch → no HIGH churn finding.
2. Moderate legitimate update (~45% churn) → `PRESERVATION_ELEVATED_CHURN` only.
3. Near-full rewrite (~95% churn) → `PRESERVATION_HIGH_CHURN_REWRITE`.
4. Removed HTML id → `PRESERVATION_REMOVED_HTML_ID`.
5. Removed `aria-label` / `aria-live` → `PRESERVATION_REMOVED_ARIA_ATTRIBUTE`.
6. Baseline unavailable (missing file, symlink, binary, oversize) →
   `PRESERVATION_BASELINE_UNAVAILABLE`; plan still produced.
7. CREATE / DELETE operations → no preservation block attached.
8. Existing ChangePlan validation passes for plans without preservation fields.
9. Smoke #2 Phase 3 Attempt #2 scenario fixture → HIGH churn + removed ids + cross-file JS risk
   surfaced.
10. `baselineContentChecksum` deterministic and stable for fixed baseline text.
11. (Slice 4) apply-time drift detection tests when enforcement lands.

Adapter tests for `NodeWorkspaceBaseline`: containment, symlink rejection, size cap.

## Rollout sequence (implementation slices)

| Slice | Deliverable                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------ |
| **1** | `WorkspaceBaselinePort`, `NodeWorkspaceBaseline`, `UpdatePreservationAnalysisService` + unit tests           |
| **2** | `ChangePlannerService` integration, config thresholds, plan warnings/risks, validator allow-list             |
| **3** | Gate 2 compact preservation summary in `ChangePlanView` / prepare response typing                            |
| **4** | Apply-time `baselineContentChecksum` enforcement in File Apply (subtask of `authorize-artifact-application`) |

Prompt-only preservation instruction improvements may ship in any slice but are not sufficient alone.

## Relationship to `authorize-artifact-application`

PendingWork already requires **expected-current-content checks** before overwrite. ADR-030 delivers the
**plan-time half** (baseline snapshot, checksum metadata, reviewer-facing churn/id signals). Slice 4
implements the **apply-time half** using `baselineContentChecksum`, locking, and drift rejection —
without duplicating the full pendingWork scope (audit evidence, multi-writer locking, secret scanning).

## Explicit non-goals

- PATCH / diff artifacts or patch application
- Automatic AI repair or dynamic model routing
- Auth, tenancy, billing, deployment, hosted sandbox
- Provider schema changes
- Full static analysis or IDE-grade diff UI
- Hard reject of high-churn UPDATE plans in v1
- Verification-stage preservation (remains post-apply)

## Consequences

Positive:

- Gate 2 receives deterministic signals for the exact Smoke Test #2 failure class.
- Owner self-use on existing projects becomes reviewable without manual full-file diff in common cases.
- Apply-time enforcement path is unblocked via recorded baseline checksum.

Negative:

- One new port and analysis service increase Change Planner surface area (still effect-free).
- Time-of-check/time-of-use gap remains until Slice 4 apply enforcement.
- Cross-file analysis is intentionally narrow; not all contract breaks are detected.

## Rollout and reversal

Feature is additive and gated by composition-root wiring of `WorkspaceBaselinePort`. Reversal: remove
port wiring and preservation integration; extended validator fields become unused; behavior reverts to
ADR-016 existence checks only.
