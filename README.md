# aiagentflow

A local-first CLI that orchestrates multi-agent AI workflows for software development. Give it a task — or feed it your specs, PRDs, and guidelines — and it coordinates specialized agents to architect, code, review, test, and ship automatically.

**No cloud dependency. Bring your own API keys. Your code stays on your machine.**

[![npm version](https://img.shields.io/npm/v/@aiagentflow/cli)](https://www.npmjs.com/package/@aiagentflow/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-green)](https://nodejs.org)

---

## How It Works

```
Task → Architect → Coder → Reviewer → Security → Tester → Fixer → Judge → Ship
```

Each stage uses a specialized AI agent with tuned prompts and parameters. The loop repeats until quality thresholds pass — like a small AI engineering team running on your machine. Agents accumulate project knowledge in `.aiagentflow/memory/` so every run starts smarter than the last.

---

## Install

```bash
npm install -g @aiagentflow/cli
```

---

## Quick Start

```bash
# 1. Initialize in your project
cd /path/to/your/project
aiagentflow init

# 2. Run a task
aiagentflow run "Add a login form with email/password validation"

# 3. Autonomous mode (no approval prompts)
aiagentflow run "Refactor the auth module" --auto

# 4. Isolated branch — agents work in a git worktree, your directory stays clean
aiagentflow run "Refactor the payment module" --isolate

# 5. Review the Architect's plan before any code is written
aiagentflow run "Add OAuth2 support" --review-plan

# 6. Generate a task list from specs, then batch-run in parallel
aiagentflow plan docs/prd.md -o tasks.txt
aiagentflow run --batch tasks.txt --parallel 4 --auto
```

The `init` wizard walks you through:
1. Auto-detect your project (language, framework, test framework, package manager)
2. Select LLM providers (Anthropic, OpenAI, Groq, Gemini, OpenRouter, Ollama)
3. Enter API keys
4. Assign models per agent role
5. Choose a workflow mode (fast, balanced, strict)
6. Import existing docs (specs, requirements, guidelines) for auto-loading

Configuration is saved locally in `.aiagentflow/config.json`.

---

## Features

- **Multi-agent pipeline** — 7 specialized agents, each with a distinct role
- **Agent memory** — agents persist learned conventions, decisions, and gotchas across runs; each run starts smarter
- **Context-aware** — feed specs, PRDs, architecture docs, and guidelines to every agent
- **Worktree isolation** — `--isolate` runs tasks in a clean git worktree, leaving your working directory untouched
- **Plan review gate** — `--review-plan` pauses after Architect so you can approve, edit, or regenerate the plan
- **GitHub integration** — `--pr` resolves PR review comments; `--issue` implements issues and opens a PR automatically
- **MCP tool integration** — agents call real tools (files, databases, Slack, GitHub) via MCP servers
- **Plugin system** — extend with custom agents and providers via npm packages or local paths
- **TUI dashboard** — `aiagentflow ui` shows live run status, token counts, and per-agent costs
- **Local-first** — runs entirely on your machine, no code leaves your system
- **Provider-agnostic** — Anthropic, OpenAI, Groq, Gemini, OpenRouter (100+ models), Ollama (local/free)
- **Parallel batch** — `--batch` + `--parallel` fan out tasks across multiple simultaneous workflows
- **Plan from docs** — generate batch-ready task lists from your existing documentation
- **Workflow modes** — fast, balanced, or strict presets for iterations, approval, and temperatures
- **Git-native** — auto-creates branches, auto-commits on QA pass
- **Human-in-the-loop** — approve or override at any stage, or go full auto
- **Session persistence** — crash recovery with automatic session saving
- **Token + cost tracking** — per-agent USD cost breakdown in the run summary

---

## CLI Commands

### Core workflow

| Command | Description |
|---------|-------------|
| `aiagentflow init` | Interactive setup wizard |
| `aiagentflow run <task>` | Run a workflow |
| `aiagentflow run <task> --auto` | Autonomous mode (no approval prompts) |
| `aiagentflow run <task> --isolate` | Run in an isolated git worktree |
| `aiagentflow run <task> --review-plan` | Pause after planning for human review |
| `aiagentflow run <task> --dry-run` | Preview the plan without executing |
| `aiagentflow run <task> --context <files...>` | Run with extra reference documents |
| `aiagentflow run --batch tasks.txt [--parallel N]` | Process multiple tasks from a file |
| `aiagentflow run --pr <number> --isolate` | Resolve a PR's review comments |
| `aiagentflow run --issue <number> --isolate --auto` | Implement a GitHub issue end-to-end |
| `aiagentflow resume` | Resume the last interrupted session |
| `aiagentflow sessions` | List all saved sessions |

### Inspection & management

| Command | Description |
|---------|-------------|
| `aiagentflow config` | View current configuration |
| `aiagentflow doctor` | Health check — verify providers and setup |
| `aiagentflow runs` | List active worktree runs with status and cost |
| `aiagentflow discard --merge <branch>` | Merge and clean up a worktree run |
| `aiagentflow gc` | Prune stale worktree runs and old memories |
| `aiagentflow plan <docs...>` | Generate a task list from documentation |
| `aiagentflow chat <agent>` | Talk to a single agent without a full pipeline |
| `aiagentflow export` | Export a past session as a structured report |

### Memory

| Command | Description |
|---------|-------------|
| `aiagentflow memory list [--type <type>]` | List stored memories grouped by type |
| `aiagentflow memory show <name>` | Print a memory's full body |
| `aiagentflow memory rm <name>` | Delete a memory |
| `aiagentflow memory edit <name>` | Open a memory in `$EDITOR` |
| `aiagentflow memory clear --type <type>` | Bulk-delete all memories of a type |

### MCP & plugins

| Command | Description |
|---------|-------------|
| `aiagentflow mcp list` | Show configured MCP servers and their tools |
| `aiagentflow mcp test <server>` | Start a server and verify it exposes its tools |
| `aiagentflow plugin list` | Show installed plugins |
| `aiagentflow plugin install <source>` | Install from npm or symlink a local path |
| `aiagentflow plugin remove <name>` | Uninstall a plugin |
| `aiagentflow ui` | Launch the live terminal UI dashboard |

---

## Agent Roles

| Agent | Role | What it does |
|-------|------|-------------|
| 🧠 Architect | Plan | Analyzes the task, creates an implementation plan, records architecture decisions to memory |
| 💻 Coder | Implement | Writes production-ready code based on the plan |
| 🔍 Reviewer | Review | Reviews code for bugs and style issues, writes conventions to memory |
| 🔒 Security | Security | OWASP top-10 scan, secret detection, injection analysis |
| 🧪 Tester | Test | Generates tests and runs them, writes gotchas to memory |
| 🐛 Fixer | Fix | Resolves review, security, and test failures; writes gotchas to memory |
| ✅ Judge | QA | Final quality gate — pass or fail; records decisions to memory |

Agents read back their relevant memory types on every run. Architect sees architecture, decisions, conventions, and references. Fixer sees gotchas, conventions, and architecture. Judge sees decisions, conventions, and architecture.

---

## Agent Memory

Agents accumulate project knowledge in `.aiagentflow/memory/` across runs. Five typed categories:

| Type | Written by | Example |
|------|-----------|---------|
| `architecture` | Architect | "Workflow runner is a state machine in `runner.ts`" |
| `convention` | Reviewer, Architect | "No `any` casts — use generics or `unknown`" |
| `decision` | Architect, Judge | "Chose Zod over manual types — schemas inferred to types" |
| `gotcha` | Fixer, Tester, Reviewer | "Streaming must be disabled in batch mode" |
| `reference` | Architect, Coder | "MCP tool catalog lives in `src/mcp/registry.ts`" |

Memories are stored as human-readable markdown with frontmatter. You can edit, delete, or add entries manually. LRU eviction caps each type at 50 entries; `aiagentflow gc` removes entries not updated in 30 days.

---

## Supported Providers

| Provider | Type | Default Model | Notes |
|----------|------|---------------|-------|
| **Anthropic** | Cloud | `claude-sonnet-4-20250514` | Recommended for architecture |
| **OpenAI** | Cloud | `gpt-4o-mini` | Fast for coding and fixing |
| **Groq** | Cloud | `llama-3.3-70b-versatile` | Generous free tier, sub-second inference |
| **Google Gemini** | Cloud | `gemini-2.0-flash` | 2M context window |
| **OpenRouter** | Cloud | `meta-llama/llama-3.1-8b-instruct:free` | 100+ models; append `:free` for zero-cost models |
| **Ollama** | Local | `llama3.2:latest` | Total privacy, zero cost, no API key |

Mix providers — use a powerful model for Architect, cheaper/faster ones for Coder and Fixer.

---

## MCP Tool Integration

Agents can call real tools via [Model Context Protocol](https://github.com/modelcontextprotocol/servers) servers. Add a `mcpServers` block to `.aiagentflow/config.json`:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      "allowedRoles": ["coder", "tester"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "ghp_..." }
    }
  }
}
```

Use `aiagentflow mcp list` to see configured servers and `aiagentflow mcp test <name>` to verify they start correctly.

---

## Plugin System

Extend the pipeline with custom agents and providers:

```bash
# Install from npm
aiagentflow plugin install @my-org/aiagentflow-linter

# Symlink a local plugin (for development)
aiagentflow plugin install ./plugins/my-custom-agent

# List installed plugins
aiagentflow plugin list
```

Each plugin exports a `manifest` declaring its name, version, and contributions (`agent`, `provider`, or `both`). Plugin agents appear in the workflow after their designated built-in anchor (e.g. `after: "tester"`).

---

## GitHub Integration

```bash
# Resolve all review comments on PR #42 in an isolated branch
aiagentflow run --pr 42 --isolate

# Implement GitHub issue #7 and open a PR automatically
aiagentflow run --issue 7 --isolate --auto
```

Requires the [GitHub CLI](https://cli.github.com) — run `gh auth login` first.

---

## Configuration

After `aiagentflow init`, your project has:

```
.aiagentflow/
├── config.json              # Main configuration
├── prompts/                 # Customizable agent prompts
│   ├── architect.md
│   ├── coder.md
│   ├── reviewer.md
│   ├── security.md
│   ├── tester.md
│   ├── fixer.md
│   └── judge.md
├── context/                 # Reference docs (auto-loaded into every run)
│   └── api-spec.md          # Example: your API specification
├── memory/                  # Agent-written knowledge store (auto-managed)
│   └── *.md                 # One file per memory entry
├── plugins/                 # Installed plugins
└── sessions/                # Saved workflow sessions
```

---

## Project Structure

```
src/
├── cli/            # CLI entry point and commands
├── core/           # Config system, workflow engine, QA policies
├── providers/      # LLM provider adapters (Anthropic, OpenAI, Groq, Gemini, OpenRouter, Ollama)
├── agents/         # Agent implementations and prompt library
├── memory/         # Agent memory store, loader, and remember tool
├── mcp/            # MCP client and registry
├── integrations/   # GitHub CLI integration (--pr, --issue)
├── plugins/        # Plugin loader and registry
├── ui/             # Ink-based TUI dashboard
├── git/            # Git operations wrapper
├── prompts/        # Default prompt templates
└── utils/          # Shared utilities (logger, fs, validation)
```

---

## Development

```bash
# Clone and install
git clone https://github.com/aiagentflow/aiagentflow.git
cd aiagentflow
pnpm install

# Run in dev mode
pnpm dev run "your task here"

# Type check
pnpm typecheck

# Run tests
pnpm test

# Lint
pnpm lint
```

---

## Contributing

Contributions are welcome!

1. **Fork** the repo and clone your fork
2. **Create a branch**: `git checkout -b feature/your-feature`
3. **Check your work**: `pnpm typecheck && pnpm lint && pnpm test`
4. **Open a PR** against `main`

### Architecture rules

- Dependency direction flows downward: `cli → core → utils → types`
- Config types are inferred from Zod schemas, never manually defined
- New providers only require one adapter file + registry entry

---

## Roadmap

- [x] Multi-agent pipeline — 7 specialized agents
- [x] Context documents — feed specs, PRDs, and guidelines to agents
- [x] Plan command — generate task lists from documentation
- [x] All 6 LLM providers — Anthropic, OpenAI, Groq, Gemini, OpenRouter, Ollama
- [x] Worktree isolation — `--isolate` for clean branch-per-task workflows
- [x] Plan review gate — `--review-plan` for human-in-the-loop architecture review
- [x] Parallel batch — `--batch --parallel` for concurrent task execution
- [x] GitHub integration — `--pr` and `--issue` with auto PR creation
- [x] MCP tool integration — agents call real tools via MCP servers
- [x] Plugin system — custom agents and providers via npm or local paths
- [x] TUI dashboard — live run status, tokens, and costs
- [x] Agent memory — persistent knowledge store across workflow runs
- [ ] VSCode extension
- [ ] Watch mode — auto-run on file save

---

## License

[MIT](LICENSE)

---

<p align="center">
  <a href="https://aiagentflow.dev">aiagentflow.dev</a>
</p>
