---
name: debugging-evidence-capture
description: Capture minimal reproductions, probes, failure evidence, and recovery state to guide the next debugging step.
---

# Debugging Evidence Capture

Use this skill when the main problem is not yet enough evidence.

## Workflow

1. Record the symptom, command or action, observed output, and expected behavior.
2. Choose whether the next artifact should be a minimal repro, observability capture, file-backed probe, or recovery loop.
3. Keep probes small and reversible.
4. Preserve raw evidence before summarizing it.
5. End with the next falsifiable hypothesis or validation step.

## Reference Selection

- For minimal reproduction design, read `references/minimal-repro-design.md`.
- For logging, traces, screenshots, or probe capture, read `references/observability-capture.md`.
- For temporary file-backed probes with stable bug IDs, read `references/file-backed-debug-probe.md`.
- For failed tools, commands, tests, or validation loops, read `references/error-recovery-loop.md`.
## Scripts

- Use `scripts/new_debug_cycle.js <topic> [log-dir]` to create a stable bug ID and initialize a log file. Without an explicit `log-dir`, it writes beneath `BASICS_TEMP_ROOT/agent-workflows/debug/<topic>/` (or the platform fallback).
