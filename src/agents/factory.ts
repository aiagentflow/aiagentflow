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
import { createProvider } from '../providers/registry.js';
import { ArchitectAgent } from './roles/architect.js';
import { CoderAgent } from './roles/coder.js';
import { ReviewerAgent } from './roles/reviewer.js';
import { TesterAgent } from './roles/tester.js';
import { FixerAgent } from './roles/fixer.js';
import { JudgeAgent } from './roles/judge.js';
import { WorkflowError } from '../core/errors.js';

/**
 * Create an agent instance for the specified role using the app config.
 *
 * @param role - Which agent to create
 * @param config - Full application config
 * @param projectRoot - Project root directory for prompt loading
 */
export function createAgent(
    role: AgentRole,
    config: AppConfig,
    projectRoot: string,
): BaseAgent {
    const agentConfig = config.agents[role];
    const provider = createProvider(agentConfig.provider, config.providers);

    const options = {
        model: agentConfig.model,
        temperature: agentConfig.temperature,
        maxTokens: agentConfig.maxTokens,
    };

    switch (role) {
        case 'architect':
            return new ArchitectAgent(provider, options, projectRoot);
        case 'coder':
            return new CoderAgent(provider, options, projectRoot);
        case 'reviewer':
            return new ReviewerAgent(provider, options, projectRoot);
        case 'tester':
            return new TesterAgent(provider, options, projectRoot);
        case 'fixer':
            return new FixerAgent(provider, options, projectRoot);
        case 'judge':
            return new JudgeAgent(provider, options, projectRoot);
        default:
            throw new WorkflowError(`Unknown agent role: ${role}`, { role });
    }
}
