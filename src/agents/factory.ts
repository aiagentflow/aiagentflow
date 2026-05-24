/**
 * Agent factory — creates agent instances from config.
 *
 * Wires together the provider registry + agent config + prompt library
 * to produce ready-to-use agent instances.
 *
 * Dependency direction: factory.ts → agents/roles/*, providers/registry
 * Used by: workflow runner
 */

import type { AgentRole } from './types.js';
import type { BaseAgent } from './base.js';
import type { AppConfig } from '../core/config/types.js';
import type { ToolDefinition, ToolCall, ToolResult } from '../providers/types.js';
import { createProvider } from '../providers/registry.js';
import { ArchitectAgent } from './roles/architect.js';
import { CoderAgent } from './roles/coder.js';
import { ReviewerAgent } from './roles/reviewer.js';
import { SecurityAgent } from './roles/security.js';
import { TesterAgent } from './roles/tester.js';
import { FixerAgent } from './roles/fixer.js';
import { JudgeAgent } from './roles/judge.js';
import { WorkflowError } from '../core/errors.js';
import { loadMemoriesForRole, formatMemoriesForAgent } from '../memory/loader.js';
import { rememberToolDefinition, handleRememberCall, REMEMBER_ELIGIBLE_ROLES } from '../memory/tool.js';

export interface AgentFactoryOptions {
    tools?: ToolDefinition[];
    onToolCall?: (call: ToolCall) => Promise<ToolResult>;
    /** When true, the remember tool is not added even for eligible roles. */
    memoryDisabled?: boolean;
}

/**
 * Create an agent instance for the specified role using the app config.
 * Automatically:
 *   - Loads and injects project memories relevant to this role
 *   - Wires the `remember` tool for roles authorized to write memories
 *
 * @param role - Which agent to create
 * @param config - Full application config
 * @param projectRoot - Project root directory for prompt loading
 * @param factoryOpts - Optional MCP tools and memory flags
 */
export function createAgent(
    role: AgentRole,
    config: AppConfig,
    projectRoot: string,
    factoryOpts?: AgentFactoryOptions,
): BaseAgent {
    const agentConfig = config.agents[role];
    const provider = createProvider(agentConfig.provider, config.providers);

    // Build tool list: MCP tools + remember tool (if role is eligible)
    const mcpTools = factoryOpts?.tools ?? [];
    const memoryDisabled = factoryOpts?.memoryDisabled ?? false;
    const canWriteMemory = !memoryDisabled && REMEMBER_ELIGIBLE_ROLES.has(role);

    const allTools: ToolDefinition[] = canWriteMemory
        ? [...mcpTools, rememberToolDefinition]
        : [...mcpTools];

    // Chain onToolCall: memory tool takes priority, then delegate MCP calls
    const mcpOnToolCall = factoryOpts?.onToolCall;
    const onToolCall = allTools.length > 0
        ? async (call: ToolCall): Promise<ToolResult> => {
            if (call.name === rememberToolDefinition.name) {
                return handleRememberCall(call, role, projectRoot);
            }
            if (mcpOnToolCall) return mcpOnToolCall(call);
            return { callId: call.callId, content: `Unknown tool: ${call.name}`, isError: true };
        }
        : undefined;

    const options = {
        model: agentConfig.model,
        temperature: agentConfig.temperature,
        maxTokens: agentConfig.maxTokens,
        tools: allTools.length > 0 ? allTools : undefined,
        onToolCall,
    };

    let agent: BaseAgent;
    switch (role) {
        case 'architect':
            agent = new ArchitectAgent(provider, options, projectRoot);
            break;
        case 'coder':
            agent = new CoderAgent(provider, options, projectRoot);
            break;
        case 'reviewer':
            agent = new ReviewerAgent(provider, options, projectRoot);
            break;
        case 'security':
            agent = new SecurityAgent(provider, options, projectRoot);
            break;
        case 'tester':
            agent = new TesterAgent(provider, options, projectRoot);
            break;
        case 'fixer':
            agent = new FixerAgent(provider, options, projectRoot);
            break;
        case 'judge':
            agent = new JudgeAgent(provider, options, projectRoot);
            break;
        default:
            throw new WorkflowError(`Unknown agent role: ${role}`, { role });
    }

    // Inject memories into the agent's system prompt
    if (!memoryDisabled) {
        const memories = loadMemoriesForRole(projectRoot, role);
        if (memories.full.length > 0) {
            agent.memorySection = formatMemoriesForAgent(memories);
        }
    }

    return agent;
}
