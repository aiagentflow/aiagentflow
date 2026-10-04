# aiagentflow

A local-first CLI that runs a team of AI agents on your codebase: an architect plans, a coder implements, a reviewer and a security agent check the change, a tester writes and runs tests, a fixer handles what fails, and a judge decides whether the task is done. Every gate is a structured verdict or a real test run, so a change only passes when it actually passes.

**Bring your own models and keys. Your code stays on your machine.**

[![npm version](https://img.shields.io/npm/v/@aiagentflow/cli)](https://www.npmjs.com/package/@aiagentflow/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-green)](https://nodejs.org)

> Upgrading from v1? See [MIGRATION.md](MIGRATION.md).

---

## How it works

```
plan → implement → review → security → test → judge
            ↑          │         │        │      │
            └──────────┴── fix ──┴────────┴──────┘
```

- **Agents work through tools.** They explore with `list_dir`, `grep`, and `read_file`, change code with `edit_file` and `write_file`, and verify with `run_command`, within a permission policy you control.
- **Gates are real.** Reviewer, security, and judge submit structured verdicts with typed issues; lint and tests run for real. Any failure routes to the fixer with the exact problem.
- **Pipelines are YAML.** Use a built-in workflow or write your own, including steps from plugins.
- **Bring other agents.** Any coder, fixer, or tester step can run Claude Code, OpenCode, or another agent CLI, with aiagentflow's gates still deciding.
- **Runs are isolated.** Each task runs on its own branch in a git worktree, so your working directory is untouched until you merge.
- **Agents remember.** Conventions, decisions, and gotchas are saved to `.aiagentflow/memory/` so later runs start smarter.

---

## Install

```bash
npm install -g @aiagentflow/cli
```

Requires Node.js 22 or later.

## Quick start

```bash
cd your-project
aiagentflow init                                   # pick providers, models, and settings

aiagentflow run "Add input validation to the signup form"
aiagentflow run "Fix the flaky date test" --workflow fast --auto
aiagentflow run "Add OAuth2 login" --review-plan   # approve the plan before coding starts

aiagentflow review --staged                        # review your staged changes
aiagentflow review --pr 42 --comment               # review a PR and post inline comments
```

---

## Workflows

| Workflow | Steps | Use it for |
|---|---|---|
| `standard` (default) | plan → implement → review → security → test → judge, with fixes | Most tasks |
| `fast` | implement → test, with fixes | Small, well-specified changes |
| `review` | review → security, read-only | Checking a change |
| `security-audit` | audit, read-only | A security pass over the repository |

Write your own in `.aiagentflow/workflows/<name>.yml`:

```yaml
name: careful
steps:
  - id: plan
    agent: architect
    approval: true
  - id: implement
    agent: coder
    checks: [format, lint]
    onFail: fix
  - id: test
    agent: tester
    checks: [test]
    onFail: fix
  - id: fix
    agent: fixer
    trigger: on-fail
    next: test
```

Full reference: [docs/workflows.md](docs/workflows.md).

---

## Reviewing changes

`aiagentflow review` runs the reviewer and security agents on a diff without editing anything:

```bash
aiagentflow review                        # uncommitted changes
aiagentflow review --diff main...HEAD     # a git range
aiagentflow review --pr 42 --comment      # post findings as inline PR comments
aiagentflow review --fail-on critical     # exit 1 only on critical findings
```

See [docs/review.md](docs/review.md).

## CI and automation

```bash
aiagentflow run "Implement issue #12" --headless --max-cost 2 --max-time 20 --output json
```

- `--headless` never prompts; commands that need approval are denied.
- Exit codes: `0` passed, `1` workflow failed, `2` config or usage error, `3` budget exceeded, `4` provider error.
- `--output json` prints [run events](docs/events.md) as NDJSON on stdout.
- Budgets: `--max-tokens`, `--max-cost` (USD), `--max-time` (minutes).

The [GitHub Action](action/README.md) reviews pull requests or runs workflows in CI:

```yaml
- uses: aiagentflow/aiagentflow/action@v2
  with:
    fail-on: high
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

More: [docs/headless.md](docs/headless.md).

---

## Commands

| Command | |
|---|---|
| `init` | Interactive setup |
| `run <task>` | Run a workflow (`--workflow`, `--auto`, `--headless`, `--isolate`/`--inplace`, `--review-plan`, `--dry-run`, `--batch`, `--parallel`, `--pr`, `--issue`, budgets, `--output json`) |
| `review` | Review a diff or PR |
| `resume [session]` | Resume an interrupted run |
| `sessions` | List saved runs |
| `runs` | List worktree runs with status and cost |
| `discard --merge <branch>` | Merge and clean up a worktree run |
| `export` | Export a run as markdown or JSON |
| `workflow list\|show\|validate` | Manage workflows |
| `plan <docs...>` | Turn specs into a task list for `--batch` |
| `chat <agent>` | Talk to one agent |
| `eval` | Measure a workflow on tasks with hidden tests |
| `memory list\|show\|edit\|rm\|clear` | Manage agent memory |
| `mcp list\|test` | MCP servers |
| `plugin list\|install\|remove` | Plugins |
| `ui` | Live terminal dashboard |
| `doctor` | Check setup, providers, and models |
| `config` | Show the config (secrets masked) |
| `migrate` | Upgrade a v1 project |
| `gc` | Clean up stale worktrees and old memories |

---

## Providers

| Provider | Default model | Notes |
|---|---|---|
| Anthropic | `claude-opus-5-5` | |
| OpenAI | `gpt-5-mini` | |
| Google Gemini | `gemini-2.5-flash` | |
| Groq | `llama-3.3-70b-versatile` | Fast inference, free tier |
| OpenRouter | `qwen/qwen3.8-27b:free` | Hundreds of models; `:free` models cost nothing |
| Ollama | `llama3.2:latest` | Local, no API key |

Mix providers per agent role. API keys can come from `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, and `OPENROUTER_API_KEY`, so `.aiagentflow/config.json` can be committed without secrets. Plugins can add providers.

---

## Configuration

`aiagentflow init` creates:

```
.aiagentflow/
├── config.json      # providers, agents, project, workflow, permissions, MCP servers
├── prompts/         # per-agent prompts you can edit
├── policies/        # coding standards and QA rules
├── context/         # reference docs loaded into every run
├── workflows/       # your workflows
├── memory/          # agent-written project knowledge
├── plugins/         # installed plugins
└── sessions/        # run state and event logs
```

What agents may run is controlled by `permissions`:

```json
"permissions": {
  "mode": "ask",
  "allow": ["npm run *"],
  "deny": ["sudo *", "git push*"]
}
```

See [docs/permissions.md](docs/permissions.md).

---

## Extending

- **MCP servers**: give agents tools from any [MCP server](https://github.com/modelcontextprotocol/servers) via `mcpServers` in config.
- **Plugins**: add tools, providers, and workflow steps. See [docs/plugins.md](docs/plugins.md) and [examples/plugin-no-todos](examples/plugin-no-todos).

---

## Development

```bash
git clone https://github.com/aiagentflow/aiagentflow.git
cd aiagentflow
npm install
npm run dev -- run "your task"   # run from source
npm run typecheck && npm run lint && npm test
```

Project work is tracked with [Backlog.md](https://github.com/MrLesk/Backlog.md) in `backlog/`.

## License

[MIT](LICENSE)

<p align="center">
  <a href="https://aiagentflow.dev">aiagentflow.dev</a>
</p>
