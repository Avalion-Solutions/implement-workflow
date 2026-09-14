---
name: skill-check
description: Validate a Claude Code skill's structure, resource integrity, and design quality. Use when reviewing, linting, improving, or preparing a skill for use, especially for workflow clarity, progressive disclosure, deterministic scripts, and stale or broken resources.
---

# Skill Check

Run the bundled check against the requested skill directory:

```bash
node <loaded-skill-check-root>/scripts/quick-validate.mjs <skill-dir>
node <loaded-skill-check-root>/scripts/check-skill.mjs <skill-dir>
```

Resolve `<loaded-skill-check-root>` to the directory containing this `SKILL.md`; do not substitute another globally installed `skill-check` copy. The bundled checker understands suite-level sibling links such as `../build/SKILL.md` while still rejecting arbitrary directory escapes.

For a portable canonical suite, run the bundled checker without `--strict`: host-specific UI metadata may be injected only during packaging. Do not report canonical missing-UI-metadata warnings as package defects.

## Review

Separate hard errors from design warnings. Then inspect the skill and report whether:

1. The name and description are concise and state clear triggering situations.
2. The body provides a clear task workflow or task-oriented structure.
3. Conditional or variant-specific detail is kept concise and routed to `references/` when substantial.
4. Repeatable, deterministic operations live in `scripts/` rather than long inline code blocks.
5. Every bundled resource is necessary, referenced, and complete.
6. The instructions are actionable, internally consistent, and avoid stale placeholders.

Do not edit the reviewed skill unless the user requests fixes. Return a compact table of errors, warnings, design assessment, and recommended next actions.
