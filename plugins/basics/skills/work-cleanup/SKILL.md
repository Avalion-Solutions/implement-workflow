---
name: work-cleanup
description: Safely inventory stale Git worktrees and branches, then clean only explicitly approved targets. Use for audit, removal, pruning, or reporting requests.
---

# Worktree Cleanup

Run cleanup as a two-phase, evidence-first operation. Never delete during the inventory phase.

## Modes

Use the default **cleanup mode** for an inventory followed by an approval-gated
cleanup proposal.

### Invocation hint

Invoke `$work-cleanup --report` for a read-only evaluated status report. The
`--report` parameter means “evaluate current worktrees and local branches; do
not perform cleanup.”

Use **report mode** with `$work-cleanup --report` to evaluate and state the
current worktree and local-branch status only. Determine the documented
protected integration branch first, then run the read-only inventory as:

```bash
node <skill-dir>/scripts/worktree-inventory.mjs --report --base <branch>
```

In report mode, preserve the four-column status table: worktree/path, branch
or HEAD, current state, and merge evidence. Use merge evidence to evaluate the
status, but do not add proposal or hint columns. If no documented base can be
determined, omit `--base` and say merge evaluation is unavailable. Do not
propose actions, ask for approval, prune metadata, delete anything, or
otherwise continue cleanup work. Return the report table and stop.

## 1. Establish scope

Run from the target repository. Identify the current branch and every registered worktree with:

```bash
git worktree list --porcelain
git branch --all --verbose --no-abbrev
node <skill-dir>/scripts/worktree-inventory.mjs
```

The inventory also reads optional Markdown discovery hints from `<user-home>/.codex/notes/work-cleanup/*.md`; pass `--notes-dir <path>` only for an explicitly selected equivalent registry. A note path is never deletion authority. Report it as `note hint / needs investigation` until its existence, owning repository, Git registration, dirtiness, locks, merge evidence, and task/handoff activity are verified. Never migrate or delete a hinted path automatically.

If the repository has a documented base branch, use it. Otherwise ask the user which protected integration branch should define “merged”; do not assume that `main`, `master`, or `devel` is disposable.

The exact local branch names `devel`, `main`, and `master` are permanently
protected. Always classify them as `keep / protected branch`, regardless of
the selected base, merge evidence, age, or whether they are checked out. Never
propose, request approval for, or attempt deletion of those exact names.

Treat a worktree as protected when any of these apply:

- It is the current worktree, is locked, or has uncommitted/untracked changes.
- Its branch is not an ancestor of the approved base branch.
- Its branch name, path, recent commits, or repository task/handoff documentation indicates active or potentially active work.
- It is a detached-HEAD worktree without explicit user approval.

Classify missing administrative registrations separately from actual directories. `git worktree prune` only cleans stale metadata; it does not authorize removal of a real directory.

## 2. Produce the proposed action table

Use the inventory script as evidence, then present a Markdown table before mutating anything:

| Worktree/path | Branch or HEAD | State | Merge evidence | Proposed action | Requires approval |
| --- | --- | --- | --- | --- | --- |

Include every registered worktree and every local branch that has no worktree. Use these actions only: `keep`, `prune stale registration`, `remove worktree`, `delete branch`, or `needs investigation`.

Do not remove protected, uncertain, unmerged, or task-tied entries. Ask the user to explicitly approve the exact rows proposed for deletion. A generic request to “clean up” is not approval to remove uncertain work.

Before presenting the table, verify that `devel`, `main`, and `master` have no
deletion proposal. If any of those exact names is marked for deletion, stop and
correct the inventory or proposal logic.

## 3. Execute approved cleanup

For each approved real worktree, prefer Git-managed removal:

```bash
git worktree remove <path>
```

Use `--force` only after confirming the exact path is approved and explaining why normal removal refused it. If Git removal fails because the worktree is stale/broken, show the failure, re-check the path and repository containment, and obtain or confirm approval before manual removal. Manual removal must be narrowly targeted; afterward run:

```bash
git worktree prune
```

Delete an approved local branch only after it is no longer checked out by any worktree:

```bash
git branch -d <branch>
```

Refuse to run branch-deletion commands targeting the exact names `devel`,
`main`, or `master`, even if the user includes them in a broader cleanup
approval. These names require a deliberate workflow outside this skill.

Use `git branch -D` only for an explicitly approved unmerged branch. Never delete remote branches unless the user separately requests it.

## 4. Verify and report

Re-run the inventory and `git worktree list --porcelain`. Report a final table covering all proposed rows, with the actual action and any failures or retained entries. State that no unmerged, locked, dirty, or task-associated worktree/branch was removed without explicit approval.

## Safety constraints

- Do not use recursive deletion until Git-managed removal has failed and the exact directory has explicit approval.
- Do not remove a worktree solely because it is old, outside the repository, or has a stale-sounding name.
- Preserve user-owned dirty/untracked content and report it instead of cleaning it.
- Do not use resets, forced checkouts, or merge-base assumptions that bypass the repository’s merge policy.
