# Editors (Agent Client Protocol)

`aiagentflow acp` runs aiagentflow as an [Agent Client Protocol](https://agentclientprotocol.com) (ACP v1) server, so editors that support ACP can drive your workflows. Editors start the command themselves; you don't run it by hand.

## Zed

Add aiagentflow as a custom agent server in Zed's `settings.json`:

```json
{
  "agent_servers": {
    "aiagentflow": {
      "type": "custom",
      "command": "aiagentflow",
      "args": ["acp"],
      "env": {}
    }
  }
}
```

Open the agent panel, pick aiagentflow, and type a task. Use `"args": ["acp", "--workflow", "fast"]` to choose a workflow. API keys come from `.aiagentflow/config.json` or environment variables (put them in `env`).

The project needs an `.aiagentflow/config.json` (run `aiagentflow init` once in the project).

## What you see

| aiagentflow | In the editor |
|---|---|
| Workflow steps | A plan whose entries turn in progress and completed as steps run; a failed step goes back to pending until the fix runs |
| `read_file`, `grep`, `list_dir` | Tool calls (read, search) |
| `edit_file`, `write_file` | Tool calls with diffs and file locations |
| `run_command` outside your allow list | A permission request: allow once, allow for this run, or deny |
| Reviewer, security, judge verdicts; lint and test results | Agent messages |
| Cancel | The run stops before its next step |

## Differences from the terminal

- Runs edit the project in place (no worktree), so the editor shows the changes as they happen.
- Approval checkpoints and plan review are skipped; command approvals go to the editor instead.
- Cancelling takes effect between steps: a step that is already running finishes first.
