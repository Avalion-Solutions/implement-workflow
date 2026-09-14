#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const protectedBranches = new Set(["devel", "main", "master"]);
const defaultGit = (...args) => { try { return { ok: true, output: execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() }; } catch { return { ok: false, output: "" }; } };

export function repositoryOwner(path, git = defaultGit) {
  let probe = path;
  while (!existsSync(probe) && probe !== dirname(probe)) probe = dirname(probe);
  const result = git("-C", probe, "rev-parse", "--show-toplevel");
  return result.ok ? result.output : "unknown";
}

export function discoverNoteHints(notesDir, registered = new Set(), ownerResolver = repositoryOwner) {
  if (!existsSync(notesDir)) return [];
  const hints = new Map();
  for (const file of readdirSync(notesDir).filter((name) => name.endsWith(".md")).sort()) {
    for (const match of readFileSync(resolve(notesDir, file), "utf8").matchAll(/`(\/[^`\r\n]+)`|(?<![\w.-])(\/[^\s`|)]+)/g)) {
      const path = resolve((match[1] || match[2]).replace(/[.,:;\]]+$/, ""));
      if (!registered.has(path) && !hints.has(path)) hints.set(path, { path, note: resolve(notesDir, file), owner: ownerResolver(path), exists: existsSync(path) });
    }
  }
  return [...hints.values()];
}

export function parseWorktrees(output) {
  return output.split("\n\n").filter(Boolean).map((block) => {
    const value = {};
    for (const line of block.split("\n")) { const [key, ...rest] = line.split(" "); value[key] = rest.join(" ") || true; }
    return { path: value.worktree, head: value.HEAD || "", branch: String(value.branch || "").replace("refs/heads/", ""), locked: Boolean(value.locked), detached: Boolean(value.detached), prunable: Boolean(value.prunable) };
  });
}

export function classifyWorktree(entry, { base, current, status, merge }) {
  const states = [status, resolve(entry.path) === current ? "current" : "", entry.locked ? "locked" : "", entry.detached ? "detached" : "", entry.prunable ? "stale registration" : ""].filter(Boolean);
  if (protectedBranches.has(entry.branch)) return { state: states.join(", "), action: "keep / protected branch", approval: "not applicable" };
  if (entry.prunable) return { state: states.join(", "), action: "candidate: prune stale registration", approval: "yes for any removal" };
  if (resolve(entry.path) === current || entry.locked || entry.detached || status !== "clean" || merge === "not merged") return { state: states.join(", "), action: "keep / needs investigation", approval: "yes for any removal" };
  if (merge === "merged") return { state: states.join(", "), action: "candidate: remove worktree", approval: "yes for any removal" };
  return { state: states.join(", "), action: base ? "keep / needs investigation" : "keep / choose base", approval: "yes for any removal" };
}

export function inventory({ base, notesDir = resolve(homedir(), ".claude/notes/work-cleanup"), report = false, git = defaultGit } = {}) {
  const listed = git("worktree", "list", "--porcelain");
  if (!listed.ok) throw new Error("not a Git repository or git worktree list failed");
  const entries = parseWorktrees(listed.output);
  const top = git("rev-parse", "--show-toplevel");
  const current = top.ok ? resolve(top.output) : "";
  const checkedOut = new Set(entries.map((entry) => entry.branch).filter(Boolean));
  const registered = new Set(entries.map((entry) => resolve(entry.path)));
  const mergeState = (branch) => !branch || !base ? "not evaluated" : git("merge-base", "--is-ancestor", branch, base).ok ? "merged" : "not merged";
  const rows = entries.map((entry) => {
    const stateResult = git("-C", entry.path, "status", "--porcelain");
    const status = stateResult.ok ? (stateResult.output ? "dirty" : "clean") : "missing/unreadable";
    const merge = mergeState(entry.branch);
    return { path: entry.path, ref: entry.branch || entry.head.slice(0, 12) || "unknown", merge, ...classifyWorktree(entry, { base, current, status, merge }) };
  });
  const branches = git("for-each-ref", "--format=%(refname:short)", "refs/heads");
  if (branches.ok) for (const branch of branches.output.split("\n").filter(Boolean)) if (!checkedOut.has(branch)) {
    const merge = mergeState(branch);
    const isProtected = protectedBranches.has(branch) || branch === base;
    rows.push({ path: "—", ref: branch, state: "local branch, not checked out", merge, action: isProtected ? "keep / protected branch" : merge === "merged" ? "candidate: delete branch" : "keep / needs investigation", approval: isProtected ? "not applicable" : "yes for deletion" });
  }
  const owner = (path) => repositoryOwner(path, git);
  const hints = discoverNoteHints(notesDir, registered, owner).map((hint) => ({ path: hint.path, ref: "note hint", state: `registry hint, ${hint.exists ? "exists" : "missing"}, owner: ${hint.owner}, source: ${hint.note}`, merge: "not evaluated", action: "needs investigation", approval: "yes for any removal" }));
  return { report, rows: [...rows, ...hints] };
}

export function renderInventory(result) {
  const header = result.report ? "| Worktree/path | Branch or HEAD | Current state | Merge evidence |\n| --- | --- | --- | --- |" : "| Worktree/path | Branch or HEAD | State | Merge evidence | Proposed action | Requires approval |\n| --- | --- | --- | --- | --- | --- |";
  const rows = result.rows.map((row) => result.report ? `| ${row.path} | ${row.ref} | ${row.state} | ${row.merge} |` : `| ${row.path} | ${row.ref} | ${row.state} | ${row.merge} | ${row.action} | ${row.approval} |`);
  return [header, ...rows].join("\n");
}

function valueAfter(args, flag, fallback) { const index = args.indexOf(flag); return index >= 0 && args[index + 1] ? args[index + 1] : fallback; }
export function run(args) { console.log(renderInventory(inventory({ report: args.includes("--report"), base: valueAfter(args, "--base"), notesDir: valueAfter(args, "--notes-dir", resolve(homedir(), ".claude/notes/work-cleanup")) }))); return 0; }

if (process.argv[1] === fileURLToPath(import.meta.url)) { try { process.exitCode = run(process.argv.slice(2)); } catch (error) { console.error(`error: ${error.message}`); process.exitCode = 2; } }
