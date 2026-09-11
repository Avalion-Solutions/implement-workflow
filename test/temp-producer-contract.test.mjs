import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = join(repositoryRoot, ".agents", "skills");
const producerExtensions = new Set([".js", ".mjs", ".sh"]);
const prohibitedTemporaryDefaults = /\btmpdir\s*\(|\bTMPDIR\b|\bBASICS_WORKTREE_ROOT\b|\/(?:var\/)?tmp(?:\/|["'`])/;

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

test("every current temporary-work producer invokes the shared resolver", () => {
  const producers = [
    ".agents/skills/build/scripts/worktree-root.mjs",
    ".agents/skills/bug-list-generator/scripts/create_readonly_snapshot.sh",
    ".agents/skills/debugging-evidence-capture/scripts/new_debug_cycle.js",
    ".agents/skills/expo-run/scripts/expo-go-launch.mjs",
    ".agents/skills/red-team/scripts/create_readonly_snapshot.sh",
  ];
  for (const producer of producers) {
    assert.match(readFileSync(join(repositoryRoot, producer), "utf8"), /shared\/temp-location/, producer);
  }
});
