# `aiagentflow review`

Reviews a diff with the reviewer and security agents. Nothing is edited.

```bash
aiagentflow review                      # uncommitted changes (vs HEAD)
aiagentflow review --staged             # staged changes
aiagentflow review --diff main...HEAD   # a git range
aiagentflow review --pr 42 --comment    # a GitHub PR, posting inline comments
```

Both agents get the diff as a reference document and the changed files under "Modified Files", and can read the files for context. Both always run, so the report includes code-quality and security findings.

## Pass or fail

`--fail-on <severity>` (default `high`) sets the bar: the command exits `1` when any finding is at or above it. Severities, most serious first: `critical`, `high`, `medium`, `low`, `nit`. Use `--fail-on never` for an informational review. Budget and provider failures use the usual [exit codes](headless.md#exit-codes).

## PR comments

With `--pr <n> --comment`, findings that point at a line inside the diff become inline comments; the rest are listed in the review body. The review is posted as a plain comment (it never blocks merging on its own). Requires the [GitHub CLI](https://cli.github.com), authenticated.

When reviewing a PR locally, the agents read files from your current checkout. For exact file contents, check the PR out first (`gh pr checkout 42`). In CI the PR is already checked out.

## Options

| Option | |
|---|---|
| `--staged`, `--diff <range>`, `--pr <n>` | What to review (default: uncommitted changes) |
| `--fail-on <severity>` | Exit 1 at or above this severity (default `high`) |
| `--comment` | Post an inline PR review (needs `--pr`) |
| `-w, --workflow <name>` | Use another workflow instead of reviewer + security |
| `--output json` | NDJSON [run events](events.md) on stdout |
| `--max-tokens`, `--max-cost`, `--max-time` | [Budgets](headless.md#budgets) |
