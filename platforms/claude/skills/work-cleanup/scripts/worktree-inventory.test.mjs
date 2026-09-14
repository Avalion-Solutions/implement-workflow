import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { classifyWorktree, discoverNoteHints, inventory, parseWorktrees } from "./worktree-inventory.mjs";

test("note paths are hints and registered paths are omitted", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "worktree-notes-")); t.after(() => rm(root, { recursive: true, force: true }));
  const notes = join(root, "notes"); const existing = join(root, "existing worktree"); const registered = join(root, "registered");
  mkdirSync(notes); mkdirSync(existing); writeFileSync(join(notes, "candidates.md"), `- \`${existing}\`\n- \`${registered}\`\n- \`/missing/worktree\`\n`);
  const hints = discoverNoteHints(notes, new Set([registered]), () => "/repo");
  assert.deepEqual(new Set(hints.map((hint) => hint.path)), new Set([existing, "/missing/worktree"]));
  assert.equal(hints.find((hint) => hint.path === existing).exists, true); assert.equal(hints.find((hint) => hint.path === "/missing/worktree").exists, false);
});
test("missing note registry is empty", () => assert.deepEqual(discoverNoteHints("/definitely/missing/notes", new Set()), []));
test("parses detached, locked, and prunable worktree flags", () => {
  const [entry] = parseWorktrees("worktree /repo/wt\nHEAD abcdef\ndetached\nlocked reason\nprunable reason");
  assert.deepEqual(entry, { path: "/repo/wt", head: "abcdef", branch: "", locked: true, detached: true, prunable: true });
});
test("classifies protected, stale, dirty, detached, and merged worktrees safely", () => {
  const base = { path: "/repo/wt", head: "abc", branch: "topic", locked: false, detached: false, prunable: false };
  assert.equal(classifyWorktree({ ...base, branch: "devel" }, { current: "/repo", status: "clean", merge: "merged" }).action, "keep / protected branch");
  assert.equal(classifyWorktree({ ...base, prunable: true }, { current: "/repo", status: "clean", merge: "merged" }).action, "candidate: prune stale registration");
  assert.equal(classifyWorktree({ ...base, detached: true }, { current: "/repo", status: "clean", merge: "merged" }).action, "keep / needs investigation");
  assert.equal(classifyWorktree(base, { current: "/repo", status: "dirty", merge: "merged" }).action, "keep / needs investigation");
  assert.equal(classifyWorktree(base, { current: "/repo", status: "clean", merge: "merged" }).action, "candidate: remove worktree");
});
test("inventory includes local branches that are not checked out", () => {
  const outputs = new Map([
    ["worktree list --porcelain", "worktree /repo\nHEAD abc\nbranch refs/heads/devel"], ["rev-parse --show-toplevel", "/repo"],
    ["-C /repo status --porcelain", ""], ["for-each-ref --format=%(refname:short) refs/heads", "devel\ntopic"],
    ["merge-base --is-ancestor devel devel", ""], ["merge-base --is-ancestor topic devel", ""],
  ]);
  const git = (...args) => ({ ok: outputs.has(args.join(" ")), output: outputs.get(args.join(" ")) ?? "" });
  const result = inventory({ base: "devel", notesDir: "/missing", git });
  const topic = result.rows.find((row) => row.ref === "topic");
  assert.equal(topic.action, "candidate: delete branch"); assert.equal(topic.approval, "yes for deletion");
});
