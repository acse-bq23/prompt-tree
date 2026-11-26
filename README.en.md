<p align="right"><a href="README.md" lang="zh-CN">简体中文</a></p>

<h1 align="center"><img src="skills/prompttree/assets/prompt-tree-mark.png" width="40" height="40" align="top" alt=""> Prompt Tree</h1>

<p align="center"><strong>Change one prompt instruction. Which answers improve, and which break?</strong><br>
A Codex skill that turns failed examples into branches. Compare the edits, scores, and per-case results on your own data.</p>

<div align="center">

[Explore the report][restaurant] · [Run the demo](#run-the-demo)

</div>

## The Restaurant8K experiment

**88.17% → 91.06%** mean accuracy on booking-field extraction, a gain of 2.89 percentage points. The original prompt and the version selected on validation each ran five times on the same 360 held-out test examples.

<div align="center">

[<img src="examples/reports/restaurant8k-growth.en.gif" width="560" alt="Seventeen prompt versions grow into a six-level tree. Click the animation to open the interactive report.">][restaurant]<br>
<sub>17 versions across six levels. [View the static tree (Chinese)](examples/reports/restaurant8k-preview.png)</sub>

</div>

Under **Prompt comparison**, pick the original (`L1-N1`) on the left and the selected version (`L6-N1`) on the right to see each round.

## Run the demo

Classify 12 synthetic support tickets with a local mock model. You need Git and Node.js 22+. You can run the demo without installing packages or setting an API key.

```sh
git clone https://github.com/acse-bq23/prompt-tree.git
cd prompt-tree
npm run demo
```

**Expected result** A ticket passes when all its labels match. The original scores **1/4** on validation and the selected version scores **3/4**. Open the file printed under `report_en` (English) or `report` (Chinese) in your browser.

<details>
<summary>See the edit on the first branch</summary>

Compare the root (`L1-N1`) with its first child (`L2-N1`).

```diff
- Return a matching label.
+ Return all matching labels.
```

The ticket `payment reversed and login blocked` now gets both `billing` and `access`. The original missed the login issue. That edit takes the first child to **2/4** on validation. [Demo data and scoring](examples/label-routing/README.md)

</details>

## Use it in your project

Start with the prompt your application actually calls and examples with expected answers or explicit scoring rules. Codex can reuse an evaluator or build an adapter from rules you confirm. [Example with an existing batch evaluation (Chinese)](examples/after-sales/README.md)

### Install the skill

From the cloned `prompt-tree` directory, set the first line to your project's path.

```sh
project="/path/to/your-project"
mkdir -p "$project/.agents/skills"
cp -R skills/prompttree "$project/.agents/skills/"
```

### Run a baseline in Codex

Open the target project in Codex and start with the original prompt.

> Use $prompttree to evaluate our support-routing prompt. Run one level for the baseline. Check the examples and scoring rules, then estimate the model calls. After the run, show me the baseline score, the main failures, and the budget for exploring two more levels.

<details>
<summary>Explore more versions with the agreed budget</summary>

> Use $prompttree to improve this prompt within the agreed call budget. Explore up to six levels, counting the original as level one. Propose edits from failures on the search split, rerun the finalists on validation, and give me the selected prompt, the experiment summary, and the comparison report.

Validation determines which version to keep. If you have an independent test set, evaluate the locked prompt on those examples and attach the results to the same report.

</details>

For details on splitting data, revisiting branches, and resuming an interrupted run, see the [skill guide (Chinese)](skills/prompttree/SKILL.md).

## Case studies

### Banking77 · What did the new rule break?

**Four cases fixed, nine regressions.** Round five revisited an older branch. The new version scored lower on validation, and the earlier `L2-N3` was ultimately selected. [Compare parent L2-N2 with child L3-N4][banking]

### Restaurant8K · Would you keep the winner of a single run?

**Five validation repeats reversed the screening order.** The right version led in screening. The left averaged **1.11 percentage points** higher on validation and was selected. On the independent test the right led by **0.17 points**, below the preset one-point margin. [Compare L6-N1 (left) with L6-N2 (right)][restaurant]

Both reports work offline. Open the HTML from a clone, or pick a language in the report directory and choose **Download raw file** on GitHub. The English viewer preserves the original prompts, inputs, and experiment notes. [Report downloads and dataset credits](examples/reports/README.md)

## Contributing

If a score or branch selection looks wrong, include an example that reproduces the issue and the expected and actual results. For code changes, see the [contributing guide](CONTRIBUTING.md).

## License

Prompt Tree’s code is available under the [MIT License](LICENSE). Banking77 and Restaurant8K excerpts and annotations in the example reports are licensed under CC BY 4.0.

[restaurant]: https://livecodes.io/?mode=result&x=https://github.com/acse-bq23/prompt-tree/blob/main/examples/reports/restaurant8k.en.html
[banking]: https://livecodes.io/?mode=result&x=https://github.com/acse-bq23/prompt-tree/blob/main/examples/reports/banking77.en.html
