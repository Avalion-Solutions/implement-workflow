# Build status protocol

Use this protocol only when a Build orchestrator supplies the script path, run ID, and status directory. The Build orchestrator is the authoritative event producer; teams supplement it at their own lifecycle boundaries. Status is telemetry, never a release gate.

## State model

Use these values exactly:

| Entity | States |
| --- | --- |
| Run | `active`, `awaiting-approval`, `blocked`, `completed`, `failed` |
| Team / agent | `queued`, `active`, `waiting`, `completed`, `blocked`, `failed`, `not-required` |
| Task / finding | `queued`, `active`, `waiting`, `passed`, `failed`, `blocked`, `not-required` |

The status script is the only state normalizer. Send every lifecycle transition through it; it canonicalizes team references (including round-specific IDs such as `red-1` and `fixer-2`), updates the dashboard state atomically, and derives overall progress. Do not calculate or submit overall progress from task/finding queue counts. A task must not become `passed` until its declared command/check or review decision is recorded.

Schema-v3 state includes a deterministic `summary`: `activeAgents` counts only active registered agents; `queuedOrWaitingAgents` counts registered agents in either state; `openBlockers` counts blocked or failed tasks; and `openFindings` counts non-terminal finding tasks. The dashboard treats these recorded values as authoritative. Its three interactive summary filters are unions when more than one is selected: active agents shows active agents, their teams, and tasks owned by those teams; open blockers shows blocked/failed tasks and their teams/agents; open findings shows unresolved findings and their teams/agents.

Each run also records an immutable URL-safe `run.slug` and monotonically increasing event sequence. Build stores the run under `<state-root>/build-runs/<slug>/status`; Codex defaults `<state-root>` to `<user-home>/.codex`, and adapters may set `BASICS_RUNS_DIR`. Temporary integration worktrees remain separate under the project-contained root resolved from `BASICS_TEMP_ROOT` (with the deprecated Build fallback and platform temporary directory only when needed). Status snapshots retain the most recent 200 events, while `events.ndjson` retains the complete ordered log. The script repairs a snapshot event missing from the log before the next update or export. If a crash leaves only the final NDJSON line unterminated and invalid, the script preserves that raw tail in an `events.ndjson.corrupt-tail-<hash>` sidecar and continues from the valid prefix. A terminated invalid line or corruption before the tail remains a hard error.

Every dashboard server receives the shared archive through `--runs-dir`. One healthy protocol-compatible server with the same bind host is reused across runs, and each run is addressed as `/runs/<slug>`. A live but unhealthy, incompatible, or differently bound registered server blocks another launch until it is explicitly stopped. The local read API provides `/api/runs`, `/api/runs/<slug>/status`, and `/api/runs/<slug>/export`; `/api/status` remains the launch-run compatibility alias. Search covers run ID/slug, repository, branch, and status only. Export JSON includes the normalized snapshot and full event log and may contain recorded evidence, commands, and local paths. Keep the server loopback-only unless remote access receives a separate security review.

Overall progress is monotonic and is derived only from these fixed workflow milestones: planning (15%), seeded tests (10%), Blue Team (35%), Red Team review (15%), Fixers and judges (15%), and integration (10%). A completed or not-required team completes its named milestone; once recorded, a milestone never reduces the progress value. Task and finding updates never affect overall progress.

`--progress` on a task remains available for its individual queue card only; it never contributes to the workflow total. Team progress is display telemetry, while workflow completion always comes from the script-derived milestones. The normalizer forces a `completed` or `not-required` team's display progress to 100 so its card cannot contradict its terminal milestone state. The dashboard applies the same terminal-state rule at its rendering boundary for compatibility with legacy exports and already-running older servers.

## Commands

Set `<tool>` to the path provided by Build and `<state-dir>` to its run status directory:

```bash
node <tool> init --state-dir <state-dir> --run <run-id> --repo <repo> --base <sha> --branch <branch> --workspace <integration-worktree>
node <tool> serve --state-dir <state-dir> --runs-dir <state-root>/build-runs --host 127.0.0.1 --port 4173 --api-port 4174 --open
node <tool> team --state-dir <state-dir> --id blue --status active --message "Specialists dispatched"
node <tool> agent --state-dir <state-dir> --id blue-orchestrator --team blue --role orchestrator --model gpt-5.6-terra --effort xhigh --status active
node <tool> task --state-dir <state-dir> --id blue-ui --team blue --kind task --title "Implement accessible composer" --status queued --verification-command "npm test -- --runInBand"
node <tool> context --state-dir <state-dir> --team blue --task blue-ui --agent blue-orchestrator --workspace <integration-worktree>
node <tool> event --state-dir <state-dir> --kind validation --message "npm test: pass" --team blue --task blue-ui
```

Use stable IDs: `brainstorm`, `seed-tests`, `blue`, `red-<round>`, `fixer-<round>`, and `integration` for teams; prefix task and agent IDs with their team. The script canonicalizes team IDs to the dashboard stages, so round-specific IDs such as `red-1`, `red-2`, `fixer-1`, and `fixer-2` are valid. Use `--kind finding` for a Red Team or Fixer finding and `--kind task` otherwise. Include commands, commit SHAs, review IDs, and plan paths in messages or evidence fields.

## Bundled lifecycle hooks

`hooks/hooks.json` is the portable source template; a standalone copied skill
folder is not a hook discovery layer. The installed artifact is distinct from
the source and must not retain its `PLUGIN_ROOT` placeholders, because hook
runners do not provide that environment variable. After a cachebuster update,
install with `node plugins/basics/scripts/install-plugin.mjs install`. It
runs Codex's normal plugin update, discovers the selected installed path from
Codex's JSON result, checks that installed manifest matches the source version,
then materializes every root hook command to the selected destination's
absolute `skills/build/scripts/build-status.mjs` path. Use `inspect` to report
a stale installation before changing it. The operation is idempotent and must
be repeated after every plugin update. Review and trust the resulting changed
hooks with `/hooks`; do not activate both placeholder and materialized hook
files, or the lifecycle event would be handled twice.

The `context` command is the active-run/task pointer. It binds an existing task (and optional registered agent) to the run workspace; the first matching event also binds the parent Codex session ID so subagent events remain attached when their cwd changes. Change the pointer at each task boundary and use `context --state-dir <state-dir> --clear` when no task should receive lifecycle updates.

The hook command reads the official Codex JSON event from stdin. `SubagentStart` activates the selected/next queued agent; `SubagentStop` records an explicit `blocked` or `failed` final prefix and otherwise completes it. `PreToolUse` activates the selected task. `PostToolUse` records tool success/failure, but passes the task only when the successful shell command exactly matches its declared `--verification-command`. `Stop` moves leftover active tasks to `waiting` and records a consistency event without changing run approval, readiness, or merge state. Do not add `UserPromptSubmit` approval automation; only `build-handoff.mjs approve` may bind an interpreted approval to exact plan and scope hashes.

## Required lifecycle reporting

Build must emit:

1. run initialization and source safety result;
2. every team/agent queued, active, waiting, completed, blocked, failed, or not-required transition;
3. each question/approval pause and response;
4. plan, seeded-test, commit, review finding, fixer loop, validation, and merge milestone;
5. final readiness and cleanup state.

Use one shared transition template. Team, agent, task, and run commands already append their own event; do not surround them with duplicate generic events. Reserve generic events for approvals, validations, merges, and telemetry gaps. Register an intended team handoff and every known role as `queued` before launching agents. Transition the team to `active` only after its documented readiness prerequisite, and transition an agent to `active` only when the host confirms it started. Use `waiting` for a user or dependent-team pause and exactly one terminal state for every invoked role and team. A role that is intentionally skipped becomes `not-required`, not silently absent. Add or update the current task/finding at each meaningful loop turn.

If status emission fails, create a telemetry task with status `failed`, record the command/error, continue safely, and disclose the gap in the final report.
