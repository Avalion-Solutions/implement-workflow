---
name: expo-run
description: Configure, launch, observe, or stop an Expo project with a verified browser URL and Expo Go QR rendered directly in the terminal, or an explicit local Expo Web mode.
---

# Expo Run

Use this skill for an Expo application's launch workflow. It is portable: first
identify the actual project root containing `package.json`; do not assume the
repository root is runnable.

## Repository instructions

Before configuring or launching, read `<repository-root>/.agents/expo-run.md`
when it exists. Identify the actual project root containing `package.json` and
follow the repository launcher, staging policy, environment requirements, and
safe-stop behavior. Do not overwrite a repository launcher with `--write` when
the repository instructions select a different command.

## Preflight

From the proposed project root, inspect configuration without mutating it:

```sh
node <expo-run-skill>/scripts/configure-expo-run.mjs --check .
```

The project must declare `expo` in `dependencies` or `devDependencies`.
Tunnel mode also needs project-local `@expo/ngrok` and `qrcode-terminal`.
If either dependency is missing, explain the exact missing package and ask for
approval before installing compatible project-local versions, for example:

```sh
pnpm add -D @expo/ngrok qrcode-terminal
```

Do not use a global Expo CLI, a global QR tool, PNG generation, `qrencode`, or
a browser for the tunnel journey. Do not infer an Expo Go URL from a project
name, host, or fixed port.

## Configure package scripts

After approval to change this Expo project's `package.json`, copy
`expo-go-launch.mjs` from this skill's `scripts/` directory into the project's
`scripts/` directory, then apply the mapping:

```sh
node <expo-run-skill>/scripts/configure-expo-run.mjs --write .
```

This maps the target project's scripts exactly as follows while preserving all
unrelated package fields and scripts:

```json
{
  "scripts": {
    "start": "node scripts/expo-go-launch.mjs tunnel",
    "start:local": "node scripts/expo-go-launch.mjs local",
    "start:status": "node scripts/expo-go-launch.mjs status"
  }
}
```

`--check` is a non-mutating preview. The configurator rejects non-Expo
packages; it never installs dependencies itself.

## Launch browser and Expo Go through one tunnel

Run this only when the user has asked to launch the app and accepts opening a
public tunnel:

```sh
pnpm start
```

The foreground launcher invokes the project's Expo CLI with exactly:

```text
start --go --tunnel --clear
```

It waits until Expo actually publishes both a working public `https://...`
browser URL and an `exp://...` Expo Go URL. Only then does it render a
terminal QR for that exact Expo Go URL. The launcher prints the complete
user-facing report directly to stdout; it must not create a QR/report file,
print a report path, or require the agent to reconstruct the QR.

After the launcher prints the report, copy that complete block verbatim into
the final response with no summary or omission. The report is exactly:

```text
---
Browser: https://xxx
[TUI QR]
<terminal-qr>
---
```

The QR is the mobile handoff; the raw `exp://` URL is intentionally not shown.
Never derive one URL from the other, report a local-only endpoint as the
browser URL, or promise a fixed port. If output is truncated or the process is
already running, run `pnpm run start:status`; it must rediscover the verified
endpoints and print the same report directly to stdout.

## Launch local Expo Web

For local-only web development, run:

```sh
pnpm run start:local
```

This invokes the project's Expo CLI with exactly:

```text
start --web --localhost --clear
```

Expo may open its local browser normally in this user-requested mode. This is
not a tunnel and does not render or persist an Expo Go QR. CI and automated
checks must not invoke either launch command.

## Health, logs, and stop

Observe the launcher's own output and Expo's emitted lines. Treat both the
observed public `https://` browser URL and `exp://` Expo Go URL as tunnel
readiness. On timeout or early exit, report the first actionable Expo output
and dependency guidance before changing commands.

The launcher remains in the foreground. Stop it with Ctrl-C (or SIGTERM); it
forwards that signal to its Expo child. Never detach the process, kill a fixed
port, or terminate a process that the launcher does not own.

## Known failures

- A missing `@expo/ngrok` or `qrcode-terminal` is a project dependency issue:
  ask before installing it locally; do not substitute a global tool.
- If either the public `https://` browser URL or `exp://` Expo Go URL is absent
  before the timeout, inspect Expo output and the tunnel/network configuration.
  There is no usable final report in this state.
- Expo Web can fail when web dependencies are absent. Surface Expo's first
  error rather than adding packages or switching modes automatically.
- A printed localhost or LAN URL is useful only when Expo actually printed it;
  it is never a replacement for the mobile tunnel URL.
