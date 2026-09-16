---
name: expo-run
description: Read repository Expo instructions, configure or start its browser and Expo Go tunnel, and print the browser URL and scannable terminal QR.
---

# Expo Run

Read applicable `AGENTS.md` files and
`<repository-root>/.agents/expo-run.md` when present before configuring or
launching. Identify the runnable Expo project, which may be a subdirectory.
Follow its launcher, staging policy, environment, companion services, and
safe-stop requirements.

## Setup

Reuse a compatible repository launcher. Adapt an existing specialized launcher
to the output contract below without losing its startup behavior. When no
suitable script exists, configure the portable helper:

```sh
node <expo-run-skill>/scripts/configure-expo-run.mjs --check <project-root>
node <expo-run-skill>/scripts/configure-expo-run.mjs --write <project-root>
```

The write command copies the bundled launcher and sets `start` to
`node scripts/expo-go-launch.mjs tunnel`, with `start:status` to reprint
a running tunnel's report. It does not add `start:local`: the tunnel serves
both browser and mobile clients. Preserve existing project-specific scripts.
It refuses to overwrite a different existing launcher; inspect and adapt that
script instead.

Use project-local Expo, `@expo/ngrok`, and `qrcode-terminal`. Install
missing project dependencies compatible with the declared SDK/device constraints.
Ensure Expo Web dependencies and Metro web configuration are available
(`pnpm exec expo install react-dom react-native-web @expo/metro-runtime`
where applicable). Routine setup is part of the launch request; host permission
checks still apply.

## Launch

Run `pnpm start` or the repository-selected equivalent in a persistent
terminal session and keep it running for the user. Verify a known server's
project identity before reusing it.

The portable helper uses `start --go --web --tunnel --clear` with
`BROWSER=none`. This selects Expo Go and initializes web support without
opening a GUI. Both clients use the public tunnel. A separate local server
is not required for the normal browser-plus-mobile workflow.

Wait for the actual published `exp://` URL. Probe the HTTP variant of that
same tunnel, follow redirects, and require app HTML containing a bundle script
before reporting readiness. Do not trust arbitrary HTTPS links in logs or
ngrok's first unrelated tunnel. A successful HEAD, JSON manifest, or Expo
loading page alone does not prove browser readiness. For a repository-specific
tunnel domain, adapt the helper's domain check to the documented launcher.

Observe startup failures and report them instead of inventing endpoints.
The helper defaults to a 120-second deadline (`EXPO_RUN_TIMEOUT_MS`).
Tunnel access needs internet and may be slower than local development; native
and web rendering can differ according to the application.

## Required report

The launcher must print the complete report to stdout, and the agent must
reproduce it in its response. Use exactly this layout with real values:

```text
---
Browser: http://actual-tunnel-host

QR:
<actual scannable terminal QR encoding the published exp:// URL>
---
```

Use the verified HTTP or HTTPS browser URL, including redirects. Every report
line starts at column one: no added indentation, list nesting, blockquotes, or
code fences around the final report. Preserve the QR renderer's own characters
and necessary internal/quiet-zone spacing exactly. Do not replace the QR with
a raw URL, placeholder, image link, summary, or artifact path.

A saved report is optional and never replaces stdout or the agent's visible
response. If output is truncated, use `pnpm run start:status` to reprint it.
Set `EXPO_RUN_MANIFEST_URL` to the known local manifest endpoint when it is
not port 8081. Status checks the manifest's project root; if identity cannot be
verified, inspect the owned process and repository launcher rather than
printing another project's report.

## Stop and checks

Forward Ctrl-C/SIGTERM to the owned Expo child and wait for its exit.
Stop only processes belonging to this launch. Automated checks use simulated
servers and must not open a GUI or public tunnel. The helper's optional `local`
mode remains available for existing launchers that explicitly require it;
normal setup does not create a local-mode package script.
