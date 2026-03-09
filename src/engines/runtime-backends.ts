import { randomUUID } from 'crypto';
import {
    TokenSupremacyEngine,
    type FileRef,
    type ReadingPlan
} from './token-supremacy.js';
import { KVBridge, createKVBridge, type BridgeMetrics } from './kv-bridge.js';
import { MetaLearner } from './meta-learner.js';
import { type MemoryItem, type MemoryStats } from './memory.js';
import { NXLInterpreter, nxl, type AgentArchetype } from './nxl-interpreter.js';

export type BackendMode = 'default' | 'shadow' | 'experimental';

export interface BackendDescriptor {
    kind: string;
    mode: BackendMode;
    details?: Record<string, unknown>;
}

export interface MemorySnapshotCapable {
    snapshot?(limit?: number): MemoryItem[];
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

export interface CompressionPlanResult {
    plan: ReadingPlan;
    notes: string[];
}

export interface CompressionBackend {
    descriptor: BackendDescriptor;
    planFiles(task: string, files: FileRef[]): ReadingPlan | CompressionPlanResult;
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
    workflows: string[];
    guardrails: boolean;
    consensus: 'local' | 'run' | 'global';
    memoryBackend: string;
    compressionBackend: string;
    dslCompiler?: string;
    backendMode?: BackendMode;
    skillPolicy: 'guarded-hot' | 'session-only' | 'manual';
    workflowPolicy?: 'guarded-hot' | 'session-only' | 'manual';
    derivationPolicy?: 'auto' | 'manual' | 'disabled';
    actions?: Array<Record<string, unknown>>;
    metadata?: Record<string, unknown>;
}

export interface DSLCompilationResult {
    spec: DSLExecutionSpec;
    raw: Record<string, unknown>;
    archetypes: AgentArchetype[];
    notes?: string[];
}

export interface DSLCompilerBackend {
    descriptor: BackendDescriptor;
    compile(goal: string, rawScript?: string, useCase?: string): DSLCompilationResult;
}

type MemoryLike = {
    recall(query: string, k?: number): Promise<string[]>;
    store(content: string, priority?: number, tags?: string[], parentId?: string, depth?: number): string;
    getStats(): MemoryStats;
} & MemorySnapshotCapable;

export class SQLiteMemoryBackend implements MemoryBackend {
    descriptor: BackendDescriptor = {
        kind: 'sqlite-memory',
        mode: 'default',
        details: {
            supportsHyperbolicShadow: true,
            supportsTemporalShadow: true,
        },
    };

    constructor(protected memory: MemoryLike) { }

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

export class TemporalHyperbolicMemoryBackend extends SQLiteMemoryBackend {
    descriptor: BackendDescriptor = {
        kind: 'temporal-hyperbolic-memory',
        mode: 'experimental',
        details: {
            strategy: 'priority+recency+depth',
        },
    };

    async recall(query: string, k: number = 5): Promise<string[]> {
        const snapshot = this.memory.snapshot?.(Math.max(k * 6, 24)) ?? [];
        if (snapshot.length === 0) {
            return super.recall(query, k);
        }

        const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
        return snapshot
            .map((item) => ({
                item,
                score: rankTemporalHyperbolic(queryTerms, item),
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, k)
            .map(({ item }) => item.content);
    }

    async shadowRecall(query: string, k: number = 5): Promise<Record<string, unknown>> {
        const promoted = await this.recall(query, k);
        const baseline = await super.recall(query, k);
        return {
            query,
            baseline,
            promoted,
            notes: [
                'Temporal/hyperbolic backend reranks by recency, priority, and hierarchy depth.',
                'Baseline SQLite recall is preserved for fallback and comparison.',
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

    protected tokenEngine: TokenSupremacyEngine;
    protected shadowBridge: KVBridge;

    constructor(tokenEngine?: TokenSupremacyEngine, shadowBridge?: KVBridge) {
        this.tokenEngine = tokenEngine ?? new TokenSupremacyEngine();
        this.shadowBridge = shadowBridge ?? createKVBridge({
            inferenceBackend: 'mock',
            endpoint: 'local-shadow',
            modelId: 'shadow-adaptive-kv-merge',
            agents: 3,
        });
    }

    planFiles(task: string, files: FileRef[]): ReadingPlan | CompressionPlanResult {
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

export class MetaCompressionBackend extends DeterministicCompressionBackend {
    descriptor: BackendDescriptor = {
        kind: 'meta-compression',
        mode: 'experimental',
        details: {
            driver: 'meta-learner+kv-bridge',
        },
    };

    private metaLearner = new MetaLearner();

    planFiles(task: string, files: FileRef[]): CompressionPlanResult {
        const baseline = normalizeReadingPlan(super.planFiles(task, files)).plan;
        const candidateFiles = baseline.files.slice(0, Math.min(6, baseline.files.length));
        const scores = candidateFiles.map((entry, index) => {
            const prediction = this.metaLearner.predict(
                [[entry.estimatedTokens || 1]],
                task,
                index + 1,
                Math.max(candidateFiles.length, 1),
                [entry.estimatedTokens || 1, entry.file.sizeBytes || 1],
                [Math.max(1, Math.floor((entry.estimatedTokens || 1) / 2)), Math.max(1, Math.floor((entry.file.sizeBytes || 1) / 2))]
            );
            return {
                path: entry.file.path,
                shouldMerge: prediction.shouldMerge,
                t: prediction.t,
                gamma: prediction.gamma,
            };
        });

        const fullPaths = new Set(scores.filter((score) => score.shouldMerge || score.t > 0.55).map((score) => score.path));
        const adjustedFiles = baseline.files.map((entry) => {
            if (fullPaths.has(entry.file.path) && entry.action !== 'full') {
                return {
                    ...entry,
                    action: 'partial' as const,
                    reason: `${entry.reason}; meta-compression retained more context`,
                };
            }
            return entry;
        });

        return {
            plan: {
                ...baseline,
                files: adjustedFiles,
            },
            notes: [
                `Meta-compression evaluated ${scores.length} candidate file chunks.`,
                'Deterministic plan remains available for fallback.',
            ],
        };
    }

    allocateWorkerBudget(workerIds: string[], plan: ReadingPlan): Map<string, number> {
        const budgets = new Map<string, number>();
        const total = Math.max(plan.totalEstimatedTokens, workerIds.length * 200);
        workerIds.forEach((id, index) => {
            const weight = 1 + ((workerIds.length - index) / Math.max(workerIds.length, 1)) * 0.25;
            budgets.set(id, Math.max(200, Math.round((total / Math.max(workerIds.length, 1)) * weight)));
        });
        return budgets;
    }

    async shadow(task: string, files: FileRef[]): Promise<CompressionShadow> {
        const base = await super.shadow(task, files);
        return {
            ...base,
            mode: 'experimental',
            notes: [...base.notes, 'Meta-compression can materially alter worker budgets and file routing.'],
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

    constructor(protected interpreter: NXLInterpreter = nxl) { }

    compile(goal: string, rawScript?: string, useCase?: string): DSLCompilationResult {
        const raw = rawScript ? (this.interpreter.parse(rawScript) as Record<string, unknown>) : {};
        const spec = this.interpreter.compileExecution(goal, raw, useCase);
        return {
            spec,
            raw,
            archetypes: this.interpreter.induceArmy(useCase || goal),
            notes: ['Deterministic NXL compilation selected.'],
        };
    }
}

export class ExperimentalAgentLangCompilerBackend extends DeterministicDSLCompilerBackend {
    descriptor: BackendDescriptor = {
        kind: 'agentlang-neural-compiler',
        mode: 'experimental',
        details: {
            fallback: 'deterministic-nxl-compiler',
        },
    };

    compile(goal: string, rawScript?: string, useCase?: string): DSLCompilationResult {
        const compiled = super.compile(goal, rawScript, useCase);
        const normalizedRoles = Array.from(new Set([...compiled.spec.roles, 'skill-maker', 'research-shadow']));
        return {
            ...compiled,
            spec: {
                ...compiled.spec,
                roles: normalizedRoles,
                backendMode: 'experimental',
                metadata: {
                    ...compiled.spec.metadata,
                    compilerPath: 'experimental-agentlang-neural',
                },
            },
            notes: [...(compiled.notes ?? []), 'Experimental AgentLang/neural compiler path selected.', 'Validation fallback remains deterministic.'],
        };
    }
}

export interface RuntimeBackendRegistry {
    memory: Map<string, MemoryBackend>;
    compression: Map<string, CompressionBackend>;
    dsl: Map<string, DSLCompilerBackend>;
}

export interface BackendResolution<T> {
    selected: T;
    descriptor: BackendDescriptor;
    fallback?: string;
}

export function buildRunId(prefix: string = 'run'): string {
    return `${prefix}_${randomUUID().slice(0, 8)}`;
}

export function normalizeReadingPlan(result: ReadingPlan | CompressionPlanResult): CompressionPlanResult {
    return 'plan' in result ? result : { plan: result, notes: [] };
}

export function createRuntimeBackendRegistry(memory: MemoryLike): RuntimeBackendRegistry {
    const deterministicCompression = new DeterministicCompressionBackend();
    const registry: RuntimeBackendRegistry = {
        memory: new Map<string, MemoryBackend>([
            ['sqlite-memory', new SQLiteMemoryBackend(memory)],
            ['temporal-hyperbolic-memory', new TemporalHyperbolicMemoryBackend(memory)],
        ]),
        compression: new Map<string, CompressionBackend>([
            ['deterministic-token-supremacy', deterministicCompression],
            ['meta-compression', new MetaCompressionBackend()],
        ]),
        dsl: new Map<string, DSLCompilerBackend>([
            ['deterministic-nxl-compiler', new DeterministicDSLCompilerBackend()],
            ['agentlang-neural-compiler', new ExperimentalAgentLangCompilerBackend()],
        ]),
    };

    return registry;
}

export function resolveBackend<T>(
    registry: Map<string, T>,
    requested: string | undefined,
    fallbackKey: string
): BackendResolution<T> {
    if (requested && registry.has(requested)) {
        const selected = registry.get(requested)!;
        const descriptor = (selected as any).descriptor as BackendDescriptor;
        return { selected, descriptor };
    }

    const selected = registry.get(fallbackKey)!;
    const descriptor = (selected as any).descriptor as BackendDescriptor;
    return {
        selected,
        descriptor,
        fallback: requested && requested !== fallbackKey ? fallbackKey : undefined,
    };
}

function rankTemporalHyperbolic(queryTerms: string[], item: MemoryItem): number {
    const content = item.content.toLowerCase();
    const overlap = queryTerms.reduce((sum, term) => sum + (content.includes(term) ? 1 : 0), 0);
    const recency = Math.exp(-(Date.now() - item.timestamp) / (14 * 24 * 3600 * 1000));
    const depthBonus = 1 / (1 + Math.max(item.depth ?? 0, 0));
    return overlap * 0.45 + item.priority * 0.25 + recency * 0.2 + depthBonus * 0.1;
}

export const createSQLiteMemoryBackend = (memory: MemoryLike) => new SQLiteMemoryBackend(memory);
export const createDeterministicCompressionBackend = (
    tokenEngine?: TokenSupremacyEngine,
    shadowBridge?: KVBridge
) => new DeterministicCompressionBackend(tokenEngine, shadowBridge);
export const createDeterministicDSLCompilerBackend = (interpreter?: NXLInterpreter) =>
    new DeterministicDSLCompilerBackend(interpreter);
