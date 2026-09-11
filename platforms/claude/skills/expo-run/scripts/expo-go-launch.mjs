#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTempLocation, tempPath } from "../../../shared/temp-location.mjs";

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

function projectSlug(projectRoot) {
  const slug = basename(resolve(projectRoot))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "expo-app";
}

export function qrArtifactPath({ projectRoot, temporaryRoot }) {
  if (temporaryRoot) return join(temporaryRoot, `${projectSlug(projectRoot)}-expo-go-qr.txt`);
  return tempPath(resolveTempLocation(), { project: projectSlug(projectRoot), topic: "expo", name: "expo-go-qr.txt" });
}

export async function writeQrArtifact({ projectRoot, temporaryRoot, url, render }) {
  if (!/^exp:\/\//i.test(url ?? "")) throw new Error("A published exp:// URL is required before creating a QR artifact.");
  const qr = await render(url);
  const artifact = qrArtifactPath({ projectRoot, temporaryRoot });
  const contents = `${qr.trimEnd()}\n\nExpo Go URL: ${url}\n`;
  await mkdir(dirname(artifact), { recursive: true });
  await writeFile(artifact, contents, "utf8");
  return artifact;
}

export function formatReadyOutput({ browserUrl, url, qr }) {
  return [
    "---",
    `Browser: ${browserUrl}`,
    `Expo Go: ${url}`,
    "",
    "[TUI QR]",
    qr.trimEnd(),
    "---",
    "",
  ].join("\n");
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
  temporaryRoot,
  timeoutMs = timeoutFromEnvironment(process.env.EXPO_RUN_TIMEOUT_MS),
  spawnImpl = spawn,
  stdout = process.stdout,
  stderr = process.stderr,
  render = terminalQrRenderer,
  signalSource = process,
} = {}) {
  const root = resolve(projectRoot);
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
      await writeQrArtifact({ projectRoot: root, temporaryRoot, url: publishedUrl, render: async () => qr });
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

  if (mode === "tunnel") {
    timeout = setTimeout(() => {
      if (publishedUrl && browserUrl) return;
      timedOut = true;
      stderr.write(
        `Expo did not publish both a public https:// browser URL and an exp:// URL within ${timeoutMs}ms. Check the project-local @expo/ngrok dependency and tunnel connectivity; no QR was created.\n`,
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
        rejectRun(new Error("Expo exited before publishing both a public https:// browser URL and an exp:// URL; no QR artifact was created."));
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
  if (argv.length !== 1) throw new Error("Usage: node scripts/expo-go-launch.mjs <tunnel|local>");
  await runExpo({ mode: argv[0] });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`expo-run launch failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
