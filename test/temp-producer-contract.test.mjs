import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = join(repositoryRoot, ".agents", "skills");
const producerExtensions = new Set([".js", ".mjs", ".sh"]);
const prohibitedTemporaryDefaults = /\bTMPDIR\b|\bBASICS_WORKTREE_ROOT\b|\/(?:var\/)?tmp(?:\/|["'`])/;

function activeProducerScripts(directory = skillsRoot) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return activeProducerScripts(path);
    if (!entry.isFile() || entry.name.includes(".test.") || !producerExtensions.has(entry.name.slice(entry.name.lastIndexOf(".")))) return [];
    return [path];
  });
}

test("active Basics producer scripts cannot bypass the shared temporary-location resolver", () => {
  const offenders = activeProducerScripts()
    .filter((path) => prohibitedTemporaryDefaults.test(readFileSync(path, "utf8")))
    .map((path) => relative(repositoryRoot, path));
  assert.deepEqual(offenders, []);
});

test("every current temporary-work producer resolves BASICS_TEMP_ROOT or the portable copied-launcher fallback", () => {
  const sharedResolverProducers = [
    ".agents/skills/build/scripts/worktree-root.mjs",
    ".agents/skills/bug-list-generator/scripts/create_readonly_snapshot.sh",
    ".agents/skills/debugging-evidence-capture/scripts/new_debug_cycle.js",
    ".agents/skills/red-team/scripts/create_readonly_snapshot.sh",
  ];
  for (const producer of sharedResolverProducers) {
    assert.match(readFileSync(join(repositoryRoot, producer), "utf8"), /shared\/temp-location/, producer);
  }
  const copiedExpoLauncher = readFileSync(join(repositoryRoot, ".agents/skills/expo-run/scripts/expo-go-launch.mjs"), "utf8");
  assert.doesNotMatch(copiedExpoLauncher, /writeFile|mkdtemp|mkdir/);
});
