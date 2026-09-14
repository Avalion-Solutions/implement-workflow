# Basics for Claude Code

This is the Claude Code adapter for the canonical skills in
`../../.agents/skills/`. `skills/` is generated: do not edit it by hand. Run
`node scripts/sync-claude-skills.mjs` to create it, and use
`node scripts/sync-claude-skills.mjs --check` to prove it is current.

Test the downloaded plugin directly for one session:

```bash
claude --plugin-dir /absolute/path/to/agent-workflows/platforms/claude
```

For a persistent local installation, start Claude Code and add this repository
as a marketplace, then install the plugin:

```text
/plugin marketplace add /absolute/path/to/agent-workflows
/plugin install basics@agent-workflows
```

Plugin skills use Claude Code's native namespace. Invoke the Build workflow as
`/basics:build`; the other skills follow `/basics:<skill-name>`. The plugin
manifest is `.claude-plugin/plugin.json`. This repository does not install,
authenticate, or globally configure Claude Code on its own.

## Capability contract

**Model mapping:** no model is selected or mapped by this adapter. Claude Code
selects the session model.

**Effort:** no effort setting is configured. Role labels in adapted skills are
advisory; use the capability available in the current Claude Code session.

**Fresh-context delegation:** when isolated delegation is available, give each
agent only its bounded artifact paths and receipt contract. Otherwise perform
roles sequentially and retain the same file-backed handoffs.

**Worktrees:** use isolated Git worktrees only when the host and repository
permit them. Otherwise do not parallelize overlapping edits; use a reviewed
branch or stop for user direction.

**Lifecycle hooks:** the adapter ships no lifecycle runtime or dashboard.
Record the telemetry gap and continue with the workflow's file-backed
manifests and receipts; hooks never grant approval.

**State directory:** set `BASICS_RUNS_DIR` when durable status artifacts need
a host-selected location. `BASICS_TEMP_ROOT` controls project-contained
disposable artifacts; Build accepts `BASICS_WORKTREE_ROOT` only as its
deprecated fallback.

The generated tree excludes the unavailable lifecycle implementation while
retaining every canonical skill directory and all compatible resources. The
sync check validates both the generated contents and these exclusions.
