# Build orchestration contract

Read this reference when Build delegates a stage or a team delegates a specialist. It is the shared contract for context isolation, handoffs, models, budgets, telemetry, and validation.

## Context isolation

- Start every team orchestrator, specialist, adversary, judge, and final validator with `fresh-context isolation: "none"`. Never inherit the parent conversation.
- A delegation prompt contains only: objective; immutable source commit/snapshot/worktree; allowed scope; decision/criterion/finding IDs; exact manifest, artifact, and log paths; required checks; and the terminal receipt contract.
- Never paste earlier reports, raw test output, full diffs, or chat history into a prompt. Point to durable artifacts and require the agent to read only the files needed for its bounded task.
- Keep the parent compact after each stage: reload `run-ledger.json` and the latest required manifest; retain only unresolved IDs and the next gate in conversation.
- Return a concise receipt (outcome, status, commit, checks digest, blockers, artifact paths). Full findings, command output, and reports stay on disk.

## Models and host capacity


| --- | --- | --- |

Respect host concurrency and reserve one slot for each waiting orchestrator. Reduce parallelism, never required gates. Build runs Brainstorm, seed tests, Blue, exactly one scope-bound Red pass, at most one Fixer/Judge pass when eligible findings exist, and integration. Standalone Red/Fixer invocations retain their deep workflows.

## Build assurance boundary

The approved plan, scope file, criterion IDs, and Blue changed paths are the Build review boundary. Under Build:

- Red may mark a finding `eligible` only when evidence shows that the candidate fails an approved criterion or introduces a regression within the approved change scope. Each eligible finding includes `scopeDisposition: "in-scope"` and non-empty `criterionIds`.
- Red records outside-scope, uncommon-environment, speculative-hardening, portability, and pre-existing observations as `repairDisposition: "deferred"`, with `scopeDisposition` and `deferReason`. They remain in the delivery report but do not block readiness or enter Fixer unless the user explicitly expands scope.
- `needs-context` means an in-scope product decision prevents judging an approved criterion; it blocks readiness. Style-only or unsupported claims remain `rejected`.
- Fixer handles all eligible IDs in one Planner/Builder/Adversary/Judge batch. Its Judge is the scoped post-fix gate. It may verify only the approved criteria, eligible IDs, repair diff, and relevant regressions; it defers new outside-scope observations. Build never launches a second Red or Fixer round automatically.
- A single unresolved eligible ID blocks Build readiness and is handed to standalone `/basics:fixer-team` or `/basics:red-team` for optional deep work.

## Durable artifacts

## Recorded worktree root

Build initialization resolves `BASICS_TEMP_ROOT` once through `scripts/worktree-root.mjs`, with nonblank `BASICS_WORKTREE_ROOT` retained only as a deprecated Build fallback, then preflights the selected filesystem before Git mutation. It stores the absolute root, project-contained run root, and integration path in `run-ledger.json`. The temporary-root variables control disposable worktrees and large build artifacts only; `BASICS_RUNS_DIR` continues to control durable status archives. Every Blue, Red snapshot, Fixer, Judge, and integration prompt must receive paths below the ledger-recorded run root. Reject child-selected roots or environment overrides. When neither configured value is present, use only the helper's platform temporary-directory fallback; do not embed host-specific temporary paths in prompts.

All low-context handoffs live below `<status-dir>`:

```text
handoffs/plan.json
handoffs/authorizations.json
handoffs/seed.json
handoffs/blue.json
handoffs/red-<round>.json
handoffs/fixer-<round>.json
handoffs/repairs/<finding-id>-<iteration>.json
handoffs/integration.json
handoffs/run-ledger.json
logs/<stage>-<check>.log
```

Every stage manifest uses this envelope; arrays may be empty, but required keys must exist:

```json
{
  "schemaVersion": 1,
  "kind": "plan|seed|candidate|review|repair|integration",
  "runId": "stable run id",
  "stage": "brainstorm|seed-tests|blue|red-N|fixer-N|integration",
  "status": "queued|active|waiting|completed|blocked|failed|needs-context|not-reproducible|not-required",
  "source": { "repo": "path/name", "base": "sha", "commit": "sha" },
  "objective": "one sentence",
  "decisions": [],
  "criteria": [],
  "inputs": [],
  "outputs": [],
  "checks": [],
  "findings": [],
  "blockers": [],
  "artifacts": [],
  "next": []
}
```

Use stable IDs across manifests. An automated check records `command`, `result` (`passed`, `failed`, or seed-only `expected-failure`), integer `exitCode`, `commit`, duration when known, and either a log path or an evidence excerpt of at most 512 characters. Its commit must equal `source.commit`. `passed` requires exit 0; failed/expected-failure requires nonzero. A `blocked` or `not-required` check uses `exitCode: null` and a concrete `reason`; use not-required only for genuinely manual-only criteria. Seed readiness permits expected failures but no unrelated `failed` or `blocked` check. A review finding records a stable `id`, evidence, impact, verification, `scopeDisposition` (`in-scope`, `in-scope-nonblocking`, or `out-of-scope`), and `repairDisposition` (`eligible`, `deferred`, `needs-context`, or `rejected`). Eligible findings also record `criterionIds`; deferred findings record `deferReason`. A repair finding records the same ID and `result` (`fixed`, `not-reproducible`, `needs-context`, or `blocked`). Blue includes `{ "kind": "seed", "commit": "<seed SHA>" }`; Fixer includes `{ "kind": "review", "commit": "<Red-reviewed SHA>" }`; integration includes `{ "kind": "reviewed-candidate", "commit": "<Blue SHA when Fixer is not required, otherwise scoped-Judge-accepted Fixer SHA>" }` in `inputs`. Unrelated commits do not satisfy readiness. Artifacts record a path plus purpose; do not inline their contents.

Use the deterministic helper:

```bash
node <skill>/scripts/build-handoff.mjs validate --file <manifest>
node <skill>/scripts/build-handoff.mjs close-stage --status-dir <status-dir> --file <staged-manifest>
node <skill>/scripts/build-handoff.mjs reconcile --status-dir <status-dir>
node <skill>/scripts/build-handoff.mjs budget --status-dir <status-dir> --kind manifest --file <manifest>
node <skill>/scripts/build-handoff.mjs time-budget --status-dir <status-dir>
```

`close-stage` is the required terminal-stage interface. It accepts only `completed` and `not-required`, validates the dependency chain, promotes the staged manifest to its canonical path, records a pending ledger receipt, and reconciles dashboard telemetry. Reconciliation is restart-safe and idempotent by stage and manifest SHA-256. The ledger and canonical manifest remain authoritative; a telemetry failure stays visible and non-release-blocking. Legacy `record` remains available only for offline ledger-only compatibility.

## Authorization provenance

For a concrete implementation request, write and validate a bounded-unattended
authorization manifest. Classify ordinary scoped edits, tests, local branches,
and local commits as `authority: "task"`; the request itself authorizes them.
Use `authority: "explicit"` only for irreversible/destructive actions,
protected-branch history changes or merges, and external publication. If any
operation is explicit, ask once for the complete sensitive-operation inventory.

```json
{
  "schemaVersion": 1,
  "kind": "authorization",
  "runId": "stable run id",
  "status": "ready",
  "reviewedCategories": ["filesystem", "git", "dependencies", "external-systems", "identity-access", "cost-lifecycle", "recovery"],
  "execution": {
    "mode": "bounded-unattended",
    "maxAttemptsPerOperation": 2,
    "stopConditions": [{ "id": "STOP-001", "condition": "an action exceeds approved targets, consequence, cost, attempts, or integrity invariants", "reason": "new user authority is required" }]
  },
  "operations": [
    { "id": "AUTH-001", "authority": "task", "category": "filesystem", "action": "exact scoped implementation command", "targets": ["exact repository paths"], "consequence": "updates only the requested implementation", "bounds": "stated task scope and repository checks" },
    { "id": "AUTH-REC-001", "authority": "task", "category": "recovery", "trigger": "exact observable failure from AUTH-001", "action": "exact fallback command", "targets": ["same bounded target"], "consequence": "effect of the fallback", "bounds": "preserved version, security, and resource limits", "dependsOn": ["AUTH-001"], "maxAttempts": 1 },
    { "id": "AUTH-PUB-001", "authority": "explicit", "category": "external-systems", "action": "exact publication command", "targets": ["exact remote or service destination"], "consequence": "publishes the reviewed result outside the local workspace", "bounds": "named destination and release/version only" }
  ],
  "excluded": [{ "id": "AUTH-X01", "action": "protected branch merge", "reason": "requires separate current approval" }],
  "unresolved": [],
  "evidence": ["read-only discovery or exact preview used to build this inventory"]
}
```

All seven categories must be reviewed even when no operation is needed. Concrete implementation requests use `execution.mode: "bounded-unattended"`; reserve `interactive` for a user-requested staged workflow. Unattended mode requires a retry cap and explicit stop conditions. Every operation has `authority: "task"` or `authority: "explicit"`; omitted legacy authority is explicit. Operations use stable IDs and exact bounded targets; optional `trigger`, `dependsOn`, `maxAttempts`, and `derivation` fields define bounded branches without changing the manifest. A derivation names exact inputs, a deterministic procedure, validation invariants, and an action placeholder. Wildcards, blanket future authority, and unspecified destructive actions are invalid.

`excluded` records intentionally unapproved actions and `unresolved` must be empty before binding. Use read-only discovery and exact previews to materialize values before an explicit approval whenever possible. If a later value is unknowable but deterministic and fully validated, use a bounded derivation. If it requires a subjective choice, broader target, different identity, new consequence, weakened invariant, unbounded cost, information loss, protected-branch change, or publication, split before mutation and obtain approval while the user is present.

```bash
node <skill>/scripts/build-handoff.mjs validate-authorizations \
  --file <authorization-manifest> --run <run-id>
```

When every operation has `authority: "task"`, bind the user’s concrete request
without another conversational approval:

```bash
node <skill>/scripts/build-handoff.mjs authorize-routine --status-dir <status-dir> \
  --plan <plan-manifest> --scope <scope-file> \
  --authorizations <authorization-manifest> --event task-request
```

When any operation has `authority: "explicit"`, obtain one consolidated
approval, then bind authority to the exact plan, scope, and authorization files:

```bash
node <skill>/scripts/build-handoff.mjs approve --status-dir <status-dir> \
  --plan <plan-manifest> --scope <scope-file> \
  --authorizations <authorization-manifest> --event <approval-event-id>
node <skill>/scripts/build-handoff.mjs check-approval --status-dir <status-dir> \
  --plan <plan-manifest> --scope <scope-file> --authorizations <authorization-manifest> \\
  --operations AUTH-001,AUTH-REC-001
```

Re-run `check-approval --operations <comma-separated-ids>` before seeding, each external mutation group, integration, and readiness. Any changed plan, scope, or authorization hash invalidates the binding. Pass the manifest and applicable operation IDs to every execution agent.

In `bounded-unattended` mode, agents must not ask again for a listed task-authorized operation, fallback whose exact trigger is evidenced, or derived operation whose procedure and validation pass. Record actual commands, resolved values, trigger evidence, attempts, and outcomes in receipts without editing the bound manifest. Before announcing that unattended execution is armed, resolve every platform-enforced sandbox, network, credential, or scoped escalation prompt identified by preflight; the manifest never overrides host enforcement. If a new host prompt appears later, use an already granted capability or stop rather than bypassing it.

Stop before any absent operation, exceeded bound or attempt limit, failed integrity invariant, unapproved information loss, material product/scope choice, new identity/target/consequence, or protected-branch merge. Repeated late prompts for knowable or reasonably foreseeable recovery are planning defects. Approval never authorizes a protected-branch merge.

## Time and proxy budgets

Build targets 30 elapsed minutes and has a 45-minute automatic-work ceiling. Invoke `time-budget` before every team or specialist launch. `target-exceeded` means stop expanding investigation and defer non-blocking work. `hard-stop` means launch no new agents; finish only an already-running deterministic check, then report the preserved candidate as blocked when an approved criterion is unresolved. Only explicit user direction extends the ceiling. Elapsed time never weakens tests, approval, source-control safety, or the scoped Judge gate.

The runtime does not provide enforceable per-stage token caps. Use byte/line proxies:

| Payload | Warning threshold |
| --- | --- |
| Delegation prompt | 6 KiB |
| Manifest | 16 KiB |
| Receipt | 2 KiB |
| Inline command output | 2 KiB or 20 lines |

Run `build-handoff.mjs budget`. On warning, move detail to an artifact/log and shorten the prompt or receipt where practical. Never skip a required gate because of a warning. Track proxy warnings in the run ledger.

## Status telemetry


## Required suite validation

After changing this suite, run:

```bash
node --test build/scripts/build-handoff.test.mjs
node <skill-check>/scripts/quick-validate.mjs <each-skill>
node <skill-check>/scripts/check-skill.mjs --strict <each-skill>
```

If a package build fails only because shared `node_modules` is read-only, run the equivalent Vite build with `--configLoader runner` and record the environment caveat.
