# Writing plugins (API v2)

A plugin is a Node package in `.aiagentflow/plugins/<name>/` (install one with `aiagentflow plugin install <npm-package-or-path>`). Its entry module exports a `manifest` and any of `tools`, `providers`, and `steps`.

Plugins run in-process with the same permissions as aiagentflow. Only install plugins you trust.

See [`examples/plugin-no-todos`](../examples/plugin-no-todos) for a complete example.

```js
export const manifest = {
    name: 'my-plugin',      // lowercase; workflows reference steps as my-plugin/<step>
    version: '1.0.0',
    apiVersion: 2,
    description: 'What it does',
};
```

## Tools

Tools are added to agents' tool sets. Without `roles`, every agent gets the tool.

```js
export const tools = [{
    definition: {
        name: 'lookup_ticket',          // must not clash with built-in tools
        description: 'Fetch a ticket by id',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
    roles: ['architect', 'coder'],      // optional
    async execute(input) {
        return `Ticket ${input.id}: ...`;                 // or { content, isError: true }
    },
}];
```

## Workflow steps

A step runs code instead of an agent. Return `passed: false` to route the workflow to the step's `onFail` target; the `summary` is handed to the fixer.

```js
export const steps = [{
    name: 'licenses',
    async run(ctx) {
        // ctx.projectRoot, ctx.task, ctx.changedFiles, ctx.with (YAML options), ctx.log(message)
        return { passed: true, summary: 'All dependencies have approved licenses' };
    },
}];
```

```yaml
steps:
  - id: licenses
    uses: my-plugin/licenses
    with: { allow: [MIT, Apache-2.0] }
    onFail: fix
```

A workflow that names a missing plugin step fails before anything runs (exit code 2).

## Providers

Providers implement the same `LLMProvider` contract as the built-ins (`chat`, `stream`, `listModels`, `validateConnection`), including tool calls and normalized stop reasons. See `src/providers/types.ts`.

```js
export const providers = [{
    name: 'my-gateway',                         // must not clash with built-ins
    create(config) {                             // config = providers["my-gateway"] from config.json
        return new MyGatewayProvider(config);
    },
}];
```

```json
{
  "providers": { "my-gateway": { "url": "https://llm.internal", "token": "..." } },
  "agents": { "coder": { "provider": "my-gateway", "model": "internal-coder" } }
}
```

## Migrating from v1 plugins

v1 plugins (`manifest.type`, `agents` with an `after` anchor) are rejected with a message. v1 agent contributions were never wired into runs; in v2, use a workflow step for custom logic or a tool to give agents new capabilities, and set `apiVersion: 2`.
