# Release routing

Before presenting merge readiness, and again before acting on any later
protected-branch merge approval, inspect local `release/*` branches and
registered worktrees. For each release branch not contained in the proposed
target, report its name, commit, worktree state, and relationship to the
integration candidate.

A pending or checked-out release is a routing conflict. Report `Not ready for
merge approval` until the user explicitly chooses to route the candidate
through that release or explicitly authorizes bypassing the named release.
Never interpret a generic instruction such as “merge to devel” as resolving or
bypassing a known release branch.
