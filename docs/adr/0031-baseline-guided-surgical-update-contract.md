# ADR-031: Baseline-Guided Surgical UPDATE Contract

- **Status:** Accepted (implemented and live-validated)
- **Date:** 2026-08-04
- **Owners:** BuilderAI architecture
- **Related:** ADR-017 (full-file UPDATE semantics), ADR-023 (task-aware context retrieval),
  ADR-024 (iteration feedback loop), ADR-029 (correction output bounding), ADR-030 (UPDATE
  preservation and drift protection)

## Context

Real-smoke validation after ADR-030 demonstrated that BuilderAI's **detection and safety** stack
works: broad provider rewrites are flagged at Change Plan time, rejected at Gate 2, and protected at
apply time by `BASELINE_CONTENT_DRIFT`. The remaining failure class is **generation quality**: for
small modification requests on existing projects, providers frequently emit schema-valid
`UPDATE_FILE` artifacts that rewrite unrelated sections, touch unrequested files, alter stable IDs,
remove accessibility attributes, and break behavior such as `localStorage` persistence.

ADR-030 addresses this class **after** provider generation through deterministic preservation
analysis, Gate 2 review, and apply-time drift checks. It intentionally does **not** inject baseline
content or preservation instructions into the provider prompt. The read-only Surgical UPDATE
Reliability Diagnostic confirmed:

- `WorkspaceBaselinePort` reads current file content at **plan time** but that content is not supplied
  to the provider as authoritative **CURRENT BASELINE**.
- Context Builder selects up to 12 relevance-ranked files with **no guarantee** that an UPDATE target
  appears in `relevantFiles`.
- Initial prepares have **no** deterministic update-scope plan; operator phrases such as "prefer
  index.html only" are prose only.
- Prompt Orchestrator correction instructions constrain **artifact count**, not **edit magnitude**
  within each file.
- Gemini/OpenAI schemas require **complete target file content**, which models often interpret as
  permission to regenerate the entire file.

This ADR introduces **pre-generation** baseline-guided surgical UPDATE behavior. It does **not**
reopen ADR-030, reverse ADR-017, or add PATCH/diff artifacts.

## Problem

Define the failure class **SURGICAL UPDATE GENERATION FAILURE**:

A request asks for a small modification to an existing working project, but the provider generates
schema-valid full-file `UPDATE_FILE` artifacts that unnecessarily:

1. Rewrite unrelated sections of a target file.
2. Touch files not required by the request.
3. Rename or restructure existing markup.
4. Alter content not requested by the operator.
5. Remove existing behavior (for example `localStorage` persistence).
6. Remove stable DOM IDs or accessibility attributes.
7. Break sibling-file contracts with unchanged files.

**ADR-030 role:** detect, surface for Gate 2 review, and protect against post-prepare drift.

**ADR-031 role:** improve generation quality **before** provider execution by supplying deterministic
baseline context, scope guidance, and MODIFY-not-REWRITE semantics.

## Decision drivers

- Owner self-use MVP requires reliable surgical modification of existing projects, not only safe
  rejection of bad plans.
- Preserve ADR-017: every accepted `UPDATE_FILE` carries **complete resulting file content**.
- Preserve Gate 2 human approval; no auto-apply or auto-reject based on scope alone.
- Preserve ADR-029 correction bounding as the authoritative correction allowlist mechanism.
- Preserve ADR-030 plan-time preservation analysis and apply-time drift protection unchanged.
- Provider-neutral orchestration; avoid provider-specific prompt duplication where possible.
- No second model call for scope planning in MVP.
- No automatic provider retry loops.
- Deterministic, testable contracts derived from repository evidence—not provider-invented invariants.
- Fail open when scope cannot be inferred reliably; never invent false hard constraints.

## Non-goals

ADR-031 does **not** introduce:

- PATCH/diff artifacts or patch application (ADR-017 remains authoritative).
- Automatic provider retry or correction loops.
- Second-model or AI-assisted scope planning.
- Dynamic provider routing or fallback.
- AST malicious-code scanning or secret vault (separate roadmap items).
- Multi-tenant isolation, background queues, or deployment orchestration.
- Hard auto-approval or Gate 2 removal.
- Changes to Response Processor validation rules beyond optional metadata passthrough.
- Changes to ADR-030 preservation algorithms or apply-time drift semantics.

## Decision

Adopt a provider-neutral **Baseline-Guided Surgical UPDATE Contract** composed of three concepts:

| Concept                                 | Purpose                                                             | When active                                                     |
| --------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------- |
| **A. `UpdateScopePlan`**                | Deterministic pre-provider scope inference                          | Initial and correction prepares when evidence supports it       |
| **B. Baseline Preservation Contract**   | Provider-facing CURRENT BASELINE + invariants + MODIFY instructions | When `requiredBaselinePaths` is non-empty                       |
| **C. Correction Preservation Feedback** | Bounded ADR-030 rejection summary in correction prepares            | Operator-authorized correction after Gate 2 rejection (Slice 2) |

All three are orchestration-layer concerns (Context Builder, Prompt Orchestrator, workspace runtime).
Provider artifact schemas remain unchanged (see §Provider contract).

### Separation from ADR-030

| Concern                      | ADR-030                       | ADR-031                                                |
| ---------------------------- | ----------------------------- | ------------------------------------------------------ |
| When baseline is read        | Plan time (Change Planner)    | Pre-provider (prompt contract) + plan time (unchanged) |
| Baseline in provider prompt  | No                            | Yes, labeled CURRENT BASELINE                          |
| Churn/ID/cross-file analysis | Yes                           | No (unchanged)                                         |
| Apply-time drift             | Yes                           | No (unchanged)                                         |
| Gate 2 preservation UI       | Per-operation ADR-030 summary | Complemented by optional scope warnings (Slice 3)      |

---

## A. `UpdateScopePlan` contract

### Type (schemaVersion 1)

```typescript
export const UPDATE_SCOPE_PLAN_SCHEMA_VERSION = 1 as const;

export type UpdateScopeMode = 'NONE' | 'SOFT' | 'HARD';

export interface UpdateScopeEvidence {
  readonly code:
    | 'EXPLICIT_PATH_MENTION'
    | 'EXPLICIT_ONLY_PATH_INSTRUCTION'
    | 'TASK_FILE_EXTENSION_HINT'
    | 'ITERATION_PATH_HINT'
    | 'CONTEXT_RANK_TOP'
    | 'HTML_ENTRYPOINT_HEURISTIC';
  readonly path?: string;
  readonly message: string;
}

export interface UpdateScopePlan {
  readonly schemaVersion: typeof UPDATE_SCOPE_PLAN_SCHEMA_VERSION;
  readonly mode: UpdateScopeMode;
  readonly requiredBaselinePaths: readonly string[];
  readonly preferredUpdatePaths: readonly string[];
  readonly preferredMaximumUpdateOperations?: number;
  readonly evidence: readonly UpdateScopeEvidence[];
}
```

### Field semantics

| Field                              | Meaning                                                                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `mode`                             | `NONE`: no ADR-031 constraints; legacy behavior. `SOFT`: guidance only. `HARD`: explicit operator path restriction detected. |
| `requiredBaselinePaths`            | Paths whose **current baseline content** MUST appear in the Baseline Preservation Contract (max 3, see §Budget).             |
| `preferredUpdatePaths`             | Paths the provider should prefer to update (may equal `requiredBaselinePaths`).                                              |
| `preferredMaximumUpdateOperations` | Soft artifact/operation count hint for the provider (typically 1–3). Omitted when unknown.                                   |
| `evidence`                         | Deterministic audit trail for tests and Gate 2 scope warnings.                                                               |

### Deterministic scope inference (MVP)

`UpdateScopePlanner` (new pure service) derives scope from **non-AI evidence only**:

1. **Explicit path mentions** — POSIX logical paths matching task text (`index.html`, `assets/app.js`).
2. **Explicit only-path instructions** — phrases matching bounded patterns such as `only <path>`,
   `<path> only`, `do not modify` sibling lists (narrow regex set; tested fixtures).
3. **Task file-extension hints** — "HTML", "stylesheet", "JavaScript" mapped to likely entry paths when
   unambiguous in small projects (heuristic, low confidence alone).
4. **Iteration path hints** — ADR-024 `extractIterationPathHints` (correction prepares only); boosts
   scope evidence, does not override HARD rules from operator text.
5. **Context rank** — if a mentioned path is already in Context Builder shortlist top 12, add
   `CONTEXT_RANK_TOP` evidence.
6. **HTML entrypoint heuristic** — when task implies page/UI change and `index.html` exists in project
   index, add as **soft** preferred path only.

**MVP does not** call providers, read Change Plans, or parse provider output.

### Output rules

| Condition                                            | Result                                                                                                   |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| No paths inferred with confidence                    | `mode: 'NONE'`, empty arrays — **legacy behavior**                                                       |
| Paths inferred, no explicit only-path language       | `mode: 'SOFT'`                                                                                           |
| Explicit only-path instruction for one or more paths | `mode: 'HARD'`, `preferredUpdatePaths` = allowed set, `preferredMaximumUpdateOperations` = allowed count |

---

## B. Hard vs soft scope policy

### SOFT scope (default when evidence exists)

- `requiredBaselinePaths` and `preferredUpdatePaths` are **guidance** in the Preservation Contract and
  prompt instructions.
- Provider MAY update additional paths if the task truly requires it (for example HTML + JS ID
  contract change).
- Change Planner MAY emit plan warning `SCOPE_DEVIATION` when provider artifacts include paths outside
  `preferredUpdatePaths` (Slice 3).
- **No** provider schema path enum on initial prepare.
- **No** automatic plan rejection for scope alone.

### HARD scope (explicit operator restriction only)

Activated only when deterministic patterns match explicit only-path instructions (for example
"Modify index.html only", "Do not modify assets/app.js").

- `preferredUpdatePaths` becomes the **allowed update path set** for **prompt instructions** and
  plan-time `SCOPE_DEVIATION` warnings.
- Provider schema remains unchanged on initial prepare (ADR-031 §Provider contract).
- HARD scope does **not** add File Apply enforcement or silent auto-reject.
- HARD scope on initial prepare does **not** override ADR-029 correction allowlists. On correction
  prepares, **ADR-029 allowlist from IterationFeedback.apply paths remains authoritative** for bounding;
  ADR-031 preservation feedback is additive guidance inside ITERATION, not a replacement allowlist.

### Interaction with ADR-029

| Prepare kind       | Path authority                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------ |
| Initial prepare    | ADR-031 SOFT/HARD guidance only; no ADR-029 bounding                                       |
| Correction prepare | ADR-029 allowlist from feedback apply paths; ADR-031 adds baseline + preservation feedback |

ADR-031 MUST NOT weaken ADR-029 post-response allowlist validation or derive allowlists from provider
output.

---

## C. Baseline Preservation Contract

### Source of baseline content

Reuse **`WorkspaceBaselinePort`** (ADR-030) exclusively. Same adapter (`NodeWorkspaceBaseline`), same
normalization (`\r\n?` → `\n`), same 512 KiB per-file cap, same symlink/binary rejection.

| Reader                                         | When          | Purpose                                   |
| ---------------------------------------------- | ------------- | ----------------------------------------- |
| Prompt Orchestrator (via new port consumer)    | Pre-provider  | CURRENT BASELINE in Preservation Contract |
| Change Planner (`ChangePreservationService`)   | Post-provider | Unchanged ADR-030 analysis                |
| File Apply (`readRegularFileBaselineChecksum`) | Apply time    | Unchanged ADR-030 drift check             |

Prompt baseline and plan-time baseline **must** share canonical normalization (reuse
`text-baseline-content` utilities; no second checksum implementation).

### Provider-facing structure

New Prompt Package section: **`PRESERVATION_CONTRACT`** (provider-neutral), inserted after `TASK` and
before `RULES` when `requiredBaselinePaths` is non-empty.

Section payload:

```typescript
interface PreservationContractContent {
  readonly scope: UpdateScopePlan;
  readonly baselines: readonly {
    readonly logicalPath: string;
    readonly content: string;
    readonly checksum: ArtifactChecksum;
    readonly sizeBytes: number;
  }[];
  readonly invariants: readonly PreservationInvariant[];
}
```

Each baseline entry is labeled in serialized prompt text as:

```text
CURRENT BASELINE — <logicalPath>
<normalized UTF-8 content>
```

### v1 invariant set (`PreservationInvariant`)

Extract deterministically from **baseline content** of pinned paths only. Reuse ADR-030 parsers where
they exist; regex/narrow extraction only—no general AST.

| Invariant kind          | Source        | Extraction                                             | Provider representation               |
| ----------------------- | ------------- | ------------------------------------------------------ | ------------------------------------- |
| `DOM_ID`                | HTML baseline | Existing ADR-030 id extraction                         | `id="..."` list (truncated to 32 ids) |
| `ARIA_ATTRIBUTE`        | HTML baseline | Existing ADR-030 aria extraction                       | attribute name list (truncated to 16) |
| `SCRIPT_REFERENCE`      | HTML baseline | `<script src="...">` regex                             | path list                             |
| `STYLESHEET_REFERENCE`  | HTML baseline | `<link rel="stylesheet" href="...">` regex             | path list                             |
| `LITERAL_DOM_REFERENCE` | JS baseline   | `getElementById('...')`, `querySelector('#...')` regex | id list (truncated to 16)             |
| `LOCAL_STORAGE_KEY`     | JS baseline   | `localStorage.getItem/setItem('...')` regex            | key list (truncated to 8)             |

| Property           | Rule                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------- |
| Violation handling | **Instruction-only** in prompt; ADR-030 validates post-generation unchanged                 |
| Confidence         | High for extracted literals; planner does not infer behavioral invariants beyond regex hits |
| Missing baseline   | Omit invariants for that path; emit evidence code `BASELINE_UNAVAILABLE`                    |

### Provider-neutral MODIFY instructions (template additions)

Added to `default-prompt-template.ts` under a new `PRESERVATION` template section kind (always present,
content populated only when contract active):

1. **MODIFY, DO NOT RECREATE** — The complete resulting file MUST be produced by modifying the supplied
   CURRENT BASELINE. It is NOT permission to redesign, restructure, or regenerate from scratch.
2. **Preserve unrelated content** — Lines and sections not required by the task MUST remain unchanged
   except when a requested accessibility or behavior change requires a localized edit nearby.
3. **Preserve existing behavior** — Do not remove persistence, event wiring, or data flows unless
   explicitly requested.
4. **Preserve identifiers and contracts** — Do not rename or remove listed DOM IDs, aria attributes,
   script/stylesheet references, or cross-file literal references unless the task explicitly requires
   it and all dependent files are updated.
5. **Minimum files** — Touch the minimum number of files necessary. Do not rewrite sibling files for
   cosmetic consistency.
6. **No cosmetic refactors** — No renaming, reformatting, dependency changes, or quote/content rewrites
   unless explicitly requested.
7. **Full-file output semantics (ADR-017)** — Each `UPDATE_FILE` artifact MUST still contain the
   **complete resulting file content** after applying the minimal modification to CURRENT BASELINE.

These instructions explicitly reconcile ADR-017 with surgical intent:

> **UPDATE_FILE = complete resulting content, conceptually derived as baseline + minimal delta.**

---

## D. Context pinning and budget policy

### Admission order (when `requiredBaselinePaths` non-empty)

1. Governance context (constitution, brain, task) — unchanged ADR-023 priority.
2. **Pinned baselines** — each required path read via `WorkspaceBaselinePort`; admitted as
   `ContextSourceFile` with new priority label `PINNED_BASELINE` (rank above `RELATED_SOURCE_FILES`).
3. Ordinary ranked `RELATED_SOURCE_FILES` — greedy admission as today.
4. Documents, decisions, modules — unchanged.

### Deduplication

If a pinned path is already admitted via ordinary ranking, keep single copy; prefer `PINNED_BASELINE`
priority label.

### Eviction under budget pressure

When measured Context Package exceeds limits:

1. Evict lowest-scored `RELATED_SOURCE_FILES` first.
2. Never evict `PINNED_BASELINE` files while `UpdateScopePlan.mode !== 'NONE'`.
3. Never truncate file content (whole-file admission invariant preserved).
4. If pinned baselines alone exceed effective file budget (`maxCharacters - reserved headroom`), see
   oversize behavior below.

### Limits (v1)

| Limit                                              | Value       | Rationale                                                                   |
| -------------------------------------------------- | ----------- | --------------------------------------------------------------------------- |
| Max pinned baseline paths                          | **3**       | Covers HTML + primary JS + CSS in smoke-scale projects                      |
| Max bytes per pinned baseline                      | **512 KiB** | Matches ADR-030 / `NodeWorkspaceBaseline`                                   |
| Max total pinned baseline chars in Context Package | **48,000**  | ~half of effective file budget; leaves room for governance + ranked context |
| Max pinned paths in Preservation Contract          | **3**       | Same as above                                                               |

### Baseline-unavailable behavior

When `WorkspaceBaselinePort.readTextBaseline(path)` returns `null`:

- Path removed from `requiredBaselinePaths` for contract purposes.
- Add `UpdateScopeEvidence` code `BASELINE_UNAVAILABLE`.
- Emit Context Package omission entry (new reason `BASELINE_UNAVAILABLE` or reuse `SIZE_LIMIT` with
  distinct identifier).
- **Do not** invent baseline content or hard scope constraints for that path.
- If all required paths unavailable → degrade to `mode: 'NONE'`.

### Oversize behavior

Single file > 512 KiB → same as unavailable. If total pinned content > 48,000 chars, include paths in
deterministic path-sorted order until budget exhausted; remaining paths marked unavailable with evidence
`BASELINE_BUDGET_EXCEEDED`. Never partial-file truncate.

---

## E. Correction Preservation Feedback (Slice 2)

### Trigger

Operator initiates correction prepare with `iterationFeedback` after Gate 2 rejection. Client/server
attaches optional **`preservationRejection`** block built from the rejected Change Plan's ADR-030
metadata (not from re-sent artifact bodies).

### Schema extension (IterationFeedback schemaVersion 1 — additive optional field)

```typescript
interface IterationPreservationRejection {
  readonly rejectedPreparationId?: string;
  readonly operatorReason?: string; // max 240 chars, sanitized
  readonly operations: readonly {
    readonly logicalPath: string;
    readonly churnRatio?: number;
    readonly similarityRatio?: number;
    readonly findingCodes: readonly string[];
    readonly removedHtmlIds?: readonly string[];
    readonly removedAccessibilityAttributes?: readonly string[];
    readonly crossFileReferenceRisks?: readonly string[];
  }[];
  readonly unrequestedPaths?: readonly string[];
}
```

### Limits

| Limit                                  | Value                                                  |
| -------------------------------------- | ------------------------------------------------------ |
| Max operations listed                  | **8**                                                  |
| Max finding codes per operation        | **4**                                                  |
| Max removed IDs/attrs per operation    | **8** each                                             |
| Max cross-file risks per operation     | **2**                                                  |
| Max `operatorReason`                   | **240** chars (same sanitizer as ADR-024 findings)     |
| Max serialized `preservationRejection` | **800** chars                                          |
| Total `IterationFeedback` serialized   | **4,800** chars (ADR-024 4,000 + 800 extension budget) |

Deterministic ordering: operations by `logicalPath` localeCompare; arrays sorted lexicographically.

### Prompt rendering

Append to ITERATION section after existing correction instructions:

- Bounded structured `preservationRejection` object (same pattern as apply/verify feedback).
- Template instruction: "Reduce scope and churn; preserve baseline behavior and listed invariants; do not
  repeat unrequested path updates."

**No automatic retry.** Operator must explicitly submit correction prepare.

### ADR-029 interaction

Preservation feedback does not replace or widen ADR-029 allowlists. If feedback apply paths are empty
(non-partial correction), ADR-029 bounding may be inactive; ADR-031 preservation feedback still guides
the model.

---

## F. Provider contract / schema decision

**No provider structured-output schema changes.**

Providers continue returning artifacts with:

- `logicalPath`
- `content` (complete file body)
- `metadata.description`
- `metadata.change-operation`

ADR-031 influences generation through Prompt Package content only. Gemini/OpenAI/OpenRouter mappers
unchanged.

---

## G. Response Processor / Change Planner

### Unchanged

- Response Processor validation
- ADR-030 `ChangePreservationService` analysis
- File Apply drift protection
- `baselineContentChecksum` attachment

### Optional plan-time scope warnings (Slice 3)

When `UpdateScopePlan.mode !== 'NONE'` and provider artifacts map to operations:

| Warning code                         | Condition                                                     |
| ------------------------------------ | ------------------------------------------------------------- |
| `SCOPE_DEVIATION`                    | Any artifact path ∉ `preferredUpdatePaths`                    |
| `PREFERRED_OPERATION_COUNT_EXCEEDED` | Operation count > `preferredMaximumUpdateOperations` when set |

Warnings merge into Change Plan `warnings[]` with affected `operationIds`. **Warn-first** — same policy
as ADR-030 preservation; no auto-reject.

Store compact `updateScopePlan` snapshot in Change Plan `metadata` (optional, for Gate 2 display):

```typescript
metadata: {
  'update-scope-mode': 'SOFT' | 'HARD' | 'NONE';
  'update-scope-preferred-paths': 'path1\u001fpath2'; // bounded
}
```

---

## H. Gate 2 interaction

Gate 2 remains human-controlled approval.

| Signal source                          | UI / review value                                              |
| -------------------------------------- | -------------------------------------------------------------- |
| ADR-031 Preservation Contract (prompt) | Provider had CURRENT BASELINE — operator expects smaller diffs |
| ADR-030 per-operation preservation     | Churn, IDs, cross-file risks (existing Slice 3 UI)             |
| ADR-031 `SCOPE_DEVIATION` plan warning | Provider touched paths outside preferred scope                 |
| ADR-030 + ADR-031 together             | Operator can reject for scope OR preservation OR both          |

Slice 3 UI work is **optional** if plan-level `SCOPE_DEVIATION` warnings and existing ADR-030 operation
summaries are sufficient in JSON review. Default: plan warnings only; dedicated Gate 2 scope panel
deferred unless smoke shows confusion.

---

## I. Backward compatibility

| Workflow                              | Behavior                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------ |
| CREATE-heavy plans                    | `UpdateScopePlan.mode: 'NONE'` when no UPDATE scope inferred — unchanged |
| DELETE operations                     | Unchanged                                                                |
| Legacy UPDATE without scope inference | Unchanged — no false constraints                                         |
| Correction (ADR-024/029)              | Unchanged authority for bounding                                         |
| ADR-030 preservation/drift            | Unchanged                                                                |
| Provider adapters                     | Unchanged schemas                                                        |

Fallback rule: **`mode: 'NONE'` whenever evidence is insufficient** — never guess hard scope.

---

## J. Security and privacy

- Baseline content sent to provider duplicates data already eligible for `CONTEXT.relevantFiles`; same
  trust model as ADR-023.
- Protected paths (`project-brain.json`, `.env`, etc.) MUST NOT appear in `requiredBaselinePaths`
  (planner rejects via existing safe-path rules).
- Baseline port already rejects symlinks, binary, oversize files.
- Preservation feedback MUST NOT include raw artifact bodies or secrets; bounded codes and path lists
  only.
- Source comments may contain prompt-injection text — existing SAFETY template instructions apply;
  ADR-031 does not remove untrusted-data treatment.
- **Separate finding (out of scope):** repository has no dedicated secret scanner for context files;
  do not expand ADR-031 to implement one. Record under `evaluate-prompt-quality-and-safety` pendingWork.

---

## K. Token and cost implications

| Addition                          | Typical cost     |
| --------------------------------- | ---------------- |
| 1 pinned HTML baseline (~1–2 KB)  | +1–2 KB prompt   |
| Invariant lists                   | +200–600 chars   |
| MODIFY instructions (when active) | +800–1,200 chars |
| Preservation rejection feedback   | ≤800 chars       |

Pinned baselines displace lower-ranked context files—not additive unbounded growth. Deterministic eviction
preserves ADR-018 budget invariant.

---

## L. Test strategy

Deterministic tests only — **no live provider calls in CI**.

| #   | Scenario                                                                         |
| --- | -------------------------------------------------------------------------------- |
| 1   | Explicit "index.html only" → `mode: 'HARD'`                                      |
| 2   | HTML accessibility request without path → `mode: 'SOFT'`, `index.html` preferred |
| 3   | JS-only behavior change → JS path preferred                                      |
| 4   | CSS-only change → CSS path preferred                                             |
| 5   | Legitimate HTML + JS change → both in `preferredUpdatePaths`, SOFT               |
| 6   | CREATE-only task → `mode: 'NONE'`                                                |
| 7   | No reliable scope → legacy behavior                                              |
| 8   | Low relevance score but pinned path → baseline admitted                          |
| 9   | Deduplication when path already in context                                       |
| 10  | Budget eviction removes ranked files before pinned                               |
| 11  | Baseline unavailable → degrade gracefully                                        |
| 12  | Oversize baseline → `BASELINE_UNAVAILABLE`                                       |
| 13  | DOM ID invariants extracted and rendered                                         |
| 14  | Aria invariants extracted                                                        |
| 15  | Script/stylesheet refs extracted                                                 |
| 16  | localStorage key invariant extracted                                             |
| 17  | Provider paths outside preferred → `SCOPE_DEVIATION` warning                     |
| 18  | Correction feedback after HIGH_CHURN                                             |
| 19  | Correction feedback after cross-file warning                                     |
| 20  | Feedback bounded deterministically                                               |
| 21  | ADR-029 allowlist unchanged on correction                                        |
| 22  | ADR-030 preservation still runs post-provider                                    |
| 23  | Provider schema snapshots unchanged                                              |
| 24  | CREATE-heavy Smoke #1 fixture regression                                         |

### Surgicality acceptance criteria (for future smoke)

| Class     | Criteria                                                  |
| --------- | --------------------------------------------------------- |
| EXCELLENT | Requested paths only; churn < 20%; IDs/behavior preserved |
| GOOD      | Requested paths only; churn < 40%; no behavior regression |
| MARGINAL  | Extra cosmetic churn or one unrequested low-churn file    |
| POOR      | Multi-file rewrite, behavior loss, or churn > 70%         |

---

## M. Implementation slices

| Slice            | Deliverable                                                                                                                                                                            |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1**            | `UpdateScopePlanner`, types, baseline pinning in Context Builder, `PRESERVATION_CONTRACT` prompt section, MODIFY template instructions, unit/integration tests, golden prompt fixtures |
| **2**            | `IterationPreservationRejection`, feedback builder from rejected Change Plan, ITERATION rendering, correction tests, 4,800 char budget enforcement                                     |
| **3** (optional) | Change Planner `SCOPE_DEVIATION` / `PREFERRED_OPERATION_COUNT_EXCEEDED` warnings + compact metadata; Gate 2 display only if Slice 1–2 smoke shows gap                                  |

Stop after Slice 2 unless Gate 2 scope visibility is demonstrably insufficient.

---

## N. Relationship to other ADRs

| ADR         | Relationship                                                                                                         |
| ----------- | -------------------------------------------------------------------------------------------------------------------- |
| **ADR-017** | Full-file `UPDATE_FILE` content remains mandatory; ADR-031 clarifies semantic intent (baseline + minimal delta).     |
| **ADR-024** | Correction remains operator-initiated; Slice 2 extends feedback additively.                                          |
| **ADR-029** | Correction allowlist/bounding unchanged and authoritative.                                                           |
| **ADR-030** | Post-generation preservation and drift protection unchanged; ADR-031 feeds correction feedback from ADR-030 outputs. |

---

## O. PendingWork mapping

| PendingWork id                       | Relationship                                                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `evaluate-prompt-quality-and-safety` | ADR-031 directly addresses prompt-quality gap for surgical UPDATE; close after implementation + smoke validation, not ADR authoring alone. |
| `evaluate-context-relevance-quality` | ADR-031 pinning partially addresses target-file omission; full relevance corpus evaluation remains separate.                               |

**Do not modify `project-brain.json` in this ADR checkpoint.** Update after Slice 1–2 implementation and
successful smoke re-validation.

---

## P. Smoke validation plan (post-implementation)

1. Re-run Phase 1 accessibility prompt on `smoke-atelier` with clean port-3000 dev server.
2. Expect: fewer artifact paths (ideally 1), lower ADR-030 churn, `EXCELLENT` or `GOOD` surgicality.
3. Re-run Phase 2 drift test — must still pass (`BASELINE_CONTENT_DRIFT` unchanged).
4. Do not apply rejected Phase 1 preparations from pre-ADR-031 runs.

---

## Alternatives considered

| Option                                       | Why not                                              |
| -------------------------------------------- | ---------------------------------------------------- |
| Prompt-only strengthening (A)                | Insufficient without guaranteed baseline in prompt   |
| PATCH/diff (F)                               | Violates ADR-017; hidden transformation              |
| Second-model scope planner                   | Out of MVP scope; latency/cost                       |
| Hard provider schema enum on initial prepare | Provider schema change; false restrictions; deferred |
| Auto-reject on HIGH churn                    | Violates warn-first Gate 2 policy                    |

---

## Consequences

### Positive

- Provider receives authoritative CURRENT BASELINE for likely UPDATE targets.
- Surgical intent explicit without reversing ADR-017.
- Deterministic, testable scope and invariant contracts.
- Correction loop can consume ADR-030 rejection evidence.

### Negative / risks

- Prompt size increases for pinned baselines; lower-ranked context may be omitted.
- HARD scope false positives possible if only-path regex matches too broadly — mitigated by narrow patterns + tests.
- Regex invariants miss edge cases — ADR-030 post-check remains safety net.

### Neutral

- Provider schemas unchanged.
- Gate 2 approval still required.
