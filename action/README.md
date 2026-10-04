# aiagentflow GitHub Action

Review pull requests with the aiagentflow reviewer and security agents, or run a workflow in CI.

## Review pull requests

```yaml
name: AI review
on: pull_request

permissions:
  contents: read
  pull-requests: write   # to post the inline review

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: aiagentflow/aiagentflow/action@v2
        with:
          fail-on: high      # fail the check on high or critical findings
          max-cost: "2"      # USD budget per run
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

Findings on lines inside the diff become inline comments; the full report goes to the job summary. On `push` events the action reviews the pushed commits instead and does not comment; check out with `fetch-depth: 0` so the previous commit is available.

## Implement an issue when it is labelled

```yaml
name: AI implement
on:
  issues:
    types: [labeled]

permissions:
  contents: write
  pull-requests: write
  issues: read

jobs:
  implement:
    if: github.event.label.name == 'aiagentflow'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: aiagentflow/aiagentflow/action@v2
        with:
          command: run
          task: |
            ${{ github.event.issue.title }}

            ${{ github.event.issue.body }}
          max-cost: "5"
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      # Open a PR with the changes, e.g. with peter-evans/create-pull-request
```

`command: run` is headless: commands that need approval are denied, except your configured test, lint, and format commands and anything in `permissions.allow`. The NDJSON event log path is available as the `events` output.

## Inputs

| Input | Default | |
|---|---|---|
| `command` | `review` | `review` or `run` |
| `task` | | Task for `run` |
| `workflow` | | Workflow name (`run` default: `standard`; review default: reviewer + security) |
| `fail-on` | `high` | Review: fail at or above `critical`, `high`, `medium`, `low`, `nit`, or `never` |
| `comment` | `true` | Review: post an inline PR review |
| `provider` | `anthropic` | Used only when the repo has no `.aiagentflow/config.json` |
| `model` | provider default | Used only when the repo has no `.aiagentflow/config.json` |
| `max-cost` | | USD budget (exit code 3 when exceeded) |
| `max-time` | | Minutes (exit code 3 when exceeded) |
| `cli-version` | `latest` | `@aiagentflow/cli` version, or `local` for an `aiagentflow` already on `PATH` |
| `working-directory` | `.` | |

## API keys

Set the provider's key as a secret and pass it as an environment variable: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY` (or `GOOGLE_API_KEY`), or `OPENROUTER_API_KEY`. Keys in the environment fill any provider in `.aiagentflow/config.json` that has no `apiKey`, so you can commit the config without secrets.
