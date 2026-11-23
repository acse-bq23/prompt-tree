# Contributing to Prompt Tree

Use Node.js 22 or later and Git. The toolkit uses the Node.js standard library, so you can run the checks immediately after cloning. Discovery outside a Git repository also requires ripgrep.

```sh
npm test
npm run demo
```

GitHub Actions runs the same test command. The demo prints a linkable local path to the generated report. For CLI changes, run the affected command from the skill directory or inspect its usage with `node skills/prompttree/scripts/prompttree.cjs --help`.

## Where changes belong

| Location | Contents |
| --- | --- |
| `skills/prompttree/` | The installable unit. Keep everything needed at runtime inside this directory. |
| `skills/prompttree/scripts/` and `lib/` | CLI entry point, intake, experiment storage, evaluation, and report generation. |
| `skills/prompttree/references/` and `assets/` | Workflow contracts, configuration templates, and the offline HTML report template. |
| `examples/label-routing/` | Synthetic inputs, a mock project, scoring rules, and a reproducible demo. |
| `tests/` | CLI and intake tests, including a test that copies the skill into a fresh directory. |

For changes to installation or invocation, update both [the Chinese README](README.md) and [the English README](README.en.md). For an evaluation change, include a reproducible case showing the expected score, parent branch, or budget effect.

## Reporting a bug

Include the Node.js version, the command or Codex request, the expected outcome, and the actual result. A minimal synthetic case is enough to reproduce most scoring and branch-history issues. [Repository issues](https://github.com/acse-bq23/prompt-tree/issues)
