/**
 * NXL (Nexus Language) Interpreter
 * 
 * Parses declarative .nxl files to define agent archetypes, 
 * swarm sizes, and execution modes.
 */

import * as yaml from 'js-yaml';
import { nexusEventBus } from './event-bus.js';

export interface AgentArchetype {
    name: string;
    role: string;
    capabilities: string[];
    temperature: number;
    tools: string[];
}

export interface SwarmConfig {
    name: string;
    workers: number;
    mode: 'parallel' | 'sequential' | 'competitive';
    knowledgeSharing: boolean;
}

export class NXLInterpreter {
    private archetypes: Map<string, AgentArchetype> = new Map();

    constructor() {
        this.registerDefaultArchetypes();
    }

    private registerDefaultArchetypes() {
        this.archetypes.set('product-dev', {
            name: 'Product Developer',
            role: 'End-to-end product implementation (PDLC)',
            capabilities: ['planning', 'coding', 'testing', 'documentation'],
            temperature: 0.7,
            tools: ['grep_search', 'write_to_file', 'run_command']
        });

        this.archetypes.set('researcher', {
            name: 'Deep Researcher',
            role: 'Log analysis and codebase archaeology',
            capabilities: ['analysis', 'pattern-matching', 'context-retrieval'],
            temperature: 0.2,
            tools: ['nexus_recall_memory', 'githubSearchCode', 'grep_search']
        });

        this.archetypes.set('architect', {
            name: 'System Architect',
            role: 'High-level structural design and risk analysis',
            capabilities: ['modelling', 'risk-assessment', 'dependency-mapping'],
            temperature: 0.4,
            tools: ['nexus_ghost_pass', 'nexus_decompose_task', 'nexus_graph_query']
        });

        this.archetypes.set('ux-validator', {
            name: 'UX Validator',
            role: 'Runtime verification and UI/UX testing',
            capabilities: ['visual-check', 'interaction-testing', 'latency-analysis'],
            temperature: 0.5,
            tools: ['read_browser_page', 'command_status', 'nexus_request_affirmation']
        });
    }

    /**
     * Parses a .nxl file (YAML format) and extracts swarm or archetype definitions.
     */
    public parse(content: string): any {
        try {
            const data = yaml.load(content);
            nexusEventBus.emit('nexusnet.sync', { newItemsCount: 1 }); // Mocking event for now
            return data;
        } catch (error) {
            throw new Error(`NXL Parse Error: ${(error as Error).message}`);
        }
    }

    /**
     * Induces a specialized "army" of agents based on the use case.
     */
    public induceArmy(useCase: string): AgentArchetype[] {
        const army: AgentArchetype[] = [];
        const uc = useCase.toLowerCase();

        if (uc.includes('pdlc') || uc.includes('product')) {
            army.push(this.archetypes.get('architect')!);
            army.push(this.archetypes.get('product-dev')!);
            army.push(this.archetypes.get('ux-validator')!);
        } else if (uc.includes('research') || uc.includes('bug') || uc.includes('investigate')) {
            army.push(this.archetypes.get('researcher')!);
            army.push(this.archetypes.get('architect')!);
        } else {
            // Default: Generalist Swarm
            army.push(this.archetypes.get('product-dev')!);
            army.push(this.archetypes.get('researcher')!);
        }

        return army;
    }

    public getArchetype(name: string): AgentArchetype | undefined {
        return this.archetypes.get(name);
    }
}

export const nxl = new NXLInterpreter();
