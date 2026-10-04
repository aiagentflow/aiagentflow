# Evals

`aiagentflow eval` measures a workflow on coding tasks with hidden tests, using your project's providers and models.

```bash
aiagentflow eval                                # standard workflow, shipped suite
aiagentflow eval --workflow fast --max-cost 1   # per-task budget
aiagentflow eval --task py-median-bug js-lru-cache --keep
aiagentflow eval --json --report eval.json --min-pass-rate 0.7
```

Every task runs real model calls and costs tokens. Use `--max-cost`, `--max-tokens`, or `--max-time` to cap each task.

## How a task runs

1. The task's `repo/` is copied to a temporary git repository with your provider and agent settings (headless, in place, no approval prompts).
2. The workflow runs on the task's prompt. Its test steps run the task's visible `test` command.
3. The task's `hidden/` tests are copied in and its `check` command decides pass or fail, whatever the workflow concluded.

The report lists, per task: result, fix iterations, tokens, cost, and time, plus totals and the pass rate. `--report` writes JSON that includes the agent models used.

## The shipped suite

Ten tasks in `evals/tasks/`, five JavaScript (`node --test`) and five Python (`unittest`), no dependencies to install: bug fixes (pagination, median, CSV quoting, slugify), implementations (duration parsing, LRU cache, Roman numerals, word frequency, interval merging), and an API extension (event emitter `once`). A unit test checks that every task's hidden tests fail on the starting code and pass on its reference `solution/`.

## Your own suite

```
my-evals/
  fix-auth-bug/
    task.yml      # id, language, testFramework, prompt, test, check, optional workflow
    repo/         # starting project
    hidden/       # tests the agents never see
    solution/     # optional reference solution
```

```bash
aiagentflow eval ./my-evals
```

## CI

`.github/workflows/evals.yml` runs the suite on demand (Actions → Evals) with the provider and budget you choose, writes the table to the job summary, and uploads the JSON report. It needs the provider's API key as a repository secret.
