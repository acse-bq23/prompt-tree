# Synthetic ticket routing

Twelve synthetic tickets are grouped by three independent accounts. The mock model exposes three reproducible failure patterns: a second issue in a ticket, uppercase text, and a password synonym. Each group has examples of all three plus a passing control.

## Scoring

A ticket passes when the full predicted label set matches the expected set regardless of order. Each branch edits one instruction. The demo planner reads only its parent's search failures and proposes one edit per remaining pattern. Ties keep the earlier version. Validation is exploratory.

## Run and resume

Run `npm run demo` at the repository root. The demo submits three layers with 1, 3 and 6 nodes. It waits for each whole batch and prints the selected version's comparison and HTML report. No external model calls are made.

To resume after closing the demo client, run `node examples/label-routing/demo.cjs --resume RUN_DIRECTORY`. To inspect an empty experiment, use `--prepare-only`. The demo's deterministic planner stands in for the analysis Codex performs on real projects. The CLI, background workers, receipts, recovery and report are shared with the installed skill.
