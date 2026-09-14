---
name: audit-regression-readiness
description: Audit whether user-visible behavior has adequate regression tests and verification before refactors, migrations, or handoffs.
---

# Audit Regression Readiness

Assess how safely a project can change without silently breaking working behavior. Default to a read-only audit: inspect, run existing gates, and report evidence without editing tests or production code.

Use [references/audit-checklist.md](references/audit-checklist.md) as the compact completion checklist for complex audits.

## Operating rules

- Treat a status or audit request as read-only. Implement hardening only when the user explicitly asks for changes.
- Inspect the real repository and relevant runtime. Do not answer from test names, coverage percentages, or QA documents alone.
- Evaluate user-visible behavior and stable public boundaries, not incidental implementation details.
- Treat current implementation as evidence, not truth. Flag broken, contradictory, or inaccessible behavior instead of recommending that it be frozen.
- Preserve dirty and untracked files. Record the initial and final worktree state.
- Separate current verification from historical claims. Report stale test counts, screenshots, manifests, or QA status when found.
- State what was not run or could not be verified.

## 1. Establish the audit boundary

1. Find the repository and actual runnable roots, including nested apps in monorepos.
2. Read repository instructions, package/build manifests, test configuration, acceptance documents, QA notes, and `git status`.
3. Identify the product stage, supported platforms, critical user flows, public APIs or adapters, and the changes being planned.
4. Decide which behavior is durable, temporary stage status, intentionally flexible, or questionable.
5. Check whether runtime, remote CI, branch protection, native-device behavior, or external services are material to the claim.

## 2. Inventory protection layers

Use the audit matrix below, then inventory:

- unit, contract, component, integration, end-to-end, runtime, visual, accessibility, and device tests;
- fixtures, seeds, snapshots, goldens, and behavioral baseline tools;
- loading, empty, partial, error, retry, recovery, navigation, and cleanup transitions;
- public data shapes, ordering, routing parameters, enabled or disabled status, and platform behavior;
- verification scripts, CI workflows, required checks, branch protection, and agent instructions;
- mock, stub, production-adapter, and generated-output boundaries.

Map each important invariant using:

`Surface | Observable invariant | Existing evidence | Strength | Enforcement | Gap | Classification`

Use these strength labels:

- **Strong**: exercises the public behavior, includes meaningful negative or transition paths, and runs in an enforced gate.
- **Moderate**: focused behavioral coverage exists, but mocks, missing integration, or manual execution leave a material gap.
- **Weak**: protected only by static inspection, broad snapshots, duplicated fixtures, historical evidence, or manual review.
- **Missing**: no test would reliably fail if the behavior changed.

### Contract inventory

| Area | Candidate observable contracts | Evidence to seek |
| --- | --- | --- |
| Entry and navigation | default route, route targets and parameters, tab order, redirects, back behavior, fallback routes | real router or browser flow; focused route assertions |
| Content and data | meaningful copy, values, identity, ordering, filtering, seed status | exact public projections; deterministic fixture and adapter checks |
| Interaction | enabled, disabled, selected, inert, mutation, confirmation, cancellation | user actions through the public surface; negative assertions |
| View states | initial, loading, empty, partial, success, error, retry, recovered | controlled dependencies and explicit state transitions |
| Async and media | load, play, pause, expiry, failure, retry, cleanup | controlled clocks/promises plus real platform smoke checks |
| APIs and adapters | request shape, response DTO, error taxonomy, delegation, production selection | contract/integration tests against the real boundary |
| Persistence | create, update, reload, migration, concurrency, rollback | isolated database or storage integration tests |
| Accessibility | roles, labels, names, state, focus order, live regions, contrast | semantic queries, automated checks, manual assistive-tech review |
| Responsive and visual | overflow, containment, stable composition, important imagery | geometry assertions and selective screenshot review or diff |
| Platform and runtime | build/export, served URL, browser/native differences, permissions | current build and runtime/device evidence |
| Security and absence | forbidden writes, credentials, unavailable features, access boundaries | negative contract tests, static gates, runtime probes |

### Evidence layers

Treat layers as complementary rather than interchangeable.

| Layer | Proves | Does not prove by itself |
| --- | --- | --- |
| Unit | isolated rules and boundary values | real wiring or user flow |
| Contract | public shapes, errors, ordering, adapter semantics | rendering or deployment behavior |
| Component | rendered states and local interactions | router, network, storage, or platform integration when mocked |
| Integration | multiple real modules cooperate | complete deployed user flow |
| End-to-end | critical flow works through public entry points | every edge case or native/platform parity |
| Runtime/device | actual environment behavior | repeatable regression enforcement unless automated |
| Visual | selected appearance and layout | semantic correctness or interaction behavior |
| Accessibility | exposed semantics and assistive behavior | unrelated product correctness |

### Enforcement audit

Check whether protection is mandatory rather than aspirational:

- A single documented verification command exists and includes relevant tests, type checks, lint, build/export, and runtime checks.
- CI runs on pull requests and the target branch, and required checks or branch protection prevent bypass.
- Skipped, focused, quarantined, flaky, or warning-producing tests cannot silently pass the gate.
- Baseline check and update commands are separate; snapshot or golden updates require explicit review.
- Tests use deterministic clocks, data, ports, and services.
- Generated artifacts are reproducibly checked or deliberately excluded.
- Repository instructions require agents to run and report the gate.
- Remote enforcement is verified remotely rather than inferred from workflow files.

### AI-specific regression traps

- Production behavior and expected snapshots change together without an explicit contract decision.
- A mock repeats the implementation but never reaches the real adapter, router, database, or media player.
- A test asserts a call but not the user-visible result.
- Passing counts are copied into QA documents and drift from the current suite.
- Broad snapshots freeze incidental markup while missing route, error, or recovery behavior.
- Baseline capture overwrites the committed reference even when used as a check.
- The default adapter is tested while the production adapter remains a stub or untested branch.
- Manual commands exist but no merge gate runs them.
- One platform is treated as proof for another.
- A neighboring query or screen is mistaken for coverage of an independently failing dependency.
- Missing error handling becomes a blank state that is accidentally classified as behavior to preserve.

### Gap priority

- **P0**: data loss, security boundary, destructive mutation, unrecoverable migration, or release-blocking critical path.
- **P1**: common user flow, navigation, persistence, payment, authentication, media, or failure/recovery path can regress silently.
- **P2**: lower-frequency state, presentation contract, documentation drift, or manual-only quality check.

Assign priority from user impact, likelihood, detectability, and blast radius, never missing line coverage alone.

Before leaving the inventory, answer which behaviors definitely fail a test if changed, which tests bypass real boundaries, which state transitions are missing, which current behaviors are temporary or questionable, which visual/accessibility claims remain manual, which gates are current, and whether a failed gate or baseline update can be bypassed.

## 3. Run current verification

1. Discover and run the project's normal full test command non-silently.
2. Run available typecheck, lint, build or export, architecture, and static gates in proportion to the project risk.
3. Check for skipped, focused, quarantined, flaky, or warning-producing tests.
4. If runtime behavior matters, check whether the app is already running before launching it. Verify the served endpoint or critical flow and restore the prior process state afterward.
5. Use coverage only as supporting evidence. Never equate line coverage with behavioral protection.
6. Do not run a capture or update command that overwrites committed baselines during a read-only audit. Prefer a check mode; otherwise inspect the existing artifact and report that it was not refreshed.
7. If a GitHub or equivalent connector is available and a remote is configured, inspect remote workflows and required checks. Local workflow files do not prove branch protection.

Record exact commands, results, counts, warnings, and timestamps where drift matters.

## 4. Test the tests adversarially

For each critical surface, ask:

- Would a meaningful behavior change fail a test, or could production and expected data drift together?
- Does the test drive the public route, UI, API, or adapter, or only a mocked substitute?
- Are fixtures copied from the implementation so that both can be wrong in the same way?
- Are error, retry, recovery, back-navigation, cancellation, and cleanup paths covered?
- For every independent query, promise, process, or subscription, can its loading, error, retry, recovery, and cleanup behavior be traced separately? Do not treat a neighboring dependency or screen as coverage.
- Is the real production adapter exercised, or only a mock while production remains a stub?
- Can an agent update snapshots or baselines in the same command that checks them?
- Are tests automatically required before merge, or merely documented commands?
- Are web, native, browser, database, media, accessibility, and platform boundaries being inferred rather than observed?
- Do QA documents claim test counts or runtime evidence that no longer match the current checkout?

Inspect the production branch that produces the behavior when a test name is ambiguous. Surface unhandled behavior as a product gap, not merely a missing test.

## 5. Report the verdict

Lead with **Yes**, **Partially**, or **No**, followed by one sentence explaining the limiting factor. Then report:

1. current verification results and worktree state;
2. a compact surface-by-surface protection matrix;
3. the strongest existing protections;
4. gaps ordered by regression risk and blast radius;
5. questionable behavior that should not be frozen;
6. a prioritized hardening sequence;
7. unverified runtime, remote, device, or accessibility claims.

Use direct file links and line-level evidence. Distinguish absent local CI from unverified remote branch settings. Avoid false numerical scores unless the project already has a meaningful scoring model.

For AI-heavy workflows, normally prioritize:

1. one canonical verification command;
2. required CI checks and protected baseline-update paths;
3. end-to-end coverage of critical flows;
4. missing error and recovery contracts;
5. platform, native-device, accessibility, and selective visual checks;
6. repository instructions requiring evidence before completion.

If the user then asks to implement the hardening, use the project's existing test stack and the `capture-behavioral-baseline` workflow where available. Do not silently convert the audit into implementation.
