# Trusted-local operator runbook (Zyro.lk-style targets)

This runbook is for a **single operator** using BuilderAI locally against an external target such as Zyro.lk. It does not cover hosted production, multi-user access, or unattended automation.

## Normal flow

1. Bootstrap the target once (`.builderai/target-project.json`, governance docs).
2. Enter a feature request or task-scoped request.
3. **Gate 2 — Review before applying:** inspect change plan, preservation, and surgicality evidence.
4. Explicitly approve, then apply and verify.

BuilderAI never applies changes before Gate 2 approval.

## Gate 2 rejection / correction

If the prepared plan is too broad or misses constraints:

1. Click **Reject / Request correction**.
2. Optionally add concise guidance (smallest safe change expected).
3. Review the corrected plan at Gate 2 — approval resets.
4. Approve only the corrected preparation.

Rejected preparations are never applied automatically.

## Verification failure after successful apply

When apply status is **Applied** but verification fails:

- Message: **The file changes were applied, but verification failed.**
- Files are already on disk — BuilderAI does **not** roll back automatically.
- Inspect the Verification Report tab for stage classification (build, test, lint, typecheck, timeout, infrastructure).
- Use **Fix verification failures** to start a bounded correction prepare.
- Corrected plans return to Gate 2; you must approve again before another apply.

## PARTIALLY_APPLIED

When some operations succeeded and others failed:

- Some files were written; remaining operations may not have run.
- **Do not** use automatic AI correction from the previous prepare baseline.
- Follow the recovery checklist:
  1. Inspect applied operations.
  2. Inspect failed operation and error reason.
  3. Inspect current target files on disk.
  4. Run or inspect verification where available.
  5. Reconcile the filesystem manually if needed.
  6. Click **Start fresh prepare** and describe remaining/fix work from **current** disk state.

Automatic retry is unsafe until the filesystem is understood.

## Baseline drift

If apply reports **baseline drift** (`BASELINE_CONTENT_DRIFT`):

- Target files changed after prepare (manual edit, another tool, or concurrent work).
- No safe mutation was applied for drifted operations.
- Start a **fresh prepare** from the current filesystem state.

## Dependency / package.json changes

When a plan updates `package.json` or lockfiles:

- BuilderAI does **not** run `npm install` automatically.
- Run `npm install` manually in the target repository if dependencies changed.
- Ensure lockfile and `node_modules` match before the next prepare/verify cycle.

## When to run npm install manually

- After applying a plan that changed dependencies.
- After you edited `package.json` outside BuilderAI.
- Before expecting build/test/lint/typecheck verification to pass on new packages.

## When a fresh prepare is required

- After **PARTIALLY_APPLIED**.
- After **baseline drift**.
- After manual filesystem reconciliation.
- When optional verification scripts were added/removed in `package.json` and context must be re-indexed.

## When BuilderAI should NOT continue automatically

- Partial apply — manual inspection first.
- Baseline drift — no stale prepare/apply.
- Verification failure — correction still requires Gate 2 approval.
- Dependency changes — install packages manually first.
- Any situation where disk state is unknown.

## Readiness boundary

**BUILDERAI_ZYROLK_READY** means: controlled trusted-local, single-operator, feature-by-feature development with Gate 2 human review — **not** hosted production readiness, unattended autonomy, transactional rollback, or deployment automation.
