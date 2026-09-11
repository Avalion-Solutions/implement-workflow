import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { configureTempRoot, inspectInstall, installPlugin, materializeHooks } from "./install-plugin.mjs";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../plugins/basics");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "implement-plugin-install-"));
  const source = join(root, "source");
  const destination = join(root, "installed", "implement");
  const home = join(root, "home");
  cpSync(pluginRoot, source, { recursive: true });
  return { root, source, destination, home };
}

function installFrom(source, destination) {
  return installPlugin({
    sourceRoot: source,
    destination,
    executePluginAdd: () => {
      cpSync(source, destination, { recursive: true, force: true });
      return { status: 0 };
    },
    configureRoot: () => ({ configured: true, actions: [] }),
  });
}

function materializedHook(destination, event) {
  const config = JSON.parse(readFileSync(join(destination, "hooks", "hooks.json"), "utf8"));
  return config.hooks[event][0].hooks[0];
}

function hookEnvironment(home) {
  const environment = { ...process.env, HOME: home };
  delete environment.PLUGIN_ROOT;
  return environment;
}

function invoke(command, input, home) {
  const match = /^node "([^"]+)" hook$/.exec(command);
  assert.ok(match, `unexpected materialized hook command: ${command}`);
  mkdirSync(home, { recursive: true });
  const eventPath = join(home, "hook-event.json");
  const outputPath = join(home, "hook-output.json");
  writeFileSync(eventPath, JSON.stringify(input));
  const inputDescriptor = openSync(eventPath, "r");
  const outputDescriptor = openSync(outputPath, "w");
  try {
    const result = spawnSync(process.execPath, [match[1], "hook"], {
      encoding: "utf8",
      env: hookEnvironment(home),
      stdio: [inputDescriptor, outputDescriptor, "pipe"],
    });
    return { ...result, stdout: readFileSync(outputPath, "utf8") };
  } finally {
    closeSync(inputDescriptor);
    closeSync(outputDescriptor);
  }
}

function invokeTemplate(command, input, source, home) {
  mkdirSync(home, { recursive: true });
  const eventPath = join(home, "hook-template-event.json");
  const outputPath = join(home, "hook-template-output.json");
  writeFileSync(eventPath, JSON.stringify(input));
  const inputDescriptor = openSync(eventPath, "r");
  const outputDescriptor = openSync(outputPath, "w");
  try {
    const result = spawnSync("sh", ["-c", command], {
      encoding: "utf8",
      env: { ...hookEnvironment(home), PLUGIN_ROOT: source },
      stdio: [inputDescriptor, outputDescriptor, "pipe"],
    });
    return { ...result, stdout: readFileSync(outputPath, "utf8") };
  } finally {
    closeSync(inputDescriptor);
    closeSync(outputDescriptor);
  }
}

function runStatus(destination, args, home) {
  return spawnSync(process.execPath, [join(destination, "skills", "build", "scripts", "build-status.mjs"), ...args], {
    encoding: "utf8",
    env: hookEnvironment(home),
  });
}

test("materialization refuses a stale destination before changing hooks", () => {
  const { root, source, destination } = fixture();
  try {
    cpSync(source, destination, { recursive: true });
    const manifest = join(destination, ".codex-plugin", "plugin.json");
    const stale = JSON.parse(readFileSync(manifest, "utf8"));
    stale.version = "0.0.1";
    writeFileSync(manifest, `${JSON.stringify(stale, null, 2)}\n`);
    const hooksPath = join(destination, "hooks", "hooks.json");
    const before = readFileSync(hooksPath, "utf8");

    assert.throws(() => materializeHooks({ sourceRoot: source, destination }), /installed plugin is stale/);
    assert.equal(readFileSync(hooksPath, "utf8"), before);
    assert.equal(inspectInstall({ sourceRoot: source, destination }).stale, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("installation materializes every root hook and repeats after an update", () => {
  const { root, source, destination } = fixture();
  try {
    const first = installFrom(source, destination);
    assert.equal(first.before.stale, true);
    assert.equal(first.materialized.changed, true);
    const sourceHooks = readFileSync(join(source, "hooks", "hooks.json"), "utf8");
    assert.match(sourceHooks, /\$PLUGIN_ROOT/);
    const firstMaterialized = readFileSync(join(destination, "hooks", "hooks.json"), "utf8");
    assert.doesNotMatch(firstMaterialized, /\$PLUGIN_ROOT|%PLUGIN_ROOT%/);

    const config = JSON.parse(firstMaterialized);
    for (const event of ["PreToolUse", "PostToolUse", "SubagentStart", "SubagentStop", "Stop"]) {
      assert.equal(config.hooks[event].length, 1);
      assert.equal(config.hooks[event][0].hooks.length, 1);
      const hook = config.hooks[event][0].hooks[0];
      assert.equal(hook.timeout, 3);
      assert.match(hook.command, /^node "\//);
      assert.match(hook.command, /skills\/build\/scripts\/build-status\.mjs" hook$/);
    }
    assert.equal(config.hooks.PreToolUse[0].matcher, "^(Bash|apply_patch)$");
    assert.equal(config.hooks.PostToolUse[0].matcher, "^(Bash|apply_patch)$");

    const second = installFrom(source, destination);
    assert.equal(second.materialized.changed, true);
    assert.equal(readFileSync(join(destination, "hooks", "hooks.json"), "utf8"), firstMaterialized);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("source hooks use Codex's supported timeout and execute with the active plugin root", () => {
  const { root, source, home } = fixture();
  try {
    const config = JSON.parse(readFileSync(join(source, "hooks", "hooks.json"), "utf8"));
    for (const eventName of ["PreToolUse", "PostToolUse", "SubagentStart", "SubagentStop", "Stop"]) {
      const hook = config.hooks[eventName][0].hooks[0];
      assert.equal(hook.timeout, 3, `${eventName} must use Codex's 1-3 second timeout range`);
      const result = invokeTemplate(hook.command, {
        session_id: "source-hook-session",
        cwd: root,
        hook_event_name: eventName,
        tool_name: "Bash",
        tool_input: { command: "echo nothing" },
        tool_response: { exit_code: 0 },
      }, source, home);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), {});
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("installation materializes Codex's reported destination rather than a legacy path", () => {
  const { root, source } = fixture();
  const destination = join(root, "cache", "personal", "implement", "1.2.3");
  try {
    const result = installPlugin({
      sourceRoot: source,
      executePluginAdd: () => {
        cpSync(source, destination, { recursive: true });
        return { status: 0, installedPath: destination };
      },
      configureRoot: () => ({ configured: true, actions: [] }),
    });
    assert.equal(result.installedDestination, destination);
    assert.equal(result.materialized.destination, destination);
    assert.doesNotMatch(readFileSync(join(destination, "hooks", "hooks.json"), "utf8"), /\$PLUGIN_ROOT|%PLUGIN_ROOT%/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function tempRootSystem({ root, platform = "linux", environment = {}, systemctlStatus = 0, registryValue = null }) {
  const commands = [];
  return {
    platform,
    environment,
    home: join(root, "home"),
    existsSync,
    readFileSync,
    writeFileSync,
    mkdirSync,
    commands,
    spawnSync(command, args) {
      commands.push([command, ...args]);
      if (command === "reg" && args[0] === "query" && registryValue !== null) {
        return { status: 0, stdout: `BASICS_TEMP_ROOT    REG_SZ    ${registryValue}\n`, stderr: "" };
      }
      return systemctlStatus === 0
        ? { status: 0, stdout: "", stderr: "" }
        : { status: systemctlStatus, stdout: "", stderr: "user manager unavailable" };
    },
  };
}

test("Linux persistence writes environment.d and a conditional managed Bash fallback only when blank", () => {
  const { root } = fixture();
  try {
    const system = tempRootSystem({ root });
    const preview = configureTempRoot({ system, dryRun: true });
    assert.equal(preview.configured, true);
    assert.equal(existsSync(join(system.home, ".config", "environment.d", "50-basics-temp-root.conf")), false);
    assert.deepEqual(preview.actions.map(action => action.name), ["linux-environment.d", "linux-bash-fallback", "linux-systemd-user-environment"]);

    const result = configureTempRoot({ system });
    assert.equal(result.configured, true);
    assert.equal(readFileSync(join(system.home, ".config", "environment.d", "50-basics-temp-root.conf"), "utf8"), "BASICS_TEMP_ROOT=/temp\n");
    assert.match(readFileSync(join(system.home, ".bashrc"), "utf8"), /if \[ -z "\$\{BASICS_TEMP_ROOT:-\}" \]; then/);
    assert.deepEqual(system.commands.at(-1), ["systemctl", "--user", "set-environment", "BASICS_TEMP_ROOT=/temp"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Linux persistence preserves a nonblank Bash-only root before writing other defaults", () => {
  const { root } = fixture();
  try {
    const system = tempRootSystem({ root });
    mkdirSync(system.home, { recursive: true });
    writeFileSync(
      join(system.home, ".bashrc"),
      'if [ -z "${BASICS_TEMP_ROOT:-}" ]; then\n  export BASICS_TEMP_ROOT="/custom/bash-root"\nfi\n',
    );

    const result = configureTempRoot({ system });

    assert.equal(result.preserved, true);
    assert.equal(result.value, "/custom/bash-root");
    assert.equal(system.commands.length, 0);
    assert.equal(existsSync(join(system.home, ".config", "environment.d", "50-basics-temp-root.conf")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("installer dry-run exposes the planned temporary-root persistence without installing", () => {
  const { root, source, destination } = fixture();
  try {
    const system = tempRootSystem({ root });
    const result = installPlugin({
      sourceRoot: source,
      destination,
      dryRun: true,
      configureRoot: options => configureTempRoot({ system, ...options }),
    });
    assert.equal(result.tempRoot.dryRun, true);
    assert.equal(result.tempRoot.actions[0].name, "linux-environment.d");
    assert.equal(existsSync(destination), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("persistence preserves every nonblank existing root and reports host failures without rolling installation back", () => {
  const { root, source, destination } = fixture();
  try {
    const system = tempRootSystem({ root, environment: { BASICS_TEMP_ROOT: "/custom/root" } });
    const preserved = configureTempRoot({ system });
    assert.equal(preserved.preserved, true);
    assert.equal(system.commands.length, 0);

    const configuredPath = join(root, "configured", "home", ".config", "environment.d");
    mkdirSync(configuredPath, { recursive: true });
    writeFileSync(join(configuredPath, "50-basics-temp-root.conf"), "BASICS_TEMP_ROOT=/already/chosen\n");
    const configuredSystem = tempRootSystem({ root: join(root, "configured") });
    assert.equal(configureTempRoot({ system: configuredSystem }).value, "/already/chosen");
    assert.equal(configuredSystem.commands.length, 0);

    const failingSystem = tempRootSystem({ root: join(root, "failure"), systemctlStatus: 1 });
    const result = installPlugin({
      sourceRoot: source,
      destination,
      executePluginAdd: () => {
        cpSync(source, destination, { recursive: true });
        return { status: 0, installedPath: destination };
      },
      configureRoot: () => configureTempRoot({ system: failingSystem }),
    });
    assert.equal(result.materialized.destination, destination);
    assert.equal(result.tempRoot.configured, false);
    assert.equal(result.tempRoot.actions.at(-1).status, "failed");
    assert.doesNotMatch(readFileSync(join(destination, "hooks", "hooks.json"), "utf8"), /\$PLUGIN_ROOT|%PLUGIN_ROOT%/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Windows persistence writes the current user's registry only when its value is absent or blank", () => {
  const { root } = fixture();
  try {
    const system = tempRootSystem({ root, platform: "win32" });
    const result = configureTempRoot({ system });
    assert.equal(result.configured, true);
    assert.deepEqual(system.commands, [
      ["reg", "query", "HKCU\\Environment", "/v", "BASICS_TEMP_ROOT"],
      ["reg", "add", "HKCU\\Environment", "/v", "BASICS_TEMP_ROOT", "/t", "REG_SZ", "/d", "/temp", "/f"],
    ]);
    const custom = tempRootSystem({ root: join(root, "custom"), platform: "win32", registryValue: "D:\\agent-temp" });
    const preserved = configureTempRoot({ system: custom });
    assert.equal(preserved.value, "D:\\agent-temp");
    assert.equal(preserved.preserved, true);
    assert.equal(custom.commands.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("installed PreToolUse and PostToolUse safely no-op without PLUGIN_ROOT or a selected run", () => {
  const { root, source, destination, home } = fixture();
  try {
    installFrom(source, destination);
    const event = { session_id: "session-none", cwd: root, tool_name: "Bash", tool_input: { command: "echo nothing" } };
    for (const eventName of ["PreToolUse", "PostToolUse"]) {
      const hook = materializedHook(destination, eventName);
      const result = invoke(hook.command, { ...event, hook_event_name: eventName, tool_response: { exit_code: 0 } }, home);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), {});
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("installed hooks update only the selected task and preserve approval and ownership", () => {
  const { root, source, destination, home } = fixture();
  const workspace = join(root, "workspace");
  const statusDir = join(home, ".codex", "build-runs", "install-hook-run", "status");
  const baseEvent = { session_id: "session-selected", cwd: workspace, tool_name: "Bash", tool_input: { command: "node --test focused.test.mjs" } };
  try {
    installFrom(source, destination);
    for (const args of [
      ["init", "--state-dir", statusDir, "--run", "install-hook-run", "--repo", workspace, "--workspace", workspace, "--base", "abc", "--branch", "build/install-hook-run"],
      ["team", "--state-dir", statusDir, "--id", "blue", "--status", "active"],
      ["agent", "--state-dir", statusDir, "--id", "blue-worker", "--team", "blue", "--role", "worker", "--status", "queued"],
      ["task", "--state-dir", statusDir, "--id", "blue-verify", "--team", "blue", "--title", "Verify installation", "--status", "queued", "--verification-command", "node --test focused.test.mjs"],
      ["context", "--state-dir", statusDir, "--team", "blue", "--task", "blue-verify", "--agent", "blue-worker", "--workspace", workspace],
    ]) {
      const result = runStatus(destination, args, home);
      assert.equal(result.status, 0, result.stderr);
    }

    let result = invoke(materializedHook(destination, "PreToolUse").command, { ...baseEvent, hook_event_name: "PreToolUse" }, home);
    assert.equal(result.status, 0, result.stderr);
    result = invoke(materializedHook(destination, "PostToolUse").command, { ...baseEvent, hook_event_name: "PostToolUse", tool_response: { exit_code: 1 } }, home);
    assert.equal(result.status, 0, result.stderr);
    const state = JSON.parse(readFileSync(join(statusDir, "status.json"), "utf8"));
    assert.equal(state.tasks["blue-verify"].status, "active");
    assert.equal(state.tasks["blue-verify"].team, "blue");
    assert.equal(Object.hasOwn(state, "approval"), false);
    assert.equal(Object.hasOwn(state, "merge"), false);
    assert.equal(state.events.some(event => event.kind === "tool" && event.status === "failed"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
