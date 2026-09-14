---
name: brainstorm
description: Turn an ambiguous product, design, or engineering request into an assumption-checked implementation plan.
---

# Brainstorm

Create a decision-ready plan without implementing the requested work. Treat the prompt and supplied sources as evidence, not permission to invent product choices.

## Team

Use this fixed role structure:

| --- | --- | --- | --- |

Use two workers for a bounded request and three for cross-cutting or high-risk work. Start every worker with `fresh-context isolation: "none"`; pass only the request, source paths, lens, and output contract. Workers return a compact table and never patches, mutations, or user questions. Keep one host slot for the orchestrator; when capacity is tight, run workers sequentially rather than reducing the role count.

When invoked by `/basics:build`, first read [references/orchestration-contract.md](references/orchestration-contract.md). Use its manifest paths, budget warnings, fresh-context receipt, model fallback, and status rules. Otherwise do not create Build telemetry or artifacts.

## Behavior-preservation support

When the request changes an existing product surface, invoke
[/basics:audit-regression-readiness](../audit-regression-readiness/SKILL.md)
to identify observable behavior that lacks adequate protection. When a
behavioral contract must be captured before change, invoke
[/basics:capture-behavioral-baseline](../capture-behavioral-baseline/SKILL.md)
and carry its explicit invariants into the plan. These skills are conditional:
do not manufacture a baseline or regression audit for wholly new, isolated
work with no existing behavior to preserve.

## Workflow

1. **Frame.** Extract outcome, users, constraints, deliverables, evidence, and unknowns. Inspect only in-scope sources; do not browse, install, test, branch, or mutate merely to brainstorm.
2. **Ledger.** Give every material assumption an ID, type (`fact`, `constraint`, `implementation`, `product`, `design`, `personalization`, `risk`, or `scope`), evidence, owner, and disposition.
3. **Independent lenses.** Cover product/journey, engineering/operations, and adversarial constraints as appropriate. Workers return: candidate, evidence/inference, consequence if wrong, confidence, owner, and minimal resolution.
4. **Reconcile.** Deduplicate and resolve from explicit requirements, source facts, or reversible conventions. Escalate only consequential non-derivable choices: product intent, personalization/design, binding risk, scope, budget, or timeline.
5. **Ask.** Use the question tool for every unresolved user-owned decision, at most three per call, with a recommendation and real options. If unavailable, ask the same bounded questions in chat and stop. Never silently choose a subjective preference.
6. **Authorization preflight.** Before declaring the plan ready, inventory operations and host escalations. For a concrete implementation request, default to `bounded-unattended` and classify ordinary scoped edits, tests, local branches, and local commits as `authority: task`; the task request already authorizes them. Classify only irreversible/destructive actions, protected-branch history changes or merges, and external publication as `authority: explicit`. Ask once only if the plan contains an explicit operation or a consequential user-owned choice is unstated. For unattended work, use read-only discovery to enumerate likely failure signatures and exact fallback commands, set retry/cost/resource limits and stop conditions, and identify sandbox/network capabilities that must be granted while the user is present. Materialize exact values before an explicit approval when possible. When a later value is inherently unknowable but deterministically derivable, authorize its input, derivation procedure, validation invariants, action template, targets, and consequence instead of forcing a second prompt.
7. **Plan.** Require every material ledger item to be resolved, explicitly deferred, or evidenced irrelevant. Give each decision, criterion, risk, and authorization a stable ID. Every implementation step names a target or discovery command, dependency, observable acceptance, and verification. Under Build, write the complete authorization inventory to `<status-dir>/handoffs/authorizations.json` using the shared contract. A late-discovered action outside the task-authorized or explicitly approved envelope is a preflight defect and returns to planning; a listed recovery or validated deterministic derivation continues unattended without changing the manifest.

## Handoff

Return concise Markdown with: Outcome, Resolved Decisions, Assumption Coverage, Scope, Implementation Plan, Risks and Mitigations, Handoff Notes, and Remaining Open Decisions. Keep detailed evidence in artifacts rather than chat.

Under Build, write `docs/build/<run-id>-plan.md`, `<status-dir>/handoffs/plan.json`, and `<status-dir>/handoffs/authorizations.json`. The plan manifest must map decision and criterion IDs to evidence and verification and identify blocking decisions. The authorization manifest must prove that every category in the shared preflight checklist was reviewed, declare its execution mode, list exact bounded operations and unattended recovery/derivation rules, record excluded operations, and contain no unresolved items. Validate it with `build-handoff.mjs validate-authorizations`; return only compact receipts and artifact paths. Do not claim implementation or unattended readiness while a material decision, known authorization, or required host capability is unresolved.
