# aiagentflow

A local-first CLI that orchestrates multi-agent AI workflows for software development. Give it a task — it coordinates specialized agents to architect, code, review, test, and ship automatically.

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
```

The `init` wizard walks you through:
1. Select your LLM providers (Anthropic, Ollama)
2. Enter API keys
3. Assign models per agent role
4. Set workflow preferences

Configuration is saved locally in `.aiagentflow/config.json`.

---

## Features

- **Multi-agent pipeline** — 6 specialized agents, each with a distinct role
- **Local-first** — runs entirely on your machine, no code leaves your system
- **Provider-agnostic** — Anthropic (Claude), Ollama (local models), more coming
- **Configurable** — tune models, temperature, and iteration limits per agent
- **Git-native** — auto-creates branches for each task
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
| `aiagentflow run --batch tasks.txt` | Process multiple tasks from a file |

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

| Provider | Type | Setup |
|----------|------|-------|
| **Anthropic** | Cloud API | Requires `ANTHROPIC_API_KEY` |
| **Ollama** | Local | Requires [Ollama](https://ollama.com) running locally |

More providers (OpenAI, Groq, etc.) can be added by implementing a single adapter file.

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
└── sessions/                # Saved workflow sessions
```

Edit the prompt files to customize how each agent behaves. Edit `coding-standards.md` to set project-specific rules that all agents follow.

---

## Project Structure

```
src/
├── cli/            # CLI entry point and commands
├── core/           # Config system, workflow engine, QA policies
├── providers/      # LLM provider adapters (Anthropic, Ollama)
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
- [ ] Context management for large repositories
- [ ] More providers (OpenAI, Groq, Mistral)
- [ ] VSCode extension
- [ ] Desktop GUI

---

## License

[MIT](LICENSE)

---

<p align="center">
  <a href="https://aiagentflow.dev">aiagentflow.dev</a>
</p>
