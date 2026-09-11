# Temp-root standardization plan

## Outcome

Basics uses `BASICS_TEMP_ROOT` as the single configurable root for agent-created
temporary work. Every producer resolves a path below
`<root>/<project>/<topic>`; the installer establishes the host default only
when the variable is absent or blank.

## Resolved decisions

- **DEC-001:** `BASICS_TEMP_ROOT` is the general variable. Its nonblank value
  wins; Build retains nonblank `BASICS_WORKTREE_ROOT` only as a deprecated
  fallback.
- **DEC-002:** Paths are short and purpose-led: worktrees use
  `worktrees/<run>-<sha4>/<lane>`, snapshots use `snapshots/<tool>/<topic>`,
  Expo uses `expo/expo-go-qr.txt`, debug uses `debug/<topic>/<id>.log`, and
  tests use `tests/<suite>/<unique-id>`.
- **DEC-003:** Unix fallback is the platform temporary directory. The Basics
  installer configures this host to `/temp`; Windows falls back to `%TEMP%`.
- **DEC-004:** Linux persistence is environment.d plus a managed Bash fallback
  block; nonblank user values are never overwritten. Windows uses the user
  environment registry value. A failed persistence update is reported as
  partial success, not rolled back.
- **DEC-005:** Atomic sidecars tied to durable files remain adjacent to their
  targets. `BASICS_RUNS_DIR` remains durable and is outside this migration.

## Criteria

- **CRIT-001:** Resolver precedence and all returned paths are contained by
  `BASICS_TEMP_ROOT/<project>/`.
- **CRIT-002:** Build retains legacy compatibility without emitting paths under
  the root itself.
- **CRIT-003:** Node and shell producers no longer default their artifacts to
  `/tmp`, `TMPDIR`, `os.tmpdir()`, or a repository directory.
- **CRIT-004:** Codex install/update persists an absent/blank temp root on Linux
  and preserves a nonblank configured root; its dry-run is inspectable.
- **CRIT-005:** Codex and Claude generated adapters contain the same shared
  resolver behavior and their version streams advance by one patch level.
- **CRIT-006:** A static contract blocks future active Basics scripts from
  bypassing the resolver, while allowing documented durable atomic sidecars.
- **CRIT-007:** Existing Build status archives and legacy worktree locations are
  not moved or deleted by the software migration.

## Implementation steps

1. Add a canonical shared Node resolver and test it; package it in both adapters.
2. Migrate Build, Expo, debug, Red, and bug-list snapshot producers and their
   contracts to the resolver-derived path scheme.
3. Add installer configuration, platform persistence tests, and the static
   producer contract test; update global and plugin policy documentation.
4. Advance adapter versions, regenerate generated packages, run the required
   suite, and locally configure this host with `/temp` only after all checks pass.

## Risks and mitigations

- Shell portability is contained by a small shell resolver with Linux and
  Windows behavior explicitly tested at the Node installer boundary.
- Existing custom roots are preserved and reported rather than normalized.
- Old `/tmp` worktrees are discovery-only; no cleanup action is in scope.
- Host persistence may require a new login/GUI session; the installer reports
  that requirement and does not claim current processes changed.

## Scope exclusions

No protected merge, remote push, public release, branch deletion, existing
worktree cleanup, or migration of durable run archives is authorized.
