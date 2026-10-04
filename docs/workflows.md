# Workflows

A workflow is a pipeline of steps described in YAML. Run one with `aiagentflow run --workflow <name> "task"`.

## Built-in workflows

| Name | Steps | Use it for |
|---|---|---|
| `standard` (default) | plan → implement → review → security → test → judge, with a fixer loop | Most tasks |
| `fast` | implement → test, with a fixer loop | Small, well-specified changes |
| `review` | review → security, read-only | Checking a change; fails on a negative verdict |
| `security-audit` | audit, read-only | A security pass over the whole repository |

`aiagentflow workflow list` shows them; `aiagentflow workflow show standard` prints one as YAML to copy and adapt.

## Writing your own

Put files in `.aiagentflow/workflows/<name>.yml`. A file named like a built-in replaces it.

```yaml
name: careful
description: Plan with review, implement, test, and judge.
maxIterations: 6            # fix iterations before the run fails (default: workflow.maxIterations)

steps:
  - id: plan
    agent: architect
    approval: true          # pause to approve, edit, or regenerate the plan (interactive runs)

  - id: implement
    agent: coder
    checks: [format, lint]  # lint failure -> onFail
    onFail: fix

  - id: review
    agent: reviewer
    gate: verdict           # request_changes -> onFail
    onFail: fix

  - id: test
    agent: tester
    checks: [test]          # failing tests -> onFail
    onFail: fix

  - id: judge
    agent: judge
    gate: verdict
    onFail: fix

  - id: fix
    agent: fixer
    trigger: on-fail        # only runs when another step routes here
    checks: [format]
    next: review
```

Validate with `aiagentflow workflow validate`.

## Step fields

| Field | |
|---|---|
| `id` | Unique, lowercase with dashes. Used by `onFail` and `next`. |
| `agent` | `architect`, `coder`, `reviewer`, `security`, `tester`, `fixer`, or `judge`. |
| `uses` | A plugin step, `<plugin>/<step>`, instead of `agent` (see [plugins](plugins.md)). |
| `with` | Options for a plugin step. |
| `description` | Shown in `workflow show` and dry runs. |
| `trigger` | `always` (default) or `on-fail`: skipped in normal order, run only when routed to. |
| `checks` | `format` (never fails), `lint`, `test`: run after the agent using `workflow.formatCommand`, `lintCommand`, and `testCommand`. |
| `gate` | `verdict`: a negative verdict from reviewer, security, or judge fails the step. |
| `onFail` | Step to run when a check or gate fails. Each jump uses one fix iteration. Without `onFail`, a failure ends the run as failed. |
| `next` | Step to run after this one succeeds (default: the next `always` step). |
| `approval` | Pause for a human to approve, edit, or regenerate the output. Skipped with `--auto` and `--headless`. |
| `maxTurns` | Max model turns that may call tools in this step. |
| `external` | Run this coder, fixer, or tester step with another agent CLI (below). |

## How a run moves

Each step runs its agent (or plugin step), then its checks, then its gate. A failure jumps to `onFail` and counts one iteration; reaching `maxIterations` fails the run. Success continues to `next`. The run passes when the last step succeeds.

The fixer receives the most recent failure: review issues, security findings, lint errors, or test output.

## Delegating steps to other agents

A coder, fixer, or tester step can run another agent CLI instead of aiagentflow's own agent. aiagentflow still runs the checks and gates, sends failures back to the fixer, and records what changed.

```yaml
steps:
  - id: implement
    agent: coder
    external:
      cli: claude-code            # claude-code | opencode | command
      model: claude-sonnet-5-5    # optional
  - id: review
    agent: reviewer
    gate: verdict
    onFail: fix
  - id: fix
    agent: fixer
    trigger: on-fail
    external:
      cli: command
      args: [codex, exec, --full-auto, "{prompt}"]
    next: review
```

| `external` field | |
|---|---|
| `cli` | `claude-code` runs `claude -p ... --output-format json --permission-mode acceptEdits`; `opencode` runs `opencode run --format json ...`; `command` runs `args` as given with `{prompt}` replaced. |
| `model` | Passed as the CLI's model flag. |
| `args` | Extra arguments (for `command`, the whole command line). |
| `bin` | Path to the CLI if it is not on `PATH`. |
| `timeoutMinutes` | Default 30. |

The external agent works in the run's directory (the worktree, by default). Changed files are detected with git; the diff and any cost the CLI reports (Claude Code does) are stored in the session. The external CLI applies its own permission rules, not aiagentflow's `permissions`.

