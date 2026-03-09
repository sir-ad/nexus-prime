import { randomUUID } from 'crypto';
import {
    TokenSupremacyEngine,
    type FileRef,
    type ReadingPlan
} from './token-supremacy.js';
import { KVBridge, createKVBridge, type BridgeMetrics } from './kv-bridge.js';
import { type MemoryStats } from './memory.js';
import { NXLInterpreter, nxl, type AgentArchetype } from './nxl-interpreter.js';

export type BackendMode = 'default' | 'shadow' | 'experimental';

export interface BackendDescriptor {
    kind: string;
    mode: BackendMode;
    details?: Record<string, unknown>;
}

export interface MemoryBackend {
    descriptor: BackendDescriptor;
    recall(query: string, k?: number): Promise<string[]>;
    store(content: string, priority?: number, tags?: string[], parentId?: string, depth?: number): Promise<string> | string;
    stats(): MemoryStats | Record<string, unknown>;
    shadowRecall?(query: string, k?: number): Promise<Record<string, unknown>>;
}

export interface CompressionShadow {
    mode: BackendMode;
    bridgeMetrics?: BridgeMetrics;
    notes: string[];
}

export interface CompressionBackend {
    descriptor: BackendDescriptor;
    planFiles(task: string, files: FileRef[]): ReadingPlan;
    allocateWorkerBudget(workerIds: string[], plan: ReadingPlan): Map<string, number>;
    shadow(task: string, files: FileRef[]): Promise<CompressionShadow>;
}

export interface DSLExecutionSpec {
    goal: string;
    files: string[];
    workers: number;
    roles: string[];
    strategies: string[];
    verify: string[];
    skills: string[];
    guardrails: boolean;
    consensus: 'local' | 'run' | 'global';
    memoryBackend: string;
    compressionBackend: string;
    skillPolicy: 'guarded-hot' | 'session-only' | 'manual';
    actions?: Array<Record<string, unknown>>;
    metadata?: Record<string, unknown>;
}

export interface DSLCompilationResult {
    spec: DSLExecutionSpec;
    raw: Record<string, unknown>;
    archetypes: AgentArchetype[];
}

export interface DSLCompilerBackend {
    descriptor: BackendDescriptor;
    compile(goal: string, rawScript?: string, useCase?: string): DSLCompilationResult;
}

type MemoryLike = {
    recall(query: string, k?: number): Promise<string[]>;
    store(content: string, priority?: number, tags?: string[], parentId?: string, depth?: number): string;
    getStats(): MemoryStats;
};

export class SQLiteMemoryBackend implements MemoryBackend {
    descriptor: BackendDescriptor = {
        kind: 'sqlite-memory',
        mode: 'default',
        details: {
            supportsHyperbolicShadow: true,
            supportsTemporalShadow: true,
        },
    };

    constructor(private memory: MemoryLike) { }

    async recall(query: string, k: number = 5): Promise<string[]> {
        return this.memory.recall(query, k);
    }

    store(content: string, priority: number = 0.7, tags: string[] = [], parentId?: string, depth: number = 0): string {
        return this.memory.store(content, priority, tags, parentId, depth);
    }

    stats(): MemoryStats {
        return this.memory.getStats();
    }

    async shadowRecall(query: string, k: number = 5): Promise<Record<string, unknown>> {
        const recalled = await this.memory.recall(query, k);
        return {
            query,
            strategy: 'temporal-hyperbolic-shadow',
            recalled,
            notes: [
                'Using SQLite memory backend as the source of truth.',
                'Temporal/hyperbolic ranking remains in shadow mode until promoted.',
            ],
        };
    }
}

export class DeterministicCompressionBackend implements CompressionBackend {
    descriptor: BackendDescriptor = {
        kind: 'deterministic-token-supremacy',
        mode: 'default',
        details: {
            shadow: 'adaptive-kv-merge',
        },
    };

    private tokenEngine: TokenSupremacyEngine;
    private shadowBridge: KVBridge;

    constructor(tokenEngine?: TokenSupremacyEngine, shadowBridge?: KVBridge) {
        this.tokenEngine = tokenEngine ?? new TokenSupremacyEngine();
        this.shadowBridge = shadowBridge ?? createKVBridge({
            inferenceBackend: 'mock',
            endpoint: 'local-shadow',
            modelId: 'shadow-adaptive-kv-merge',
            agents: 3,
        });
    }

    planFiles(task: string, files: FileRef[]): ReadingPlan {
        return this.tokenEngine.plan(task, files);
    }

    allocateWorkerBudget(workerIds: string[], plan: ReadingPlan): Map<string, number> {
        const budgets = new Map<string, number>();
        const usable = Math.max(plan.totalEstimatedTokens, workerIds.length);
        const perWorker = Math.max(200, Math.floor(usable / Math.max(workerIds.length, 1)));
        workerIds.forEach(id => budgets.set(id, perWorker));
        return budgets;
    }

    async shadow(task: string, files: FileRef[]): Promise<CompressionShadow> {
        const bridgeMetrics = this.shadowBridge.getMetrics();
        return {
            mode: 'shadow',
            bridgeMetrics,
            notes: [
                `Shadow compression evaluation for "${task.slice(0, 80)}"`,
                `Files considered: ${files.length}`,
                'Deterministic planning remains the default apply path.',
            ],
        };
    }
}

export class DeterministicDSLCompilerBackend implements DSLCompilerBackend {
    descriptor: BackendDescriptor = {
        kind: 'deterministic-nxl-compiler',
        mode: 'default',
        details: {
            futureBackend: 'agentlang-neural',
        },
    };

    constructor(private interpreter: NXLInterpreter = nxl) { }

    compile(goal: string, rawScript?: string, useCase?: string): DSLCompilationResult {
        const raw = rawScript ? (this.interpreter.parse(rawScript) as Record<string, unknown>) : {};
        const spec = this.interpreter.compileExecution(goal, raw, useCase);
        return {
            spec,
            raw,
            archetypes: this.interpreter.induceArmy(useCase || goal),
        };
    }
}

export function buildRunId(prefix: string = 'run'): string {
    return `${prefix}_${randomUUID().slice(0, 8)}`;
}

export const createSQLiteMemoryBackend = (memory: MemoryLike) => new SQLiteMemoryBackend(memory);
export const createDeterministicCompressionBackend = (
    tokenEngine?: TokenSupremacyEngine,
    shadowBridge?: KVBridge
) => new DeterministicCompressionBackend(tokenEngine, shadowBridge);
export const createDeterministicDSLCompilerBackend = (interpreter?: NXLInterpreter) =>
    new DeterministicDSLCompilerBackend(interpreter);
