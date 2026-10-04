/**
 * Ollama local model provider adapter.
 *
 * Uses Ollama's OpenAI-compatible endpoint (`/v1/chat/completions`), which
 * supports streaming and function calling. Model listing and health checks
 * use the native `/api/tags` endpoint.
 *
 * Dependency direction: ollama.ts → openai-compatible.ts
 * Used by: providers/registry.ts
 */

import { PROVIDER_DEFAULT_MODELS } from './metadata.js';
import type { ModelInfo } from './types.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import { fetchWithRetry, OLLAMA_TIMEOUT_MS } from './provider-errors.js';

/** Configuration required to create an Ollama provider. */
export interface OllamaProviderConfig {
    readonly baseUrl?: string;
}

/** Default Ollama settings. */
const DEFAULTS = {
    baseUrl: 'http://localhost:11434',
    model: PROVIDER_DEFAULT_MODELS.ollama,
} as const;

export class OllamaProvider extends OpenAICompatibleProvider {
    public readonly name = 'ollama' as const;
    /** Server root, without the /v1 suffix (native endpoints live under /api). */
    private readonly serverUrl: string;

    constructor(config?: OllamaProviderConfig) {
        const serverUrl = (config?.baseUrl ?? DEFAULTS.baseUrl).replace(/\/+$/, '').replace(/\/v1$/, '');
        super({
            name: 'ollama',
            label: 'Ollama',
            baseUrl: `${serverUrl}/v1`,
            defaultModel: DEFAULTS.model,
            timeoutMs: OLLAMA_TIMEOUT_MS,
            headers: {},
        });
        this.serverUrl = serverUrl;
    }

    /** List models installed in the local Ollama instance. */
    override async listModels(): Promise<ModelInfo[]> {
        const response = await fetchWithRetry(
            `${this.serverUrl}/api/tags`,
            { method: 'GET' },
            { provider: 'ollama', baseUrl: this.serverUrl, timeoutMs: OLLAMA_TIMEOUT_MS },
        );

        const data = await response.json() as { models?: Array<Record<string, unknown>> };
        return (data.models ?? []).map(m => ({
            id: String(m.name ?? m.model ?? ''),
            name: String(m.name ?? m.model ?? 'Unknown'),
            provider: 'ollama' as const,
        }));
    }

    /** Check that Ollama is running and reachable. */
    override async validateConnection(): Promise<boolean> {
        try {
            const response = await fetch(`${this.serverUrl}/api/tags`);
            return response.ok;
        } catch {
            return false;
        }
    }
}
