// Writes a minimal .aiagentflow/config.json when the repository has none.
// Every agent uses the PROVIDER and MODEL inputs; the API key comes from the
// provider's environment variable (e.g. ANTHROPIC_API_KEY), never from a file.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const path = '.aiagentflow/config.json';
if (existsSync(path)) {
    console.log(`Using the repository's ${path}`);
    process.exit(0);
}

const DEFAULT_MODELS = {
    anthropic: 'claude-sonnet-4-6',
    openai: 'gpt-4o-mini',
    groq: 'llama-3.3-70b-versatile',
    gemini: 'gemini-2.0-flash',
    openrouter: 'meta-llama/llama-3.1-8b-instruct:free',
};

const provider = process.env.PROVIDER || 'anthropic';
if (!(provider in DEFAULT_MODELS)) {
    console.error(`::error::Unsupported provider "${provider}". Use one of: ${Object.keys(DEFAULT_MODELS).join(', ')}`);
    process.exit(2);
}
const model = process.env.MODEL || DEFAULT_MODELS[provider];
const roles = ['architect', 'coder', 'reviewer', 'security', 'tester', 'fixer', 'judge'];

const config = {
    version: 2,
    providers: { [provider]: {} },
    agents: Object.fromEntries(roles.map(role => [role, { provider, model }])),
    project: {},
    workflow: { humanApproval: false },
    mcpServers: {},
};

mkdirSync('.aiagentflow', { recursive: true });
writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Wrote ${path} (${provider} / ${model})`);
