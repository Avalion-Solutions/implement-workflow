---
name: ahk-no-shadow
description: 'Detect AutoHotkey variable names that shadow built-ins or reserved names.'
argument-hint: 'Provide one or more .ahk files or directories to scan for shadowing.'
user-invocable: true
disable-model-invocation: false
---

# ahk-no-shadow

Use this skill to run a lightweight no-shadow lint over AutoHotkey files.

## Goal
- Block obvious name shadowing before validation and test runs.
- Catch shadowing of built-ins and reserved names in params, locals, loop vars, and catch vars.

## Files
- scripts/run_no_shadowing.sh: shell entrypoint
- scripts/no-shadowing.mjs: analyzer
- scripts/ahk_builtin_names.txt: baseline built-in/reserved names

These source files live under `scripts/` in this repo and are copied into the installed skill root during sync.

## Usage
Run from the repository root:

```bash
<ahk-no-shadow-root>/run_no_shadowing.sh <path ...>
```

If no path is passed, the runner scans the current directory.
