---
id: doc-1
title: v2 Vision - Verified Agent Pipelines
type: specification
created_date: '2026-10-04 01:16'
updated_date: '2026-10-04 01:16'
tags:
  - v2
  - roadmap
---
# aiagentflow v2: Verified Agent Pipelines

## Why v2
Everything in PLAN_V2.md shipped by v1.4.0 (worktrees, plan review, parallel batch, MCP, GitHub, plugins, TUI, memory). The surface grew, but the core is still v0-era:

- **Agents are single-shot text generators.** Coder/Fixer/Tester emit whole files as `FILE:` blocks parsed by regex (`src/core/workflow/file-parser.ts`). Existing sources are bulk-injected into the prompt (`loadSourceFiles`). This breaks on large files and large repos.
- **Tool calling only works on Anthropic.** OpenAI, Groq, Gemini, Ollama, OpenRouter ignore `tools`; the streaming path drops tools for every provider.
- **Verdicts are substring matches.** Reviewer approval = `includes('APPROVE') && !includes('REJECT')`.
- **Pipeline is hardcoded.** 14-state machine in `engine.ts`; plugins can only anchor "after X".
- **No headless contract.** No machine-readable output, no stable exit codes, no CI action.
- **Stale defaults.** `claude-sonnet-4-20250514`, `gpt-4o-mini`, `gemini-2.0-flash`; tokens estimated as chars/4.

## Market position (Oct 2026)
Single-agent CLIs own the "one agent edits my repo" space: OpenCode, Codex CLI, Claude Code, Pi, Cline CLI 2.0 (headless + NDJSON), Aider. Editors integrate agents via ACP (Agent Client Protocol, Zed).
aiagentflow should not compete as another single agent. Its edge is the **team**: a configurable pipeline of specialized roles with **verified quality gates** (review, security, tests, judge) and **memory**, that can run unattended in CI.

## v2 thesis
> aiagentflow v2 is the quality-gated pipeline that orchestrates agents, including other agents.

### Pillars
1. **Agentic runtime**: one tool loop for every provider; repo tools (read, list, grep, edit via search/replace, run command) with a permission model. Kill `FILE:` parsing.
2. **Structured verdicts**: Reviewer/Security/Judge return JSON validated by Zod.
3. **Declarative workflows**: pipelines defined in `.aiagentflow/workflows/*.yml`; the current 7-agent flow becomes the built-in `standard` workflow.
4. **Headless + CI**: NDJSON event stream, exit codes, `aiagentflow review` for PRs, official GitHub Action.
5. **Bring your own agent**: any step can delegate to an external CLI agent (Claude Code, Codex, OpenCode) while aiagentflow keeps the gates.
6. **Interop**: speak ACP (editors) and run as an MCP server (other agents call aiagentflow).
7. **Proof**: an eval harness so quality claims are measured, not asserted.

## Breaking changes (why it is a major)
- Config schema v2 (`workflows`, `permissions`, `agents.*.runtime`), with `aiagentflow migrate`.
- Agent output contract changes (tools instead of `FILE:` blocks); custom prompts in `.aiagentflow/prompts/` need updating.
- Plugin API v2 (steps instead of "after" anchors).
- Default isolation flips to `worktree`.
- Node >= 22.

## Milestones
- **v2.0-alpha: Runtime**: provider tool loop, repo tools, permissions, structured verdicts.
- **v2.0-beta: Workflows & CI**: YAML workflows, event stream, headless, review command, GitHub Action.
- **v2.0: GA**: config migration, plugin API v2, defaults, docs, evals baseline.
- **v2.1: Interop**: external agent steps, ACP server, MCP server mode.

## Non-goals for v2.0
Web UI, VSCode extension (ACP covers editors), hosted/cloud service.
