---
name: bug-finding-review
description: Review code, designs, or bug reports for likely defects, faulty assumptions, edge cases, and regression risks.
---

# Bug Finding Review

Use this skill to find plausible defects and sharpen debugging hypotheses before changing code.

For AutoHotkey reviews, use the analyzer and built-in-name list under `scripts/` as described in [references/ahk-no-shadow.md](references/ahk-no-shadow.md).

## Workflow

1. State the reviewed behavior, contract, and files or traces under review.
2. Choose the smallest relevant review lenses from `references/`.
3. Report findings by severity with concrete evidence, file or code references, and the failing condition.
4. Convert uncertain findings into falsifiable hypotheses or narrow validation steps.
5. Avoid broad refactors unless the evidence shows the bug is structural.

## Reference Selection

- For static scans, read `references/static-bug-scan.md`.
- For branch, state, and invariant issues, read `references/logic-reviewer.md`.
- For hidden assumptions, read `references/assumption-audit.md`.
- For examples that should break the logic, read `references/counterexample-hunt.md`.
- For reachability and impacted callers, read `references/reachability-analysis.md` and `references/blast-radius-analysis.md`.
- For dependency contracts, read `references/dependency-semantics-check.md`.
- For skeptical second-pass review, read `references/skeptical-review.md`.
- For AutoHotkey shadowing, read `references/ahk-no-shadow.md`.
