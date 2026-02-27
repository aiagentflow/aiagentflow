# ai-workflow

A local-first CLI tool that orchestrates multi-agent AI workflows for software development. Give it a task — it coordinates specialized agents (architect, coder, reviewer, tester, fixer) to implement, review, test, and ship code automatically.

**No cloud dependency. Bring your own API keys. Your code stays on your machine.**

---

## Why?

Most AI coding tools are single-agent and have no structure. You prompt, you copy-paste, you hope for the best.

`ai-workflow` is different — it runs a structured engineering loop:

```
Task → Architect → Coder → Reviewer → Tester → Fixer → PR
```

Each stage uses a specialized AI agent with tuned prompts and parameters. The loop repeats until quality thresholds pass. Think of it as a small AI engineering team running on your machine.

---

## Features

- **Multi-agent workflow** — each agent has a specific role and expertise
- **Local-first** — runs entirely on your machine, no code leaves your system
- **Provider-agnostic** — supports Anthropic (Claude) and Ollama (local models), more coming
- **Configurable** — tune models, temperature, and iteration limits per agent
- **Git-native** — auto-creates branches and generates PR descriptions
- **Human-in-the-loop** — approve or override at any stage

---

## Quick Start

```bash
# Clone the repo
git clone https://github.com/raj-khan/ai-workflow.git
cd ai-workflow

# Install dependencies
pnpm install

# Build
pnpm build

# Initialize in your project
cd /path/to/your/project
ai-workflow init

# Check setup
ai-workflow doctor
```

The init wizard walks you through:
1. Select your LLM providers (Anthropic, Ollama)
2. Enter API keys
3. Assign models per agent role
4. Set workflow preferences

Configuration is saved locally in `.ai-workflow/config.json`.

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `ai-workflow init` | Interactive setup wizard |
| `ai-workflow config` | View current configuration |
| `ai-workflow doctor` | Health check — verify providers and setup |
| `ai-workflow run <task>` | Run a workflow task *(coming in Phase 2)* |

---

## Supported Providers

| Provider | Type | Setup |
|----------|------|-------|
| **Anthropic** | Cloud API | Requires API key |
| **Ollama** | Local | Requires [Ollama](https://ollama.com) running locally |

More providers (OpenAI, Groq, etc.) can be added by implementing a single adapter file.

---

## Agent Roles

| Agent | Role | Purpose |
|-------|------|---------|
| 🧠 Architect | Plan | Creates spec and implementation plan |
| 💻 Coder | Implement | Writes code based on the plan |
| 🔍 Reviewer | Review | Critiques code and suggests improvements |
| 🧪 Tester | Test | Generates and runs tests |
| 🐛 Fixer | Fix | Addresses review comments and test failures |
| ✅ Judge | QA | Evaluates if quality thresholds are met |

---

## Project Structure

```
src/
├── cli/            # CLI entry point and commands
├── core/           # Business logic (config, workflow engine)
├── providers/      # LLM provider adapters (Anthropic, Ollama)
├── agents/         # Agent role definitions
├── git/            # Git operations wrapper
├── utils/          # Shared utilities (logger, fs, validation)
└── types/          # Global shared types
```

---

## Development

```bash
# Run in dev mode
pnpm dev init

# Type check
pnpm typecheck

# Run tests
pnpm test

# Lint
pnpm lint

# Format
pnpm format
```

---

## Contributing

Contributions are welcome! Here's how to get started:

1. **Fork** the repo and clone your fork
2. **Create a branch** for your feature or fix: `git checkout -b feature/your-feature`
3. **Follow the coding standards:**
   - Functions: `camelCase`
   - Classes: `PascalCase`
   - Files: `kebab-case`
   - All public functions must have JSDoc, types, and error handling
   - Use custom `AppError` subclasses — never raw `throw new Error()`
4. **Check your work:**
   ```bash
   pnpm typecheck
   pnpm lint
   pnpm test
   ```
5. **Commit** with clear messages (no AI-generated signatures)
6. **Open a PR** against `main` with a description of what and why

### Architecture rules

- Read `ARCHITECTURE.md` before writing code
- Dependency direction flows downward: `cli → core → utils → types`
- Config types are always inferred from Zod schemas, never manually defined
- New providers only require one adapter file + registry entry

---

## Roadmap

- [x] Phase 1: Project scaffolding, config system, LLM provider layer
- [ ] Phase 2: Workflow engine, agent implementations, Git integration
- [ ] Phase 3: QA agent, configurable policies, prompt library
- [ ] Future: Desktop GUI, VSCode extension, team collaboration

---

## License

[MIT](LICENSE)
