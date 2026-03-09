import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import type { Adapter } from '../core/types.js';
import { nexusEventBus } from './event-bus.js';

export type ClientStatus = 'active' | 'ready' | 'standby' | 'inferred' | 'offline';
export type ClientSource = 'adapter-heartbeat' | 'manual' | 'heuristic' | 'none';

export interface ClientHeartbeatInput {
    displayName?: string;
    source?: Exclude<ClientSource, 'heuristic' | 'none'>;
    metadata?: Record<string, unknown>;
}

export interface ClientRecord {
    clientId: string;
    displayName: string;
    state: ClientStatus;
    source: ClientSource;
    inferred: boolean;
    lastHeartbeat?: number;
    lastSeen?: number;
    lastExplicitState?: 'connected' | 'disconnected';
    confidence: number;
    evidence: string[];
    metadata: Record<string, unknown>;
}

interface ClientDescriptor {
    clientId: string;
    displayName: string;
    aliases: string[];
    configPaths: string[];
    recentPaths: string[];
    adapterNames?: string[];
}

interface ClientHeartbeatState {
    displayName: string;
    source: Exclude<ClientSource, 'heuristic' | 'none'>;
    metadata: Record<string, unknown>;
    lastHeartbeat?: number;
    lastDisconnect?: number;
}

const HOME = os.homedir();

const KNOWN_CLIENTS: ClientDescriptor[] = [
    {
        clientId: 'codex',
        displayName: 'Codex',
        aliases: ['codex'],
        configPaths: [path.join(HOME, '.codex')],
        recentPaths: [path.join(HOME, '.codex', 'sessions')],
    },
    {
        clientId: 'claude-code',
        displayName: 'Claude Code',
        aliases: ['claude', 'claude-code'],
        configPaths: [path.join(HOME, '.claude'), path.join(HOME, '.config', 'claude-code')],
        recentPaths: [path.join(HOME, '.claude', 'projects')],
        adapterNames: ['claude-code'],
    },
    {
        clientId: 'antigravity',
        displayName: 'Antigravity',
        aliases: ['antigravity', 'openclaw'],
        configPaths: [path.join(HOME, '.antigravity'), path.join(HOME, '.openclaw')],
        recentPaths: [path.join(HOME, '.antigravity', 'sessions'), path.join(HOME, '.openclaw', 'sessions')],
        adapterNames: ['openclaw'],
    },
    {
        clientId: 'opencode',
        displayName: 'Opencode',
        aliases: ['opencode'],
        configPaths: [path.join(HOME, '.opencode')],
        recentPaths: [path.join(HOME, '.opencode', 'sessions')],
    },
    {
        clientId: 'mcp',
        displayName: 'MCP',
        aliases: ['mcp'],
        configPaths: [],
        recentPaths: [],
        adapterNames: ['mcp'],
    },
];

export class ClientRegistry {
    private heartbeats = new Map<string, ClientHeartbeatState>();
    private cachedPsOutput = '';
    private lastPsScan = 0;
    private readonly psTtlMs = 5000;

    recordHeartbeat(clientKey: string, input: ClientHeartbeatInput = {}): ClientRecord {
        const descriptor = this.resolveDescriptor(clientKey);
        const clientId = descriptor.clientId;
        const previous = this.resolveState(this.heartbeats.get(clientId));
        const current = this.heartbeats.get(clientId);
        const nextState: ClientHeartbeatState = {
            displayName: input.displayName ?? descriptor.displayName,
            source: input.source ?? 'adapter-heartbeat',
            metadata: { ...(current?.metadata ?? {}), ...(input.metadata ?? {}) },
            lastHeartbeat: Date.now(),
            lastDisconnect: current?.lastDisconnect,
        };

        this.heartbeats.set(clientId, nextState);
        const record = this.getClient(clientId);

        nexusEventBus.emit('client.heartbeat', {
            clientId,
            displayName: record.displayName,
            source: nextState.source,
            state: record.state,
        });

        if (previous !== record.state) {
            nexusEventBus.emit('client.status', {
                clientId,
                displayName: record.displayName,
                previous,
                next: record.state,
                source: nextState.source,
            });
        }

        return record;
    }

    recordDisconnect(clientKey: string, input: ClientHeartbeatInput = {}): ClientRecord {
        const descriptor = this.resolveDescriptor(clientKey);
        const clientId = descriptor.clientId;
        const current = this.heartbeats.get(clientId);
        const previous = this.resolveState(current);

        this.heartbeats.set(clientId, {
            displayName: input.displayName ?? current?.displayName ?? descriptor.displayName,
            source: input.source ?? current?.source ?? 'adapter-heartbeat',
            metadata: { ...(current?.metadata ?? {}), ...(input.metadata ?? {}) },
            lastHeartbeat: current?.lastHeartbeat,
            lastDisconnect: Date.now(),
        });

        const record = this.getClient(clientId);
        if (previous !== record.state) {
            nexusEventBus.emit('client.status', {
                clientId,
                displayName: record.displayName,
                previous,
                next: record.state,
                source: this.heartbeats.get(clientId)?.source ?? 'adapter-heartbeat',
            });
        }

        return record;
    }

    clear(clientKey: string): void {
        const descriptor = this.resolveDescriptor(clientKey);
        this.heartbeats.delete(descriptor.clientId);
    }

    reconnect(clientKey: string): ClientRecord {
        return this.recordHeartbeat(clientKey, { source: 'manual' });
    }

    syncAdapters(adapters: Adapter[]): void {
        for (const adapter of adapters) {
            if (adapter.connected) {
                this.recordHeartbeat(adapter.name, {
                    source: 'adapter-heartbeat',
                    metadata: {
                        adapterType: adapter.type,
                        agents: adapter.agents.length,
                    },
                });
            } else {
                this.recordDisconnect(adapter.name, {
                    source: 'adapter-heartbeat',
                    metadata: {
                        adapterType: adapter.type,
                        agents: adapter.agents.length,
                    },
                });
            }
        }
    }

    listClients(adapters: Adapter[] = []): ClientRecord[] {
        if (adapters.length) {
            this.syncAdapters(adapters);
        }

        const records = KNOWN_CLIENTS.map((descriptor) => this.buildRecord(descriptor));

        for (const adapter of adapters) {
            const descriptor = this.resolveDescriptor(adapter.name, adapter.type);
            if (!records.find((record) => record.clientId === descriptor.clientId)) {
                records.push(this.buildRecord(descriptor));
            }
        }

        return records.sort((a, b) => {
            const rank = (state: ClientStatus) => ({ active: 0, ready: 1, standby: 2, inferred: 3, offline: 4 }[state]);
            return rank(a.state) - rank(b.state) || a.displayName.localeCompare(b.displayName);
        });
    }

    getClient(clientKey: string, adapters: Adapter[] = []): ClientRecord {
        if (adapters.length) {
            this.syncAdapters(adapters);
        }
        const descriptor = this.resolveDescriptor(clientKey);
        return this.buildRecord(descriptor);
    }

    private buildRecord(descriptor: ClientDescriptor): ClientRecord {
        const heartbeat = this.heartbeats.get(descriptor.clientId);
        const explicitState = this.resolveState(heartbeat);
        const heuristic = this.detectHeuristic(descriptor);

        if (explicitState === 'active' || explicitState === 'ready' || explicitState === 'standby') {
            return {
                clientId: descriptor.clientId,
                displayName: heartbeat?.displayName ?? descriptor.displayName,
                state: explicitState,
                source: heartbeat?.source ?? 'adapter-heartbeat',
                inferred: false,
                lastHeartbeat: heartbeat?.lastHeartbeat,
                lastSeen: heartbeat?.lastHeartbeat ?? heartbeat?.lastDisconnect,
                lastExplicitState: heartbeat?.lastDisconnect && (!heartbeat.lastHeartbeat || heartbeat.lastDisconnect > heartbeat.lastHeartbeat)
                    ? 'disconnected'
                    : 'connected',
                confidence: explicitState === 'active' ? 1 : explicitState === 'ready' ? 0.9 : 0.7,
                evidence: heuristic.evidence,
                metadata: { ...(heartbeat?.metadata ?? {}), heuristic: heuristic.evidence },
            };
        }

        return {
            clientId: descriptor.clientId,
            displayName: descriptor.displayName,
            state: heuristic.state,
            source: heuristic.state === 'offline' ? 'none' : 'heuristic',
            inferred: heuristic.state !== 'offline',
            lastHeartbeat: heartbeat?.lastHeartbeat,
            lastSeen: heuristic.lastSeen,
            lastExplicitState: heartbeat ? 'disconnected' : undefined,
            confidence: heuristic.confidence,
            evidence: heuristic.evidence,
            metadata: {
                ...(heartbeat?.metadata ?? {}),
                heuristic: heuristic.evidence,
            },
        };
    }

    private resolveState(heartbeat?: ClientHeartbeatState): ClientStatus {
        if (!heartbeat) return 'offline';
        const now = Date.now();
        if (heartbeat.lastDisconnect && (!heartbeat.lastHeartbeat || heartbeat.lastDisconnect > heartbeat.lastHeartbeat)) {
            const sinceDisconnect = now - heartbeat.lastDisconnect;
            if (sinceDisconnect < 30 * 60 * 1000) return 'standby';
            return 'offline';
        }
        if (!heartbeat.lastHeartbeat) return 'offline';
        const age = now - heartbeat.lastHeartbeat;
        if (age < 3 * 60 * 1000) return 'active';
        if (age < 30 * 60 * 1000) return 'ready';
        if (age < 6 * 60 * 60 * 1000) return 'standby';
        return 'offline';
    }

    private detectHeuristic(descriptor: ClientDescriptor): {
        state: ClientStatus;
        confidence: number;
        evidence: string[];
        lastSeen?: number;
    } {
        const evidence: string[] = [];
        let lastSeen = 0;

        // Check environment variables for direct signals
        if (descriptor.clientId === 'claude-code' && (process.env.CLAUDE_CODE || process.env.CLAUDE_SESSION_ID || process.env.CLAUDE_PROJECT_DIR)) {
            evidence.push('env:CLAUDE detected');
        }
        if (descriptor.clientId === 'codex' && (process.env.CODEX_HOME || process.env.CODEX_SESSION)) {
            evidence.push('env:CODEX detected');
        }
        if (descriptor.clientId === 'opencode' && process.env.OPENCODE_HOME) {
            evidence.push('env:OPENCODE detected');
        }

        const processOutput = this.readProcessSnapshot();
        if (descriptor.aliases.some((alias) => processOutput.includes(alias))) {
            evidence.push('process marker detected');
        }

        for (const configPath of descriptor.configPaths) {
            if (fs.existsSync(configPath)) {
                evidence.push(`config:${path.basename(configPath)}`);
                lastSeen = Math.max(lastSeen, this.safeMtime(configPath));
            }
        }

        for (const recentPath of descriptor.recentPaths) {
            if (fs.existsSync(recentPath)) {
                evidence.push(`recent:${path.basename(recentPath)}`);
                lastSeen = Math.max(lastSeen, this.walkRecentMtime(recentPath));
            }
        }

        if (!evidence.length) {
            return { state: 'offline', confidence: 0, evidence: [] };
        }

        const hasEnvSignal = evidence.some((e) => e.startsWith('env:'));
        return {
            state: 'inferred',
            confidence: hasEnvSignal ? 0.88 : evidence.includes('process marker detected') ? 0.76 : 0.52,
            evidence,
            lastSeen: lastSeen || undefined,
        };
    }

    private readProcessSnapshot(): string {
        const now = Date.now();
        if (now - this.lastPsScan < this.psTtlMs) {
            return this.cachedPsOutput;
        }
        this.lastPsScan = now;
        try {
            this.cachedPsOutput = execSync('ps -ax -o command=', {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],
                timeout: 400,
            }).toLowerCase();
        } catch {
            this.cachedPsOutput = '';
        }
        return this.cachedPsOutput;
    }

    private resolveDescriptor(clientKey: string, adapterType?: Adapter['type']): ClientDescriptor {
        const normalized = clientKey.toLowerCase();
        const known = KNOWN_CLIENTS.find((descriptor) =>
            descriptor.clientId === normalized ||
            descriptor.aliases.includes(normalized) ||
            descriptor.adapterNames?.includes(normalized)
        );
        if (known) return known;

        return {
            clientId: normalized,
            displayName: adapterType ? normalizeDisplayName(adapterType) : normalizeDisplayName(clientKey),
            aliases: [normalized],
            configPaths: [],
            recentPaths: [],
            adapterNames: [normalized],
        };
    }

    private safeMtime(targetPath: string): number {
        try {
            return fs.statSync(targetPath).mtimeMs;
        } catch {
            return 0;
        }
    }

    private walkRecentMtime(targetPath: string): number {
        try {
            const stat = fs.statSync(targetPath);
            if (!stat.isDirectory()) return stat.mtimeMs;
            const entries = fs.readdirSync(targetPath).slice(0, 20);
            let latest = stat.mtimeMs;
            for (const entry of entries) {
                latest = Math.max(latest, this.safeMtime(path.join(targetPath, entry)));
            }
            return latest;
        } catch {
            return 0;
        }
    }
}

function normalizeDisplayName(value: string): string {
    if (value === 'openclaw') return 'Antigravity';
    if (value === 'claude-code') return 'Claude Code';
    if (value === 'mcp') return 'MCP';
    return value
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}
