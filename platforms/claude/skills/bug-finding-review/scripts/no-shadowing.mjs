#!/usr/bin/env node
import { readFileSync, statSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const declaration = /^\s*(?:local|global|static)\s+(.+)$/i;
const forVariable = /^\s*for\s+([^\n]+?)\s+in\b/i;
const catchVariable = /^\s*catch\s+([A-Za-z_][A-Za-z0-9_]*)\b/i;
const functionDeclaration = /^\s*[A-Za-z_#@$][A-Za-z0-9_#@$]*\s*\(([^)]*)\)\s*(?:=>|\{)/;
const identifier = /\b([A-Za-z_][A-Za-z0-9_]*)\b/;

function builtins(directory) {
  return new Set(readFileSync(join(directory, "ahk_builtin_names.txt"), "utf8")
    .split(/\r?\n/).map((line) => line.trim()).filter((name) => name && !name.startsWith("#")).map((name) => name.toLowerCase()));
}

function names(text, parameters = false) {
  return text.split(",").flatMap((part) => {
    let value = part.trim();
    if (parameters) value = value.replace(/\b(?:ByRef|Optional|const)\b/gi, "").trim().replace(/^[*&]+/, "");
    value = value.split(":=", 1)[0].trim();
    const match = value.match(identifier);
    return match ? [match[1]] : [];
  });
}

export function lintText(text, blocked) {
  const issues = [];
  for (const [offset, raw] of text.replace(/^\uFEFF/, "").split(/\r?\n/).entries()) {
    const line = raw.split(";", 1)[0];
    if (!line.trim()) continue;
    const found = line.match(declaration);
    if (found) {
      for (const name of names(found[1])) if (blocked.has(name.toLowerCase())) issues.push([offset + 1, `shadowed name in declaration: ${name}`]);
      continue;
    }
    const loop = line.match(forVariable);
    if (loop) {
      for (const name of names(loop[1])) if (blocked.has(name.toLowerCase())) issues.push([offset + 1, `shadowed name in for-variable: ${name}`]);
      continue;
    }
    const caught = line.match(catchVariable);
    if (caught) {
      if (blocked.has(caught[1].toLowerCase())) issues.push([offset + 1, `shadowed name in catch-variable: ${caught[1]}`]);
      continue;
    }
    const fn = line.match(functionDeclaration);
    if (fn) for (const name of names(fn[1], true)) if (blocked.has(name.toLowerCase())) issues.push([offset + 1, `shadowed name in parameter: ${name}`]);
  }
  return issues;
}

function targets(paths) {
  const results = [];
  const visit = (path) => {
    const info = statSync(path);
    if (info.isFile() && path.toLowerCase().endsWith(".ahk")) results.push(path);
    if (info.isDirectory()) for (const entry of readdirSync(path, { withFileTypes: true })) visit(join(path, entry.name));
  };
  for (const path of paths.length ? paths : [process.cwd()]) visit(resolve(path));
  return results.sort();
}

function main(argv) {
  const blocked = builtins(new URL(".", import.meta.url).pathname);
  const files = targets(argv);
  if (!files.length) { process.stderr.write("no-shadow: no .ahk files found\n"); return 2; }
  let count = 0;
  for (const path of files) {
    for (const [line, message] of lintText(readFileSync(path, "utf8"), blocked)) process.stdout.write(`${path}:${line}: ${message}\n`), count += 1;
  }
  if (count) { process.stderr.write(`no-shadow: found ${count} issue(s)\n`); return 1; }
  process.stdout.write(`no-shadow: clean (${files.length} file(s) checked)\n`);
  return 0;
}

if (process.argv[1] === new URL(import.meta.url).pathname) process.exitCode = main(process.argv.slice(2));
