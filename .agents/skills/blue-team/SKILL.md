---
name: blue-team
description: Orchestrate parallel, test-first implementation by isolated specialist subagents. Use only for explicit Blue Team requests.
---

# Blue Team

Own clarification, decomposition, isolated implementation, integration, validation, and delivery. Do not delegate orchestrator decisions or merge into the user's branch.

When invoked by `$basics:build`, read [references/orchestration-contract.md](references/orchestration-contract.md) and accept the plan/seed manifest paths as authoritative. Apply its fresh-context, receipt, model fallback, budget, and telemetry rules.

## Setup and team

Use a `gpt-5.6-terra` / `xhigh` orchestrator. Use Terra/medium specialists for cross-module, state, API, data, UI, accessibility, or risky changes; use Terra/low for bounded mechanical, test, or documentation work. Record the nearest available fallback.

Inspect applicable `AGENTS.md`, repository state, validation commands, and referenced artifacts. Require a clean source worktree. Resolve only implementation-blocking ambiguities; ask the user in batches of at most three and persist decisions in the candidate manifest.

Create `blue-team/<run-id>-integration` and one branch/worktree per independent domain. Start every specialist with `fork_turns: "none"` and a prompt containing only its worktree, bounded goal, allowed files, interfaces, criterion IDs, required checks, and manifest/log paths. Never parallelize overlapping edits; sequence shared-interface work.

## Implement and integrate

Each specialist must use
[$basics:bug-validation-and-regression](../bug-validation-and-regression/SKILL.md)
to select the smallest faithful regression proof for its assigned criteria.
Each specialist must inspect local code, implement a complete scoped change,
preserve public contracts, avoid placeholders/test suppression, run scoped
checks, commit, and write a compact receipt. When acceptance depends on a
user-observable runtime flow, invoke [$basics:run](../run/SKILL.md) to
observe that flow and record the result; do not claim runtime observation when
it was not possible. The orchestrator reviews and merges accepted commits one
at a time. Resolve mechanical conflicts only; escalate semantic conflicts.

Run the full relevant repository suite from the Blue integration worktree. Separate baseline, candidate-caused, external, and unresolved failures. Call the result green only when task-relevant checks pass. Never force-push, reset, overwrite user work, or merge to the user's base branch.

## Handoff

Under Build, write a staged Blue manifest with resolved decisions, criterion coverage, specialist commits, changed behavior, exact checks/results, blockers, artifact/log paths, and the final candidate branch/SHA. The Build orchestrator must close it with `build-handoff.mjs close-stage --status-dir <status-dir> --file <staged-manifest>`; return only the receipt and artifact links. Outside Build, return the equivalent concise Markdown delivery.

Remove only team-created specialist worktrees after their commits are merged or intentionally retained. Preserve the Blue integration branch as the candidate artifact.
