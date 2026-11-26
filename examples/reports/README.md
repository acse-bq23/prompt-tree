# Interactive example reports

The online links open the repository’s HTML files in LiveCodes. In either report, choose two versions under **Prompt comparison** (中文「Prompt 对比」). Each report contains the prompts, recorded predictions, and scores from a real model run.

| Experiment | Open online | Offline HTML |
| --- | --- | --- |
| Restaurant8K · booking-field extraction | [English][restaurant-en] / [中文][restaurant-zh] | [English](restaurant8k.en.html) / [中文](restaurant8k.html) |
| Banking77 · intent classification | [English][banking-en] / [中文][banking-zh] | [English](banking77.en.html) / [中文](banking77.html) |

To view a report offline, open its HTML file from a clone. On a GitHub file page, choose **Download raw file**, then open the saved file in your browser. To generate a new report with a local mock model, run `npm run demo` from the repository root. [Synthetic ticket routing](../label-routing/README.md)

## What to compare

- **Restaurant8K.** Select `L6-N1` on the left and `L6-N2` on the right. The right version led in screening (326/360 vs. 323/360). The left won on mean accuracy over five fresh validation runs (90.61% vs. 89.50%). On the held-out test, the means were 91.06% and 91.22%, inside the preset one-percentage-point margin. Keep the left version and switch the right to the original (`L1-N1`) to see the baseline in the same table. The comparison with the screening leader includes follow-up testing after selection.
- **Banking77.** Select the parent `L2-N2` on the left and its child `L3-N4` on the right. Round 5 revisited the parent. The child fixed four validation cases and broke nine. This experiment used single-run validation. The baseline scored 177/231, and `L2-N3` and `L6-N1` both scored 183/231. The earlier `L2-N3` won the preset tie-break.

## Data credits

Both snapshots contain sampled dataset excerpts and annotations from [PolyAI's task-specific datasets, revision 57ec275](https://github.com/PolyAI-LDN/task-specific-datasets/tree/57ec275d8078af65b7731c2a98be812d844a6d6b). The data is licensed under [CC BY 4.0](DATA-LICENSE). Prompt Tree added sampling, task formatting, prompts, model predictions and evaluation results.

- **Banking77.** Iñigo Casanueva, Tadas Temčinas, Daniela Gerz, Matthew Henderson and Ivan Vulić. The report uses 154 search and 231 validation examples for 77-way intent classification. [Efficient Intent Detection with Dual Sentence Encoders](https://arxiv.org/abs/2003.04807)
- **Restaurant8K.** Samuel Coope, Tyler Farghly, Daniela Gerz, Matthew Henderson and Ivan Vulić. The derived task requests one verbatim booking field per utterance and scores an exact span match, including the missing-field answer. Search, validation and independent test each use 360 distinct utterances, balanced across five target fields. [Span-ConveRT dataset and paper citation](https://github.com/PolyAI-LDN/task-specific-datasets/tree/57ec275d8078af65b7731c2a98be812d844a6d6b#span-extraction)

[restaurant-en]: https://livecodes.io/?mode=result&x=https://github.com/acse-bq23/prompt-tree/blob/main/examples/reports/restaurant8k.en.html
[restaurant-zh]: https://livecodes.io/?mode=result&x=https://github.com/acse-bq23/prompt-tree/blob/main/examples/reports/restaurant8k.html
[banking-en]: https://livecodes.io/?mode=result&x=https://github.com/acse-bq23/prompt-tree/blob/main/examples/reports/banking77.en.html
[banking-zh]: https://livecodes.io/?mode=result&x=https://github.com/acse-bq23/prompt-tree/blob/main/examples/reports/banking77.html
