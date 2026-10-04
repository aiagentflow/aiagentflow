# Headless runs (CI and scripts)

```bash
aiagentflow run "Fix the flaky date test" --headless --max-cost 2 --max-time 20 --output json
```

## `--headless`

- Never prompts. Implies `--auto` (no approval checkpoints, no plan review).
- `run_command` calls that need approval are **denied**. Commands in `permissions.allow`, plus the configured test, lint, and format commands, still run.
- `resume --headless` recreates a missing worktree instead of asking.

## Budgets

| Flag | Limit |
|---|---|
| `--max-tokens <n>` | Total tokens (input + output) |
| `--max-cost <usd>` | Estimated cost in USD (from the pricing table) |
| `--max-time <minutes>` | Wall-clock time |

The budget is checked before every step and after every model turn, so a long agent loop is stopped mid-step. The run ends as `failed` with `failureKind: "budget"`, the session and report are saved, and the tokens spent so far are counted.

In batch mode (`--batch`), the budget is shared: each task gets what is left, and remaining tasks are skipped once it runs out. A resumed session counts the tokens it had already used.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | The run passed |
| `1` | The workflow failed: a gate or check failed with no recovery left, max iterations, a repeated test failure, or a human abort |
| `2` | Configuration or usage error: no config, unknown or invalid workflow, missing task file, nothing to resume |
| `3` | Budget exceeded (tokens, cost, or time) |
| `4` | Provider error: authentication, network, or rate limits |

For batches, `3` wins if the budget ran out; `4` if every failed task failed on the provider; otherwise `1` if any task failed.

See [events.md](events.md) for `--output json`.
