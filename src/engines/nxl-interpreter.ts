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

export interface NXLExecutionSpec {
    goal: string;
    files: string[];
    workers: number;
    roles: string[];
    strategies: string[];
    verify: string[];
    skills: string[];
    workflows: string[];
    guardrails: boolean;
    consensus: 'local' | 'run' | 'global';
    memoryBackend: string;
    compressionBackend: string;
    dslCompiler?: string;
    backendMode?: 'default' | 'shadow' | 'experimental';
    skillPolicy: 'guarded-hot' | 'session-only' | 'manual';
    workflowPolicy?: 'guarded-hot' | 'session-only' | 'manual';
    derivationPolicy?: 'auto' | 'manual' | 'disabled';
    crews?: string[];
    specialists?: string[];
    optimizationProfile?: 'standard' | 'max';
    actions?: Array<Record<string, unknown>>;
    metadata?: Record<string, unknown>;
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
            const data = yaml.load(content) ?? {};
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

    public compileExecution(
        goal: string,
        parsedInput: Record<string, unknown> = {},
        useCase?: string
    ): NXLExecutionSpec {
        const induced = this.induceArmy(useCase || goal);
        const roles = normalizeStringArray(parsedInput.roles) ?? induced.map(agent => agent.name.toLowerCase().replace(/\s+/g, '-'));
        const strategies = normalizeStringArray(parsedInput.strategies) ?? ['minimal', 'standard', 'thorough'];
        const verify = normalizeStringArray(parsedInput.verify) ?? [];
        const skills = normalizeStringArray(parsedInput.skills) ?? [];
        const workflows = normalizeStringArray(parsedInput.workflows) ?? [];
        const crews = normalizeStringArray(parsedInput.crews) ?? [];
        const specialists = normalizeStringArray(parsedInput.specialists) ?? [];
        const files = normalizeStringArray(parsedInput.files) ?? [];
        const workers = normalizeNumber(parsedInput.workers) ?? Math.max(1, roles.filter(role => role.includes('coder')).length || roles.length || 1);
        const skillPolicy = normalizeSkillPolicy(parsedInput.skillPolicy);
        const workflowPolicy = normalizeSkillPolicy(parsedInput.workflowPolicy);
        const consensus = normalizeConsensus(parsedInput.consensus);
        const guardrails = typeof parsedInput.guardrails === 'boolean' ? parsedInput.guardrails : true;
        const derivationPolicy = normalizeDerivationPolicy(parsedInput.derivationPolicy);
        const backendMode = normalizeBackendMode(parsedInput.backendMode);

        return {
            goal: String(parsedInput.goal ?? goal),
            files,
            workers,
            roles,
            strategies,
            verify,
            skills,
            workflows,
            guardrails,
            consensus,
            memoryBackend: String(parsedInput.memoryBackend ?? 'sqlite-memory'),
            compressionBackend: String(parsedInput.compressionBackend ?? 'deterministic-token-supremacy'),
            dslCompiler: String(parsedInput.dslCompiler ?? 'deterministic-nxl-compiler'),
            backendMode,
            skillPolicy,
            workflowPolicy,
            derivationPolicy,
            crews,
            specialists,
            optimizationProfile: normalizeOptimizationProfile(parsedInput.optimizationProfile),
            actions: Array.isArray(parsedInput.actions)
                ? parsedInput.actions.filter((value): value is Record<string, unknown> => !!value && typeof value === 'object')
                : [],
            metadata: {
                useCase: useCase ?? null,
                inducedArchetypes: induced.map(agent => agent.name),
                mode: String(parsedInput.mode ?? 'parallel'),
            },
        };
    }
}

export const nxl = new NXLInterpreter();

function normalizeStringArray(value: unknown): string[] | null {
    if (!Array.isArray(value)) return null;
    return value.map(String).filter(Boolean);
}

function normalizeNumber(value: unknown): number | null {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function normalizeSkillPolicy(value: unknown): 'guarded-hot' | 'session-only' | 'manual' {
    if (value === 'session-only' || value === 'manual') return value;
    return 'guarded-hot';
}

function normalizeConsensus(value: unknown): 'local' | 'run' | 'global' {
    if (value === 'run' || value === 'global') return value;
    return 'local';
}

function normalizeDerivationPolicy(value: unknown): 'auto' | 'manual' | 'disabled' {
    if (value === 'manual' || value === 'disabled') return value;
    return 'auto';
}

function normalizeBackendMode(value: unknown): 'default' | 'shadow' | 'experimental' {
    if (value === 'shadow' || value === 'experimental') return value;
    return 'default';
}

function normalizeOptimizationProfile(value: unknown): 'standard' | 'max' {
    return value === 'max' ? 'max' : 'standard';
}
