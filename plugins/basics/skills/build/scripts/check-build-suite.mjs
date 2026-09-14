#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const suiteRoot = resolve(process.argv[2] || dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const names = ["build", "brainstorm", "blue-team", "red-team", "fixer-team"];
const limits = { build: 1000, total: 4250 };
const errors = [];
let total = 0;

for (const name of names) {
  const path = join(suiteRoot, name, "SKILL.md");
  if (!existsSync(path)) { errors.push(`Missing ${path}`); continue; }
  const content = readFileSync(path, "utf8");
  const words = content.trim().split(/\s+/).filter(Boolean).length;
  total += words;
  if (name === "build" && words > limits.build) errors.push(`build/SKILL.md has ${words} words (limit ${limits.build})`);
  if (!content.includes('fork_turns: "none"')) errors.push(`${name}/SKILL.md does not enforce fresh-context delegation`);
  if (!content.includes("references/orchestration-contract.md")) errors.push(`${name}/SKILL.md does not link the shared contract`);
  for (const link of content.matchAll(/\[[^\]]+\]\(([^)]+\.md)\)/g)) {
    const target = resolve(dirname(path), link[1]);
    if (!existsSync(target)) errors.push(`${name}/SKILL.md has missing link ${link[1]}`);
  }
}

if (total > limits.total) errors.push(`Combined SKILL.md word count is ${total} (limit ${limits.total})`);
const fixer = readFileSync(join(suiteRoot, "fixer-team", "SKILL.md"), "utf8");
if (/no arbitrary iteration limit/i.test(fixer)) errors.push("Fixer still contains the unbounded-iteration instruction");
const build = readFileSync(join(suiteRoot, "build", "SKILL.md"), "utf8");
if (!build.includes("Invoke `$basics:red-team` once") || !build.includes("At most one scoped Fixer/Judge pass")) errors.push("Build does not enforce the fast single-pass assurance boundary");
if (!build.includes("time-budget") || !build.includes("45 minutes")) errors.push("Build does not enforce the elapsed-time gate");
if (!build.includes("authorizations.json") || !build.includes("authorize-routine") || !build.includes("one consolidated approval")) errors.push("Build does not enforce routine task authorization and consolidated sensitive approval");
if (!build.includes("serve --state-dir <state-dir>") || !build.includes("--runs-dir <state-root>/build-runs")) errors.push("Build does not require dashboard startup before Brainstorm");
for (const term of ["bounded-unattended", "derived values", "sandbox/network grants", "applicable operation IDs", "authority: task", "authority: explicit"]) {
  if (!build.includes(term)) errors.push(`Build does not enforce unattended authorization semantics: ${term}`);
}
const hooksPath = join(suiteRoot, "build", "hooks", "hooks.json");
if (!existsSync(hooksPath)) errors.push("Build is missing hooks/hooks.json");
else {
  try {
    const hookConfig = JSON.parse(readFileSync(hooksPath, "utf8"));
    const requiredEvents = ["SubagentStart", "SubagentStop", "PreToolUse", "PostToolUse", "Stop"];
    for (const event of requiredEvents) if (!Array.isArray(hookConfig.hooks?.[event])) errors.push(`Build hooks are missing ${event}`);
    if (hookConfig.hooks?.UserPromptSubmit) errors.push("Build hooks must not automate approval from UserPromptSubmit");
  } catch (error) {
    errors.push(`Build hooks are invalid JSON: ${error.message}`);
  }
}
if (!fixer.includes("Process the complete eligible set in one Planner/Builder/Adversary/Judge batch")) errors.push("Fixer does not define Build's single batch mode");
const red = readFileSync(join(suiteRoot, "red-team", "SKILL.md"), "utf8");
if (!red.includes("as `deferred`") || !red.includes("Return one `red-1.json`")) errors.push("Red does not define Build's scoped deferral mode");
const contract = readFileSync(join(suiteRoot, "build", "references", "orchestration-contract.md"), "utf8");
if (!contract.includes("reviewedCategories") || !contract.includes("validate-authorizations")) errors.push("Shared contract does not define the authorization manifest");
for (const term of ["bounded-unattended", "maxAttemptsPerOperation", "derivation", "--operations", "authorize-routine", '"authority": "task"', '"authority": "explicit"']) {
  if (!contract.includes(term)) errors.push(`Shared contract does not define unattended authorization semantics: ${term}`);
}
for (const name of names.filter((name) => name !== "build")) {
  const copy = readFileSync(join(suiteRoot, name, "references", "orchestration-contract.md"), "utf8");
  if (copy !== contract) errors.push(`${name} orchestration contract is stale`);
}

const requiredRoutes = {
  build: ["brainstorm", "bug-validation-and-regression", "blue-team", "red-team", "fixer-team", "verify", "feat-commit-no-scope", "audit-regression-readiness", "capture-behavioral-baseline", "run", "bug-finding-review", "debugging-evidence-capture", "hypothesis-formulation", "hypothesis-instrumentation", "hypothesis-evaluation"],
  "red-team": ["bug-finding-review"],
  "fixer-team": ["bug-list-generator", "debugging-evidence-capture", "hypothesis-formulation", "hypothesis-instrumentation", "hypothesis-evaluation", "bug-validation-and-regression"],
};

for (const [owner, routes] of Object.entries(requiredRoutes)) {
  const content = readFileSync(join(suiteRoot, owner, "SKILL.md"), "utf8");
  for (const route of routes) {
    const target = `../${route}/SKILL.md`;
    if (!content.includes(`](${target})`)) errors.push(`${owner}/SKILL.md does not explicitly link ${route}`);
  }
}

if (errors.length) {
  for (const error of errors) process.stderr.write(`ERROR: ${error}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Build suite lint passed: ${total} words across ${names.length} skills.\n`);
}
