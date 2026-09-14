---
name: build
description: Run a bounded-unattended feature workflow with one approval only for sensitive operations.
---

# Build

Deliver a reviewed branch; keep planning, execution, and merge authority separate. Never merge to a protected branch without explicit approval.

Read [references/orchestration-contract.md](references/orchestration-contract.md) and [references/status-protocol.md](references/status-protocol.md). Use `scripts/build-handoff.mjs` for manifests, ledger, approvals, receipts, and reporting.
Dashboard lives in `assets/dashboard/`.

## Source and run setup

Use `model: "gpt-5.6-sol"` and `reasoning_effort: "xhigh"` when available. Inspect `AGENTS.md`, repository state, and validation commands. Require a clean source worktree.

Before Git mutation, run `scripts/worktree-root.mjs resolve --run <run-id>`. It resolves `BASICS_TEMP_ROOT`, then deprecated Build-only `BASICS_WORKTREE_ROOT`, then platform temp, and preflights the root. `build-handoff.mjs init` records absolute paths; every child lane inherits them.

Create only after checking that the recorded path and branch do not exist:

```text
<worktree-root>/build-runs/<run-id>/integration
branch: build/<run-id>-integration
archive: <state-root>/build-runs/<run-slug>/status (Codex defaults to `<user-home>/.codex`; set `BASICS_RUNS_DIR` to override)
```

Preserve the integration worktree and branch. Never force-push, reset, implicitly stash, or merge into the base branch.

## Commit-subject policy

All workflow commits must follow [$basics:feat-commit-no-scope](../feat-commit-no-scope/SKILL.md).
Inspect the staged diff and validate a scope-free `type: concrete outcome` subject:

```bash
node <plugin>/skills/feat-commit-no-scope/scripts/validate_commit_subject.js \
  "type: concrete outcome"
```

Use `chore: merge <concrete description>` for merge commits. Never use a scope or `!`.

## Explicit skill routing

Do not infer or substitute workflow methods. Build invokes
[$basics:brainstorm](../brainstorm/SKILL.md),
[$basics:bug-validation-and-regression](../bug-validation-and-regression/SKILL.md),
[$basics:blue-team](../blue-team/SKILL.md),
[$basics:red-team](../red-team/SKILL.md),
[$basics:fixer-team](../fixer-team/SKILL.md), and
[$basics:verify](../verify/SKILL.md) at their named stages. Every commit
uses [$basics:feat-commit-no-scope](../feat-commit-no-scope/SKILL.md).

Their explicit delegated routes are: Brainstorm conditionally uses
[$basics:audit-regression-readiness](../audit-regression-readiness/SKILL.md)
and [$basics:capture-behavioral-baseline](../capture-behavioral-baseline/SKILL.md);
Blue uses [$basics:run](../run/SKILL.md); Red uses
[$basics:bug-finding-review](../bug-finding-review/SKILL.md); and Fixer,
when the finding is not already reproducibly isolated, uses
[$basics:debugging-evidence-capture](../debugging-evidence-capture/SKILL.md),
[$basics:hypothesis-formulation](../hypothesis-formulation/SKILL.md),
[$basics:hypothesis-instrumentation](../hypothesis-instrumentation/SKILL.md),
and [$basics:hypothesis-evaluation](../hypothesis-evaluation/SKILL.md), in
that order. Record a limitation rather than claiming an unsupported skill ran.

Before Brainstorm, initialize status and start/reuse the dashboard:

```bash
node <tool> serve --state-dir <state-dir> --runs-dir <state-root>/build-runs --open
```

Keep it running and report its URL.

## Fast workflow and time gate

Run stages serially. Every team orchestration and specialist delegation must start with `fork_turns: "none"` and only the bounded artifact paths required by the shared contract.

Aim to finish within 30 minutes. Before every team or specialist launch, run `build-handoff.mjs time-budget`. At `target-exceeded`, stop expanding investigation and defer non-blocking findings. At `hard-stop` (45 minutes), launch no new agents: finish only an already-running deterministic check, then deliver the best preserved candidate as blocked if an approved criterion remains unresolved. Only explicit user direction may extend the run.

1. **Brainstorm and authorization preflight.** Invoke `$basics:brainstorm` in the integration worktree. Route existing behavior through regression-readiness and behavioral-baseline checks. Use two Terra/medium workers with the Sol/xhigh Build orchestrator. Store and validate the plan, `plan.json`, and `authorizations.json`. Concrete implementation requests default to `bounded-unattended`: ordinary scoped edits, tests, local branches, and commits are `authority: task`; destructive actions, protected-branch history changes or merges, and external publication are `authority: explicit`. Preflight bounded retries, derived values, sandbox/network grants, costs, and stops. Do not proceed with unresolved decisions or authority.
2. **Bind task authority or get one consolidated approval.** If every operation is `authority: task`, bind the task request with `build-handoff.mjs authorize-routine` without asking again. If any is `authority: explicit`, present the plan, scope, and sensitive-operation inventory once, then use `build-handoff.mjs approve`. This binding never bypasses the sandbox. Run bound operations without re-prompting; stop for envelope violations, integrity failure, exhausted bounds, unapproved information loss, material scope decisions, protected-branch merges, or external publication. Check bound authority and applicable operation IDs before seeding, external mutations, integration, and readiness reporting.
3. **Seed tests.** Use `$basics:bug-validation-and-regression` to translate each observable criterion into the smallest failing automated test; retain manual/legal/visual/external criteria as explicit checks. Do not modify product code or weaken tests. Commit the plan and tests, record exact failures in `seed.json`, and hand off its path.
4. **Blue Team.** Invoke `$basics:blue-team` from the seeded commit. It owns isolated specialist worktrees, explicitly uses `$basics:bug-validation-and-regression` and `$basics:run` where applicable, and returns `blue.json`, its candidate branch/commit, and validation artifacts. Do not let Blue workers edit the Build integration worktree.
5. **One scoped Red Team pass.** Invoke `$basics:red-team` once against the immutable Blue candidate with the approved plan, scope, criteria, and changed paths. Eligible findings must demonstrate and cite an approved-criterion failure or in-scope regression. Record all other findings as visible `deferred` items; they neither enter Fixer nor block readiness. Use `needs-context` only for an in-scope decision that prevents judging a criterion.
6. **At most one scoped Fixer/Judge pass.** If Red has eligible findings, invoke `$basics:fixer-team` once for the complete set. Its Planner, Builder, Adversary, and Judge are one batch; the Judge assesses only approved criteria, repaired IDs, repair diff, and relevant regression suite. Defer new outside-scope observations and launch no further Red/Fixer round. An unresolved approved criterion blocks readiness and is preserved for explicit standalone Fixer/Red work. With no eligible findings, record `fixer-1.json` as `not-required`.
7. **Integrate.** Merge the Blue commit when Fixer is not required, otherwise the Fixer commit accepted by its scoped Judge. Resolve mechanical conflicts only; ask about semantic conflicts. Invoke `$basics:verify` for the complete applicable proof, run the complete relevant suite, and record the final SHA. Do not perform a second Red pass inside Build.

Progress follows stage milestones. Add generic events only for approvals, validation, merges, and telemetry gaps.

## Delivery

Before merge readiness or a protected-branch merge, apply the fail-closed [release-routing gate](references/release-routing.md). Carry its result through continuations and handoffs.

Commit `docs/build/<run-id>-report.md` after `git diff --check`. Return outcome, readiness, dashboard URL, branch/commit, artifacts, and release routing. End with exactly `Ready for explicit merge approval` or `Not ready for merge approval`.

Readiness requires approved current plan, scope, and authorization; green validation; completed scoped Red; accepted eligible fixes (or Fixer not required); and no in-scope blockers. Deferred findings remain residual risk without blocking readiness. The report commit never authorizes a protected-branch merge.

Remove only Build-created temporary snapshots and child worktrees whose commits are merged or intentionally retained. Keep the integration branch/worktree, durable status archive, reports, and all blocking or unmerged artifacts.

When changing this skill suite or dashboard, run the status, handoff, suite-lint, dashboard, and strict skill validations named in the shared contract.
