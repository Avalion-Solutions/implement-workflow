import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { checkSkill, parseMetadataYaml } from "./check-skill.mjs";

async function fixture(t, { name = "build", description = "A useful test skill description.", body = "## Workflow\n\nRun it.\n", metadata = null } = {}) {
  const root = await mkdtemp(join(tmpdir(), "skill-check-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const skill = join(root, "skills", name); mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`);
  if (metadata !== null) { mkdirSync(join(skill, "agents")); writeFileSync(join(skill, "agents", "host-ui-metadata.yaml"), metadata); }
  return { root, skill };
}

test("parses the nested scalar metadata schema", () => assert.deepEqual(parseMetadataYaml("interface:\n  display_name: Build\n  enabled: true\n"), { interface: { display_name: "Build", enabled: true } }));
test("rejects malformed and duplicate YAML instead of silently accepting it", () => {
  assert.throws(() => parseMetadataYaml("name: one\nname: two"), /duplicate key/);
  assert.throws(() => parseMetadataYaml("- list"), /malformed YAML/);
});
test("allows an existing sibling skill entrypoint", async (t) => {
  const { root, skill } = await fixture(t, { body: "## Workflow\n\nRead [target](../brainstorm/SKILL.md).\n" });
  const sibling = join(root, "skills", "brainstorm"); mkdirSync(sibling); writeFileSync(join(sibling, "SKILL.md"), "ok");
  assert.equal(checkSkill(skill).some((item) => item.rule === "local-reference"), false);
});
test("rejects arbitrary escapes and missing sibling entrypoints", async (t) => {
  const escaped = await fixture(t, { body: "## Workflow\n\nRead [target](../../outside.md).\n" });
  writeFileSync(join(escaped.root, "outside.md"), "outside");
  assert.match(checkSkill(escaped.skill).find((item) => item.rule === "local-reference").message, /escapes/);
  const missing = await fixture(t, { body: "## Workflow\n\nRead [target](../missing/SKILL.md).\n" });
  assert.match(checkSkill(missing.skill).find((item) => item.rule === "local-reference").message, /missing/);
});
test("validates discovery metadata fields and invocation", async (t) => {
  const { skill } = await fixture(t, { metadata: "interface:\n  display_name: Build\n  short_description: short\n  default_prompt: Run this skill.\n" });
  const rules = checkSkill(skill).map((item) => item.rule);
  assert.ok(rules.includes("short-description-length")); assert.ok(rules.includes("default-prompt"));
});
test("restores body and resource heuristics", async (t) => {
  const lines = Array.from({ length: 10 }, (_, index) => `When case ${index} applies, continue.`).join("\n");
  const { skill } = await fixture(t, { body: `## Workflow\n\n${lines}\n\nTODO later.\n` });
  mkdirSync(join(skill, "assets"));
  const rules = checkSkill(skill).map((item) => item.rule);
  assert.ok(rules.includes("stale-placeholder")); assert.ok(rules.includes("progressive-disclosure")); assert.ok(rules.includes("empty-resource"));
});
