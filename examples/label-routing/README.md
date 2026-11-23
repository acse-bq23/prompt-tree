# Synthetic ticket routing

This example simulates a support system that labels tickets about payments and login problems. All tickets, rules and model responses were written for this repository. The default prompt asks for one label. Some tickets contain two issues.

## Scoring

A ticket passes when the predicted labels match the full expected set, regardless of order. Missing or extra labels fail the case. The example uses exact-set accuracy and keeps the baseline on ties. Variants of a ticket must stay in the same split. The mock uses no network, paid calls or credentials.

## Run or try a fresh intake

From the repository root, run `node examples/label-routing/demo.cjs`. The demo freezes a grouped split and compares two independent wording changes against the same baseline. Open the printed HTML report.

To try discovery yourself, copy only `route.cjs`, `prompt.json` and `cases.json` into a fresh project and install the skill. Ask Codex to run Prompt Tree using the local mock. If Codex asks how to score a partial match, give it the rule above. The adapter and demo here are a reference implementation for the confirmed rule.
