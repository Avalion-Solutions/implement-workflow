---
name: capture-behavioral-baseline
description: Capture current user-visible behavior as durable regression contract tests before a redesign, refactor, migration, or handoff.
---

# Capture Behavioral Baseline

Turn the current working stage into a verified regression baseline. Preserve behavior and public contracts without freezing incidental presentation or implementation details.

Use [references/baseline-checklist.md](references/baseline-checklist.md) to confirm the captured contract covers failure, recovery, cleanup, and enforcement boundaries.

## Operating rules

- Inspect the real repository and, when relevant, the running product before editing tests.
- Treat the current implementation as evidence, not automatically as correct. Do not encode an obvious defect, contradiction, or accidental behavior without surfacing it.
- Lock user-observable behavior and stable boundaries. Keep styles, layout, component trees, render counts, and private implementation flexible unless the user explicitly defines them as contracts.
- Prefer behavioral contract tests over broad rendered-tree or file snapshots.
- Preserve unrelated dirty or untracked files. Never stage or commit artifacts outside the owned scope.
- Use the project's existing test stack and conventions. Add production test hooks only when semantic queries cannot identify a meaningful element.
- Use focused regression-validation and commit-convention skills when they are available and relevant; keep this workflow usable when they are not installed.
- Commit only when the user explicitly requests it.

## Workflow

Before editing, tell the user how the baseline will be captured:

- interpret "snapshot" as behavioral contract tests rather than broad rendered-tree snapshots, unless the user explicitly requests visual or golden snapshots;
- name the relevant contract areas, such as content, order, routes, enabled or disabled status, loading, error, accessibility, async or media transitions, and data boundaries;
- state whether validation and a commit are in scope; and
- identify any parallel audits as read-only and confirm they will not edit code.

Explain that this keeps harmless redesign work flexible while guarding working behavior.

### 1. Establish the boundary

1. Identify the product stage, surfaces, and user flows to preserve.
2. Determine whether the request includes implementation, runtime launch, and a commit.
3. Read repository instructions, test scripts, existing tests, QA documents, and `git status`.
4. If runtime evidence matters, check whether the app is already running before launching it, then verify the served URL or primary flow.
5. Record pre-existing failures and unowned changes before editing.

### 2. Inventory current contracts

Use the coverage matrix below, then inspect both runtime behavior and its code/data path.

| Area | Candidate contracts | Useful checks |
| --- | --- | --- |
| Content and data | meaningful copy, values, item identity, ordering, sample or production status | exact content when it is product data; semantic presence when wording is intentionally flexible |
| Navigation | routes, parameters, tab order, entry points, back behavior, fallback targets | trigger the action and assert the exact public destination |
| Interaction and status | enabled, disabled, selected, deselected, coming soon, retryable | assert accessibility state and whether the action can actually occur |
| View states | loading, empty, partial, success, error, retry, recovered | control the dependency or promise and assert mutually exclusive states |
| Accessibility | roles, labels, hints, values, selected or disabled state, live regions | prefer accessible queries and assert the contract exposed to assistive technology |
| Async and media | loading, play, pause, failure, retry, recovery, cleanup | test visible state transitions and meaningful public calls, not incidental render counts |
| Adapters and APIs | factory selection, method delegation, DTO shape, public errors, metadata | assert exact stable boundaries and exclude private or obsolete fields |
| Seed and configuration | IDs, slugs, category membership, status, ordering, route targets | freeze deterministic business data only when it is intentionally part of the stage |
| Time and caching | displayed dates, expiry, stale-time buffers, refresh behavior | freeze the clock and test boundary values on both sides |
| Architecture | provider ownership, import boundaries, root wrappers, unsupported implementations | use focused static contract tests only for deliberate architectural constraints |
| Runtime | served URL, health response, critical browser flow, process state | verify the actual listener or endpoint rather than assuming startup succeeded |

Classify every candidate expectation as:

- **Lock**: stable, intentional behavior that another change must preserve.
- **Stage status**: intentional but temporary milestone state, such as sample content, coming-soon sections, feature flags, or an unimplemented adapter. Lock it in clearly named stage-specific tests so it changes only through an explicit transition.
- **Flexible**: presentation or implementation that the expected next stage may change.
- **Questionable**: contradictory, inaccessible, broken, or likely accidental behavior that needs a decision before it becomes a contract.

For each candidate invariant, ask:

1. Would a user or downstream consumer notice if it changed?
2. Is it intentional at this stage, or merely how the current implementation happens to work?
3. Is it durable behavior or intentional temporary stage status?
4. Is the next planned redesign expected to change it?
5. Can the test observe it through a public or semantic surface?
6. Does the failure message explain the broken contract?

If the answers are unclear, classify the item as questionable instead of silently freezing it. Keep temporary sample data, coming-soon controls, feature flags, and stubbed backends visibly separate from durable behavior so later baselines can replace them deliberately.

Cover independent surfaces with read-only parallel audits when useful. Tell audit agents not to edit files, and merge their findings into one contract inventory.

### 3. Map contracts to tests

Create a small gap matrix:

`Invariant | Evidence | Existing test | New or updated test | Classification | Status`

For every locked invariant, identify a test that fails when that behavior changes. Include normal paths, meaningful negative paths, and state transitions. Do not add a test merely to raise a coverage number.

When refreshing an existing baseline at a later stage:

1. Run the previous baseline before changing expectations.
2. Classify each difference as a regression, an intentional stage transition, or questionable behavior.
3. Update or remove only contracts explicitly superseded by the new stage.
4. Preserve unaffected contracts and add tests for newly stable behavior.
5. Never accept a changed snapshot wholesale as proof that the new behavior is correct.

### 4. Implement durable tests

- Drive the public surface through user actions, public functions, routes, or adapter APIs.
- Assert meaningful content, ordering, route targets and parameters, enabled or disabled status, loading, empty, error, retry, success, and accessibility semantics where applicable.
- Use fixed clocks, deterministic fixtures, controlled promises, and explicit async settlement.
- Test media and async flows as state transitions such as load, play, pause, failure, retry, and recovery.
- Test data and adapter boundaries for exact public shapes, order, status, and error contracts when those are stable.
- Keep temporary stage-status assertions visibly separate from long-lived product contracts when the test structure allows it.
- Use semantic queries first. Add minimal `testID` or equivalent hooks only when no stable semantic selector exists.
- Clean up timers, subscriptions, players, clients, and rendered trees created by tests.
- Avoid broad UI snapshots, exact CSS or layout assertions, arbitrary sleeps, private-state assertions, and brittle lifecycle call counts.
- Do not change product behavior just to make the baseline pass. If testability requires a production change, keep it behavior-neutral and explain it.

### 5. Validate the baseline

1. Run focused tests while iterating.
2. Run the complete test suite using the repository's normal command.
3. Run available typecheck, lint, build, or static architecture gates.
4. Run relevant tests non-silently at least once. Resolve unexpected warnings or report them as caveats.
5. Recheck the running product or served endpoint when the baseline covers runtime behavior.
6. Run diff and whitespace checks, then compare the final tests against the contract inventory.

Do not call the baseline complete when required gates fail. Separate pre-existing failures from regressions introduced by the work.

### 6. Commit and hand off

When a commit was requested:

1. Validate the commit subject against repository conventions.
2. Stage only owned implementation and test files.
3. Review the staged names, diff, and whitespace check.
4. Commit only after the full gate passes.
5. Verify the resulting commit and remaining worktree state.

Report:

- the stage and surfaces captured;
- the stable behavior now locked;
- temporary stage status captured for deliberate later replacement;
- presentation intentionally left flexible;
- test, typecheck, lint, build, and runtime results;
- known gaps, warnings, or questionable behaviors not encoded;
- the commit hash when applicable;
- any unowned worktree items deliberately left untouched.

## Definition of done

- Every identified locked invariant maps to a focused regression test.
- Every intentional temporary state is labeled as stage status rather than implied to be permanent product behavior.
- Intended redesign freedom is not constrained by incidental snapshots or style assertions.
- The complete validation gate passes, or the task is explicitly reported as incomplete.
- Runtime evidence is current when runtime behavior is in scope.
- Unowned changes remain untouched.
