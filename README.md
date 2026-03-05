# aiagentflow

A local-first CLI that orchestrates multi-agent AI workflows for software development. Give it a task — or feed it your specs, PRDs, and guidelines — and it coordinates specialized agents to architect, code, review, test, and ship automatically.

**No cloud dependency. Bring your own API keys. Your code stays on your machine.**

[![npm version](https://img.shields.io/npm/v/@aiagentflow/cli)](https://www.npmjs.com/package/@aiagentflow/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-green)](https://nodejs.org)

---

## How It Works

```
Task → Architect → Coder → Reviewer → Tester → Fixer → Ship
```

Each stage uses a specialized AI agent with tuned prompts and parameters. The loop repeats until quality thresholds pass — like a small AI engineering team running on your machine.

---

## Install

```bash
npm install -g @aiagentflow/cli
```

Or with pnpm:

```bash
pnpm add -g @aiagentflow/cli
```

---

## Quick Start

```bash
# 1. Initialize in your project
cd /path/to/your/project
aiagentflow init

# 2. Run a task
aiagentflow run "Add a login form with email/password validation"

# 3. Or run autonomously (no approval prompts)
aiagentflow run "Refactor the auth module" --auto

# 4. Feed context docs to agents
aiagentflow run "Add auth" --context docs/api-spec.md docs/security.md

# 5. Generate a task list from specs, then batch-run
aiagentflow plan docs/prd.md -o tasks.txt
aiagentflow run --batch tasks.txt --auto
```

The `init` wizard walks you through:
1. Auto-detect your project (language, framework, test framework, package manager)
2. Select your LLM providers (Anthropic, OpenAI, Gemini, Ollama)
3. Enter API keys
4. Assign models per agent role
5. Choose a workflow mode (fast, balanced, strict)
6. Import existing docs (specs, requirements, guidelines) for auto-loading

Configuration is saved locally in `.aiagentflow/config.json`.

---

## Features

- **Multi-agent pipeline** — 6 specialized agents, each with a distinct role
- **Context-aware** — feed specs, PRDs, architecture docs, and guidelines to every agent
- **Plan from docs** — generate batch-ready task lists from your existing documentation
- **Local-first** — runs entirely on your machine, no code leaves your system
- **Provider-agnostic** — Anthropic (Claude), OpenAI (GPT), Google Gemini, Ollama (local/free)
- **Workflow modes** — fast, balanced, or strict presets for iterations, approval, and temperatures
- **Smart detection** — auto-detects language, framework, test runner, and package manager
- **Configurable** — tune models, temperature, and iteration limits per agent
- **Git-native** — auto-creates branches, auto-commits on QA pass
- **Human-in-the-loop** — approve or override at any stage, or go full auto
- **QA policies** — configurable quality gates (max critical issues, test requirements)
- **Batch mode** — process multiple tasks from a file
- **Session persistence** — crash recovery with automatic session saving
- **Token tracking** — monitor LLM usage per agent and per run
- **Customizable prompts** — edit agent prompts in `.aiagentflow/prompts/`

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `aiagentflow init` | Interactive setup wizard |
| `aiagentflow config` | View current configuration |
| `aiagentflow doctor` | Health check — verify providers and setup |
| `aiagentflow run <task>` | Run a workflow for a task |
| `aiagentflow run <task> --auto` | Autonomous mode (no approval prompts) |
| `aiagentflow run <task> --context <files...>` | Run with reference documents |
| `aiagentflow run --batch tasks.txt` | Process multiple tasks from a file |
| `aiagentflow plan <docs...>` | Generate a task list from documentation |
| `aiagentflow plan <docs...> -o tasks.txt` | Write task list to file (batch-ready) |

---

## Agent Roles

| Agent | Role | What it does |
|-------|------|-------------|
| 🧠 Architect | Plan | Analyzes the task and creates an implementation plan |
| 💻 Coder | Implement | Writes production-ready code based on the plan |
| 🔍 Reviewer | Review | Reviews code for bugs, security, and quality |
| 🧪 Tester | Test | Generates tests and runs them |
| 🐛 Fixer | Fix | Addresses review comments and test failures |
| ✅ Judge | QA | Final quality gate — pass or fail |

---

## Supported Providers

| Provider | Type | Default Model | Setup |
|----------|------|---------------|-------|
| **Anthropic** | Cloud API | `claude-sonnet-4-20250514` | Requires API key |
| **OpenAI** | Cloud API | `gpt-4o-mini` | Requires API key |
| **Google Gemini** | Cloud API | `gemini-2.0-flash` | Requires API key |
| **Ollama** | Local | `llama3.2:latest` | Requires [Ollama](https://ollama.com) running locally |

You can mix providers — use cloud APIs for reasoning agents (architect, reviewer, judge) and local models for generation agents (coder, tester, fixer).

### Using with Ollama (free, local)

```bash
# Install and start Ollama
ollama serve

# Pull a model
ollama pull llama3.2

# Initialize aiagentflow with Ollama
aiagentflow init
# → Select "ollama" as provider
# → Enter model name: llama3.2
```

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
│   ├── tester.md
│   ├── fixer.md
│   └── judge.md
├── policies/                # Quality standards
│   └── coding-standards.md
├── context/                 # Reference docs (auto-loaded into every run)
│   ├── api-spec.md          # Example: your API specification
│   └── requirements.md      # Example: your PRD or requirements
└── sessions/                # Saved workflow sessions
```

Edit the prompt files to customize how each agent behaves. Edit `coding-standards.md` to set project-specific rules that all agents follow. Drop `.md` or `.txt` files into `context/` and they'll be automatically included as reference material for all agents.

---

## Context Documents

Agents work best when they understand your project's requirements, API contracts, and standards. There are three ways to provide reference documents:

**1. Auto-loaded (recommended)** — Drop files into `.aiagentflow/context/`:

```bash
cp docs/api-spec.md .aiagentflow/context/
cp docs/security-guidelines.md .aiagentflow/context/
aiagentflow run "Implement user registration"
# Both docs are automatically included in every agent's context
```

**2. Per-run via `--context` flag:**

```bash
aiagentflow run "Add OAuth support" --context docs/oauth-spec.md docs/auth-arch.md
```

**3. During init** — The setup wizard asks if you have existing docs and copies them for you.

### What to include

| Document type | Example | Why it helps |
|---------------|---------|-------------|
| API specs | `api-spec.md` | Agents generate correct endpoints and contracts |
| Requirements / PRDs | `requirements.md` | Architect plans match your actual requirements |
| Security guidelines | `security.md` | Reviewer catches violations against your policies |
| Architecture docs | `architecture.md` | Coder follows your patterns and conventions |
| Development guidelines | `dev-guidelines.md` | All agents follow your team's standards |

### Plan command

Turn documentation into an actionable task list, then batch-run it:

```bash
# Generate tasks from a PRD
aiagentflow plan docs/prd.md -o tasks.txt

# Review the generated tasks
cat tasks.txt

# Run them all
aiagentflow run --batch tasks.txt --auto --context docs/architecture.md
```

---

## Project Structure

```
src/
├── cli/            # CLI entry point and commands
├── core/           # Config system, workflow engine, QA policies
├── providers/      # LLM provider adapters (Anthropic, OpenAI, Gemini, Ollama)
├── agents/         # Agent implementations and prompt library
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

# Lint & format
pnpm lint
pnpm format
```

---

## Contributing

Contributions are welcome! Here's how to get started:

1. **Fork** the repo and clone your fork
2. **Create a branch** for your feature: `git checkout -b feature/your-feature`
3. **Follow the coding standards:**
   - Functions: `camelCase`, Classes: `PascalCase`, Files: `kebab-case`
   - All public functions need JSDoc, types, and error handling
   - Use custom `AppError` subclasses — never raw `throw new Error()`
4. **Check your work:** `pnpm typecheck && pnpm lint && pnpm test`
5. **Open a PR** against `main` with a description of what and why

### Architecture rules

- Dependency direction flows downward: `cli → core → utils → types`
- Config types are inferred from Zod schemas, never manually defined
- New providers only require one adapter file + registry entry

---

## Roadmap

- [x] Project scaffolding, config system, LLM provider layer
- [x] Workflow engine, agent implementations, Git integration
- [x] QA policies, token tracking, session persistence
- [x] Context documents — feed specs, PRDs, and guidelines to agents
- [x] Plan command — generate task lists from documentation
- [x] Multiple providers — Anthropic, OpenAI, Gemini, Ollama
- [x] Project auto-detection — language, framework, test runner, package manager
- [x] Auto-commit on QA pass
- [x] Workflow mode presets — fast, balanced, strict
- [ ] VSCode extension
- [ ] Desktop GUI

---

## License

[MIT](LICENSE)

---

<p align="center">
  <a href="https://aiagentflow.dev">aiagentflow.dev</a>
</p>
