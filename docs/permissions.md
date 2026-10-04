# Tools and permissions

In v2, agents work through tools instead of returning whole files.

| Tool | What it does | Default roles |
|---|---|---|
| `read_file` | Read a file (numbered lines, offset/limit) | all |
| `list_dir` | List files, honouring `.gitignore` | all |
| `grep` | Search file contents with a regex | all |
| `edit_file` | Exact search/replace in an existing file | coder, tester, fixer |
| `write_file` | Create a new file | coder, tester, fixer |
| `run_command` | Run a shell command in the project | coder, tester, fixer |
| `remember` | Save a project memory | roles allowed to write memory |
| `submit_verdict` | Return a structured verdict | reviewer, security, judge |

Paths are confined to the project (or its worktree); `..`, absolute paths, and symlinks that point outside are rejected. MCP and plugin tools are added on top.

## `permissions` in config

```json
"permissions": {
  "mode": "ask",
  "allow": ["npm run *", "pytest*"],
  "deny": ["sudo *", "git push*", "npm publish*", "curl *"],
  "tools": { "reviewer": ["read_file", "grep"] },
  "commandTimeoutMs": 120000
}
```

| Field | |
|---|---|
| `mode` | What happens to commands that match no rule: `ask` (prompt in interactive runs, deny otherwise), `auto` (run), `deny`. |
| `allow` | Patterns that always run. `*` matches anything; `"npm test"` matches only `npm test`. Your `testCommand`, `lintCommand`, and `formatCommand` are always allowed. |
| `deny` | Patterns that never run, even in `auto` mode. The default list blocks privilege escalation, pushes, publishing, destructive resets, and network tools. |
| `tools` | Built-in tools per role, replacing the defaults above. |
| `commandTimeoutMs` | Per-command timeout; the whole process tree is killed when it expires. |

Compound commands (`&&`, `||`, `;`, `|`) are checked part by part: every part must be allowed, and a deny rule matching any part blocks the whole command. Command substitution (`$(...)`, backticks) is never covered by an allow rule.

In `--auto` and `--headless` runs nothing prompts, so `ask` behaves like `deny` for commands outside the allow list.

## Models without tool support

Set `"workflow": { "legacyFileBlocks": true }` to use v1 behaviour: no built-in tools, agents return whole files as `FILE:` blocks, and full source files are inlined in prompts.
