---
name: red-team
description: Run an adversarial, read-only software review with validated findings. Use only for explicit Red Team or adversarial-review requests.
---

# Red Team

Review only. Never edit, generate, format, install, build, test, commit, merge, create branches, update worktrees, or write to the repository under review.

When invoked by `$basics:build`, read [references/orchestration-contract.md](references/orchestration-contract.md) and use its fresh-context, manifests, receipt, model fallback, budget, and telemetry rules.

## Immutable review

Resolve the requested commit, record source `git status --short` and `git diff --quiet`, then create an immutable snapshot with `scripts/create_readonly_snapshot.sh <repo> <commit> [snapshot-path]`. Under Build, require `snapshot-path` below the run-ledger-recorded worktree root; never fall back to a child-selected temporary root. Use only read commands (`git show/log/diff`, `rg`, `find`, `sed`, `head`, `tail`, and file reads). Recheck source state afterward; if it changed, disclose the integrity failure and do not claim verified read-only review. Ask for a commit or explicit diff when an immutable commit cannot represent requested changes.

## Team and evidence

Use a Terra/xhigh orchestrator. Select non-overlapping relevant domains: architecture/control flow/concurrency and data/API/security/error handling use Terra/xhigh; UI/accessibility/client correctness and tests/boundaries/observability use Terra/high. Start every specialist with `fork_turns: "none"` and only the snapshot, commit, scope, criteria, no-write rule, and output path. Record nearest available fallbacks.

Every specialist must follow
[$basics:bug-finding-review](../bug-finding-review/SKILL.md), selecting
only its relevant review lenses and returning evidence-backed findings rather
than a generic checklist.

Each specialist returns a compact findings table with stable `RT-<domain>-<number>` IDs, status (`confirmed`, `suspected`, `needs-context`, `not-reproducible`), confidence, concrete `path:line` evidence, impact, and observable verification. Omit unsupported concerns.

Start a separate Sol/high final validator with `fork_turns: "none"`. Give it the same snapshot plus specialist artifact paths, not the parent conversation. It must reread cited evidence, deduplicate, reject unsupported/style-only claims, and set `repairDisposition` to `eligible`, `deferred`, `needs-context`, or `rejected`. It remains read-only and does not run tests.

## Build mode

When Build invokes Red, perform exactly one review pass and treat the approved plan, scope file, criterion IDs, and Blue changed paths as the authority. Focus first on whether the candidate implements those criteria and preserves common behavior touched by the change.

The final validator marks a finding `eligible` only when it demonstrably fails an approved criterion or introduces a regression inside the approved change scope; include `scopeDisposition: "in-scope"` and the violated `criterionIds`. Record outside-scope, uncommon-environment, speculative-hardening, portability, and pre-existing observations as `deferred` with a concise `deferReason`. Deferred findings are still useful report items but do not enter Build’s Fixer pass. Use `needs-context` only when an in-scope decision prevents judging criterion success. Do not expand Build review merely because an unusual-but-possible invocation exists.

Return one `red-1.json`. Build does not ask Red to re-review a Fixer candidate; Fixer’s scoped Judge is the post-repair gate. Standalone `$basics:red-team` remains the deep, open-ended adversarial workflow.

## Handoff

Under Build, write a staged `red-1` manifest containing commit/snapshot identity, source integrity result, coverage, scoped/deferred/rejected findings, verification paths, fallbacks, and unreviewed scope. The Build orchestrator must close it with `build-handoff.mjs close-stage`; return only the receipt and artifact links. Outside Build, return equivalent concise Markdown.

Remove only the team-created snapshot after delivery. A no-finding result is valid; never invent repair work.
