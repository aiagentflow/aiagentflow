# Changelog

## 2.0.0

v2 turns aiagentflow into a quality-gated pipeline of agents that work through tools. See [MIGRATION.md](MIGRATION.md) to upgrade.

### Agents and providers
- Agents edit files through tools (`read_file`, `list_dir`, `grep`, `edit_file`, `write_file`, `run_command`) instead of returning whole files. `workflow.legacyFileBlocks` keeps the v1 behaviour.
- Native tool calling on all six providers, in one shared loop for streaming and non-streaming runs. OpenAI, Groq, OpenRouter, and Ollama share one OpenAI-compatible adapter.
- Reviewer, security, and judge return structured verdicts with typed issues; the run branches on them, never on text.
- Agents get a token-budgeted repo map instead of pasted source files.
- Accurate token and cost accounting, including prompt-cache reads and writes.
- New default models: Claude Opus 5.5, GPT-5 mini, Gemini 2.5 Flash, and a current free OpenRouter model. Current Claude and OpenAI reasoning models no longer receive parameters they reject.

### Workflows and CI
- YAML workflows with a generic executor; built-ins `standard`, `fast`, `review`, `security-audit`; `aiagentflow workflow list|show|validate`.
- `aiagentflow review` for uncommitted changes, staged changes, git ranges, and pull requests, with inline PR comments and a severity threshold.
- `--headless`, fixed exit codes, `--max-tokens`, `--max-cost`, and `--max-time` budgets.
- Typed run events: `--output json` (NDJSON) and a per-session event log; the TUI shows a live activity feed.
- Official GitHub Action (`action/`).
- `aiagentflow eval` with a ten-task suite and a manual CI workflow.

### Interoperability
- External agent steps: coder, fixer, and tester steps can run Claude Code, OpenCode, or any agent CLI, with aiagentflow's gates still deciding.
- `aiagentflow acp`: Agent Client Protocol server for editors such as Zed.
- `aiagentflow mcp serve`: run, review, plan, and memory as MCP tools for other agents.
- `aiagentflow watch`: re-review changes (or re-run a task) when files change.

### Config, plugins, and safety
- Config version 2 and `aiagentflow migrate`.
- `run_command` permission model: allow/deny patterns checked per command part, per-role tool lists.
- Worktree isolation by default; warns when uncommitted changes are left out of the worktree.
- Plugin API v2: tools, providers, and workflow steps.
- Provider API keys from environment variables; `aiagentflow config` masks secrets.
- Requires Node.js 22.

### Fixes
- Installing a local plugin crashed (`require is not defined`).
- Batch budgets (`--max-tokens`, `--max-cost`) never stopped anything.
- A lint failure after the coder step aborted the run.
- "Retry" at the approval checkpoint did nothing.
- The reviewer never saw the code it reviewed, only the list of changed files.
- `aiagentflow config` printed API keys in plain text.
- v1 plugin agents and providers were never used in runs.
- The MCP client sent an id with `notifications/initialized`.
