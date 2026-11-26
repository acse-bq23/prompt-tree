# Measured example reports

Download a report in your preferred language and open it in a browser. Each file includes the recorded prompts, scores and report viewer. Use the selectors under **Prompt comparison** (中文: **Prompt 对比**) to choose a left and right version. For a runnable, deterministic example, run `npm run demo` at the repository root. [Synthetic ticket routing](../label-routing/README.md)

| Offline report | Suggested comparison | What happened |
| --- | --- | --- |
| Banking77 · [English](banking77.en.html) / [中文](banking77.html) | Left L2-N2, right L3-N4 | Round 5 revisited a deferred branch. The child fixed 4 validation cases and regressed on 9. Baseline scored 177/231. L2-N3 and L6-N1 scored 183/231, and the earlier L2-N3 won the preset tie-break. |
| Restaurant8K · [English](restaurant8k.en.html) / [中文](restaurant8k.html) | Left L6-N1, right L6-N2 | Screening favored L6-N2 (326/360 vs 323/360). Mean accuracy over five fresh validation runs favored L6-N1 (90.61% vs 89.50%). On the same 360 held-out test cases over five runs per version, the means were 91.06% and 91.22%. |

Both reports come from real model calls. Banking77 uses the original six-level backtracking experiment's single-run validation criterion. Restaurant8K records the later repeated-validation selection policy with a one-percentage-point margin. Its test results include a post-lock follow-up on the screening leader. Scores describe the sampled splits.

## Data credits

Both snapshots contain sampled dataset excerpts and annotations from [PolyAI's task-specific datasets, revision 57ec275](https://github.com/PolyAI-LDN/task-specific-datasets/tree/57ec275d8078af65b7731c2a98be812d844a6d6b). The data is licensed under [CC BY 4.0](DATA-LICENSE). Prompt Tree added sampling, task formatting, prompts, model predictions and evaluation results.

- **Banking77.** Iñigo Casanueva, Tadas Temčinas, Daniela Gerz, Matthew Henderson and Ivan Vulić. The report uses 154 search and 231 validation examples for 77-way intent classification. [Efficient Intent Detection with Dual Sentence Encoders](https://arxiv.org/abs/2003.04807)
- **Restaurant8K.** Samuel Coope, Tyler Farghly, Daniela Gerz, Matthew Henderson and Ivan Vulić. The derived task requests one verbatim booking field per utterance and scores an exact span match, including the missing-field answer. Search, validation and independent test each use 360 distinct utterances, balanced across five target fields. [Span-ConveRT dataset and paper citation](https://github.com/PolyAI-LDN/task-specific-datasets/tree/57ec275d8078af65b7731c2a98be812d844a6d6b#span-extraction)
