# Prompt Tree

[简体中文](README.md) · [Run the example](#see-a-tree) · [Contributing](CONTRIBUTING.md)

Use your project's own examples to decide which prompt edit to keep. This Codex skill traces the messages your application sends to its model, runs a baseline, and tests each hypothesis on a separate branch. Open a node in the offline report to see the wording change, the failure that motivated it, and the validation score.

## See a tree

A ticket can have several labels. These three wordings were evaluated on the same synthetic tickets. The score counts validation tickets whose predicted labels exactly match the expected set.

```text
Baseline  “a matching label”             1/2
├──       “a specific matching label”    1/2
└──       “all matching labels”          2/2
```

From the repository root, run the demo and open the HTML file at the printed `report` path to inspect the tree and its diffs. The example uses a local mock and needs no API key. [Example and scoring rule](examples/label-routing/README.md)

```sh
npm run demo
```

## Install in a project

You need Codex and Node.js 22 or later. Clone this private repository and copy the complete skill into the target project. Replace `/path/to/your-project` with its path.

```sh
git clone https://github.com/acse-bq23/prompt-tree.git
cd prompt-tree
mkdir -p /path/to/your-project/.agents/skills
cp -R skills/prompttree /path/to/your-project/.agents/skills/
```

Open Codex in that project and ask:

> Use $prompttree to find a prompt worth improving and design tests from existing examples. Ask me about unresolved business rules. Once they're settled, compare minimal edits and generate the prompt tree.

## How it chooses a version

1. **Identify the prompt and scoring rule.** Codex follows the application call, checks examples and expected outcomes, and reuses or writes an evaluator. If the specification leaves partial credit undefined for a missing label, for example, it asks you to decide. Paid evaluations use the authorized budget.
2. **Establish a baseline.** Reuse existing search and validation splits, or partition examples by independent units such as tickets or conversations. The intake plan identifies missing expected outcomes or independent samples.
3. **Compare one edit at a time.** Each edge cites a parent search failure and a confirmed rule. Before evaluation, the CLI checks that the edit touches one editable field, one message, and one contiguous line hunk. A tie can keep the baseline. The report records exploratory results. Formal acceptance requires independent testing.

## Find your way around

| Task | Start here |
| --- | --- |
| Understand the first run in a new project | [Project intake](skills/prompttree/references/intake.md) (Chinese) |
| Connect an evaluator, examples, and scoring rules | [Configuration and results](skills/prompttree/references/contracts.md) (Chinese) |
| Check budgets or resume a run | [Recovery and budgets](skills/prompttree/references/recovery.md) (Chinese) |
| Change the code, run tests, or report a bug | [Contributing](CONTRIBUTING.md) |
