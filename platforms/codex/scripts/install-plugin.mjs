#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestRelative = ".codex-plugin/plugin.json";
const hooksRelative = "hooks/hooks.json";
const statusScriptRelative = "skills/build/scripts/build-status.mjs";
const posixRootToken = "$PLUGIN_ROOT";
const windowsRootToken = "%PLUGIN_ROOT%";
const tempRootName = "BASICS_TEMP_ROOT";
const defaultTempRoot = "/temp";
const bashFallbackStart = "# >>> basics temp root >>>";
const bashFallbackEnd = "# <<< basics temp root <<<";

function fail(message) {
  throw new Error(message);
}

function readJson(file, label) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(`${label} must be valid JSON (${file}): ${error.message}`);
  }
}

function pathInside(root, candidate) {
  const segment = relative(root, candidate);
  return segment === "" || (!segment.startsWith("..") && !isAbsolute(segment));
}

function requiredOption(options, name) {
  if (!options[name]) fail(`--${name} is required`);
  return options[name];
}

function parseOptions(tokens) {
  const options = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) fail(`unexpected argument: ${token}`);
    const key = token.slice(2);
    if (key === "dry-run") {
      options[key] = true;
      continue;
    }
    const value = tokens[index + 1];
    if (!value || value.startsWith("--")) fail(`--${key} requires a value`);
    options[key] = value;
    index += 1;
  }
  return options;
}

export function readPlugin(root) {
  const absoluteRoot = resolve(root);
  const manifestPath = join(absoluteRoot, manifestRelative);
  if (!existsSync(manifestPath)) fail(`plugin manifest is missing: ${manifestPath}`);
  const manifest = readJson(manifestPath, "plugin manifest");
  if (!manifest || typeof manifest.name !== "string" || typeof manifest.version !== "string") {
    fail(`plugin manifest must contain string name and version: ${manifestPath}`);
  }
  return { root: absoluteRoot, manifestPath, manifest };
}

function readInstalledPlugin(destination) {
  const absoluteDestination = resolve(destination);
  const manifestPath = join(absoluteDestination, manifestRelative);
  if (!existsSync(manifestPath)) return null;
  return readPlugin(absoluteDestination);
}

function ensureInstalledMatchesSource(source, installed) {
  if (!installed) fail(`installed plugin is missing: ${join(source.root, "..", "<destination>")}`);
  if (source.manifest.name !== installed.manifest.name) {
    fail(`installed plugin name ${installed.manifest.name} does not match source ${source.manifest.name}`);
  }
  if (source.manifest.version !== installed.manifest.version) {
    fail(`installed plugin is stale: source ${source.manifest.version}, installed ${installed.manifest.version}`);
  }
}

function hookEntries(config) {
  if (!config || typeof config !== "object" || !config.hooks || typeof config.hooks !== "object") {
    fail("hook configuration must contain a hooks object");
  }
  const entries = [];
  for (const [event, groups] of Object.entries(config.hooks)) {
    if (!Array.isArray(groups) || groups.length !== 1 || !Array.isArray(groups[0]?.hooks) || groups[0].hooks.length !== 1) {
      fail(`${event} must have exactly one hook handler`);
    }
    entries.push({ event, hook: groups[0].hooks[0] });
  }
  return entries;
}

function scriptPath(destination) {
  const resolvedDestination = resolve(destination);
  const resolvedScript = resolve(resolvedDestination, statusScriptRelative);
  if (!pathInside(resolvedDestination, resolvedScript)) fail("installed status script escapes plugin destination");
  if (!existsSync(resolvedScript)) fail(`installed status script is missing: ${resolvedScript}`);
  if (resolvedScript.includes('"')) fail(`installed status script path cannot contain a double quote: ${resolvedScript}`);
  return resolvedScript;
}

function windowsScriptPath(path) {
  return process.platform === "win32" ? path : path.replaceAll("/", "\\");
}

function materializeCommand(template, token, path, event, field) {
  if (typeof template !== "string" || !template.includes(token)) {
    fail(`${event}.${field} must contain the ${token} installation placeholder`);
  }
  const materialized = template.replaceAll(token, path);
  if (materialized.includes(posixRootToken) || materialized.includes(windowsRootToken)) {
    fail(`${event}.${field} still contains a plugin-root placeholder after materialization`);
  }
  return materialized;
}

export function inspectInstall({ sourceRoot = pluginRoot, destination }) {
  if (!destination) fail("--destination is required to inspect an installed plugin");
  const source = readPlugin(sourceRoot);
  const installed = readInstalledPlugin(destination);
  return {
    source: { root: source.root, name: source.manifest.name, version: source.manifest.version },
    installed: installed
      ? { root: installed.root, name: installed.manifest.name, version: installed.manifest.version }
      : null,
    stale: !installed || source.manifest.name !== installed.manifest.name || source.manifest.version !== installed.manifest.version,
  };
}

export function materializeHooks({ sourceRoot = pluginRoot, destination, dryRun = false }) {
  if (!destination) fail("--destination is required");
  const source = readPlugin(sourceRoot);
  const installed = readInstalledPlugin(destination);
  ensureInstalledMatchesSource(source, installed);
  if (source.root === installed.root) fail("source and installed plugin roots must be distinct");

  const sourceHooksPath = join(source.root, hooksRelative);
  if (!existsSync(sourceHooksPath)) fail(`source hook configuration is missing: ${sourceHooksPath}`);
  const sourceConfig = readJson(sourceHooksPath, "source hook configuration");
  const config = JSON.parse(JSON.stringify(sourceConfig));
  const script = scriptPath(installed.root);
  const windowsRoot = windowsScriptPath(installed.root);
  const commands = {};
  for (const { event, hook } of hookEntries(config)) {
    if (hook.type !== "command") fail(`${event} hook must have type command`);
    hook.command = materializeCommand(hook.command, posixRootToken, installed.root, event, "command");
    hook.commandWindows = materializeCommand(hook.commandWindows, windowsRootToken, windowsRoot, event, "commandWindows");
    commands[event] = hook.command;
  }

  const destinationHooksPath = join(installed.root, hooksRelative);
  const content = `${JSON.stringify(config, null, 2)}\n`;
  const previous = existsSync(destinationHooksPath) ? readFileSync(destinationHooksPath, "utf8") : null;
  const changed = previous !== content;
  if (changed && !dryRun) {
    const temporaryPath = `${destinationHooksPath}.materializing`;
    if (existsSync(temporaryPath)) fail(`stale hook materialization file exists: ${temporaryPath}`);
    writeFileSync(temporaryPath, content, { encoding: "utf8", mode: statSync(sourceHooksPath).mode });
    renameSync(temporaryPath, destinationHooksPath);
  }
  return {
    sourceVersion: source.manifest.version,
    installedVersion: installed.manifest.version,
    destination: installed.root,
    script,
    changed,
    dryRun,
    commands,
  };
}

function runCodexPluginAdd(plugin, marketplace) {
  const result = spawnSync("codex", ["plugin", "add", `${plugin}@${marketplace}`, "--json"], { encoding: "utf8" });
  if (result.error) fail(`could not run codex plugin add: ${result.error.message}`);
  if (result.status !== 0) fail(`codex plugin add failed: ${(result.stderr || result.stdout || "unknown error").trim()}`);
  const installed = readJsonFromText(result.stdout, "codex plugin add output");
  if (typeof installed.installedPath !== "string" || !isAbsolute(installed.installedPath)) {
    fail("codex plugin add did not return an absolute installedPath");
  }
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "", installedPath: resolve(installed.installedPath) };
}

function readJsonFromText(value, label) {
  try {
    return JSON.parse(value);
  } catch (error) {
    fail(`${label} must be valid JSON: ${error.message}`);
  }
}

function nonblank(value) {
  return typeof value === "string" && value.trim() !== "";
}

function fileValue(content) {
  const match = content.match(/^\s*(?:export\s+)?BASICS_TEMP_ROOT\s*=\s*(.*?)\s*$/m);
  if (!match) return null;
  return match[1].trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2");
}

function commandResult(system, command, args) {
  const result = system.spawnSync(command, args, { encoding: "utf8" });
  if (result?.error) throw new Error(result.error.message);
  if (result?.status !== 0) throw new Error((result?.stderr || result?.stdout || `${command} failed`).trim());
  return result;
}

function recordPersistence(actions, name, run, dryRun) {
  try {
    const result = run();
    actions.push({ name, ...result, dryRun });
  } catch (error) {
    actions.push({ name, status: "failed", error: error.message, dryRun });
  }
}

/**
 * Persist the default only when the user has not selected a nonblank root.
 * System operations are injected so platform behavior is unit-testable.
 */
export function configureTempRoot({
  system = {
    platform: process.platform,
    environment: process.env,
    home: process.env.HOME || process.env.USERPROFILE,
    existsSync,
    readFileSync,
    writeFileSync,
    mkdirSync,
    spawnSync,
  },
  value = defaultTempRoot,
  dryRun = false,
} = {}) {
  const actions = [];
  if (nonblank(system.environment?.[tempRootName])) {
    return { value: system.environment[tempRootName], preserved: true, configured: false, dryRun, actions };
  }
  if (system.platform === "win32") {
    let registryValue = null;
    try {
      const result = commandResult(system, "reg", ["query", "HKCU\\Environment", "/v", tempRootName]);
      const match = (result.stdout || "").match(/BASICS_TEMP_ROOT\s+REG_\w+\s+(.+)\s*$/m);
      registryValue = match?.[1]?.trim() || null;
    } catch (error) {
      // A missing value is reported by reg query as a nonzero exit; add it below.
    }
    if (nonblank(registryValue)) {
      return { value: registryValue, preserved: true, configured: false, dryRun, actions };
    }
    recordPersistence(actions, "windows-user-environment", () => {
      const command = ["add", "HKCU\\Environment", "/v", tempRootName, "/t", "REG_SZ", "/d", value, "/f"];
      if (!dryRun) commandResult(system, "reg", command);
      return { status: "configured", command: ["reg", ...command] };
    }, dryRun);
    return { value, preserved: false, configured: actions.every(action => action.status === "configured"), dryRun, actions };
  }
  if (system.platform !== "linux") {
    return { value, preserved: false, configured: false, dryRun, actions: [{ name: "persistence", status: "unsupported", platform: system.platform, dryRun }] };
  }
  if (!system.home) {
    return { value, preserved: false, configured: false, dryRun, actions: [{ name: "linux-environment", status: "failed", error: "could not determine the user home directory", dryRun }] };
  }

  const environmentFile = join(system.home, ".config", "environment.d", "50-basics-temp-root.conf");
  const bashrc = join(system.home, ".bashrc");
  const environmentContent = system.existsSync(environmentFile) ? system.readFileSync(environmentFile, "utf8") : "";
  const configuredValue = fileValue(environmentContent);
  if (nonblank(configuredValue)) {
    return { value: configuredValue, preserved: true, configured: false, dryRun, actions };
  }
  const bashContent = system.existsSync(bashrc) ? system.readFileSync(bashrc, "utf8") : "";
  const bashValue = fileValue(bashContent);
  if (!bashContent.includes(bashFallbackStart) && nonblank(bashValue)) {
    return { value: bashValue, preserved: true, configured: false, dryRun, actions };
  }
  recordPersistence(actions, "linux-environment.d", () => {
    if (!dryRun) {
      system.mkdirSync(dirname(environmentFile), { recursive: true });
      system.writeFileSync(environmentFile, `${tempRootName}=${value}\n`, "utf8");
    }
    return { status: "configured", path: environmentFile, content: `${tempRootName}=${value}\n` };
  }, dryRun);

  if (bashContent.includes(bashFallbackStart) && bashContent.includes(bashFallbackEnd)) {
    actions.push({ name: "linux-bash-fallback", status: "unchanged", path: bashrc, dryRun });
  } else {
    const fallback = `${bashFallbackStart}\nif [ -z \"\${BASICS_TEMP_ROOT:-}\" ]; then\n  export ${tempRootName}=\"${value}\"\nfi\n${bashFallbackEnd}\n`;
    recordPersistence(actions, "linux-bash-fallback", () => {
      if (!dryRun) system.writeFileSync(bashrc, `${bashContent}${bashContent && !bashContent.endsWith("\n") ? "\n" : ""}${fallback}`, "utf8");
      return { status: "configured", path: bashrc, content: fallback };
    }, dryRun);
  }
  recordPersistence(actions, "linux-systemd-user-environment", () => {
    const command = ["--user", "set-environment", `${tempRootName}=${value}`];
    if (!dryRun) commandResult(system, "systemctl", command);
    return { status: "configured", command: ["systemctl", ...command] };
  }, dryRun);
  return { value, preserved: false, configured: actions.every(action => action.status !== "failed"), dryRun, actions };
}

export function installPlugin({
  sourceRoot = pluginRoot,
  destination,
  marketplace = "personal",
  executePluginAdd = runCodexPluginAdd,
  configureRoot = configureTempRoot,
  dryRun = false,
}) {
  const source = readPlugin(sourceRoot);
  const requestedDestination = destination ? resolve(destination) : null;
  const before = requestedDestination ? inspectInstall({ sourceRoot: source.root, destination: requestedDestination }) : null;
  if (dryRun) {
    let tempRoot;
    try {
      tempRoot = configureRoot({ dryRun: true });
    } catch (error) {
      tempRoot = { configured: false, actions: [{ name: "persistence", status: "failed", error: error.message, dryRun: true }] };
    }
    return { before, action: `codex plugin add ${source.manifest.name}@${marketplace} --json`, requestedDestination, tempRoot, dryRun: true };
  }
  const installed = executePluginAdd(source.manifest.name, marketplace);
  const selectedDestination = installed.installedPath ? resolve(installed.installedPath) : requestedDestination;
  if (!selectedDestination) fail("codex plugin add did not report an installed destination");
  if (requestedDestination && requestedDestination !== selectedDestination) {
    fail(`Codex selected ${selectedDestination}, not the requested installation destination ${requestedDestination}`);
  }
  const materialized = materializeHooks({ sourceRoot: source.root, destination: selectedDestination });
  let tempRoot;
  try {
    tempRoot = configureRoot();
  } catch (error) {
    // Installation and hook materialization are durable even if host persistence is unavailable.
    tempRoot = { configured: false, actions: [{ name: "persistence", status: "failed", error: error.message, dryRun: false }] };
  }
  return { before, installedDestination: selectedDestination, materialized, tempRoot, dryRun: false };
}

function main() {
  const [command, ...tokens] = process.argv.slice(2);
  const options = parseOptions(tokens);
  const sourceRoot = options.source || pluginRoot;
  if (command === "inspect") {
    process.stdout.write(`${JSON.stringify(inspectInstall({ sourceRoot, destination: requiredOption(options, "destination") }))}\n`);
    return;
  }
  if (command === "materialize") {
    process.stdout.write(`${JSON.stringify(materializeHooks({ sourceRoot, destination: requiredOption(options, "destination"), dryRun: options["dry-run"] === true }))}\n`);
    return;
  }
  if (command === "install") {
    process.stdout.write(`${JSON.stringify(installPlugin({
      sourceRoot,
      destination: options.destination,
      marketplace: options.marketplace || "personal",
      dryRun: options["dry-run"] === true,
    }))}\n`);
    return;
  }
  fail("usage: install-plugin.mjs inspect|materialize|install [--source PATH] [--destination PATH] [--marketplace NAME] [--dry-run]");
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`plugin installation failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
