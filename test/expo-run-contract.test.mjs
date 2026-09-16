import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolveTempLocation } from "../.agents/shared/temp-location.mjs";
const testRoot = join(resolveTempLocation().root, "agent-workflows", "tests", "expo-run");
await mkdir(testRoot, { recursive: true });
const tmpdir = () => testRoot;
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  STATUS_SCRIPT,
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
  runExpo as runExpoImpl,
  verifyTunnelUrl,
  renderReadyReport,
} from "../.agents/skills/expo-run/scripts/expo-go-launch.mjs";

const webResponse = () => ({ ok: true, headers: { get: () => "text/html" }, text: async () => '<html><script src="/index.bundle?platform=web"></script></html>' });
const runExpo = (options) => runExpoImpl({ fetchImpl: async () => webResponse(), ...options });
async function waitForReport(stdout) {
  for (let i = 0; i < 150 && !stdout.output.includes("QR:"); i++) await new Promise(resolve => setTimeout(resolve, 10));
}
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

test("configures tunnel and status without adding a local script or disturbing package data", () => {
  const source = {
    name: "sample-app",
    private: true,
    scripts: { test: "node --test", start: "old-command" },
    dependencies: { expo: "~57.0.0", react: "19.1.0" },
    devDependencies: { "@expo/ngrok": "^4.1.0", "qrcode-terminal": "^0.12.0" },
  };

  const configured = configurePackage(source);

  assert.equal(configured.scripts.start, TUNNEL_SCRIPT);
  assert.equal(Object.hasOwn(configured.scripts, "start:local"), false);
  assert.equal(configured.scripts["start:status"], STATUS_SCRIPT);
  assert.equal(configured.scripts.test, "node --test");
  assert.equal(configured.dependencies.react, "19.1.0");
  assert.notEqual(configured, source);
  assert.equal(source.scripts.start, "old-command");
  assert.equal(configurePackage({ ...source, scripts: { "start:local": "custom-local" } }).scripts["start:local"], "custom-local");
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
  assert.deepEqual(expoArguments("tunnel"), ["start", "--go", "--web", "--tunnel", "--clear"]);
  assert.deepEqual(expoArguments("local"), ["start", "--web", "--localhost", "--clear"]);
  assert.throws(() => expoArguments("lan"), /mode/i);
});

test("extracts only a published Expo URL and ignores ordinary local endpoints", () => {
  const text = "Local: http://localhost:8081\nMetro waiting on exp://abc-123.exp.direct\n";
  assert.equal(extractExpoUrl(text), "exp://abc-123.exp.direct");
  assert.equal(extractExpoUrl("Local: http://localhost:8081"), null);
});

test("ready output gives the verified browser and Expo Go endpoints followed by the terminal QR", () => {
  const output = formatReadyOutput({
    url: "exp://abc-123.exp.direct",
    browserUrl: "https://abc-123.exp.direct",
    qr: "QR FOR exp://abc-123.exp.direct",
  });
  assert.equal(output, [
    "---",
    "Browser: https://abc-123.exp.direct",
    "",
    "QR:",
    "QR FOR exp://abc-123.exp.direct",
    "---",
    "",
  ].join("\n"));
});

test("renders the complete report to stdout without creating an artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "expo-run-report-"));
  const stdout = { output: "", write(chunk) { this.output += String(chunk); return true; } };
  await renderReadyReport({
    projectRoot: root,
    browserUrl: "https://abc-123.exp.direct",
    url: "exp://abc-123.exp.direct",
    render: () => async () => "QR FOR exp://abc-123.exp.direct\n",
    stdout,
  });
  assert.equal(stdout.output, [
    "---",
    "Browser: https://abc-123.exp.direct",
    "",
    "QR:",
    "QR FOR exp://abc-123.exp.direct",
    "---",
    "",
  ].join("\n"));
  assert.doesNotMatch(stdout.output, /Expo Go:|QR report:/);
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

test("simulated Expo tunnel observes the published URL before emitting the complete terminal report", async () => {
  const root = await mkdtemp(join(tmpdir(), "expo-run-simulated-project-"));
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
    setImmediate(async () => {
      child.stdout.write("Expo arguments: start --go --web --tunnel --clear\n");
      child.stdout.write("Browser: http://simulated.exp.direct\n");
      child.stdout.write("Published: exp://simulated.exp.direct\n");
      await waitForReport(stdout);
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
    mode: "tunnel",
    timeoutMs: 3_000,
    stdout,
    stderr,
    spawnImpl,
  });

  assert.equal(result.url, "exp://simulated.exp.direct");
  assert.equal(result.browserUrl, "http://simulated.exp.direct/");
  assert.equal(spawned.length, 1);
  assert.deepEqual(spawned[0].args.slice(1), ["start", "--go", "--web", "--tunnel", "--clear"]);
  assert.match(stdout.output, /Expo arguments: start --go --web --tunnel --clear/);
  assert.match(stdout.output, /QR FOR exp:\/\/simulated\.exp\.direct/);
  assert.match(stdout.output, /Browser: http:\/\/simulated\.exp\.direct/);
  assert.doesNotMatch(stdout.output, /Expo Go:|QR report:/);
  assert.match(stdout.output, /QR:\nQR FOR exp:\/\/simulated\.exp\.direct/);
  assert.equal(stderr.output, "");
});

test("waits for both browser and Expo Go URLs split across stdout and stderr chunks", async () => {
  const root = await createFakeExpoProject("expo-run-split-streams-");
  const child = fakeExpoChild();
  const stdout = { output: "", write(chunk) { this.output += String(chunk); return true; } };
  const stderr = { output: "", write(chunk) { this.output += String(chunk); return true; } };
  const resultPromise = runExpo({
    projectRoot: root,
    mode: "tunnel",
    timeoutMs: 3_000,
    stdout,
    stderr,
    spawnImpl: () => child,
    render: () => async (url) => `QR FOR ${url}\n`,
  });

  child.stdout.write("Published: exp://simu");
  child.stdout.write("lated.exp.direct\n");
  assert.doesNotMatch(stdout.output, /QR:/, "the report must wait for the browser probe");
  child.stderr.write("Browser: https://simulated.");
  child.stderr.write("exp.direct\n");
  await waitForReport(stdout);
  child.stdout.end();
  child.stderr.end();
  child.emit("close", 0, null);

  const result = await resultPromise;
  assert.equal(result.url, "exp://simulated.exp.direct");
  assert.equal(result.browserUrl, "http://simulated.exp.direct/");
  assert.match(stdout.output, /QR FOR exp:\/\/simulated\.exp\.direct/);
  assert.match(stdout.output, /Browser: http:\/\/simulated\.exp\.direct/);
});

test("does not create a report when the tunnel serves no browser app", async () => {
  const root = await createFakeExpoProject("expo-run-missing-browser-");
  const child = fakeExpoChild();
  const stdout = { output: "", write(chunk) { this.output += String(chunk); return true; } };
  const stderr = { output: "", write(chunk) { this.output += String(chunk); return true; } };
  const result = runExpo({
    projectRoot: root,
    mode: "tunnel",
    timeoutMs: 3_000,
    stdout,
    stderr,
    spawnImpl: () => child,
    render: () => async () => "QR MUST NOT RENDER\n",
    fetchImpl: async () => ({ ok: false }),
  });

  child.stdout.write("Published: exp://simulated.exp.direct\n");
  child.stdout.end();
  child.stderr.end();
  child.emit("close", 0, null);

  await assert.rejects(result, /both a public https:\/\/ browser URL and an exp:\/\/ URL/i);
  assert.doesNotMatch(stdout.output, /QR:|QR MUST NOT RENDER/);
});

test("status re-renders the same report for an already-running tunnel", async () => {
  const root = await createFakeExpoProject("expo-run-status-");
  const stdout = { output: "", write(chunk) { this.output += String(chunk); return true; } };
  const result = await runExpo({
    projectRoot: root,
    mode: "status",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ extra: { expoGo: { debuggerHost: "simulated.boltexpo.dev", projectRoot: root } } }),
    }),
    readTunnelUrls: async () => ({ browserUrl: "https://simulated.boltexpo.dev/", url: "exp://simulated.boltexpo.dev" }),
    render: () => async () => "QR FOR exp://simulated.boltexpo.dev\n",
    stdout,
  });
  assert.equal(result.alreadyRunning, true);
  assert.equal(stdout.output, [
    "---",
    "Browser: https://simulated.boltexpo.dev/",
    "",
    "QR:",
    "QR FOR exp://simulated.boltexpo.dev",
    "---",
    "",
  ].join("\n"));
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

test("setup installs a runnable helper and preserves custom launchers", async () => {
  const root = await createFakeExpoProject("expo-setup-");
  await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { expo: "*" }, scripts: { test: "test-command" } }));
  await configureProject({ projectRoot: root, write: true });
  assert.match(await readFile(join(root, "scripts/expo-go-launch.mjs"), "utf8"), /formatReadyOutput/);
  assert.equal(JSON.parse(await readFile(join(root, "package.json"))).scripts.test, "test-command");
  await writeFile(join(root, "scripts/expo-go-launch.mjs"), "custom startup");
  await assert.rejects(configureProject({ projectRoot: root, write: true }), /Existing launcher differs/);
  assert.equal(await readFile(join(root, "scripts/expo-go-launch.mjs"), "utf8"), "custom startup");
});

test("browser verification rejects landing pages and uses the published tunnel authority", async () => {
  let requested;
  const fetchImpl = async (url) => { requested = url; return webResponse(); };
  assert.deepEqual(await verifyTunnelUrl("exp://actual.exp.direct:80", fetchImpl), {
    url: "exp://actual.exp.direct:80", browserUrl: "http://actual.exp.direct:80/",
  });
  assert.equal(requested, "http://actual.exp.direct:80/");
  assert.equal(await verifyTunnelUrl("exp://localhost:8081", fetchImpl), null);
  assert.equal(await verifyTunnelUrl("exp://actual.exp.direct", async () => ({ ...webResponse(), text: async () => "<html>Open Expo Go</html>" })), null);
  assert.equal(await verifyTunnelUrl("exp://actual.exp.direct", async () => ({ ...webResponse(), headers: { get: () => "application/json" } })), null);
});

test("status refuses a different project's server", async () => {
  await assert.rejects(runExpo({ mode: "status", projectRoot: "/different", fetchImpl: async () => ({ ok: true, json: async () => ({ extra: { expoGo: { projectRoot: "/other" } } }) }) }), /belongs to this project/);
});

test("readiness timeout stops the owned child and never prints a QR", async () => {
  const root = await createFakeExpoProject("expo-timeout-");
  const child = fakeExpoChild();
  child.kill = () => { setImmediate(() => child.emit("close", null, "SIGTERM")); return true; };
  const stdout = { output: "", write(chunk) { this.output += chunk; } };
  await assert.rejects(runExpo({ mode: "tunnel", projectRoot: root, spawnImpl: () => child, timeoutMs: 20, stdout, stderr: { write() {} }, fetchImpl: async () => ({ ok: false }) }), /within 20ms/);
  assert.doesNotMatch(stdout.output, /QR:/);
});
