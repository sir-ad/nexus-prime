import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { KnowledgeFabricSnapshot } from './knowledge-fabric.js';
import type {
    ExecutionLedger,
    InstructionPacket,
    OrchestrationExecutionMode,
} from './instruction-gateway.js';

export type RuntimeUsageCategory =
    | 'memories'
    | 'skills'
    | 'roster'
    | 'crews'
    | 'plan'
    | 'workflows'
    | 'hooks'
    | 'automations'
    | 'governance'
    | 'federation';

export interface RuntimeUsageEntry {
    status: 'unused' | 'used';
    lastUsedAt?: number;
    summary?: string;
    details?: string[];
    count?: number;
}

export interface RuntimeLibrariesSnapshot {
    skills: number;
    workflows: number;
    hooks: number;
    automations: number;
    specialists: number;
    crews: number;
}

export interface RuntimeRelaySnapshot {
    configured: boolean;
    mode: 'live' | 'degraded';
    lastError?: string;
    lastSyncAt?: number;
    lastPublishAt?: number;
}

export interface RuntimeFederationUsageSnapshot {
    activePeerLinks: number;
    knownPeers: number;
    tracesPublished: number;
    relay: RuntimeRelaySnapshot;
}

export interface RuntimeLatestRunSnapshot {
    runId: string;
    goal: string;
    state: string;
    updatedAt: number;
}

export interface RuntimeTokenRunSnapshot {
    runId: string;
    goal: string;
    timestamp: number;
    grossInputTokens: number;
    compressedTokens: number;
    savedTokens: number;
    forwardedTokens: number;
    compressionPct: number;
    byPhase: Record<string, number>;
    bySubsystem: Record<string, number>;
    bySourceClass: Record<string, number>;
}

export interface RuntimeTokenSummarySnapshot {
    grossInputTokens: number;
    compressedTokens: number;
    savedTokens: number;
    forwardedTokens: number;
    compressionPct: number;
    totalRuns: number;
    totalEvents: number;
    byPhase: Record<string, number>;
    bySubsystem: Record<string, number>;
    bySourceClass: Record<string, number>;
    timeline: RuntimeTokenRunSnapshot[];
    lastUpdatedAt?: number;
}

export interface RuntimeOrchestrationSnapshot {
    sessionId: string;
    lastPrompt: string;
    taskType: string;
    riskClass: string;
    mode: 'single-pass' | 'bounded-swarm' | 'continuation-capable';
    phases: string[];
    objectiveHistory: string[];
    selectedCrew?: string;
    selectedSpecialists: string[];
    selectedSkills: string[];
    selectedWorkflows: string[];
    selectedHooks: string[];
    selectedAutomations: string[];
    repeatedFailures: number;
    continuationDepth: number;
    latestSessionDNA?: {
        sessionId: string;
        timestamp: number;
        handoverScore: number;
    };
    lastUpdatedAt: number;
}

export interface RuntimePrimaryClientSnapshot {
    clientId: string;
    clientFamily?: string;
    displayName: string;
    state: 'primaryActive' | 'active' | 'idle' | 'installed' | 'offline';
    source: string;
    confidence: number;
    evidence: string[];
    lastSeen?: number;
}

export interface RuntimeClientsSnapshot {
    primary?: RuntimePrimaryClientSnapshot;
    detected: RuntimePrimaryClientSnapshot[];
    lastUpdatedAt: number;
}

export interface RuntimeSequenceComplianceSnapshot {
    status: 'idle' | 'partial' | 'compliant' | 'manual-low-level';
    summary: string;
    updatedAt: number;
}

export interface RuntimeClientInstructionStatus {
    clientId?: string;
    clientFamily?: string;
    toolProfile: 'autonomous' | 'full';
    status: 'guided' | 'manual';
    summary: string;
    instructionFiles?: string[];
    updatedAt: number;
}

export interface RuntimeRegistrySnapshot {
    runtimeId: string;
    pid: number;
    cwd: string;
    entrypoint: string;
    startedAt: number;
    lastHeartbeatAt: number;
    lastActivityAt: number;
    libraries: RuntimeLibrariesSnapshot;
    usage: Record<RuntimeUsageCategory, RuntimeUsageEntry>;
    latestRun?: RuntimeLatestRunSnapshot;
    federation?: RuntimeFederationUsageSnapshot;
    tokens?: RuntimeTokenSummarySnapshot;
    orchestration?: RuntimeOrchestrationSnapshot;
    knowledgeFabric?: KnowledgeFabricSnapshot;
    clients?: RuntimeClientsSnapshot;
    clientId?: string;
    clientFamily?: string;
    instructionPacketHash?: string;
    instructionPacket?: InstructionPacket;
    executionMode?: OrchestrationExecutionMode;
    executionLedger?: ExecutionLedger;
    plannerApplied?: boolean;
    tokenOptimizationApplied?: boolean;
    bootstrapCalled?: boolean;
    orchestrateCalled?: boolean;
    plannerCalled?: boolean;
    skipReasons?: string[];
    lastToolCalls?: string[];
    sequenceCompliance?: RuntimeSequenceComplianceSnapshot;
    clientInstructionStatus?: RuntimeClientInstructionStatus;
}

export interface ListedRuntimeSnapshot extends RuntimeRegistrySnapshot {
    health: 'active' | 'stale';
}

const ACTIVE_RUNTIME_WINDOW_MS = 2 * 60 * 1000;
const STALE_PRUNE_WINDOW_MS = 12 * 60 * 60 * 1000;

export function createEmptyUsageState(): Record<RuntimeUsageCategory, RuntimeUsageEntry> {
    return {
        memories: { status: 'unused' },
        skills: { status: 'unused' },
        roster: { status: 'unused' },
        crews: { status: 'unused' },
        plan: { status: 'unused' },
        workflows: { status: 'unused' },
        hooks: { status: 'unused' },
        automations: { status: 'unused' },
        governance: { status: 'unused' },
        federation: { status: 'unused' },
    };
}

export function createEmptyTokenSummary(): RuntimeTokenSummarySnapshot {
    return {
        grossInputTokens: 0,
        compressedTokens: 0,
        savedTokens: 0,
        forwardedTokens: 0,
        compressionPct: 0,
        totalRuns: 0,
        totalEvents: 0,
        byPhase: {},
        bySubsystem: {},
        bySourceClass: {},
        timeline: [],
    };
}

export function resolveNexusStateDir(): string {
    const root = process.env.NEXUS_STATE_DIR
        ? path.resolve(process.env.NEXUS_STATE_DIR)
        : path.join(os.homedir(), '.nexus-prime');
    fs.mkdirSync(root, { recursive: true });
    return root;
}

export class RuntimeRegistry {
    private readonly registryDir: string;

    constructor(rootDir?: string) {
        this.registryDir = path.join(rootDir ?? resolveNexusStateDir(), 'runtime-registry');
        fs.mkdirSync(this.registryDir, { recursive: true });
    }

    list(): ListedRuntimeSnapshot[] {
        this.pruneStale();
        const now = Date.now();
        return fs.readdirSync(this.registryDir)
            .filter((entry) => entry.endsWith('.json'))
            .map((entry) => this.read(entry.replace(/\.json$/, '')))
            .filter((snapshot): snapshot is RuntimeRegistrySnapshot => Boolean(snapshot))
            .map((snapshot) => ({
                ...snapshot,
                health: now - snapshot.lastHeartbeatAt > ACTIVE_RUNTIME_WINDOW_MS ? ('stale' as const) : ('active' as const),
            }))
            .sort((left, right) => right.lastActivityAt - left.lastActivityAt);
    }

    read(runtimeId: string): RuntimeRegistrySnapshot | undefined {
        const target = this.snapshotPath(runtimeId);
        if (!fs.existsSync(target)) return undefined;
        try {
            const parsed = JSON.parse(fs.readFileSync(target, 'utf8')) as RuntimeRegistrySnapshot;
            return {
                ...parsed,
                usage: { ...createEmptyUsageState(), ...(parsed.usage ?? {}) },
                tokens: { ...createEmptyTokenSummary(), ...(parsed.tokens ?? {}) },
                knowledgeFabric: parsed.knowledgeFabric,
                bootstrapCalled: parsed.bootstrapCalled ?? false,
                orchestrateCalled: parsed.orchestrateCalled ?? false,
                plannerCalled: parsed.plannerCalled ?? false,
                skipReasons: parsed.skipReasons ?? [],
                lastToolCalls: parsed.lastToolCalls ?? [],
            };
        } catch {
            return undefined;
        }
    }

    write(snapshot: RuntimeRegistrySnapshot): RuntimeRegistrySnapshot {
        const normalized: RuntimeRegistrySnapshot = {
            ...snapshot,
            usage: { ...createEmptyUsageState(), ...(snapshot.usage ?? {}) },
            tokens: { ...createEmptyTokenSummary(), ...(snapshot.tokens ?? {}) },
            bootstrapCalled: snapshot.bootstrapCalled ?? false,
            orchestrateCalled: snapshot.orchestrateCalled ?? false,
            plannerCalled: snapshot.plannerCalled ?? false,
            skipReasons: snapshot.skipReasons ?? [],
            lastToolCalls: snapshot.lastToolCalls ?? [],
        };
        fs.writeFileSync(this.snapshotPath(snapshot.runtimeId), JSON.stringify(normalized, null, 2), 'utf8');
        return normalized;
    }

    remove(runtimeId: string): void {
        const target = this.snapshotPath(runtimeId);
        if (fs.existsSync(target)) {
            fs.unlinkSync(target);
        }
    }

    private pruneStale(): void {
        const now = Date.now();
        for (const entry of fs.readdirSync(this.registryDir)) {
            if (!entry.endsWith('.json')) continue;
            const target = path.join(this.registryDir, entry);
            try {
                const snapshot = JSON.parse(fs.readFileSync(target, 'utf8')) as RuntimeRegistrySnapshot;
                if (now - Number(snapshot.lastHeartbeatAt || 0) > STALE_PRUNE_WINDOW_MS) {
                    fs.unlinkSync(target);
                }
            } catch {
                fs.unlinkSync(target);
            }
        }
    }

    private snapshotPath(runtimeId: string): string {
        return path.join(this.registryDir, `${runtimeId}.json`);
    }
}
