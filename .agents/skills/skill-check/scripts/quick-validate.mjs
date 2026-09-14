#!/usr/bin/env node
import { checkSkill } from "./check-skill.mjs";
const findings = checkSkill(process.argv[2] || "").filter((item) => item.level === "error" && !["local-reference"].includes(item.rule));
if (findings.length) { console.error(findings[0].message); process.exitCode = 1; } else console.log("Skill is valid!");
