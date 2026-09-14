import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const build = readFileSync(new URL("../.agents/skills/build/SKILL.md", import.meta.url), "utf8");
const routing = readFileSync(new URL("../.agents/skills/build/references/release-routing.md", import.meta.url), "utf8");
const release = readFileSync(new URL("../.agents/skills/fix-release/SKILL.md", import.meta.url), "utf8");

test("Build fails closed when a pending release conflicts with a protected merge", () => {
  assert.match(build, /fail-closed \[release-routing gate\]\(references\/release-routing\.md\)/);
  assert.match(build, /Carry its result through continuations and handoffs/);
  assert.match(routing, /inspect local `release\/\*` branches and\s+registered worktrees/);
  assert.match(routing, /A pending or checked-out release is a routing conflict/);
  assert.match(routing, /Never interpret a generic instruction such as “merge to devel”/);
});

test("fix-release recovers a named existing release without rewriting it", () => {
  assert.match(release, /explicit recovery request naming an existing release branch/);
  assert.match(release, /merge the current verified `devel` candidate into\s+that release with an explicit merge commit/);
  assert.match(release, /instead of recreating, resetting,\n?or rebasing it/);
});
