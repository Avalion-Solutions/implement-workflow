---
name: fixer-team
description: Repair an evidence-backed Red Team bug list through a test-first planner, builder, adversary, and judge loop.
---

# Fixer Team

Repair evidence-backed findings through exactly four sequential roles. Never infer a defect from vague prose, broaden product requirements, weaken tests, or merge into the user's branch. Standalone use repairs one finding at a time; Build mode batches its approved-scope findings once.

The primary Fixer agent is the orchestrator. It owns input and decision gates, workspace control, role handoffs, receipts, and completion; Planner, Builder, Adversary, and Judge remain the four sequential repair roles.

Read [references/exception-routing.md](references/exception-routing.md). When invoked by `/basics:build`, also read [references/orchestration-contract.md](references/orchestration-contract.md) and use its manifests, fresh-context receipts, model fallbacks, budget warnings, and telemetry rules.

## Input and workspace gate

Accept only a validated Red manifest/report with a reviewed commit and, per repairable entry: unique `RT-<domain>-<number>` ID, `path:line` evidence, meaningful impact, observable verification, and `repairDisposition: eligible`. Stop before delegation on missing or vague input; request a corrected report or [/basics:bug-list-generator](../bug-list-generator/SKILL.md). Preserve `needs-context`, `not-reproducible`, and rejected entries without implementation.

Confirm repository/commit identity, applicable `AGENTS.md`, clean source state, baseline commands, and cited files. Create `fixer-team/<run-id>-integration` from the reviewed commit. Planner, Builder, and Judge use this controlled worktree sequentially; Adversary receives a read-only snapshot. Record baseline failures separately. Never force-push, reset, or overwrite user work.

## Named diagnostic and validation chain

When the cited report does not already isolate a reproducible mechanism,
invoke these individual skills in order: [/basics:debugging-evidence-capture](../debugging-evidence-capture/SKILL.md),
[/basics:hypothesis-formulation](../hypothesis-formulation/SKILL.md),
[/basics:hypothesis-instrumentation](../hypothesis-instrumentation/SKILL.md),
and [/basics:hypothesis-evaluation](../hypothesis-evaluation/SKILL.md).
Use only minimally scoped probes permitted by the repository rules, preserve
their evidence in the receipt, and remove temporary diagnostics before final
delivery. Do not add instrumentation when a minimal failing regression already
isolates the defect. For every repair, invoke
[/basics:bug-validation-and-regression](../bug-validation-and-regression/SKILL.md)
to create the faithful regression and prove the repaired behavior.

## Standalone bug-list decision gate

Apply this gate only when a manually supplied report declares both `reportSource: bug-list-generator` and `workflowMode: standalone`. Run it after validating the report identity and cited evidence, but before creating a branch/worktree, running tests, writing artifacts, or delegating any repair role. Never apply it in Build mode: Build's approved plan, scope, criteria, and Red manifest are already the decision authority.

Review all eligible findings together and create a decision ledger with: stable `DEC-<number>` ID, affected finding IDs, category (`product`, `design`, `architecture`, `scope`, `compatibility`, or `risk`), ambiguity, evidence, viable choices and tradeoffs, recommendation, owner, and disposition. Resolve facts and requirements from cited contracts. Leave reversible internal implementation choices to Planner/Builder.

Escalate a decision to the user when two or more materially different externally observable repairs remain valid, or when repair requires a product rule, design behavior, architectural ownership boundary, compatibility promise, migration, risk acceptance, or scope expansion not determined by the report. Do not ask the user to choose routine code structure.

Batch every currently known unresolved user-owned decision through the question tool, at most three questions per call. Each question includes a recommendation and concrete alternatives with their tradeoffs. Stop and wait for the answers; then update the ledger and repeat only if unresolved user-owned decisions remain. If the question tool is unavailable, present the same compact ledger and questions in chat and stop. Start the workspace gate and four-role process only after every material ledger item is resolved, explicitly deferred, or evidenced irrelevant.

Bind resolved decisions as constraints in the Planner handoff and preserve the ledger in the standalone repair receipts. If an answer changes expected behavior, verification, or scope beyond the reviewed finding, do not stretch the report: mark the affected finding `needs-context` and request a new or corrected [/basics:bug-list-generator](../bug-list-generator/SKILL.md) report.

## Roles

| --- | --- | --- | --- |

Start each role with `fresh-context isolation: "none"` and only the finding manifest/receipt, target SHA/worktree or snapshot, allowed scope, and exact checks. Reuse a role only within the current finding; start fresh role agents for the next finding. Record nearest available model/effort fallback.

## Build mode

When Build invokes Fixer, accept only `eligible` findings from `red-1.json`; each must be `scopeDisposition: "in-scope"` and cite approved `criterionIds`. Process the complete eligible set in one Planner/Builder/Adversary/Judge batch:

1. Planner adds the smallest faithful failing regressions for all eligible IDs and commits them together.
2. Builder makes one minimal implementation pass and runs the affected acceptance and regression checks.
3. Adversary reviews only the approved criteria, eligible IDs, and repair diff. Record new outside-scope observations as deferred; do not expand the batch.
4. Judge is Build's post-fix assurance gate. It verifies the same bounded surface and accepts or blocks the candidate. Do not return to Builder or launch another Red/Fixer round automatically.

Write every eligible ID to `fixer-1.json` with `result: fixed|not-reproducible|needs-context|blocked`. Any result other than `fixed` blocks Build readiness but preserves the best candidate for explicit standalone deep work. Standalone `/basics:fixer-team` retains the iterative per-finding loop below.

## Standalone per-finding loop

1. **Planner:** inspect the report row and contracts; record expected behavior, non-goals, allowed files, risks, baseline, and commands. Add, run, and commit the smallest failing regression. If a faithful test passes or needs a product/API/migration decision, route through the exception table without speculative code.
2. **Builder:** implement the smallest clear fix, preserve documented errors/interfaces, run the planner test plus affected checks, commit, and write a receipt. Stop as `needs-context` if wider requirements emerge.
3. **Adversary:** review the test, diff, adjacent flow, boundary cases, and public callers. Return only evidence-backed critiques with IDs and testable verification; do not edit.
4. **Judge:** independently reread artifacts. Reject duplicate/style-only/unsupported critiques. Add and run the smallest regression for a plausible critique; commit only a failing test and return it to Builder. Accept only when all accepted tests and affected checks pass and the change is minimal and readable.

Progress means a new faithful failing test, a candidate commit, or new evidence that changes a finding/critique disposition. After two consecutive Builder/Judge cycles with no progress on the same finding, mark it `needs-context`, preserve receipts and commits, stop that finding, and request user direction or explicit budget extension. Never count it fixed or ready. Continue independent findings when safe.

Write one append-only `<status-dir>/handoffs/repairs/<finding-id>-<iteration>.json` receipt per loop turn. Keep raw command output under `<status-dir>/logs/`; manifests contain commands, exit codes, duration, commit, and a concise excerpt/path.

## Completion

Run the complete relevant suite. Under Build, write a staged `fixer-1` manifest with per-finding results, receipt paths, commits, tests, scoped Judge decision, blockers, fallbacks, and delivery SHA; the Build orchestrator must close it with `build-handoff.mjs close-stage`. Return only its compact receipt and artifact links. Outside Build, return equivalent concise Markdown.

Hand off the integration branch. Remove only team-created temporary worktrees after their commits are merged or intentionally retained; preserve blocked/unmerged artifacts.
