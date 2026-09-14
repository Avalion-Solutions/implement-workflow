---
name: fix-release
description: Prepare a one-off patch fix release from devel to main and devel with explicit release-branch merge commits.
---

# Fix release

Use only when the user explicitly requests a one-off, low-risk patch release.
Do not use it for features, major/minor releases, or a routine development
branch.

## Preconditions

Inspect repository instructions, release/version manifests, branch topology,
worktrees, and status before changing Git state. Require clean `main` and
`devel` worktrees, no existing release branch for the target version, and an
explicit user request to perform the release. The only exception is an
explicit recovery request naming an existing release branch. For that case,
verify its worktree is clean, its product version is the intended release, and
its history is recoverable; merge the current verified `devel` candidate into
that release with an explicit merge commit instead of recreating, resetting,
or rebasing it. Never push, install, or publish unless the user separately
authorizes that action.

## Patch-release flow

1. Start on `devel` and make the scoped fix there. Keep versioned-deliverable
   changes uncommitted until the release version is prepared.
2. Create `release/<next-patch-version>` from `devel`; verify it starts at the
   intended commit and is not a fast-forward substitute for a release merge.
3. Bump every affected semantic version by at least one patch level. Update
   canonical and generated manifests together, refresh required cachebusters,
   and regenerate derived packages before the first release commit.
4. Run the repository's release checks. Commit the fix, version changes, and
   generated artifacts together with the repository's required commit-subject
   convention.
5. Merge the release branch into `main` with an explicit merge commit. Verify
   the merged result before continuing.
6. Merge the same release branch directly into `devel` with an explicit merge
   commit. Verify branch topology and version manifests on both branches, then
   delete `release/<next-patch-version>` locally. Its commits are recoverable
   from both verified merge commits.

Stop for merge conflicts, a dirty worktree, failed checks, a version mismatch,
or any release action outside the approved scope. Preserve all evidence and
report the exact blocking condition rather than resetting, stashing, or
rewriting history.
