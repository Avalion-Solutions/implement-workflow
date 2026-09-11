#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const coreSkills = join(repoRoot, ".agents", "skills");
const coreShared = join(repoRoot, ".agents", "shared");
const adapterRoot = join(repoRoot, "platforms", "codex");
const packageRoot = join(repoRoot, "plugins", "basics");
const packageSkills = join(packageRoot, "skills");
const packageShared = join(packageRoot, "shared");
const checkOnly = process.argv.includes("--check");
const refresh = process.argv.includes("--refresh");

function files(root, base = root) {
  const result = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && (entry.name === "node_modules" || entry.name === "__pycache__")) continue;
    const absolute = join(root, entry.name);
    if (entry.isDirectory()) result.push(...files(absolute, base));
    else if (entry.isFile()) result.push(relative(base, absolute));
  }
  return result.sort();
}

function sameTree(source, destination) {
  if (!existsSync(destination)) return false;
  const sourceFiles = files(source);
  return sourceFiles.every((file) => existsSync(join(destination, file))
    && readFileSync(join(source, file), "utf8") === readFileSync(join(destination, file), "utf8"));
}

function copyFile(source, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, readFileSync(source));
}

function sameFile(source, destination) {
  return existsSync(destination) && readFileSync(source, "utf8") === readFileSync(destination, "utf8");
}

function adapterMatchesPackage() {
  const filesToCheck = [
    [join(adapterRoot, "plugin.json"), join(packageRoot, ".codex-plugin", "plugin.json")],
    [join(adapterRoot, "hooks", "hooks.json"), join(packageRoot, "hooks", "hooks.json")],
    [join(adapterRoot, "scripts", "install-plugin.mjs"), join(packageRoot, "scripts", "install-plugin.mjs")],
    [join(adapterRoot, "scripts", "install-plugin.test.mjs"), join(packageRoot, "scripts", "install-plugin.test.mjs")],
  ];
  for (const skill of readdirSync(join(adapterRoot, "metadata"))) {
    const source = join(adapterRoot, "metadata", skill, "openai.yaml");
    if (existsSync(source)) filesToCheck.push([source, join(packageSkills, skill, "agents", "openai.yaml")]);
  }
  return filesToCheck.every(([source, destination]) => sameFile(source, destination));
}

if (!existsSync(coreSkills) || !existsSync(coreShared)) throw new Error("canonical skills or shared resources are missing");
if (checkOnly) {
  if (!sameTree(coreSkills, packageSkills) || !sameTree(coreShared, packageShared) || !adapterMatchesPackage()) {
    throw new Error("Codex package drift from .agents/skills or platforms/codex; run scripts/sync-codex-basics.mjs");
  }
  process.stdout.write("Codex Basics package matches the canonical skills.\n");
  process.exit(0);
}
if (existsSync(packageSkills) && !refresh) throw new Error(`refusing to overwrite ${packageSkills}; rerun with --refresh to update the generated package in place`);

mkdirSync(packageRoot, { recursive: true });
cpSync(coreSkills, packageSkills, { recursive: true });
cpSync(coreShared, packageShared, { recursive: true });
for (const skill of readdirSync(join(adapterRoot, "metadata"))) {
  const source = join(adapterRoot, "metadata", skill);
  if (statSync(source).isDirectory()) cpSync(source, join(packageSkills, skill, "agents"), { recursive: true });
}
copyFile(join(adapterRoot, "plugin.json"), join(packageRoot, ".codex-plugin", "plugin.json"));
copyFile(join(adapterRoot, "hooks", "hooks.json"), join(packageRoot, "hooks", "hooks.json"));
copyFile(join(adapterRoot, "scripts", "install-plugin.mjs"), join(packageRoot, "scripts", "install-plugin.mjs"));
copyFile(join(adapterRoot, "scripts", "install-plugin.test.mjs"), join(packageRoot, "scripts", "install-plugin.test.mjs"));
process.stdout.write(`Created ${packageRoot} from .agents/skills.\n`);
