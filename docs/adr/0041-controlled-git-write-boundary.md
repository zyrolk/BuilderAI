# ADR-041: Controlled Git Write Boundary (P1-B B5)

- **Status:** Accepted
- **Date:** 2026-08-22
- **Owners:** BuilderAI architecture
- **Related:** ADR-011 (Safe File Apply), ADR-036 (Agent Operating Layer), ADR-037 (Tool Registry),
  ADR-039 (File Editing), ADR-040 (Controlled Terminal)

## Context

B1–B4 delivered a policy-gated Tool Registry, codebase intelligence, proposal-only edits, and a
catalog-only verification terminal. Production Git today is **read-only baseline capture**
(`NodeRepositoryBaselineService`). Agents still cannot create local Git history. B5 must add the
smallest safe **local** Git write surface without becoming a second source-file mutation path, an
unrestricted shell, or a remote-mutating client.

## Decision drivers

- Preserve Gate 2 → `approveAndApply` → FileApply as the sole **source-file** mutation path.
- Treat Git history mutation as a **separate** capability with explicit OPERATOR approval.
- Fixed Git command descriptors only — no arbitrary argv, command strings, or B4 terminal Git.
- Constrain stage/commit paths to a subset of the relevant successful FileApply paths.
- Fail closed on unsafe repository states; never destructive auto-rollback.
- Keep B1–B4 contracts frozen; providers remain `toolCalling: false`.

## Decision

**P1-B B5 = Controlled Git Write (local status/diff/stage/commit).**

### Dual mutation invariant

```
Gate2 → approveAndApply → FileApply     = sole SOURCE FILE mutation
Separate OPERATOR approval
  → controlled Git stage/commit         = VCS HISTORY mutation only
```

### Tools (additive)

- `inspect_git_status` — GIT_READ, read-only porcelain-aligned status
- `inspect_git_diff` — GIT_READ, bounded diff summary/digest
- `stage_git_paths` — GIT_WRITE, OPERATOR approval; stage allowlisted paths only
- `commit_git_snapshot` — GIT_WRITE, OPERATOR approval; commit staged allowlisted set

### Runner

Introduce a dedicated **Controlled Git Runner** (not `SafeVerificationRunner`):

- `shell: false`, fixed argv factories, repository-root cwd (server-resolved)
- Bounded stdout/stderr, cancellation, timeout, process-tree termination
- Minimal sanitized environment; no interactive pager/editor/prompt
- Server-authored write descriptors may include fixed hook neutralization
  (`core.hooksPath` → empty isolated directory) and config isolation; clients cannot supply `-c`,
  `--config`, `--git-dir`, `--work-tree`, or aliases
- Fail closed if repository topology cannot be safely controlled

### Path authority

Stage/commit paths are server-validated as a **strict subset** of paths successfully Applied by the
bound FileApply evidence. Forbidden: `git add .`, `git add -A`, `git commit -a`, “commit everything”,
and trusting client path lists as authority.

### Registry policy extension

- Allow `GIT_READ` when: `readOnly: true`, `requiresGate2: false`, `approvalRequirement: NONE`,
  authorization ≠ `APPLY`
- Allow `GIT_WRITE` when: `readOnly: true` (no FileApply/APPLY/Gate2-on-tool), `riskLevel: HIGH`,
  `approvalRequirement: OPERATOR`, `authorizationAction: GIT_WRITE`, `requiresGate2: false`

Continue rejecting: `MUTATE`, unrestricted shell, FileApply wiring, provider tool execution, push.

### Approval

- Gate 2 remains content approval for source mutation.
- Git write requires explicit OPERATOR evidence (`operatorApproved`) distinct from Gate2.
- Do not auto-commit inside `approveAndApply`. Do not auto-push.

### Fail-closed repository states

Reject write (and where applicable, unsafe reads) when detecting: workspace/repo mismatch, baseline
drift, branch mismatch, detached HEAD, merge/rebase/cherry-pick/bisect, conflicts, unrelated dirty or
staged paths, index lock, unsupported worktree/submodule topology, stale FileApply binding, or hook
tree modification after stage.

### Recovery

On commit/stage failure: report safely. **Never** `reset --hard`, `clean`, destructive checkout, or
automatic history rewrite.

## B5 non-goals

- push / force-push / fetch / pull
- checkout / reset / revert / clean
- merge / rebase / cherry-pick / tag mutation
- remote configuration / credentials / GitHub-GitLab APIs
- generic Git execution / B4 terminal Git / autonomous Git loop
- provider `toolCalling` / background agents / MCP / browser

## Consequences

### Positive

- Agents/operators can record approved FileApply work as local history under tight control.
- Clear separation between content mutation and VCS history.

### Negative / accepted limits

- No remote publish in B5.
- Hooks are neutralized via isolated hooksPath for write verbs; repositories requiring mandatory
  project hooks must be handled outside this MVP.

## Security and privacy impact

- New privileged local Git process surface with env scrubbing and fixed argv.
- Operator approval required for write tools.
- Applied-path binding prevents committing unrelated dirty trees.

## Rollout and reversal

- Ship ADR-041, Controlled Git runner, binding port, four tools, `createB5GitRegistry`, policy
  extensions, and composition/security tests.
- Reversal: stop registering B5 tools; baseline read and FileApply remain intact.
