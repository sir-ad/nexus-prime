import * as fs from 'fs';
import * as path from 'path';
import { MemoryEngine } from './memory.js';
import { PatternRegistry, type PatternCard, type PatternSearchResult } from './pattern-registry.js';
import {
    RuntimeRegistry,
    resolveNexusStateDir,
    type RuntimeRegistrySnapshot,
} from './runtime-registry.js';
import { RagCollectionStore, type RagCollectionSummary, type RagRetrievalHit } from './rag-collections.js';
import { TokenSupremacyEngine, type FileRef, type ReadingPlan } from './token-supremacy.js';

export type KnowledgeSourceClass = 'repo' | 'memory' | 'rag' | 'patterns' | 'runtime';
export type ModelTier = 'low' | 'high';

export interface SourceMixDecision {
    dominantSource: KnowledgeSourceClass;
    weights: Record<KnowledgeSourceClass, number>;
    reasons: string[];
}

export interface TokenBudgetAllocation {
    totalBudget: number;
    bySource: Record<KnowledgeSourceClass, number>;
    byStage: Record<'bootstrap' | 'planning' | 'mutation' | 'verification' | 'continuation', number>;
    dropped: Array<{ sourceClass: KnowledgeSourceClass; label: string; reason: string }>;
}

export interface ContextProvenanceEntry {
    sourceClass: KnowledgeSourceClass;
    id: string;
    label: string;
    summary: string;
    tokens: number;
    stage: string;
    selected: boolean;
    reason: string;
    score: number;
}

export interface ContextProvenanceTrace {
    entries: ContextProvenanceEntry[];
}

export interface ModelTierPolicy {
    lowTierStages: string[];
    highTierStages: string[];
    escalationRules: string[];
}

export interface ModelTierTrace {
    stage: string;
    tier: ModelTier;
    reason: string;
    escalated: boolean;
}

export interface KnowledgeFabricBundle {
    runtimeId: string;
    sessionId: string;
    task: string;
    generatedAt: number;
    sourceMix: SourceMixDecision;
    tokenBudget: TokenBudgetAllocation;
    provenance: ContextProvenanceTrace;
    modelTierPolicy: ModelTierPolicy;
    modelTierTrace: ModelTierTrace[];
    repo: {
        candidateFiles: string[];
        selectedFiles: string[];
        readingPlan?: ReadingPlan;
    };
    memory: {
        matches: string[];
    };
    rag: {
        attachedCollections: RagCollectionSummary[];
        hits: RagRetrievalHit[];
    };
    patterns: {
        selected: PatternSearchResult[];
        shortlist: PatternCard[];
    };
    runtime: {
        priorObjectives: string[];
        skipReasons: string[];
        lastToolCalls: string[];
        lastRunId?: string;
    };
    recommendations: {
        skills: string[];
        workflows: string[];
        hooks: string[];
        automations: string[];
        crews: string[];
        specialists: string[];
    };
    summary: string;
}

export interface KnowledgeFabricSnapshot {
    runtimeId: string;
    sessionId: string;
    generatedAt: number;
    task: string;
    sourceMix: SourceMixDecision;
    tokenBudget: TokenBudgetAllocation;
    attachedCollections: RagCollectionSummary[];
    patternHits: Array<{ patternId: string; name: string; score: number }>;
    selectedFiles: string[];
    candidateFiles: string[];
    recommendations: KnowledgeFabricBundle['recommendations'];
    modelTierPolicy: ModelTierPolicy;
    modelTierTrace: ModelTierTrace[];
    provenance: ContextProvenanceTrace;
    summary: string;
}

interface ComposeInput {
    runtimeId: string;
    sessionId: string;
    task: string;
    candidateFiles: string[];
    memoryMatches: string[];
    runtimeSnapshot?: RuntimeRegistrySnapshot;
    tokenBudget?: number;
    intent?: {
        riskClass?: string;
        complexity?: number;
        taskType?: string;
    };
}

export class KnowledgeFabricEngine {
    private readonly repoRoot: string;
    private readonly stateDir: string;
    private readonly tokenEngine: TokenSupremacyEngine;
    private readonly runtimeRegistry: RuntimeRegistry;
    private readonly ragCollections: RagCollectionStore;
    private readonly patternRegistry: PatternRegistry;
    private readonly memory?: MemoryEngine;

    constructor(options: {
        repoRoot?: string;
        stateRoot?: string;
        memory?: MemoryEngine;
        runtimeRegistry?: RuntimeRegistry;
        tokenEngine?: TokenSupremacyEngine;
        ragCollections?: RagCollectionStore;
        patternRegistry?: PatternRegistry;
    } = {}) {
        this.repoRoot = options.repoRoot ?? process.cwd();
        this.stateDir = path.join(options.stateRoot ?? resolveNexusStateDir(), 'knowledge-fabric');
        this.tokenEngine = options.tokenEngine ?? new TokenSupremacyEngine();
        this.runtimeRegistry = options.runtimeRegistry ?? new RuntimeRegistry(options.stateRoot);
        this.ragCollections = options.ragCollections ?? new RagCollectionStore(options.stateRoot);
        this.patternRegistry = options.patternRegistry ?? new PatternRegistry(options.stateRoot);
        this.memory = options.memory;
        fs.mkdirSync(this.stateDir, { recursive: true });
    }

    compose(input: ComposeInput): KnowledgeFabricBundle {
        const runtimeSnapshot = input.runtimeSnapshot ?? this.runtimeRegistry.read(input.runtimeId);
        const fileRefs = input.candidateFiles.map((entry) => toFileRef(entry)).filter((entry): entry is FileRef => Boolean(entry));
        const readingPlan = fileRefs.length > 0 ? this.tokenEngine.plan(input.task, fileRefs) : undefined;
        const selectedFiles = readingPlan
            ? readingPlan.files.filter((file) => file.action !== 'skip').map((file) => file.file.path)
            : input.candidateFiles;
        const attachedCollections = this.ragCollections.listCollections().filter((collection) => (
            collection.attachedRuntimeIds.includes(input.runtimeId)
            || collection.attachedSessionIds.includes(input.sessionId)
        ));
        const ragHits = this.ragCollections.retrieve(input.task, {
            runtimeId: input.runtimeId,
            sessionId: input.sessionId,
            limit: 6,
        });
        const selectedPatterns = this.patternRegistry.search(input.task, 5);
        const shortlistPatterns = this.patternRegistry.list().slice(0, 6);
        const sourceMix = this.buildSourceMix({
            repoFiles: input.candidateFiles.length,
            memoryMatches: input.memoryMatches.length,
            ragHits: ragHits.length,
            patternHits: selectedPatterns.length,
            runtimeSnapshot,
        });
        const tokenBudget = this.allocateTokenBudget({
            totalBudget: input.tokenBudget ?? 12_000,
            readingPlan,
            memoryMatches: input.memoryMatches,
            ragHits,
            selectedPatterns,
            runtimeSnapshot,
        });
        const recommendations = this.buildRecommendations(selectedPatterns, runtimeSnapshot, ragHits.length > 0);
        const modelTierPolicy = this.buildModelTierPolicy();
        const modelTierTrace = this.buildModelTierTrace(input, sourceMix);
        const provenance = this.buildProvenance({
            candidateFiles: input.candidateFiles,
            selectedFiles,
            memoryMatches: input.memoryMatches,
            ragHits,
            selectedPatterns,
            runtimeSnapshot,
        });
        const bundle: KnowledgeFabricBundle = {
            runtimeId: input.runtimeId,
            sessionId: input.sessionId,
            task: input.task,
            generatedAt: Date.now(),
            sourceMix,
            tokenBudget,
            provenance,
            modelTierPolicy,
            modelTierTrace,
            repo: {
                candidateFiles: input.candidateFiles,
                selectedFiles,
                readingPlan,
            },
            memory: {
                matches: input.memoryMatches.slice(0, 8),
            },
            rag: {
                attachedCollections,
                hits: ragHits,
            },
            patterns: {
                selected: selectedPatterns,
                shortlist: shortlistPatterns,
            },
            runtime: {
                priorObjectives: runtimeSnapshot?.orchestration?.objectiveHistory?.slice(0, 8) ?? [],
                skipReasons: runtimeSnapshot?.skipReasons ?? [],
                lastToolCalls: runtimeSnapshot?.lastToolCalls ?? [],
                lastRunId: runtimeSnapshot?.latestRun?.runId,
            },
            recommendations,
            summary: this.summarizeBundle(sourceMix, selectedFiles, ragHits, selectedPatterns, modelTierTrace),
        };
        this.persistBundle(bundle);
        return bundle;
    }

    listCollections(): RagCollectionSummary[] {
        return this.ragCollections.listCollections();
    }

    getCollection(collectionId: string) {
        return this.ragCollections.getCollection(collectionId);
    }

    createCollection(input: { name: string; description?: string; tags?: string[]; scope?: 'session' | 'project' }) {
        return this.ragCollections.createCollection(input);
    }

    ingestCollection(collectionId: string, inputs: Array<{ filePath?: string; url?: string; text?: string; label?: string; tags?: string[] }>) {
        return this.ragCollections.ingestCollection(collectionId, inputs);
    }

    attachCollection(collectionId: string, runtimeId: string, sessionId?: string) {
        return this.ragCollections.attachCollection(collectionId, runtimeId, sessionId);
    }

    detachCollection(collectionId: string, runtimeId?: string, sessionId?: string) {
        return this.ragCollections.detachCollection(collectionId, runtimeId, sessionId);
    }

    deleteCollection(collectionId: string): boolean {
        return this.ragCollections.deleteCollection(collectionId);
    }

    listPatterns(): PatternCard[] {
        return this.patternRegistry.list();
    }

    searchPatterns(query: string, limit: number = 6): PatternSearchResult[] {
        return this.patternRegistry.search(query, limit);
    }

    recordPatternOutcome(patternId: string, success: boolean): void {
        this.patternRegistry.recordOutcome(patternId, success);
    }

    getSessionSnapshot(runtimeId: string): KnowledgeFabricSnapshot | undefined {
        const target = path.join(this.stateDir, runtimeId, 'latest.json');
        if (!fs.existsSync(target)) return undefined;
        try {
            return JSON.parse(fs.readFileSync(target, 'utf8')) as KnowledgeFabricSnapshot;
        } catch {
            return undefined;
        }
    }

    getProvenance(runtimeId: string): ContextProvenanceTrace {
        return this.getSessionSnapshot(runtimeId)?.provenance ?? { entries: [] };
    }

    getTokensBySource(runtimeId: string): Record<string, number> {
        return this.runtimeRegistry.read(runtimeId)?.tokens?.bySourceClass ?? {};
    }

    getModelTiers(runtimeId: string): { policy?: ModelTierPolicy; trace: ModelTierTrace[] } {
        const snapshot = this.getSessionSnapshot(runtimeId);
        return {
            policy: snapshot?.modelTierPolicy,
            trace: snapshot?.modelTierTrace ?? [],
        };
    }

    private persistBundle(bundle: KnowledgeFabricBundle): void {
        const runtimeDir = path.join(this.stateDir, bundle.runtimeId);
        fs.mkdirSync(runtimeDir, { recursive: true });
        const snapshot: KnowledgeFabricSnapshot = {
            runtimeId: bundle.runtimeId,
            sessionId: bundle.sessionId,
            generatedAt: bundle.generatedAt,
            task: bundle.task,
            sourceMix: bundle.sourceMix,
            tokenBudget: bundle.tokenBudget,
            attachedCollections: bundle.rag.attachedCollections,
            patternHits: bundle.patterns.selected.map((pattern) => ({
                patternId: pattern.patternId,
                name: pattern.name,
                score: pattern.score,
            })),
            selectedFiles: bundle.repo.selectedFiles,
            candidateFiles: bundle.repo.candidateFiles,
            recommendations: bundle.recommendations,
            modelTierPolicy: bundle.modelTierPolicy,
            modelTierTrace: bundle.modelTierTrace,
            provenance: bundle.provenance,
            summary: bundle.summary,
        };
        fs.writeFileSync(path.join(runtimeDir, 'latest.json'), JSON.stringify(snapshot, null, 2), 'utf8');
        fs.writeFileSync(path.join(runtimeDir, `${bundle.sessionId}.json`), JSON.stringify(snapshot, null, 2), 'utf8');
    }

    private buildSourceMix(input: {
        repoFiles: number;
        memoryMatches: number;
        ragHits: number;
        patternHits: number;
        runtimeSnapshot?: RuntimeRegistrySnapshot;
    }): SourceMixDecision {
        const rawWeights: Record<KnowledgeSourceClass, number> = {
            repo: input.repoFiles > 0 ? 4 + Math.min(input.repoFiles, 6) : 0,
            memory: input.memoryMatches > 0 ? 3 + Math.min(input.memoryMatches, 4) : 0,
            rag: input.ragHits > 0 ? 3 + Math.min(input.ragHits, 4) : 0,
            patterns: input.patternHits > 0 ? 2 + Math.min(input.patternHits, 3) : 0,
            runtime: input.runtimeSnapshot?.executionLedger ? 2 + Math.min((input.runtimeSnapshot.lastToolCalls ?? []).length, 3) : 0,
        };
        const total = Object.values(rawWeights).reduce((sum, value) => sum + value, 0) || 1;
        const weights = Object.fromEntries(
            Object.entries(rawWeights).map(([key, value]) => [key, Number((value / total).toFixed(2))]),
        ) as Record<KnowledgeSourceClass, number>;
        const dominantSource = (Object.entries(weights).sort((left, right) => right[1] - left[1])[0]?.[0] ?? 'repo') as KnowledgeSourceClass;
        const reasons = [
            weights.repo > 0 ? `${Math.round(weights.repo * 100)}% repo weight from candidate-file discovery.` : 'Repo discovery contributed no files.',
            weights.memory > 0 ? `${Math.round(weights.memory * 100)}% memory weight from recalled learnings.` : 'Memory recall was low-signal.',
            weights.rag > 0 ? `${Math.round(weights.rag * 100)}% RAG weight from attached collection hits.` : 'No attached RAG collections matched.',
            weights.patterns > 0 ? `${Math.round(weights.patterns * 100)}% pattern weight from reusable orchestration cards.` : 'Pattern registry added no matching cards.',
            weights.runtime > 0 ? `${Math.round(weights.runtime * 100)}% runtime weight from prior ledgers and packet traces.` : 'No runtime history influenced this run.',
        ];
        return { dominantSource, weights, reasons };
    }

    private allocateTokenBudget(input: {
        totalBudget: number;
        readingPlan?: ReadingPlan;
        memoryMatches: string[];
        ragHits: RagRetrievalHit[];
        selectedPatterns: PatternSearchResult[];
        runtimeSnapshot?: RuntimeRegistrySnapshot;
    }): TokenBudgetAllocation {
        const base: Record<KnowledgeSourceClass, number> = {
            repo: input.readingPlan ? Math.min(input.totalBudget * 0.42, input.readingPlan.totalEstimatedTokens) : Math.round(input.totalBudget * 0.34),
            memory: Math.min(input.totalBudget * 0.16, input.memoryMatches.reduce((sum, entry) => sum + estimateTokens(entry), 0)),
            rag: Math.min(input.totalBudget * 0.2, input.ragHits.reduce((sum, entry) => sum + entry.tokens, 0)),
            patterns: Math.min(input.totalBudget * 0.12, input.selectedPatterns.reduce((sum, entry) => sum + estimateTokens(entry.summary), 0)),
            runtime: Math.min(input.totalBudget * 0.1, estimateTokens(JSON.stringify({
                objectiveHistory: input.runtimeSnapshot?.orchestration?.objectiveHistory ?? [],
                skipReasons: input.runtimeSnapshot?.skipReasons ?? [],
                lastToolCalls: input.runtimeSnapshot?.lastToolCalls ?? [],
            }))),
        };
        const normalized = normalizeBudget(base, input.totalBudget);
        const dropped: Array<{ sourceClass: KnowledgeSourceClass; label: string; reason: string }> = [];
        if (!input.readingPlan) {
            dropped.push({ sourceClass: 'repo', label: 'repo-plan', reason: 'no-readable-candidate-files' });
        }
        if (input.ragHits.length === 0) {
            dropped.push({ sourceClass: 'rag', label: 'rag-hits', reason: 'no-attached-collection-matches' });
        }
        if (input.selectedPatterns.length === 0) {
            dropped.push({ sourceClass: 'patterns', label: 'pattern-cards', reason: 'no-pattern-matches' });
        }
        return {
            totalBudget: input.totalBudget,
            bySource: normalized,
            byStage: {
                bootstrap: Math.round(input.totalBudget * 0.18),
                planning: Math.round(input.totalBudget * 0.24),
                mutation: Math.round(input.totalBudget * 0.3),
                verification: Math.round(input.totalBudget * 0.18),
                continuation: Math.max(0, input.totalBudget - (
                    Math.round(input.totalBudget * 0.18)
                    + Math.round(input.totalBudget * 0.24)
                    + Math.round(input.totalBudget * 0.3)
                    + Math.round(input.totalBudget * 0.18)
                )),
            },
            dropped,
        };
    }

    private buildRecommendations(selectedPatterns: PatternSearchResult[], runtimeSnapshot?: RuntimeRegistrySnapshot, hasRag: boolean = false): KnowledgeFabricBundle['recommendations'] {
        const recommendations = {
            skills: dedupeStrings(selectedPatterns.flatMap((pattern) => pattern.suggestedSkills)),
            workflows: dedupeStrings(selectedPatterns.flatMap((pattern) => pattern.suggestedWorkflows)),
            hooks: dedupeStrings(selectedPatterns.flatMap((pattern) => pattern.suggestedHooks)),
            automations: dedupeStrings(selectedPatterns.flatMap((pattern) => pattern.suggestedAutomations)),
            crews: dedupeStrings(selectedPatterns.flatMap((pattern) => pattern.suggestedCrews)),
            specialists: dedupeStrings(selectedPatterns.flatMap((pattern) => pattern.suggestedSpecialists)),
        };
        if (hasRag && !recommendations.workflows.includes('research-and-implement')) {
            recommendations.workflows = dedupeStrings(['research-and-implement', ...recommendations.workflows]);
        }
        if ((runtimeSnapshot?.orchestration?.repeatedFailures ?? 0) > 0 && !recommendations.automations.includes('failure-recovery-automation')) {
            recommendations.automations = dedupeStrings(['failure-recovery-automation', ...recommendations.automations]);
        }
        return recommendations;
    }

    private buildModelTierPolicy(): ModelTierPolicy {
        return {
            lowTierStages: [
                'intent-classification',
                'candidate-file-discovery',
                'query-rewrite',
                'pattern-shortlist',
                'chunk-ranking',
                'compression-proposal',
                'eval-triage',
                'post-run-summary',
            ],
            highTierStages: [
                'orchestration-package',
                'risky-planning',
                'mutation-authority',
                'merge-apply',
                'governance-override',
                'promotion',
            ],
            escalationRules: [
                'Escalate to the high tier when riskClass is high.',
                'Escalate when pattern confidence is below 0.65.',
                'Escalate when RAG and runtime traces disagree with repo evidence.',
            ],
        };
    }

    private buildModelTierTrace(input: ComposeInput, sourceMix: SourceMixDecision): ModelTierTrace[] {
        const highRisk = input.intent?.riskClass === 'high';
        const mixedContext = sourceMix.weights.rag > 0 && sourceMix.weights.repo > 0 && sourceMix.weights.runtime > 0;
        return [
            { stage: 'intent-classification', tier: 'low', reason: 'low-tier can classify task shape and ambiguity.', escalated: false },
            { stage: 'candidate-file-discovery', tier: 'low', reason: 'low-tier can rank likely repo hotspots.', escalated: false },
            { stage: 'pattern-shortlist', tier: 'low', reason: 'low-tier can filter reusable pattern cards.', escalated: false },
            {
                stage: 'orchestration-package',
                tier: 'high',
                reason: highRisk || mixedContext ? 'high tier selected because the run is risky or cross-source.' : 'high tier owns final package selection by policy.',
                escalated: highRisk || mixedContext,
            },
            {
                stage: 'mutation-authority',
                tier: 'high',
                reason: 'low-tier models never own mutation authority.',
                escalated: true,
            },
            {
                stage: 'merge-apply',
                tier: 'high',
                reason: 'merge/apply is guarded and stays on the high tier.',
                escalated: true,
            },
        ];
    }

    private buildProvenance(input: {
        candidateFiles: string[];
        selectedFiles: string[];
        memoryMatches: string[];
        ragHits: RagRetrievalHit[];
        selectedPatterns: PatternSearchResult[];
        runtimeSnapshot?: RuntimeRegistrySnapshot;
    }): ContextProvenanceTrace {
        const selectedFilesSet = new Set(input.selectedFiles);
        const entries: ContextProvenanceEntry[] = [
            ...input.candidateFiles.map((filePath) => ({
                sourceClass: 'repo' as const,
                id: filePath,
                label: path.relative(process.cwd(), filePath) || filePath,
                summary: selectedFilesSet.has(filePath) ? 'Selected by repo reading plan.' : 'Candidate repo file dropped by budgeting.',
                tokens: estimateTokens(filePath),
                stage: 'bootstrap',
                selected: selectedFilesSet.has(filePath),
                reason: selectedFilesSet.has(filePath) ? 'repo-reading-plan' : 'repo-budget-drop',
                score: selectedFilesSet.has(filePath) ? 10 : 3,
            })),
            ...input.memoryMatches.slice(0, 8).map((match, index) => ({
                sourceClass: 'memory' as const,
                id: `memory_${index + 1}`,
                label: `memory-${index + 1}`,
                summary: match,
                tokens: estimateTokens(match),
                stage: 'bootstrap',
                selected: true,
                reason: 'recalled-memory',
                score: 8,
            })),
            ...input.ragHits.map((hit) => ({
                sourceClass: 'rag' as const,
                id: hit.chunkId,
                label: `${hit.collectionName}: ${hit.label}`,
                summary: hit.text.slice(0, 240),
                tokens: hit.tokens,
                stage: 'planning',
                selected: true,
                reason: 'attached-collection-hit',
                score: hit.score,
            })),
            ...input.selectedPatterns.map((pattern) => ({
                sourceClass: 'patterns' as const,
                id: pattern.patternId,
                label: pattern.name,
                summary: pattern.summary,
                tokens: estimateTokens(pattern.summary),
                stage: 'planning',
                selected: true,
                reason: 'pattern-shortlist',
                score: pattern.score,
            })),
        ];
        if (input.runtimeSnapshot) {
            entries.push({
                sourceClass: 'runtime',
                id: input.runtimeSnapshot.latestRun?.runId ?? input.runtimeSnapshot.runtimeId,
                label: 'runtime-trace',
                summary: `Last tool chain: ${(input.runtimeSnapshot.lastToolCalls ?? []).join(' -> ') || 'none'}`,
                tokens: estimateTokens(JSON.stringify({
                    objectiveHistory: input.runtimeSnapshot.orchestration?.objectiveHistory ?? [],
                    skipReasons: input.runtimeSnapshot.skipReasons ?? [],
                })),
                stage: 'planning',
                selected: true,
                reason: 'runtime-ledger-trace',
                score: 7,
            });
        }
        return { entries };
    }

    private summarizeBundle(
        sourceMix: SourceMixDecision,
        selectedFiles: string[],
        ragHits: RagRetrievalHit[],
        patterns: PatternSearchResult[],
        modelTierTrace: ModelTierTrace[],
    ): string {
        const lowTierStages = modelTierTrace.filter((stage) => stage.tier === 'low').map((stage) => stage.stage);
        return [
            `Dominant source: ${sourceMix.dominantSource}.`,
            `${selectedFiles.length} repo files retained after source-aware budgeting.`,
            ragHits.length > 0 ? `${ragHits.length} attached RAG chunk(s) grounded the plan.` : 'No RAG chunks contributed to this run.',
            patterns.length > 0 ? `${patterns.length} pattern card(s) shaped orchestration.` : 'Pattern registry added no matching cards.',
            `Low-tier stages: ${lowTierStages.join(', ') || 'none'}.`,
        ].join(' ');
    }
}

function normalizeBudget(base: Record<KnowledgeSourceClass, number>, totalBudget: number): Record<KnowledgeSourceClass, number> {
    const total = Object.values(base).reduce((sum, value) => sum + value, 0) || 1;
    const normalized = Object.fromEntries(
        Object.entries(base).map(([key, value]) => [key, Math.round((value / total) * totalBudget)]),
    ) as Record<KnowledgeSourceClass, number>;
    const used = Object.values(normalized).reduce((sum, value) => sum + value, 0);
    const delta = totalBudget - used;
    if (delta !== 0) {
        normalized.repo = Math.max(0, normalized.repo + delta);
    }
    return normalized;
}

function toFileRef(filePath: string): FileRef | undefined {
    try {
        const stat = fs.statSync(filePath);
        return {
            path: filePath,
            sizeBytes: stat.size,
            lastModified: stat.mtimeMs,
        };
    } catch {
        return undefined;
    }
}

function dedupeStrings(values: string[]): string[] {
    return [...new Set(values.filter(Boolean))];
}

function estimateTokens(value: string): number {
    return Math.max(1, Math.ceil(String(value || '').length / 4));
}
