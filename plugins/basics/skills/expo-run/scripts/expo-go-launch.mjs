#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_TIMEOUT_MS = 120_000;
const LOCAL_ENDPOINT = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/[^\s"'`<>]*)?/gi;
const HTTPS_ENDPOINT = /\bhttps:\/\/[^\s"'`<>]+/gi;
const EXPO_URL = /\bexp:\/\/[^\s"'`<>]+/i;

export function expoArguments(mode) {
  if (mode === "tunnel") return ["start", "--go", "--tunnel", "--clear"];
  if (mode === "local") return ["start", "--web", "--localhost", "--clear"];
  throw new Error(`Unsupported Expo run mode: ${mode}`);
}

export function extractExpoUrl(output) {
  return output.match(EXPO_URL)?.[0] ?? null;
}

export function extractLocalEndpoints(output) {
  return [...new Set(output.match(LOCAL_ENDPOINT) ?? [])];
}

export function extractBrowserUrl(output) {
  for (const endpoint of output.match(HTTPS_ENDPOINT) ?? []) {
    try {
      const hostname = new URL(endpoint).hostname.toLowerCase();
      if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1") return endpoint;
    } catch {
      // Ignore malformed output fragments until Expo prints a complete URL.
    }
  }
  return null;
}

export function formatReadyOutput({ browserUrl, url, qr }) {
  if (!/^exp:\/\//i.test(url ?? "")) throw new Error("A published exp:// URL is required before rendering the Expo Go QR.");
  return [
    "---",
    `Browser: ${browserUrl}`,
    "[TUI QR]",
    qr.trimEnd(),
    "---",
    "",
  ].join("\n");
}

export async function readExistingExpoManifest({ fetchImpl = fetch, manifestUrl = "http://127.0.0.1:8081/", timeoutMs = 1_000 } = {}) {
  try {
    const response = await fetchImpl(manifestUrl, {
      headers: { Accept: "application/expo+json,application/json", "Expo-Platform": "ios" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response?.ok) return null;
    const manifest = await response.json();
    return manifest && typeof manifest === "object" ? { manifestUrl, manifest } : null;
  } catch {
    return null;
  }
}

export async function readPublishedTunnelUrls({ fetchImpl = fetch, manifestUrl = "http://127.0.0.1:8081/" } = {}) {
  const manifestResponse = await fetchImpl(manifestUrl, {
    headers: { Accept: "application/expo+json,application/json", "Expo-Platform": "ios" },
  });
  if (!manifestResponse.ok) return null;
  const manifest = await manifestResponse.json();
  const host = manifest?.extra?.expoGo?.debuggerHost;
  if (typeof host !== "string") return null;

  if (host.endsWith(".boltexpo.dev")) {
    const browserUrl = `https://${host}/`;
    const browserResponse = await fetchImpl(browserUrl, { method: "HEAD", headers: { Accept: "text/html" } });
    return browserResponse.ok ? { url: `exp://${host}`, browserUrl } : null;
  }

  if (!host.endsWith(".exp.direct")) return null;
  const tunnelsResponse = await fetchImpl("http://127.0.0.1:4040/api/tunnels");
  if (!tunnelsResponse.ok) return null;
  const tunnels = await tunnelsResponse.json();
  const browserUrl = tunnels?.tunnels?.map((tunnel) => tunnel?.public_url).find((value) => typeof value === "string" && value.startsWith("https://"));
  return browserUrl ? { url: `exp://${host}`, browserUrl } : null;
}

export async function renderReadyReport({ projectRoot, browserUrl, url, render = terminalQrRenderer, stdout = process.stdout }) {
  if (!browserUrl || !url) throw new Error("Both verified browser and Expo Go URLs are required before rendering the ready report.");
  const qr = await render(resolve(projectRoot))(url);
  stdout.write(formatReadyOutput({ browserUrl, url, qr }));
  return { browserUrl, url, qr };
}

function projectRequire(projectRoot) {
  return createRequire(join(resolve(projectRoot), "package.json"));
}

export function resolveExpoCli(projectRoot) {
  try {
    return projectRequire(projectRoot).resolve("expo/bin/cli");
  } catch {
    throw new Error(
      "Project-local Expo CLI is unavailable. Install the project's declared expo dependency before running this launcher; do not use a global Expo CLI.",
    );
  }
}

export function terminalQrRenderer(projectRoot) {
  let qrcode;
  try {
    qrcode = projectRequire(projectRoot)("qrcode-terminal");
  } catch {
    throw new Error(
      "Project-local qrcode-terminal is required for tunnel QR output. With approval, run: pnpm add -D qrcode-terminal",
    );
  }
  return (url) => new Promise((resolveQr, rejectQr) => {
    try {
      qrcode.generate(url, { small: true }, (qr) => resolveQr(qr));
    } catch (error) {
      rejectQr(error);
    }
  });
}

export function assertTunnelDependencies(projectRoot) {
  const requireFromProject = projectRequire(projectRoot);
  const missing = [];
  try {
    requireFromProject.resolve("@expo/ngrok/package.json");
  } catch {
    missing.push("@expo/ngrok");
  }
  try {
    requireFromProject.resolve("qrcode-terminal");
  } catch {
    missing.push("qrcode-terminal");
  }
  if (missing.length) {
    throw new Error(
      `Missing project-local tunnel dependencies: ${missing.join(", ")}. With approval, run: pnpm add -D ${missing.join(" ")}`,
    );
  }
}

function timeoutFromEnvironment(value) {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("EXPO_RUN_TIMEOUT_MS must be a positive number of milliseconds.");
  return parsed;
}

function streamChildOutput(child, onOutput, stdout, stderr) {
  const tails = new Map();
  const handle = (stream, destination) => (chunk) => {
    const output = String(chunk);
    destination.write(output);
    const combined = `${tails.get(stream) ?? ""}${output}`;
    const boundary = combined.search(/\s[^\s]*$/);
    if (boundary === -1) {
      tails.set(stream, combined);
      return;
    }
    const end = boundary + 1;
    onOutput(combined.slice(0, end));
    tails.set(stream, combined.slice(end));
  };
  child.stdout?.on("data", handle("stdout", stdout));
  child.stderr?.on("data", handle("stderr", stderr));
  return () => {
    for (const tail of tails.values()) onOutput(tail);
    tails.clear();
  };
}

export async function runExpo({
  mode,
  projectRoot = process.cwd(),
  timeoutMs = timeoutFromEnvironment(process.env.EXPO_RUN_TIMEOUT_MS),
  spawnImpl = spawn,
  stdout = process.stdout,
  stderr = process.stderr,
  render = terminalQrRenderer,
  signalSource = process,
  fetchImpl = fetch,
  manifestUrl = "http://127.0.0.1:8081/",
  readTunnelUrls,
} = {}) {
  const root = resolve(projectRoot);
  const existing = await readExistingExpoManifest({ fetchImpl, manifestUrl });
  if (mode === "status" || (existing && mode === "tunnel")) {
    if (!existing) throw new Error("Expo is not already running; start the tunnel before requesting its status.");
    assertTunnelDependencies(root);
    const urls = await readTunnelUrls?.({ fetchImpl, manifestUrl });
    if (!urls) throw new Error("Expo is running, but its verified public HTTPS and Expo Go URLs are not available yet.");
    const report = await renderReadyReport({ projectRoot: root, ...urls, render, stdout });
    return { alreadyRunning: true, manifestUrl: existing.manifestUrl, manifest: existing.manifest, ...report };
  }
  if (existing) {
    stdout.write(`Expo is already running at ${existing.manifestUrl}; not starting a duplicate.\n`);
    return { alreadyRunning: true, manifestUrl: existing.manifestUrl, manifest: existing.manifest };
  }
  const args = expoArguments(mode);
  if (mode === "tunnel") assertTunnelDependencies(root);
  const cli = resolveExpoCli(root);
  const child = spawnImpl(process.execPath, [cli, ...args], {
    cwd: root,
    stdio: ["inherit", "pipe", "pipe"],
  });

  let publishedUrl = null;
  let browserUrl = null;
  let readyPromise = Promise.resolve();
  let ready = false;
  let timeout;
  let timedOut = false;
  let requestedSignal = null;
  let childClosed = false;
  let tunnelPoll;
  let tunnelPollInFlight = false;
  const localEndpoints = new Set();

  const stopOwnedChild = (signal) => {
    if (!requestedSignal) requestedSignal = signal;
    if (!childClosed) child.kill(signal);
  };
  const forwardSignal = (signal) => () => stopOwnedChild(signal);
  const onSigint = forwardSignal("SIGINT");
  const onSigterm = forwardSignal("SIGTERM");
  signalSource.on("SIGINT", onSigint);
  signalSource.on("SIGTERM", onSigterm);

  const publish = () => {
    if (mode !== "tunnel" || !publishedUrl || !browserUrl || ready) return;
    ready = true;
    clearTimeout(timeout);
    readyPromise = (async () => {
      const renderQr = render(root);
      const qr = await renderQr(publishedUrl);
      stdout.write(formatReadyOutput({ browserUrl, url: publishedUrl, qr }));
    })().catch((error) => {
      stderr.write(`expo-run QR setup failed: ${error.message}\n`);
      stopOwnedChild("SIGTERM");
      throw error;
    });
  };

  const flushOutput = streamChildOutput(child, (output) => {
    for (const endpoint of extractLocalEndpoints(output)) localEndpoints.add(endpoint);
    if (!publishedUrl) publishedUrl = extractExpoUrl(output);
    if (!browserUrl) browserUrl = extractBrowserUrl(output);
    publish();
  }, stdout, stderr);

  const pollTunnelUrls = async () => {
    if (!readTunnelUrls || ready || tunnelPollInFlight) return;
    tunnelPollInFlight = true;
    try {
      const urls = await readTunnelUrls({ fetchImpl, manifestUrl });
      if (!urls) return;
      publishedUrl ||= urls.url;
      browserUrl ||= urls.browserUrl;
      publish();
    } catch { /* Expo's manifest and tunnel API are not ready yet. */ }
    finally {
      tunnelPollInFlight = false;
    }
  };

  if (mode === "tunnel") {
    tunnelPoll = setInterval(pollTunnelUrls, 1_000);
    void pollTunnelUrls();
    timeout = setTimeout(() => {
      if (publishedUrl && browserUrl) return;
      timedOut = true;
      stderr.write(
        `Expo did not publish both a public https:// browser URL and an exp:// URL within ${timeoutMs}ms. Check the project-local @expo/ngrok dependency and tunnel connectivity; no report was emitted.\n`,
      );
      stopOwnedChild("SIGTERM");
    }, timeoutMs);
  }

  return new Promise((resolveRun, rejectRun) => {
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectRun(error);
    });
    child.once("close", async (code, signal) => {
      childClosed = true;
      flushOutput();
      clearInterval(tunnelPoll);
      clearTimeout(timeout);
      signalSource.removeListener("SIGINT", onSigint);
      signalSource.removeListener("SIGTERM", onSigterm);
      try {
        await readyPromise;
      } catch (error) {
        rejectRun(error);
        return;
      }
      if (timedOut) {
        rejectRun(new Error(`Expo did not publish both a public https:// browser URL and an exp:// URL within ${timeoutMs}ms.`));
        return;
      }
      if (mode === "tunnel" && (!publishedUrl || !browserUrl) && !requestedSignal) {
        rejectRun(new Error("Expo exited before publishing both a public https:// browser URL and an exp:// URL; no report was emitted."));
        return;
      }
      if (code !== 0 && !requestedSignal) {
        rejectRun(new Error(`Expo exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}.`));
        return;
      }
      resolveRun({ code, signal, url: publishedUrl, browserUrl, localEndpoints: [...localEndpoints] });
    });
  });
}

async function main(argv) {
  if (argv.length !== 1) throw new Error("Usage: node scripts/expo-go-launch.mjs <tunnel|local|status>");
  const mode = argv[0];
  await runExpo({ mode, readTunnelUrls: mode !== "local" ? readPublishedTunnelUrls : undefined });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`expo-run launch failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
