import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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
            };
        } catch {
            return undefined;
        }
    }

    write(snapshot: RuntimeRegistrySnapshot): RuntimeRegistrySnapshot {
        const normalized: RuntimeRegistrySnapshot = {
            ...snapshot,
            usage: { ...createEmptyUsageState(), ...(snapshot.usage ?? {}) },
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
