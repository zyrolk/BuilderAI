# ADR-032: Surgicality metric semantics for structured UPDATE_FILE changes

- **Status:** Accepted (implemented and live-validated)
- **Date:** 2026-08-04
- **Owners:** BuilderAI architecture
- **Related:** ADR-017 (full-file UPDATE semantics), ADR-024 (iteration feedback loop),
  ADR-029 (correction output bounding), ADR-030 (preservation and line-LCS churn validation),
  ADR-031 (baseline-guided surgical update contract), pendingWork `evaluate-prompt-quality-and-safety`

## 1. Context

ADR-031 Slice 4 introduced preservation-contract prompt guidance and correction feedback that
references ADR-030 line-level churn thresholds (`target <40% (GOOD)`, `prefer <20% (EXCELLENT)`).
Slice 4b diagnosed why live smoke-atelier accessibility preparations plateau at
**churnRatio = 0.4444** and **MARGINAL** surgicality despite producing the mathematically minimal
golden patch.

Established facts from Slice 4b (deterministic, provider-independent):

| Fact                          | Value                                                             |
| ----------------------------- | ----------------------------------------------------------------- |
| Baseline `index.html` lines   | 36                                                                |
| Required attribute-only edits | 8 (minimum for locked accessibility request)                      |
| Golden minimal metrics        | linesAdded=8, linesDeleted=8, linesUnchanged=28                   |
| Golden churnRatio             | 0.4444 = (8+8)/36                                                 |
| Golden similarityRatio        | 0.7778 = 28/36                                                    |
| Live Gemini result            | Identical 8/8/28 metrics; all stable IDs and aria attrs preserved |
| GOOD threshold                | `< 0.40` — **unreachable** for this task under line-LCS semantics |

The mismatch is **metric / acceptance-semantics**, not primarily provider generation failure.
ADR-031 architecture (HARD scope, baseline pinning, preservation contract, correction feedback,
ADR-029 bounding, ADR-030 ID/cross-file/drift protection) is otherwise working.

This ADR defines how BuilderAI should distinguish:

1. Small attribute-level modifications to preserved HTML
2. Formatting-only churn
3. Text/content changes
4. Structural DOM changes
5. Destructive rewrites

…without weakening ADR-030 preservation safety signals.

## 2. Problem statement

ADR-030 treats **every in-place line edit** as one deleted line plus one added line in LCS diff
semantics. For a baseline of _N_ lines and _K_ required single-line attribute extensions, the
**theoretical minimum churn** is `(2K)/N`. When `2K/N ≥ elevatedChurnThreshold (0.40)`, even a
perfect provider output cannot achieve GOOD or EXCELLENT under line-only classification.

Line-LCS churn conflates:

- **Required surgical edits** (attribute insertion on existing lines)
- **Unnecessary formatting rewrites** (same semantics, different whitespace)
- **Semantic rewrites** (text, structure, destructive replacement)

Gate 2, correction feedback (ADR-031 Slice 4), and smoke acceptance criteria therefore mis-classify
exemplary attribute-only HTML patches as elevated churn. Operators and providers receive misleading
"reduce churn below 40%" guidance for tasks where 44% is the line-metric floor.

**Goal:** Introduce deterministic, provider-neutral **surgicality semantics** that align acceptance
with intent while keeping ADR-030 preservation safety findings authoritative and unchanged in
severity mapping.

## 3. Evidence from ADR-031 Slice 4b

Diagnostic test `src/core/change-planner/test/slice4b-golden-churn-boundary.test.ts` proves:

```text
theoreticalMinimumChurn = (minimumChangedLines × 2) / baselineLineCount
                        = (8 × 2) / 36
                        = 0.4444
                        ≥ elevatedChurnThreshold (0.40)
```

Each golden edit is an attribute-only extension on an existing line (not formatting excess). Live
provider output matched golden metrics exactly. Decision **D — CHURN_METRIC_OR_THRESHOLD_MISMATCH**.

Implication: **threshold-only adjustment** (Option E) cannot fix this case without either (a)
raising GOOD above 0.4444 (masking real rewrites on similar-sized files) or (b) accepting that
line churn alone is an insufficient surgicality proxy for structured HTML updates.

## 4. Existing ADR-030 behavior

### 4.1 Implementation location

| Component             | Path                                                                          |
| --------------------- | ----------------------------------------------------------------------------- |
| Line metrics + LCS    | `src/core/change-planner/services/update-preservation-analysis.service.ts`    |
| Findings → warnings   | `src/core/change-planner/services/change-preservation.service.ts`             |
| Threshold defaults    | `src/core/change-planner/config/change-planner-configuration.ts`              |
| Gate 2 display        | `src/ui/workspace/change-plan-preservation-display.ts`, `result-panel.tsx`    |
| Correction churn text | `src/core/prompt-orchestrator/internal/preservation-rejection-renderer.ts`    |
| Types                 | `src/core/change-planner/types/change-plan.ts` (UpdatePreservationAssessment) |

### 4.2 Metric definitions (current)

**Normalization:** `\r\n?` → `\n` on baseline and proposed content before analysis. No NFC
normalization in v1.

**Line splitting:** split on `\n`; trailing empty line after final newline discarded; empty file = 0
lines.

**LCS:** Standard dynamic-programming longest common subsequence over **whole lines** with **exact
string equality**. No fuzzy match, no trim, no HTML awareness.

**Derived counts:**

```text
linesUnchanged = LCS length
linesDeleted   = baselineLines - linesUnchanged
linesAdded     = proposedLines - linesUnchanged
churnRatio     = round4( (linesAdded + linesDeleted) / max(baselineLines, 1) )
similarityRatio = round4( linesUnchanged / max(baselineLines, proposedLines, 1) )
```

Rounding: clamp to [0,1], round to 4 decimal places.

**HTML extras (regex, not DOM):**

- `removedHtmlIds` / `addedHtmlIds` via `\bid\s*=\s*["']([^"']+)["']`
- `removedAccessibilityAttributes` via `\baria-[a-zA-Z0-9-]+\b` name set difference
- Cross-file literal `getElementById` / `querySelector` scan on unchanged sibling `.js` under
  `assets/` (bounded by `maximumCrossFileChecks`, default 2)

**Large deletion signal:** `linesDeletedRatio ≥ 0.50` AND `linesAddedRatio < 0.10`.

### 4.3 Thresholds and findings

| Condition                   | Finding code                             | Severity |
| --------------------------- | ---------------------------------------- | -------- |
| `churnRatio ≥ 0.70`         | `PRESERVATION_HIGH_CHURN_REWRITE`        | HIGH     |
| `0.40 ≤ churnRatio < 0.70`  | `PRESERVATION_ELEVATED_CHURN`            | MEDIUM   |
| `churnRatio < 0.40`         | (no churn finding)                       | —        |
| Removed HTML id             | `PRESERVATION_REMOVED_HTML_ID`           | MEDIUM   |
| Removed aria attribute name | `PRESERVATION_REMOVED_ARIA_ATTRIBUTE`    | MEDIUM   |
| Cross-file reference risk   | `PRESERVATION_CROSS_FILE_REFERENCE_RISK` | CRITICAL |
| Suspicious large deletion   | `PRESERVATION_LARGE_DELETION`            | MEDIUM   |

High churn also adds plan-level risk `HIGH_CHURN_REWRITE`. **No hard reject** for churn alone
(warn-first policy).

### 4.4 Persistence and consumers

- `churnRatio`, `similarityRatio`, line counts, and findings are **persisted** on
  `UpdateFileOperation.preservation` in serialized Change Plans (`schemaVersion: 1`, optional
  fields).
- **Gate 2 UI** renders percentages, line counts, findings, removed ids/aria, cross-file risks.
- **ADR-031 correction feedback** uses peak/evaluated churn to emit "target <40% (GOOD)" guidance
  when `churnRatio ≥ elevatedChurnThreshold`.
- **Tests with exact numeric thresholds:** `update-preservation-analysis.test.ts`,
  `preservation-integration.test.ts`, `change-plan-preservation.fixture.ts`,
  `preservation-churn-guidance.test.ts`, `slice4b-golden-churn-boundary.test.ts`,
  `configuration-and-summary.test.ts`.

### 4.5 Affected surface if semantics change

| Area                                      | Impact                                                   |
| ----------------------------------------- | -------------------------------------------------------- |
| `UpdatePreservationAnalysisService`       | Add structured HTML delta (new pure service)             |
| `ChangePreservationService.buildFindings` | Optional: map surgicality to new finding codes (Slice 2) |
| `UpdatePreservationAssessment` type       | Extend with `structuredAnalysis`, `surgicality`          |
| Change plan validator allow-list          | New optional fields                                      |
| Gate 2 display                            | Show surgicality class + structured axes                 |
| Preservation rejection renderer           | Reword churn targets for HTML structured success         |
| ADR-031 acceptance table                  | Decouple EXCELLENT/GOOD from line churn for HTML         |
| Preservation integration tests            | Add golden fixture matrix; keep LCS regression tests     |

**ADR-030 line metrics remain computed and stored unchanged** for backward compatibility and
diagnostics.

## 5. Options considered

### Option A — Character-level edit ratio

**Concept:** `changedCharacters / baselineCharacters` (e.g. Levenshtein or diff match).

| Scenario                  | Assessment                                                             |
| ------------------------- | ---------------------------------------------------------------------- |
| Attribute-only additions  | **Strong:** golden patch ~low ratio → EXCELLENT                        |
| Text replacements         | Detected proportionally to copy length                                 |
| Formatting changes        | **Weak:** whitespace edits inflate ratio; trim-normalization ambiguous |
| Structural rewrites       | May show low ratio if IDs/text reused but hierarchy reshuffled         |
| Computational cost        | O(n×m) on file size; acceptable at 512 KiB cap                         |
| Determinism               | High if normalization fixed                                            |
| False positives/negatives | **FN:** structural reorder with same characters → falsely surgical     |

**Verdict:** Useful diagnostic axis, insufficient alone as surgicality classifier. Does not replace
preservation checks. May supplement generic non-HTML files in future; **not selected as primary.**

### Option B — Token-aware HTML metric (full structured parse)

**Concept:** Parse HTML; compare element identity, attributes, text nodes, hierarchy.

| Scenario           | Assessment                                                                   |
| ------------------ | ---------------------------------------------------------------------------- |
| Attribute-only     | **Strong:** attribute delta count matches intent                             |
| Text / structure   | Separate `textDeltaRatio`, `structuralDeltaRatio`                            |
| Formatting-only    | **Strong:** DOM equal, line churn high → `formattingOnlyEvidence`            |
| Structural rewrite | **Strong:** non-zero structural change count                                 |
| Parser dependency  | Required (none in production `src/` today; `jsdom` is test-environment only) |
| Security           | Must not execute scripts; parse-only; size/time limits; malformed → fallback |

**Verdict:** Best semantic accuracy for HTML. **Selected as core of Option C.**

### Option C — Hybrid structured surgicality (selected)

Keep ADR-030 line-LCS metrics. For `.html` / `.htm`, add deterministic structured delta metadata.
Derive **surgicality classification** from multi-axis evidence. Fall back to generic line-LCS
classification when parse fails or file is non-HTML.

**Verdict:** **Selected.** Smallest architecture satisfying smoke evidence without discarding
existing diagnostics or preservation findings.

### Option D — Minimum-required-delta normalization

**Concept:** `observedChurn / theoreticalMinimumChurn(task)` → score near 1.0 for perfect patch.

| Scenario               | Assessment                                                                  |
| ---------------------- | --------------------------------------------------------------------------- |
| Golden accessibility   | Would normalize 0.4444/0.4444 → 1.0 if minimum known                        |
| Derivation             | **Unsafe:** engine does not know required edit count without task semantics |
| Provider/task guessing | Would require AI or operator intent parsing — forbidden                     |

**Verdict:** **Rejected.** Cannot deterministically know required delta at plan time.

### Option E — Threshold-only adjustment (e.g. GOOD < 0.50)

| Scenario                           | Assessment                                                    |
| ---------------------------------- | ------------------------------------------------------------- |
| Golden accessibility               | 0.4444 < 0.50 → GOOD — smoke passes                           |
| 8-line text rewrite (36-line file) | Could also score ~0.44 → falsely GOOD                         |
| Structural rewrite                 | May still show moderate line churn with small character delta |
| ADR-030 HIGH threshold             | Pushing elevated to 0.50 narrows MEDIUM band; arbitrary       |

**Verdict:** **Rejected as sole fix.** Makes smoke pass but does not distinguish formatting,
structure, or preservation-safe rewrites. Does not meet design drivers.

## 6. Selected architecture

Adopt **two-layer assessment** for `UPDATE_FILE` when baseline is available:

### Layer 1 — Preservation safety (ADR-030, unchanged authority)

Authoritative pass/fail signals for contract violations:

- Removed stable HTML ids
- Removed accessibility attribute **names**
- Cross-file literal reference risks
- Suspicious large deletion
- (Future) apply-time baseline drift — metadata only at plan time

**Any Layer 1 violation caps surgicality at POOR** and retains existing finding severities. Layer 1
does **not** use churn alone as a violation.

### Layer 2 — Surgicality (new, ADR-032)

Describes **how** the update changed content relative to baseline intent classes:

- Generic textual churn (existing line-LCS — diagnostic + fallback classifier input)
- Structured HTML delta (when parse succeeds)

Layers are **orthogonal**. A preservation-safe update may be MARGINAL (formatting churn) or POOR
(structural rewrite) without removed IDs. A low-churn update with removed IDs is POOR via Layer 1.

```text
┌─────────────────────────────────────────────────────────────┐
│ UPDATE_FILE + baseline available                            │
├─────────────────────────────────────────────────────────────┤
│ Layer 1: Preservation Safety (ADR-030 findings)             │
│   removed IDs / aria / cross-file / large deletion          │
├─────────────────────────────────────────────────────────────┤
│ Layer 2: Surgicality                                        │
│   HTML + parse OK → structured axes → classification        │
│   else → generic line-LCS classification                    │
└─────────────────────────────────────────────────────────────┘
```

## 7. Metric definitions

### 7.1 Unchanged ADR-030 metrics

`linesAdded`, `linesDeleted`, `linesUnchanged`, `churnRatio`, `similarityRatio` — definitions
**frozen** per ADR-030. Still emitted on every analyzed UPDATE.

### 7.2 New structured HTML delta (HTML only)

Produced by pure `HtmlStructuredDeltaService` (name tentative) when:

- `logicalPath` ends with `.html` or `.htm` (case-insensitive)
- Normalized content ≤ `maximumBaselineBytes` (reuse ADR-030 cap, default 512 KiB)
- Content is UTF-8 text without `\u0000`
- Parse completes within resource limits

```typescript
interface StructuredHtmlAnalysis {
  readonly kind: 'HTML';
  readonly parseStatus: 'SUCCESS' | 'FALLBACK';
  readonly fallbackReason?: 'BINARY' | 'OVERSIZE' | 'PARSE_ERROR' | 'TIMEOUT' | 'UNSUPPORTED';
  readonly attributeChanges: number; // attribute add/remove/replace on matched elements
  readonly textChanges: number; // text node content changes (normalized trim compare)
  readonly structuralChanges: number; // element insert/remove/reparent/tag rename
  readonly formattingOnlyEvidence: boolean; // DOM semantically equal, line-LCS churn elevated
  readonly preservedStableIdCount: number;
  readonly removedStableIdCount: number; // mirror Layer 1; for structured summary
  readonly elementCountBaseline: number;
  readonly elementCountProposed: number;
}
```

**Matching strategy (deterministic v1):**

1. Parse baseline and proposed to shallow DOM trees (elements + text nodes; ignore comments).
2. Index baseline elements with `id` attribute as stable anchors.
3. Walk tree in document order; match siblings by `(tagName, id?)` where id present, else positional
   index among same-tag siblings without id (bounded ambiguity tolerated — document in tests).
4. Count:
   - **attributeChanges:** attr key add/remove/value change on matched element
   - **textChanges:** direct text node content change under matched subtree leaf
   - **structuralChanges:** unmatched insert/delete/reparent, tag rename, section wrapper add/remove
5. **formattingOnlyEvidence:** parse trees structurally equal (zero structural/text/attribute deltas
   per rules above) AND `churnRatio ≥ elevatedChurnThreshold`.

### 7.3 Surgicality classification enum

```typescript
type SurgicalityClassification = 'EXCELLENT' | 'GOOD' | 'MARGINAL' | 'POOR' | 'UNAVAILABLE';

interface SurgicalityAssessment {
  readonly classification: SurgicalityClassification;
  readonly basis: 'STRUCTURED_HTML' | 'GENERIC_LINE_LCS';
  readonly summary: string; // bounded, deterministic
}
```

Attached under `preservation.surgicality` (optional extension).

## 8. Preservation vs surgicality separation

| Signal                          | Layer    | Affects classification | Affects existing findings       |
| ------------------------------- | -------- | ---------------------- | ------------------------------- |
| Removed HTML id                 | 1        | → POOR                 | Yes (unchanged)                 |
| Removed aria name               | 1        | → POOR                 | Yes (unchanged)                 |
| Cross-file reference risk       | 1        | → POOR                 | Yes (unchanged)                 |
| Large deletion                  | 1        | Elevates toward POOR   | Yes (unchanged)                 |
| Line churn ≥ 0.70               | 2 + diag | POOR (generic path)    | Yes (HIGH churn finding)        |
| Attribute-only structured delta | 2        | EXCELLENT/GOOD         | No new Layer 1 finding          |
| Formatting-only evidence        | 2        | MARGINAL               | Optional info finding (Slice 2) |
| Structural delta                | 2        | POOR                   | Optional info finding           |

**Rule:** Layer 1 violations **always** produce POOR surgicality regardless of structured deltas.

**Rule:** `PRESERVATION_ELEVATED_CHURN` finding **remains** for `churnRatio ≥ 0.40` in v1 Slice 2
to preserve backward-compatible warning codes; Gate 2 and correction feedback **also** surface
`surgicality.classification` so operators see EXCELLENT for golden patch despite elevated churn
finding. Deprecation of elevated-churn finding for structured-excellent HTML is Slice 3 optional.

## 9. HTML structured-analysis semantics

### 9.1 Parser choice (implementation)

Use **parse5** (or equivalent parse-only HTML5 tokenizer/tree builder):

- No script execution
- Deterministic, widely used, lighter than jsdom
- **New production dependency** — acceptable in Slice 1 with documented rationale
- `jsdom` remains test-environment only; do not reuse for plan-time analysis

### 9.2 Resource limits

| Limit           | Default                        | Behavior on exceed |
| --------------- | ------------------------------ | ------------------ |
| Input bytes     | 512 KiB (reuse ADR-030)        | FALLBACK           |
| Parse wall time | 250 ms per file (configurable) | FALLBACK           |
| Max DOM nodes   | 10_000                         | FALLBACK           |
| Max tree depth  | 128                            | FALLBACK           |

Malformed HTML: best-effort parse5 recovery; if parse throws → `parseStatus: 'FALLBACK'`.

### 9.3 Security

- Untrusted provider content parsed locally at plan time only
- No network, no `innerHTML` execution, no external entity fetch
- No persistence of raw parse trees — counts and booleans only
- Same containment as baseline read (regular file, workspace root)

## 10. Generic fallback semantics

When **any** of:

- Non-HTML path (`.js`, `.css`, `.ts`, etc.)
- `CREATE_FILE` / `DELETE_FILE`
- Baseline unavailable
- Binary / oversize / parse failure / timeout

Then:

```typescript
structuredAnalysis: undefined; // or { kind: 'HTML', parseStatus: 'FALLBACK', ... zeros }
surgicality.basis = 'GENERIC_LINE_LCS';
```

Generic classification (unchanged thresholds):

| churnRatio | Generic surgicality |
| ---------- | ------------------- |
| < 0.20     | EXCELLENT           |
| < 0.40     | GOOD                |
| < 0.70     | MARGINAL            |
| ≥ 0.70     | POOR                |

Layer 1 violations still cap at POOR.

JS/CSS surgical edits (Fixtures 9–10) continue on this path unless a future ADR extends structured
analysis to other languages.

## 11. Classification rules

### 11.1 Structured HTML path (`parseStatus: 'SUCCESS'`)

After Layer 1 pass (no removed ids/aria/cross-file/large-deletion):

| Condition                                                                                                                             | Classification |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `structuralChanges = 0` AND `textChanges = 0` AND `attributeChanges > 0` AND NOT `formattingOnlyEvidence`                             | **EXCELLENT**  |
| `structuralChanges = 0` AND `textChanges ≤ 2` (small copy tweak) AND `attributeChanges ≥ 0`                                           | **GOOD**       |
| `formattingOnlyEvidence = true` OR (`churnRatio ≥ 0.40` AND `structuralChanges = 0` AND `textChanges = 0` AND `attributeChanges = 0`) | **MARGINAL**   |
| `structuralChanges > 0` OR `textChanges > 2` OR `churnRatio ≥ 0.70`                                                                   | **POOR**       |

**Golden accessibility patch (Fixture 1):** `attributeChanges = 8`, others 0 → **EXCELLENT** despite
`churnRatio = 0.4444`.

**Single aria-live (Fixture 2):** `attributeChanges = 1` → **EXCELLENT**.

Threshold `textChanges ≤ 2` for GOOD is v1 default; tunable in configuration with tests.

### 11.2 Layer 1 failure override

Any removed id, removed aria name, cross-file risk, or large deletion → **POOR** (classification),
preservation findings unchanged.

### 11.3 Line churn role post-ADR-032

| Role                       | Status                                         |
| -------------------------- | ---------------------------------------------- |
| Primary surgicality metric | **No** for HTML with structured success        |
| Secondary diagnostic       | **Yes** — always displayed                     |
| Fallback primary           | **Yes** — non-HTML and FALLBACK                |
| ADR-030 warning thresholds | **Retained** in Slice 2; optional tune Slice 3 |

## 12. Gate 2 behavior

Per UPDATE with preservation metadata, Gate 2 adds:

1. **Surgicality badge:** EXCELLENT / GOOD / MARGINAL / POOR / UNAVAILABLE
2. **Basis label:** "Structured HTML analysis" vs "Generic line diff"
3. **Structured summary (HTML):** attribute / text / structural change counts
4. **Existing metrics:** churn %, similarity %, line counts, Layer 1 findings (unchanged layout)

When structured EXCELLENT and elevated churn finding both present, UI copy clarifies:

> "Line churn is elevated due to in-place line edits; structured analysis shows attribute-only
> changes."

Approval controls remain unchanged (warn-first, operator approves).

## 13. ADR-031 feedback implications

Current Slice 4 correction line (`preservation-rejection-renderer.ts`):

```text
Churn correction: previous X%; target <40% (GOOD); prefer <20% (EXCELLENT; guidance only).
```

**Slice 2 change (not in this checkpoint):**

- When rejected plan HTML operation has `surgicality.basis = 'STRUCTURED_HTML'` and prior classification
  was MARGINAL solely due to churn, replace line-only targets with:
  - "Prefer attribute-only edits on existing lines; avoid text/structure rewrites."
  - "Line churn may exceed 40% for multi-line attribute edits; structured surgicality is authoritative."
- When `basis = 'GENERIC_LINE_LCS'`, retain existing `<40% / <20%` guidance.

ADR-031 acceptance table (§ surgicality acceptance criteria) updated to reference ADR-032
classification for HTML; line churn bounds become **generic-file** guidance only.

## 14. Backward compatibility

| ADR / surface                | Compatibility                                                           |
| ---------------------------- | ----------------------------------------------------------------------- |
| **ADR-017** full-file UPDATE | Unchanged — still full replacement content                              |
| **ADR-024** correction loop  | Additive feedback fields; no schema break                               |
| **ADR-029** bounding         | Unchanged — path allowlist independent of surgicality                   |
| **ADR-030** preservation     | Layer 1 frozen; line metrics frozen; new optional fields only           |
| **ADR-031** contract         | Prompt contract unchanged Slice 1; feedback wording Slice 2             |
| ChangePlan serialization     | Optional `preservation.structuredAnalysis`, `preservation.surgicality`  |
| Legacy plans                 | Missing fields → Gate 2 uses generic line-LCS display only              |
| Existing tests               | LCS threshold tests remain valid; new parallel structured fixture tests |

## 15. Security and resource limits

See §9.2. Plan-time analysis only. No new network surface. Parser runs synchronously in Change
Planner thread — enforce node/time limits to prevent DoS via pathological HTML. Log `fallbackReason`
in diagnostics (bounded) for operator visibility.

## 16. Deterministic test matrix

Fixtures are synthetic or derived from smoke-atelier baseline (`D:/projects2/smoke-atelier/index.html`,
36 lines) — **not** live provider calls.

| #   | Fixture                        | Expected preservation | Expected surgicality (ADR-032) | Line churn note       |
| --- | ------------------------------ | --------------------- | ------------------------------ | --------------------- |
| 1   | Golden accessibility (8 attrs) | PASS                  | **EXCELLENT**                  | 0.4444 (elevated)     |
| 2   | Single aria-live addition      | PASS                  | **EXCELLENT**                  | ~0.0556               |
| 3   | Stable ID rename               | FAIL (removed id)     | **POOR**                       | varies                |
| 4   | aria-label removal             | FAIL (removed aria)   | **POOR**                       | low                   |
| 5   | Text rewrite only              | PASS                  | **MARGINAL/POOR** (magnitude)  | moderate              |
| 6   | Formatting-only rewrite        | PASS                  | **MARGINAL**                   | high; formatting flag |
| 7   | Structural redesign (IDs kept) | PASS                  | **POOR**                       | high                  |
| 8   | Full HTML rewrite              | PASS/FAIL             | **POOR**                       | ≥ 0.70                |
| 9   | JS surgical edit               | PASS                  | **GOOD/EXCELLENT** (generic)   | generic LCS           |
| 10  | CSS surgical edit              | PASS                  | **GOOD/EXCELLENT** (generic)   | generic LCS           |
| 11  | CREATE_FILE                    | N/A                   | **UNAVAILABLE**                | inactive              |
| 12  | Binary/oversize/bad HTML       | skip/FALLBACK         | **GENERIC_LINE_LCS**           | ADR-030 behavior      |

Golden Fixture 1 expectation validates preferred design direction.

## 17. Migration strategy

1. **Slice 1:** Emit `structuredAnalysis` only; no classification, no Gate 2 change, no feedback
   change. Validates parser + counts against golden matrix.
2. **Slice 2:** Add `surgicality` classification, Gate 2 badge, correction feedback rewording;
   keep ADR-030 finding codes.
3. **Slice 3:** Smoke re-validation on smoke-atelier; optional deprecate misleading
   `PRESERVATION_ELEVATED_CHURN` when structured EXCELLENT; document in progress-log /
   project-brain after user approval.

No migration of stored historical Change Plans required (optional fields ignored on read).

## 18. Implementation slices

| Slice | Deliverable                                                                                                                                         | Production impact               |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| **1** | `HtmlStructuredDeltaService`, types, unit tests, golden fixture matrix (Fixtures 1–12), metadata attached to `preservation.structuredAnalysis` only | None on Gate 2 / feedback       |
| **2** | `SurgicalityClassifierService`, `preservation.surgicality`, Gate 2 display, ADR-031 correction feedback update, integration tests                   | Operator-visible classification |
| **3** | Live smoke re-validation, optional elevated-churn finding suppression for structured EXCELLENT, project-brain / progress-log update                 | Acceptance criteria closure     |

Stop after Slice 2 if Gate 2 clearly distinguishes golden patch from rewrite; Slice 3 validates
end-to-end smoke.

## 19. Rejected alternatives

| Option                            | Reason                                                        |
| --------------------------------- | ------------------------------------------------------------- |
| A — Character ratio alone         | False surgical for structural reorder; ignores HTML semantics |
| D — Minimum-delta normalization   | Requires unknowable task semantics; AI forbidden              |
| E — Threshold-only (GOOD < 0.50)  | Smoke pass without semantic discrimination; arbitrary         |
| Prompt-only churn reduction       | Slice 4 proved insufficient; 0.4444 is minimum not excess     |
| Collapsing layers into one scalar | Hides preservation violations behind low churn                |

## 20. Rollback strategy

- **Slice 1 rollback:** Stop emitting `structuredAnalysis`; zero consumer impact.
- **Slice 2 rollback:** Hide surgicality in UI; revert feedback wording; retain structured metadata
  for diagnostics.
- **Full rollback:** Feature flag `preservation.structuredHtmlEnabled = false` (default true after
  validation) → pure ADR-030 behavior.

Line-LCS metrics never removed — rollback always restores ADR-030-visible behavior.

---

## Appendix A — Option comparison summary

| Criterion                | A char | B parse | C hybrid | D min-Δ | E threshold |
| ------------------------ | ------ | ------- | -------- | ------- | ----------- |
| Golden fixture 1         | ✓      | ✓       | ✓        | ✓*      | ✓           |
| Distinguish structure    | ✗      | ✓       | ✓        | ✗       | ✗           |
| Deterministic            | ✓      | ✓       | ✓        | ✗       | ✓           |
| No AI / task guess       | ✓      | ✓       | ✓        | ✗       | ✓           |
| Backward compatible      | ✓      | ✓       | ✓        | ~       | ✓           |
| Preserves ADR-030 safety | ✓      | ✓       | ✓        | ✓       | ✓           |

\*Option D only if minimum magically known — not acceptable.

## Appendix B — project-brain update

**Not required at design checkpoint.** Update `pendingWork` / progress after Slice 2–3 smoke
validation with explicit user approval per AGENTS.md.
