# Migrating from v1 to v2

v2 changes how agents work (tools instead of whole-file output), how pipelines are defined (YAML workflows), and the config format. Most projects migrate with one command.

## 1. Upgrade and migrate

```bash
npm install -g @aiagentflow/cli@2
cd your-project
aiagentflow migrate --dry-run   # see what will change
aiagentflow migrate             # back up and upgrade
```

v2 refuses to load a v1 config and tells you to run `migrate`. The command:

- backs up `.aiagentflow/config.json` and `.aiagentflow/prompts/` to `.aiagentflow/backup-v1-<timestamp>/`
- sets `version: 2`, removes `workflow.mode`, and adds `permissions`, `project.repoMapTokens`, and `workflow.legacyFileBlocks` with their defaults
- replaces prompt files that are still the untouched v1 defaults
- lists customised prompts that still use v1 conventions, without changing them

Requires Node.js 22 or later.

## 2. Customised prompts

If `migrate` lists prompts to review:

- **Coder, tester, fixer**: v1 prompts asked for whole files as `FILE: path` blocks. v2 agents read with `read_file`/`grep`, change files with `edit_file`/`write_file`, and run checks with `run_command`. Compare with the new default (`aiagentflow init` in an empty directory, or delete your file to use the default) and merge your changes. A model that still answers with `FILE:` blocks keeps working; aiagentflow writes them and warns.
- **Reviewer, security, judge**: v1 prompts asked for `**Verdict**: APPROVE` in text. v2 judging agents must call the `submit_verdict` tool. Text verdicts are no longer read.

## 3. Behaviour changes

| v1 | v2 |
|---|---|
| Agents returned whole files; source files were pasted into prompts | Agents use tools and get a compact repo map |
| Approval decided by searching the reply for "APPROVE" / "PASS" | Structured verdicts with typed issues (`submit_verdict`) |
| Fixed 7-agent state machine | YAML workflows: `standard`, `fast`, `review`, `security-audit`, or your own |
| Runs edited the working directory by default | Runs use a git worktree by default (`--inplace` to opt out). Commit first: a worktree starts from your last commit |
| `--mode fast\|balanced\|strict` | Deprecated (still works, warns). Use `--workflow` and config |
| Judge rejection re-ran the reviewer | Judge rejection goes to the fixer |
| Default models: Claude Sonnet 4, GPT-4o mini, Gemini 2.0 Flash | Claude Opus 5.5, GPT-5 mini, Gemini 2.5 Flash; default `maxTokens` 16000 |
| Agents could run any command they produced | `run_command` follows `permissions` (allow/deny/ask) |

## 4. Scripts and CI

- Use `--headless` in CI: no prompts, commands that need approval are denied.
- Exit codes are fixed: `0` passed, `1` workflow failed, `2` config or usage error, `3` budget exceeded, `4` provider error.
- `--output json` prints NDJSON run events on stdout ([docs/events.md](docs/events.md)).
- API keys can come from environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`), so the config can be committed without secrets.
- Sessions: `state` became `status` (`running`, `passed`, `failed`) plus `step`. v1 sessions are converted when loaded and can still be resumed. `aiagentflow export --format json` now reports `status`, `workflow`, `failureReason`, and `verdicts`.
- `runs --filter` takes `running`, `passed`, or `failed` (`complete` still works).

## 5. Plugins

Plugin API v2 replaces v1. v1 plugins are rejected with a message. (v1 plugin agents were never actually wired into runs.) v2 plugins contribute tools, providers, and workflow steps with `apiVersion: 2`. See [docs/plugins.md](docs/plugins.md).

Plugin providers implement the v2 `LLMProvider` contract: `ChatMessage` is a union that includes tool calls and tool results, `ChatResponse` has `stopReason` and `toolCalls`, and providers return tool calls instead of executing them.

## 6. Models without tool calling

Set `"workflow": { "legacyFileBlocks": true }` to keep v1 behaviour for models that cannot call tools.
