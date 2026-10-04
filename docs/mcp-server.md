# aiagentflow as an MCP server

`aiagentflow mcp serve` exposes aiagentflow to other agents as [Model Context Protocol](https://modelcontextprotocol.io) tools over stdio. Another agent can hand a task to aiagentflow's pipeline, or ask it to review changes before committing.

| Tool | |
|---|---|
| `aiagentflow_run` | Run a workflow on a task (headless, budgeted, worktree by default). Arguments: `task`, optional `workflow`, `max_cost_usd`, `inplace`. Returns status, changed files, verdicts, and cost; a failed run is a tool error. |
| `aiagentflow_review` | Review uncommitted changes (or `staged`, or a git `range`) with the reviewer and security agents. Returns the report; a tool error when a finding reaches `fail_on` (default `high`). |
| `aiagentflow_plan` | The architect explores the repository and writes an implementation plan for `request`. Read-only. |
| `aiagentflow_memory` | List saved project knowledge, or read one entry by `name`. |

Runs never prompt: commands that need approval are denied. Each run or review is capped by `--max-cost` (default $5); a tool call can lower the cap, not raise it. When the client sends a progress token, each finished step is reported as progress.

The server works in the directory it is started in, which needs an `.aiagentflow/config.json` (`aiagentflow init`).

## Claude Code

```bash
claude mcp add aiagentflow -- aiagentflow mcp serve --max-cost 3
```

## Other clients

Most clients take a command and arguments:

```json
{
  "mcpServers": {
    "aiagentflow": { "command": "aiagentflow", "args": ["mcp", "serve"] }
  }
}
```

Supported MCP protocol versions: 2025-06-18, 2025-03-26, 2024-11-05.
