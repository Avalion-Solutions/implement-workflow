---
name: plugin-update
description: Refresh, install, and verify the Basics Codex plugin from its GitHub main marketplace, including lifecycle-hook materialization and trust review.
---

# Plugin update

Use this skill when a committed Basics plugin change must be installed or
reinstalled for Codex. It covers the Codex adapter only; Claude Code uses its
own plugin installation flow.

Use [references/update-checklist.md](references/update-checklist.md) to verify source, version, installation, and hook state before reporting completion.

The standard marketplace is the repository's GitHub `main` branch:

```bash
git@github.com:Avalion-Automations/implement-workflow.git
```

Codex snapshots Git marketplaces. A push to `main` makes a version available,
but does not change the locally installed plugin until this skill refreshes and
installs it. Do not use a local checkout as the routine installation source.

## GitHub marketplace

Inspect `codex plugin marketplace list --json` before installation.

- If `personal` already resolves to the GitHub repository above at ref `main`,
  refresh it with `codex plugin marketplace upgrade personal`.
- If no `personal` marketplace exists, add it with:

  ```bash
  codex plugin marketplace add git@github.com:Avalion-Automations/implement-workflow.git --ref main
  ```

- If `personal` is a local or different Git source, obtain explicit approval
  that names `personal` and explains that its saved marketplace configuration
  will be removed before replacing it. Then run:

  ```bash
  codex plugin marketplace remove personal
  codex plugin marketplace add git@github.com:Avalion-Automations/implement-workflow.git --ref main
  ```

  Stop and report the state if removal succeeds but adding the Git marketplace
  fails. Do not edit Codex configuration by hand.

Verify the resulting marketplace source and `main` ref before continuing. Do
not run `marketplace upgrade` for a local source, and do not silently fall back
to a checkout when Git refresh fails.

## Release preparation

- Confirm the intended semantic version is newer than the pre-change version
  in both `platforms/codex/plugin.json` and
  `plugins/basics/.codex-plugin/plugin.json`.
- Regenerate `plugins/basics/` after canonical or Codex-adapter changes, then
  run the repository's Codex-package synchronizer in check mode.
- Run the applicable repository release checks before installing changed
  content. Do not install an uncommitted or version-stale package.

## Installation and hooks

After the package checks pass and the Git marketplace has been refreshed, run:

```bash
node plugins/basics/scripts/install-plugin.mjs install --marketplace personal
node --test plugins/basics/scripts/install-plugin.test.mjs
codex plugin list
```

Use `personal` only after it has been verified as the GitHub `main`
marketplace. If a different marketplace name is intentionally configured, use
that name consistently in each command.

If installation reports that the installed plugin is stale, inspect
`codex plugin list --json` first. For the Git marketplace, run
`codex plugin marketplace upgrade <marketplace>` and retry the installer. Do
not remove the installed plugin merely to force an ordinary Git refresh.

Only when the installer establishes that the installed entry itself must be
replaced, obtain explicit approval naming `basics@<marketplace>` and explaining
that the existing installed plugin entry will be removed before replacement.
Then run:

```bash
codex plugin remove basics@<marketplace> --json
node plugins/basics/scripts/install-plugin.mjs install --marketplace <marketplace>
```

Treat removal and reinstallation as one recovery operation. Stop immediately
if removal succeeds but reinstallation fails, preserve the failure output, and
report that the plugin is no longer installed. Never delete a cache directory,
edit Codex configuration, or alter trust hashes manually.

The installer must report the expected version and its absolute cache
destination. Verify that destination's `hooks/hooks.json` has no
`$PLUGIN_ROOT` or `%PLUGIN_ROOT%` token, has exactly one handler for each of
`SubagentStart`, `SubagentStop`, `PreToolUse`, `PostToolUse`, and `Stop`, and
that every handler points to the same installed
`skills/build/scripts/build-status.mjs` file.

Codex may report a local-marketplace source path rather than the cache path in
`codex plugin list --json`. That active source legitimately retains
`$PLUGIN_ROOT`: Codex supplies `PLUGIN_ROOT` to plugin hooks. Do not mutate the
tracked source hook template to an absolute user path. Ensure each hook timeout
is within Codex's supported 1–3 second range.

## Completion

- Review and trust changed hooks through `/hooks`; changed hook definitions are
  skipped until trusted.
- Start a new Codex thread after a successful update so the refreshed skills
  are discovered.
- If installation, materialization, the hook test, or enabled-version check
  fails, stop and report the concrete failure. Do not hand-edit Codex's config
  or trust hashes as a workaround.
