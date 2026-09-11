#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(root, ".agents", "skills");
const sourceShared = join(root, ".agents", "shared");
const adapterRoot = join(root, "platforms", "claude");
const destinationRoot = join(adapterRoot, "skills");
const destinationShared = join(adapterRoot, "shared");
const checkOnly = process.argv.includes("--check");
const refresh = process.argv.includes("--refresh");

// These are implementation details for Codex lifecycle telemetry. Claude Code
// has no equivalent contract, so the adapter keeps the file-backed workflow
// artifacts and omits this unavailable runtime rather than shipping inert hooks.
const omitted = new Set([
  "build/hooks/hooks.json",
  "build/references/status-protocol.md",
  "build/scripts/build-status.mjs",
  "build/scripts/build-status.test.mjs",
  "build/scripts/check-build-suite.mjs",
]);

function listFiles(directory, base = directory) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && (entry.name === "node_modules" || entry.name === "__pycache__")) continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...listFiles(absolute, base));
    else if (entry.isFile()) result.push(relative(base, absolute));
  }
  return result.sort();
}

function omit(path) {
  return omitted.has(path)
    || path.startsWith("build/assets/dashboard/")
    // This skill performs Codex-specific installation and hook materialization.
    || path.startsWith("plugin-update/");
}

function adapt(content) {
  const adapted = content
    .replaceAll("\r\n", "\n")
    .replaceAll("$basics:", "/basics:")
    .replaceAll("$HOME/.agents/skills/ahk-no-shadow/run_no_shadowing.sh", "<ahk-no-shadow-root>/run_no_shadowing.sh")
    .replaceAll(" For a Codex package, run `--strict` against the generated skill directory after metadata injection.", "")
    .replaceAll("Run both checks against the requested skill directory:", "Run the bundled check against the requested skill directory:")
    .replaceAll(".codex", ".claude")
    .replaceAll("Codex", "Claude Code")
    .replaceAll(/gpt-[a-z0-9.-]+/gi, "session configuration")
    .replaceAll("reasoning_effort", "effort setting")
    .replaceAll("openai.yaml", "host-ui-metadata.yaml")
    .replaceAll("SubagentStart", "host lifecycle start")
    .replaceAll("SubagentStop", "host lifecycle stop")
    .replaceAll("PreToolUse", "host tool preflight")
    .replaceAll("PostToolUse", "host tool completion")
    .replaceAll("Claude Code's normal plugin update", "the host's normal plugin update")
    .replaceAll("Claude Code JSON event", "host event")
    .replaceAll("fork_turns", "fresh-context isolation")
    .replaceAll("<plugin>", ".")
    .replaceAll("Terra", "host")
    .replaceAll("Sol", "host")
    .replaceAll("| Role | Model", "| Role | Guidance");

  // Lifecycle telemetry and its dashboard are intentionally absent from this
  // adapter. Remove instructions that would make those omitted resources an
  // operational dependency rather than leaving a dangling command or link.
  return adapted.split("\n").filter((line) => !(
    /references\/status-protocol\.md|(?:scripts\/)?build-status(?:\.test)?\.mjs|scripts\/check-build-suite\.mjs|assets\/dashboard|quick_validate\.py/i.test(line)
    // Claude Code supplies model and effort choices through its session. Drop
    // Codex role-selection tables and directives instead of relabeling them.
    || /session configuration|effort setting|\bhost\/(?:xhigh|high|medium|low)\b/i.test(line)
    || /^\|\s*Role\s*\|.*(?:Model|Guidance).*effort/i.test(line)
  )).join("\n");
}

function expectedFiles() {
  return listFiles(sourceRoot).filter((path) => !omit(path));
}

function matches() {
  if (!existsSync(destinationRoot) || !existsSync(destinationShared)) return false;
  const expected = expectedFiles();
  const actual = listFiles(destinationRoot);
  if (JSON.stringify(expected) !== JSON.stringify(actual)) return false;
  return expected.every((path) => readFileSync(join(destinationRoot, path), "utf8")
    === adapt(readFileSync(join(sourceRoot, path), "utf8")))
    && JSON.stringify(listFiles(sourceShared)) === JSON.stringify(listFiles(destinationShared))
    && listFiles(sourceShared).every((path) => readFileSync(join(sourceShared, path), "utf8") === readFileSync(join(destinationShared, path), "utf8"));
}

if (!existsSync(sourceRoot) || !existsSync(sourceShared)) throw new Error("canonical skills or shared resources are missing");
if (checkOnly) {
  if (!matches()) throw new Error("Claude adapter drift from .agents/skills; run scripts/sync-claude-skills.mjs");
  process.stdout.write("Claude adapter matches the canonical skills with its documented capability exclusions.\n");
  process.exit(0);
}
if (existsSync(destinationRoot) && !refresh) {
  throw new Error(`refusing to overwrite ${destinationRoot}; remove or archive that generated directory explicitly, then rerun`);
}

mkdirSync(destinationRoot, { recursive: true });
for (const path of expectedFiles()) {
  const destination = join(destinationRoot, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, adapt(readFileSync(join(sourceRoot, path), "utf8")));
}
for (const path of listFiles(sourceShared)) {
  const destination = join(destinationShared, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, readFileSync(join(sourceShared, path), "utf8"));
}
process.stdout.write(`Created ${destinationRoot} from .agents/skills.\n`);
