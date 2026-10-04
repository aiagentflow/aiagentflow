# aiagentflow-plugin-no-todos

Example [aiagentflow](../../README.md) plugin (API v2). It adds:

- a workflow step, `no-todos/no-todos`, that fails when files changed in the run contain `TODO` or `FIXME`
- a tool, `list_todos`, for the coder and fixer

## Install

```bash
aiagentflow plugin install ./examples/plugin-no-todos
```

## Use the step in a workflow

`.aiagentflow/workflows/clean.yml`:

```yaml
name: clean
steps:
  - id: implement
    agent: coder
  - id: todos
    uses: no-todos/no-todos
    with:
      pattern: "\\b(TODO|FIXME|XXX)\\b"   # optional
    onFail: fix
  - id: fix
    agent: fixer
    trigger: on-fail
    next: todos
```

```bash
aiagentflow run "Add input validation to the signup form" --workflow clean
```

When the step fails, its summary (the offending lines) is handed to the fixer.
