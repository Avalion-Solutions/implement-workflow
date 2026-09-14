import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const canonical = join(root, ".agents", "skills");
const adapter = join(root, "platforms", "claude");
const packaged = join(adapter, "skills");

function directories(path) {
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function files(path) {
  if (!existsSync(path)) return [];
  const result = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const absolute = join(path, entry.name);
    if (entry.isDirectory()) result.push(...files(absolute));
    else if (entry.isFile()) result.push(absolute);
  }
  return result;
}

function markdownFiles(path) {
  return files(path).filter((file) => file.endsWith(".md"));
}

function assertPackageExcludes(patterns) {
  for (const file of markdownFiles(packaged)) {
    const content = readFileSync(file, "utf8");
    for (const [pattern, label] of patterns) {
      assert.doesNotMatch(content, pattern, `${label} remains in ${relative(adapter, file)}`);
    }
  }
}

test("Claude adapter exposes every canonical skill and required contract", () => {
  assert.ok(existsSync(join(root, "CLAUDE.md")), "missing repository CLAUDE.md");
  assert.ok(existsSync(join(adapter, ".claude-plugin", "plugin.json")), "missing Claude plugin manifest");
  assert.ok(existsSync(join(adapter, "README.md")), "missing Claude adapter README");
  assert.deepEqual(
    directories(packaged),
    directories(canonical).filter((name) => name !== "plugin-update")
  );
});

test("Claude adapter excludes the Codex-only plugin update workflow", () => {
  assert.equal(existsSync(join(packaged, "plugin-update")), false);
});

test("Claude package excludes Codex-only runtime identifiers", () => {
  assert.ok(existsSync(adapter), "missing Claude adapter package");
  const forbidden = [
    [/gpt-5(?:\.|-)/i, "Codex model ID"],
    [/reasoning_effort/, "Codex reasoning_effort field"],
    [/openai\.yaml/, "OpenAI metadata"],
    [/(?:PreToolUse|PostToolUse|SubagentStart|SubagentStop)/, "Codex lifecycle hook event"]
  ];
  for (const file of files(adapter)) {
    const content = readFileSync(file, "utf8");
    for (const [pattern, label] of forbidden) {
      assert.doesNotMatch(content, pattern, `${label} leaked into ${file}`);
    }
  }
});

test("Claude package contains no owner-specific or Codex installation paths", () => {
  const forbidden = [
    [/\/home\//, "owner-specific home path"],
    [/(?:^|[\/`])\.codex(?:[\/`]|$)/, "Codex state directory"],
    [/\$HOME\/\.agents\//, "external agent installation path"],
    [/quick_validate\.py/, "unbundled quick validator"]
  ];
  for (const file of files(adapter)) {
    const content = readFileSync(file, "utf8");
    for (const [pattern, label] of forbidden) {
      assert.doesNotMatch(content, pattern, `${label} leaked into ${relative(adapter, file)}`);
    }
  }
});

test("Claude adapter documents model and capability fallbacks", () => {
  const contract = readFileSync(join(adapter, "README.md"), "utf8");
  for (const phrase of ["Model mapping", "Effort", "Fresh-context delegation", "Lifecycle hooks", "BASICS_RUNS_DIR"]) {
    assert.match(contract, new RegExp(phrase, "i"), `missing ${phrase} contract`);
  }
});

test("RT-FINAL-001: omitted lifecycle resources are not operational dependencies", () => {
  assertPackageExcludes([
    [/references\/status-protocol\.md/, "omitted status protocol reference"],
    [/\bbuild-status(?:\.test)?\.mjs\b/, "omitted status normalizer command"],
    [/scripts\/check-build-suite\.mjs/, "omitted suite checker command"],
    [/assets\/dashboard/, "omitted dashboard dependency"]
  ]);
});

test("RT-FINAL-002: packaged workflows leave model, effort, and delegation to Claude", () => {
  assertPackageExcludes([
    [/\bfork_turns\b/, "host-specific fresh-context field"],
    [/\bhost-selected model\b/i, "model-selection directive"],
    [/\b(?:Terra|Sol)\/(?:xhigh|high|medium|low)\b/, "Codex role and effort directive"],
    [/\|\s*Role\s*\|\s*Model(?:\s*\/\s*effort)?\s*\|/i, "model and effort role table"]
  ]);
});

test("RT-FINAL-003: generic gpt identifiers cannot survive generation and drift checking", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "claude-adapter-regression-"));
  const fixtureScript = join(fixtureRoot, "scripts", "sync-claude-skills.mjs");
  const fixtureSource = join(fixtureRoot, ".agents", "skills", "future", "SKILL.md");
  const fixtureShared = join(fixtureRoot, ".agents", "shared", "temp-location.mjs");
  mkdirSync(dirname(fixtureScript), { recursive: true });
  mkdirSync(dirname(fixtureSource), { recursive: true });
  mkdirSync(dirname(fixtureShared), { recursive: true });
  copyFileSync(join(root, "scripts", "sync-claude-skills.mjs"), fixtureScript);
  writeFileSync(fixtureSource, "Use gpt-4.1 for this future role.\n");
  copyFileSync(join(root, ".agents", "shared", "temp-location.mjs"), fixtureShared);

  const generated = spawnSync(process.execPath, [fixtureScript], { encoding: "utf8" });
  assert.equal(generated.status, 0, generated.stderr);
  const check = spawnSync(process.execPath, [fixtureScript, "--check"], { encoding: "utf8" });
  assert.equal(check.status, 0, check.stderr);
  assert.doesNotMatch(
    readFileSync(join(fixtureRoot, "platforms", "claude", "skills", "future", "SKILL.md"), "utf8"),
    /\bgpt-/i,
    "generic gpt identifier leaked through generation and --check"
  );
});

test("RT-FINAL-004: packaged portability guidance resolves its adapter contract", () => {
  const portability = join(packaged, "PORTABILITY.md");
  const contractLink = readFileSync(portability, "utf8").match(/`([^`]*adapter-contract\.md)`/i)?.[1];
  assert.ok(contractLink, "PORTABILITY.md does not identify its adapter contract");
  assert.ok(
    existsSync(resolve(dirname(portability), contractLink)),
    `PORTABILITY.md adapter contract link does not resolve: ${contractLink}`
  );
});

test("RT-FINAL-005: packaged commands contain no unresolved plugin-root placeholder", () => {
  assertPackageExcludes([[/<plugin>/, "unresolved plugin-root placeholder"]]);
});

test("Claude marketplace installs the adapter from the repository checkout", () => {
  const marketplacePath = join(root, ".claude-plugin", "marketplace.json");
  assert.ok(existsSync(marketplacePath), "missing repository Claude marketplace manifest");
  const marketplace = JSON.parse(readFileSync(marketplacePath, "utf8"));
  const plugin = JSON.parse(readFileSync(join(adapter, ".claude-plugin", "plugin.json"), "utf8"));
  assert.equal(marketplace.name, "agent-workflows");
  assert.equal(marketplace.owner?.name, "Jeff");
  assert.deepEqual(
    marketplace.plugins?.map(({ name, source, version }) => ({ name, source, version })),
    [{ name: "basics", source: "./platforms/claude", version: plugin.version }]
  );
});

test("Claude documentation uses native install and namespaced invocation commands", () => {
  const contract = readFileSync(join(adapter, "README.md"), "utf8");
  assert.match(contract, /claude --plugin-dir \/absolute\/path\/to\/agent-workflows\/platforms\/claude/);
  assert.match(contract, /\/plugin marketplace add \/absolute\/path\/to\/agent-workflows/);
  assert.match(contract, /\/plugin install basics@agent-workflows/);
  assert.match(contract, /\/basics:build/);
  assert.doesNotMatch(contract, /example, `\/build`/);
});

test("packaged cross-skill invocations retain the Claude plugin namespace", () => {
  assertPackageExcludes([
    [/(^|[\s`(])\/(?:build|brainstorm|blue-team|red-team|fixer-team|verify|run|bug-validation-and-regression)(?=[\s`),.]|$)/m, "unnamespaced cross-skill invocation"]
  ]);
  assert.match(readFileSync(join(packaged, "build", "SKILL.md"), "utf8"), /\/basics:red-team/);
});
