# PromptTree

[简体中文](README.md)

PromptTree is a repository-scoped Codex skill for improving prompts with a project's own examples. Codex traces a live prompt to its call site, designs an evaluation, and tests small wording changes. Each branch in the offline report shows the edit against its parent, the failure that motivated it, and the resulting scores.

## Install in a project

Use Codex and Node.js 22 or later. From this repository's root, replace the target path and copy the entire skill, including its scripts and assets.

```sh
mkdir -p /path/to/your-project/.agents/skills
cp -R skills/prompttree /path/to/your-project/.agents/skills/
```

Open Codex in the target project and ask:

> Use $prompttree to find a prompt worth improving and design tests from existing examples. Ask me about unresolved business rules. Once those are settled, run the baseline, compare minimal edits, and generate the prompt tree.

Codex traces the messages sent to the model, checks examples against their expected outcomes, and reuses or writes an evaluation adapter. Existing specifications can settle scoring rules. If a ticket has several labels and the model misses one, for example, Codex may ask whether the ticket fails or gets partial credit. Paid evaluations use the authorized budget.

## How branches work

Each edge tests one hypothesis against its parent and cites a recorded search failure and a confirmed rule. Before evaluation, the CLI checks that the edit touches one editable field, one effective message, and one contiguous line hunk. Codex reviews whether the wording expresses a single change. Independent alternatives become siblings. A refinement can branch from a previous candidate. A tie can keep the baseline. Probe scores are exploratory; independent acceptance testing is a separate step.

Reuse existing search and validation splits or partition an example pool by ticket, conversation, or another independent unit. The intake plan identifies missing expected outcomes or independent examples when a valid comparison cannot yet run.

## Run the offline example

```sh
node examples/label-routing/demo.cjs
```

Six synthetic cases are grouped by ticket. Two wording edits branch from one baseline. Open the printed `report` path to explore them. Each experiment's `output/` contains the HTML report, `evolution.json`, the selected prompt, and a summary. The demo makes zero external model calls.

## Development

The toolkit uses the Node.js standard library. Discovery uses Git inside repositories and requires ripgrep outside them. Project adapters run in their own runtime environment.

```sh
node skills/prompttree/scripts/prompttree.cjs --help
node skills/prompttree/scripts/prompttree.cjs discover --workspace .
node --test tests/*.test.cjs
```

- [First-project intake](skills/prompttree/references/intake.md) (Chinese)
- [Dataset, evaluator, and result contracts](skills/prompttree/references/contracts.md) (Chinese)
- [Recovery and budgeting](skills/prompttree/references/recovery.md) (Chinese)
- [Synthetic example and scoring rule](examples/label-routing/README.md)
