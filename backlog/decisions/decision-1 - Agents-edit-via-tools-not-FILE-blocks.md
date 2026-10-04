---
id: decision-1
title: 'Agents edit via tools, not FILE: blocks'
date: '2026-10-04 01:16'
status: proposed
---
## Context

Coder, Fixer and Tester emit whole files in `FILE: path` + fenced blocks, parsed by regex in `src/core/workflow/file-parser.ts`. Existing code is bulk-injected via `loadSourceFiles`. Whole-file rewrites truncate on large files, waste tokens, and clobber unrelated code. Tool calling exists only in the Anthropic adapter.

## Decision

All code-writing agents run in a tool loop with repo tools: `read_file`, `list_dir`, `grep`, `edit_file` (exact search/replace), `write_file` (new files only), `run_command` (permission-gated). The loop lives in one shared runtime, not per provider. `file-parser.ts` is kept only as a fallback for models without tool support, behind a flag, then removed in v3.

## Consequences

+ Works on large repos; diffs are small and reviewable.
+ Same behaviour across all providers.
- Breaking for users with custom prompts in `.aiagentflow/prompts/`.
- Small local models (Ollama) with weak tool calling need the fallback path.

