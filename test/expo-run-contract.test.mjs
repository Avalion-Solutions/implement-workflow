import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  LOCAL_SCRIPT,
  TUNNEL_SCRIPT,
  configurePackage,
  configureProject,
  inspectPackage,
} from "../.agents/skills/expo-run/scripts/configure-expo-run.mjs";
import {
  expoArguments,
  extractBrowserUrl,
  extractExpoUrl,
  formatReadyOutput,
  qrArtifactPath,
  readExistingExpoManifest,
  runExpo,
  writeQrArtifact,
} from "../.agents/skills/expo-run/scripts/expo-go-launch.mjs";

async function createFakeExpoProject(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const moduleRoot = join(root, "node_modules");
  await mkdir(join(moduleRoot, "expo", "bin"), { recursive: true });
  await mkdir(join(moduleRoot, "@expo", "ngrok"), { recursive: true });
  await mkdir(join(moduleRoot, "qrcode-terminal"), { recursive: true });
  await writeFile(join(root, "package.json"), '{"name":"simulated-project"}\n');
  await writeFile(join(moduleRoot, "expo", "package.json"), '{"name":"expo"}\n');
  await writeFile(join(moduleRoot, "expo", "bin", "cli.js"), "");
  await writeFile(join(moduleRoot, "@expo", "ngrok", "package.json"), '{"name":"@expo/ngrok"}\n');
  await writeFile(join(moduleRoot, "qrcode-terminal", "index.js"), "exports.generate = () => {};\n");
  return root;
}

function fakeExpoChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.signals = [];
  child.kill = (signal) => {
    child.killed = true;
    child.signals.push(signal);
    return true;
  };
  return child;
}

test("configures one-command tunnel and local launch scripts without disturbing package data", () => {
  const source = {
    name: "sample-app",
    private: true,
    scripts: { test: "node --test", start: "old-command" },
    dependencies: { expo: "~57.0.0", react: "19.1.0" },
    devDependencies: { "@expo/ngrok": "^4.1.0", "qrcode-terminal": "^0.12.0" },
  };

  const configured = configurePackage(source);

  assert.equal(configured.scripts.start, TUNNEL_SCRIPT);
  assert.equal(configured.scripts["start:local"], LOCAL_SCRIPT);
  assert.equal(configured.scripts.test, "node --test");
  assert.equal(configured.dependencies.react, "19.1.0");
  assert.notEqual(configured, source);
  assert.equal(source.scripts.start, "old-command");
});

test("documented copied launcher runs from the target Expo project", async () => {
  const root = await createFakeExpoProject("expo-run-copied-launcher-");
  const scripts = join(root, "scripts");
  await mkdir(scripts, { recursive: true });
  await writeFile(
    join(scripts, "expo-go-launch.mjs"),
    await readFile(new URL("../.agents/skills/expo-run/scripts/expo-go-launch.mjs", import.meta.url)),
  );

  const result = spawnSync(process.execPath, [join(scripts, "expo-go-launch.mjs"), "local"], {
    cwd: root,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND|Cannot find module/);
});

test("rejects non-Expo packages and reports project-local launcher dependencies", () => {
  assert.deepEqual(inspectPackage({ name: "not-expo", scripts: {} }), {
    expo: false,
    missing: ["@expo/ngrok", "qrcode-terminal"],
  });
  assert.deepEqual(inspectPackage({
    dependencies: { expo: "~57.0.0" },
    devDependencies: { "@expo/ngrok": "^4.1.0" },
  }), {
    expo: true,
    missing: ["qrcode-terminal"],
  });
});

test("builds exact Expo CLI arguments for tunnel and local browser modes", () => {
  assert.deepEqual(expoArguments("tunnel"), ["start", "--go", "--tunnel", "--clear"]);
  assert.deepEqual(expoArguments("local"), ["start", "--web", "--localhost", "--clear"]);
  assert.throws(() => expoArguments("lan"), /mode/i);
});

test("extracts only a published Expo URL and ignores ordinary local endpoints", () => {
  const text = "Local: http://localhost:8081\nMetro waiting on exp://abc-123.exp.direct\n";
  assert.equal(extractExpoUrl(text), "exp://abc-123.exp.direct");
  assert.equal(extractExpoUrl("Local: http://localhost:8081"), null);
});

test("writes a project-specific terminal QR artifact containing the exact published URL", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "expo-run-contract-"));
  const projectRoot = join(temporaryRoot, "My Expo App");
  const url = "exp://abc-123.exp.direct";
  const artifact = await writeQrArtifact({
    projectRoot,
    temporaryRoot,
    url,
    render: (value) => `QR FOR ${value}\n`,
  });

  assert.equal(artifact, join(temporaryRoot, "my-expo-app-expo-go-qr.txt"));
  assert.equal(await readFile(artifact, "utf8"), `QR FOR ${url}\n\nExpo Go URL: ${url}\n`);
});

test("ready output gives the verified browser and Expo Go endpoints followed by the terminal QR", () => {
  const output = formatReadyOutput({
    url: "exp://abc-123.exp.direct",
    browserUrl: "https://abc-123.exp.direct",
    qr: "QR FOR exp://abc-123.exp.direct",
    artifact: "/temp/sample/expo/expo-go-qr.txt",
  });
  assert.equal(output, [
    "---",
    "Browser: https://abc-123.exp.direct",
    "Expo Go: exp://abc-123.exp.direct",
    "QR report: /temp/sample/expo/expo-go-qr.txt",
    "",
    "[TUI QR]",
    "QR FOR exp://abc-123.exp.direct",
    "---",
    "",
  ].join("\n"));
});

test("reads a valid existing Expo manifest with the mobile request headers", async () => {
  let request;
  const existing = await readExistingExpoManifest({
    manifestUrl: "http://127.0.0.1:8081/",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ name: "already-running" }) };
    },
  });
  assert.deepEqual(existing, { manifestUrl: "http://127.0.0.1:8081/", manifest: { name: "already-running" } });
  assert.equal(request.options.headers["Expo-Platform"], "ios");
});

test("does not start a duplicate when the Expo manifest is already reachable", async () => {
  const stdout = { output: "", write(chunk) { this.output += String(chunk); return true; } };
  const result = await runExpo({
    mode: "tunnel",
    stdout,
    fetchImpl: async () => ({ ok: true, json: async () => ({ name: "running" }) }),
    spawnImpl: () => { throw new Error("must not spawn"); },
  });
  assert.equal(result.alreadyRunning, true);
  assert.match(stdout.output, /not starting a duplicate/i);
});

test("extracts an observed public HTTPS browser endpoint without treating localhost as browser-ready", () => {
  assert.equal(extractBrowserUrl("Browser: https://abc-123.exp.direct/_expo/loading"), "https://abc-123.exp.direct/_expo/loading");
  assert.equal(extractBrowserUrl("Local: http://localhost:8081"), null);
  assert.equal(extractBrowserUrl("DevTools: http://127.0.0.1:19002"), null);
});

test("configuration preview is representable without writing the package file", async () => {
  const root = await mkdtemp(join(tmpdir(), "expo-run-preview-"));
  const packagePath = join(root, "package.json");
  const original = `${JSON.stringify({ name: "preview", dependencies: { expo: "~57.0.0" } }, null, 2)}\n`;
  await writeFile(packagePath, original);

  const parsed = JSON.parse(await readFile(packagePath, "utf8"));
  const preview = configurePackage(parsed);

  assert.equal(preview.scripts.start, TUNNEL_SCRIPT);
  assert.equal(await readFile(packagePath, "utf8"), original);
});

test("configuration rejects a non-Expo project without writing it", async () => {
  const root = await mkdtemp(join(tmpdir(), "expo-run-non-expo-"));
  const packagePath = join(root, "package.json");
  const original = '{"name":"not-expo"}\n';
  await writeFile(packagePath, original);

  await assert.rejects(() => configureProject({ projectRoot: root, write: true }), /does not declare.*expo/i);
  assert.equal(await readFile(packagePath, "utf8"), original);
});

test("simulated Expo tunnel observes the published URL before emitting an identical QR artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "expo-run-simulated-project-"));
  const temporaryRoot = await mkdtemp(join(tmpdir(), "expo-run-simulated-artifact-"));
  const moduleRoot = join(root, "node_modules");
  await mkdir(join(moduleRoot, "expo", "bin"), { recursive: true });
  await mkdir(join(moduleRoot, "@expo", "ngrok"), { recursive: true });
  await mkdir(join(moduleRoot, "qrcode-terminal"), { recursive: true });
  await writeFile(join(root, "package.json"), '{"name":"simulated-project"}\n');
  await writeFile(join(moduleRoot, "expo", "package.json"), '{"name":"expo"}\n');
  await writeFile(
    join(moduleRoot, "expo", "bin", "cli.js"),
    'console.log(`Expo arguments: ${process.argv.slice(2).join(" ")}`); console.log("Local: http://localhost:8081"); console.log("Published: exp://simulated.exp.direct");\n',
  );
  await writeFile(join(moduleRoot, "@expo", "ngrok", "package.json"), '{"name":"@expo/ngrok"}\n');
  await writeFile(join(moduleRoot, "qrcode-terminal", "index.js"), 'exports.generate = (url, options, done) => done(`QR FOR ${url}\\n`);\n');

  const spawned = [];
  const spawnImpl = (command, args, options) => {
    spawned.push({ command, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.killed = false;
    child.kill = () => { child.killed = true; return true; };
    setImmediate(() => {
      child.stdout.write("Expo arguments: start --go --tunnel --clear\n");
      child.stdout.write("Browser: https://simulated.exp.direct\n");
      child.stdout.write("Published: exp://simulated.exp.direct\n");
      child.stdout.end();
      child.stderr.end();
      child.emit("close", 0, null);
    });
    return child;
  };
  const stdout = { output: "", write(chunk) { this.output += String(chunk); return true; } };
  const stderr = { output: "", write(chunk) { this.output += String(chunk); return true; } };
  const result = await runExpo({
    projectRoot: root,
    temporaryRoot,
    mode: "tunnel",
    timeoutMs: 1_000,
    stdout,
    stderr,
    spawnImpl,
  });

  assert.equal(result.url, "exp://simulated.exp.direct");
  assert.equal(result.browserUrl, "https://simulated.exp.direct");
  assert.equal(spawned.length, 1);
  assert.deepEqual(spawned[0].args.slice(1), ["start", "--go", "--tunnel", "--clear"]);
  assert.match(stdout.output, /Expo arguments: start --go --tunnel --clear/);
  assert.match(stdout.output, /QR FOR exp:\/\/simulated\.exp\.direct/);
  assert.match(stdout.output, /Browser: https:\/\/simulated\.exp\.direct/);
  assert.match(stdout.output, /Expo Go: exp:\/\/simulated\.exp\.direct/);
  assert.match(stdout.output, /\[TUI QR\]\nQR FOR exp:\/\/simulated\.exp\.direct/);
  const artifact = qrArtifactPath({ projectRoot: root, temporaryRoot });
  const artifactContents = await readFile(artifact, "utf8");
  assert.match(artifactContents, /QR FOR exp:\/\/simulated\.exp\.direct/);
  assert.match(artifactContents, /Expo Go URL: exp:\/\/simulated\.exp\.direct/);
  assert.equal(stderr.output, "");
});

test("waits for both browser and Expo Go URLs split across stdout and stderr chunks", async () => {
  const root = await createFakeExpoProject("expo-run-split-streams-");
  const temporaryRoot = await mkdtemp(join(tmpdir(), "expo-run-split-artifact-"));
  const child = fakeExpoChild();
  const stdout = { output: "", write(chunk) { this.output += String(chunk); return true; } };
  const stderr = { output: "", write(chunk) { this.output += String(chunk); return true; } };
  const resultPromise = runExpo({
    projectRoot: root,
    temporaryRoot,
    mode: "tunnel",
    timeoutMs: 1_000,
    stdout,
    stderr,
    spawnImpl: () => child,
    render: () => async (url) => `QR FOR ${url}\n`,
  });
  await new Promise((resolve) => setImmediate(resolve));

  child.stdout.write("Published: exp://simu");
  child.stdout.write("lated.exp.direct\n");
  assert.doesNotMatch(stdout.output, /\[TUI QR\]/, "the report must wait for the browser endpoint");
  child.stderr.write("Browser: https://simulated.");
  child.stderr.write("exp.direct\n");
  child.stdout.end();
  child.stderr.end();
  child.emit("close", 0, null);

  const result = await resultPromise;
  assert.equal(result.url, "exp://simulated.exp.direct");
  assert.equal(result.browserUrl, "https://simulated.exp.direct");
  assert.match(stdout.output, /QR FOR exp:\/\/simulated\.exp\.direct/);
  assert.match(stdout.output, /Browser: https:\/\/simulated\.exp\.direct/);
});

test("does not create a final report or QR when Expo exits without a browser HTTPS endpoint", async () => {
  const root = await createFakeExpoProject("expo-run-missing-browser-");
  const temporaryRoot = await mkdtemp(join(tmpdir(), "expo-run-missing-browser-artifact-"));
  const child = fakeExpoChild();
  const stdout = { output: "", write(chunk) { this.output += String(chunk); return true; } };
  const stderr = { output: "", write(chunk) { this.output += String(chunk); return true; } };
  const result = runExpo({
    projectRoot: root,
    temporaryRoot,
    mode: "tunnel",
    timeoutMs: 1_000,
    stdout,
    stderr,
    spawnImpl: () => child,
    render: () => async () => "QR MUST NOT RENDER\n",
  });
  await new Promise((resolve) => setImmediate(resolve));

  child.stdout.write("Published: exp://simulated.exp.direct\n");
  child.stdout.end();
  child.stderr.end();
  child.emit("close", 0, null);

  await assert.rejects(result, /both a public https:\/\/ browser URL and an exp:\/\/ URL/i);
  assert.doesNotMatch(stdout.output, /\[TUI QR\]|QR MUST NOT RENDER/);
  await assert.rejects(readFile(qrArtifactPath({ projectRoot: root, temporaryRoot }), "utf8"), /ENOENT/);
});

test("forwards SIGINT then SIGTERM and waits for owned child close", async () => {
  const root = await createFakeExpoProject("expo-run-escalated-signals-");
  const child = fakeExpoChild();
  const signalSource = new EventEmitter();
  const runPromise = runExpo({
    projectRoot: root,
    mode: "local",
    spawnImpl: () => child,
    signalSource,
  });
  await new Promise((resolve) => setImmediate(resolve));
  let settled = false;
  void runPromise.then(() => { settled = true; }, () => { settled = true; });

  signalSource.emit("SIGINT");
  signalSource.emit("SIGTERM");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, "parent launcher must remain pending until the owned child closes");
  child.emit("close", 0, null);
  await runPromise;

  assert.deepEqual(child.signals, ["SIGINT", "SIGTERM"]);
});

test("forwards repeated SIGINT while waiting for owned child close", async () => {
  const root = await createFakeExpoProject("expo-run-repeated-signals-");
  const child = fakeExpoChild();
  const signalSource = new EventEmitter();
  const runPromise = runExpo({
    projectRoot: root,
    mode: "local",
    spawnImpl: () => child,
    signalSource,
  });
  await new Promise((resolve) => setImmediate(resolve));
  let settled = false;
  void runPromise.then(() => { settled = true; }, () => { settled = true; });

  signalSource.emit("SIGINT");
  signalSource.emit("SIGINT");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, "parent launcher must remain pending until the owned child closes");
  child.emit("close", 0, null);
  await runPromise;

  assert.deepEqual(child.signals, ["SIGINT", "SIGINT"]);
});
