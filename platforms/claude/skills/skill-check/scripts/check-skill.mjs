#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const allowed = new Set(["name", "description", "license", "allowed-tools", "metadata"]);
const resourceDirs = ["scripts", "references", "assets"];

function scalar(raw) {
  const value = raw.trim();
  if (!value) return {};
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === "true";
  if (/^(null|~)$/i.test(value)) return null;
  return value.replace(/\s+#.*$/, "");
}

// Skill metadata uses mappings and scalar values. Unsupported YAML constructs
// are rejected so the checker never silently misreads metadata.
export function parseMetadataYaml(source) {
  const root = {};
  const stack = [{ indent: -1, value: root }];
  for (const [offset, raw] of source.split(/\r?\n/).entries()) {
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    const prefix = raw.match(/^\s*/)?.[0] ?? "";
    if (prefix.includes("\t")) throw new Error(`tabs are not valid indentation on line ${offset + 1}`);
    const indent = prefix.length;
    const match = raw.trim().match(/^([A-Za-z0-9_-]+):(?:\s+(.*))?$/);
    if (!match) throw new Error(`unsupported or malformed YAML on line ${offset + 1}`);
    while (stack.at(-1).indent >= indent) stack.pop();
    if (!stack.length) throw new Error(`invalid indentation on line ${offset + 1}`);
    const parent = stack.at(-1).value;
    if (Object.hasOwn(parent, match[1])) throw new Error(`duplicate key '${match[1]}' on line ${offset + 1}`);
    const value = match[2] === undefined ? {} : scalar(match[2]);
    parent[match[1]] = value;
    if (value && typeof value === "object") stack.push({ indent, value });
  }
  return root;
}

function allFiles(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? allFiles(join(path, entry.name)) : entry.isFile() ? [join(path, entry.name)] : []);
}

export function checkSkill(input, { metadataName = "host-ui-metadata.yaml" } = {}) {
  const root = resolve(input);
  const findings = [];
  const add = (level, rule, message) => findings.push({ level, rule, message });
  const skillMd = join(root, "SKILL.md");
  if (!existsSync(root) || !statSync(root).isDirectory()) { add("error", "skill-directory", "Skill directory does not exist."); return findings; }
  if (!existsSync(skillMd) || !statSync(skillMd).isFile()) { add("error", "skill-md", "SKILL.md is missing."); return findings; }

  const content = readFileSync(skillMd, "utf8");
  const match = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  let body = content;
  let frontmatter = {};
  if (!match) add("error", "frontmatter", "Missing or invalid YAML frontmatter.");
  else {
    body = content.slice(match[0].length);
    try {
      frontmatter = parseMetadataYaml(match[1]);
      const unknown = Object.keys(frontmatter).filter((key) => !allowed.has(key)).sort();
      if (unknown.length) add("error", "frontmatter-keys", `Unsupported frontmatter keys: ${unknown.join(", ")}.`);
      const name = frontmatter.name;
      if (typeof name !== "string" || !name.trim()) add("error", "name", "A non-empty skill name is required.");
      else { if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name.trim())) add("error", "name-format", "Name must use lowercase hyphen-case."); if (name.trim().length > 64) add("error", "name-length", "Name exceeds 64 characters."); }
      const description = frontmatter.description;
      if (typeof description !== "string" || !description.trim()) add("error", "description", "A non-empty description is required.");
      else if (description.trim().length > 300) add("warning", "description-length", "Description exceeds the recommended 300 characters; make trigger guidance more concise.");
    } catch (error) { add("error", "frontmatter-yaml", `Invalid YAML: ${error.message}`); }
  }

  const lines = body.split(/\r?\n/);
  if (!body.trim()) add("error", "body", "Skill instructions are empty.");
  else {
    if (lines.length > 500) add("error", "body-length", "Instructions exceed 500 lines; split optional detail into references.");
    if (/\b(?:TODO|TBD|FIXME)\b/i.test(body)) add("error", "stale-placeholder", "Instructions contain TODO, TBD, or FIXME placeholders.");
    if (!/^##\s+\S+/m.test(body)) add("warning", "sectioning", "Use level-two headings to make the workflow scannable.");
    if (lines.length > 80 && !/^\s*\d+\.\s+/m.test(body) && [...body.matchAll(/^##\s+/gm)].length < 2) add("warning", "workflow-clarity", "Long instructions have no visible step sequence or task-oriented sections.");
    const conditionalCount = lines.filter((line) => /\b(if|when|unless|otherwise|case|depending on)\b/i.test(line)).length;
    if (conditionalCount >= 10 && !existsSync(join(root, "references"))) add("warning", "progressive-disclosure", `Found ${conditionalCount} conditional-instruction lines without a references directory; move substantial variants out of SKILL.md.`);
    for (const block of body.matchAll(/```([^\n]*)\n([\s\S]*?)```/g)) {
      const executable = ["bash", "sh", "zsh", "python", "javascript", "js", "typescript", "ts", "powershell"].includes(block[1].trim().toLowerCase());
      if (executable && block[2].trim().split(/\r?\n/).length >= 12 && /^\s*(?:for|while|if|def|function)\b/m.test(block[2]) && !existsSync(join(root, "scripts"))) { add("warning", "deterministic-script", "Long executable control-flow block has no scripts directory; move repeatable deterministic logic into a script."); break; }
    }
  }

  for (const name of resourceDirs) {
    const path = join(root, name);
    if (existsSync(path) && !statSync(path).isDirectory()) add("error", "resource-type", `${name} exists but is not a directory.`);
    else if (existsSync(path)) { const files = allFiles(path); if (!files.length) add("warning", "empty-resource", `${name}/ is empty; remove it or add the intended resource.`); else if (!body.includes(`${name}/`)) add("warning", "unreferenced-resource", `${name}/ contains files but SKILL.md does not reference that directory.`); }
  }

  const candidates = [...body.matchAll(/\[[^\]]+\]\(([^)]+)\)/g), ...body.matchAll(/(?<![\w/])((?:scripts|references|assets)\/[A-Za-z0-9_.-]+)/g)].map((item) => item[1]);
  for (const candidate of [...new Set(candidates)].sort()) {
    const target = candidate.split("#", 1)[0].trim();
    if (!target || /^(https?:|mailto:)/.test(target)) continue;
    const destination = resolve(root, target);
    const rel = relative(root, destination);
    const within = rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"));
    const sibling = destination.endsWith("/SKILL.md") && dirname(dirname(destination)) === dirname(root);
    if (!within && !sibling) add("error", "local-reference", `Reference escapes the skill directory: ${candidate}`);
    else if (!existsSync(destination)) add("error", "local-reference", `Referenced local resource is missing: ${candidate}`);
  }

  const metadataPath = join(root, "agents", metadataName);
  if (!existsSync(metadataPath)) add("warning", "ui-metadata", `agents/${metadataName} is absent; create it for skill discovery UI.`);
  else try {
    const ui = parseMetadataYaml(readFileSync(metadataPath, "utf8")).interface;
    if (!ui || typeof ui !== "object") add("error", "ui-metadata-shape", `agents/${metadataName} must contain an interface mapping.`);
    else {
      if (typeof ui.display_name !== "string" || !ui.display_name.trim()) add("warning", "display-name", "UI metadata should include a display_name.");
      if (typeof ui.short_description !== "string" || !ui.short_description.trim()) add("warning", "short-description", "UI metadata should include a short_description.");
      else if (ui.short_description.trim().length < 25 || ui.short_description.trim().length > 64) add("warning", "short-description-length", "short_description should be 25–64 characters.");
      const invocations = [`$${frontmatter.name}`, `/basics:${frontmatter.name}`];
      if (typeof ui.default_prompt !== "string" || !invocations.some((value) => ui.default_prompt.includes(value))) add("warning", "default-prompt", "default_prompt should include the explicit skill invocation.");
    }
  } catch (error) { add("error", "ui-metadata-yaml", `Invalid agents/${metadataName}: ${error.message}`); }
  return findings;
}

export function run(argv) {
  const strict = argv.includes("--strict"); const json = argv.includes("--json"); const path = argv.find((arg) => !arg.startsWith("--"));
  if (!path) throw new Error("Usage: node check-skill.mjs <skill-dir> [--strict] [--json]");
  const findings = checkSkill(path);
  if (json) console.log(JSON.stringify(findings, null, 2));
  else if (!findings.length) console.log("PASS: no structural or heuristic design findings.");
  else { console.log("| Level | Rule | Finding |\n| --- | --- | --- |"); findings.forEach((item) => console.log(`| ${item.level.toUpperCase()} | ${item.rule} | ${item.message} |`)); }
  return findings.some((item) => item.level === "error") || (strict && findings.some((item) => item.level === "warning")) ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) { try { process.exitCode = run(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; } }
