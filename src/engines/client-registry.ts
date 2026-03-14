import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import type { Adapter } from '../core/types.js';
import { nexusEventBus } from './event-bus.js';
import { readBootstrapManifest } from './client-bootstrap.js';

export type ClientStatus = 'primaryActive' | 'active' | 'idle' | 'installed' | 'offline';
export type ClientSource = 'adapter-heartbeat' | 'manual' | 'env' | 'process' | 'recent-session' | 'heuristic' | 'none';

export interface ClientHeartbeatInput {
    displayName?: string;
    source?: 'adapter-heartbeat' | 'manual';
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
    source: 'adapter-heartbeat' | 'manual';
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
        clientId: 'cursor',
        displayName: 'Cursor',
        aliases: ['cursor'],
        configPaths: [path.join(HOME, '.cursor')],
        recentPaths: [path.join(HOME, '.cursor')],
        adapterNames: ['cursor'],
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
        clientId: 'windsurf',
        displayName: 'Windsurf',
        aliases: ['windsurf'],
        configPaths: [path.join(HOME, '.windsurf'), path.join(HOME, '.codeium', 'windsurf')],
        recentPaths: [path.join(HOME, '.windsurf'), path.join(HOME, '.codeium', 'windsurf')],
        adapterNames: ['windsurf'],
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
        const previous = this.resolveExplicitState(this.heartbeats.get(clientId));
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
        const previous = this.resolveExplicitState(current);

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

        const primary = this.getPrimaryCandidate(records);
        const normalized = records.map((record) => (
            primary && record.clientId === primary.clientId && record.state !== 'offline'
                ? { ...record, state: 'primaryActive' as const }
                : record
        ));

        return normalized.sort((a, b) => this.rankState(a.state) - this.rankState(b.state)
            || this.rankSource(a.source) - this.rankSource(b.source)
            || (b.lastSeen ?? 0) - (a.lastSeen ?? 0)
            || a.displayName.localeCompare(b.displayName));
    }

    getClient(clientKey: string, adapters: Adapter[] = []): ClientRecord {
        const requested = this.resolveDescriptor(clientKey).clientId;
        return this.listClients(adapters).find((record) => record.clientId === requested) ?? this.buildRecord(this.resolveDescriptor(clientKey));
    }

    getPrimaryClient(adapters: Adapter[] = []): ClientRecord | undefined {
        const records = this.listClients(adapters);
        return records.find((record) => record.state === 'primaryActive')
            ?? records.find((record) => record.state !== 'offline');
    }

    private buildRecord(descriptor: ClientDescriptor): ClientRecord {
        const heartbeat = this.heartbeats.get(descriptor.clientId);
        const explicitState = this.resolveExplicitState(heartbeat);
        const heuristic = this.detectHeuristic(descriptor);

        if (explicitState === 'active' || explicitState === 'idle') {
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
                confidence: explicitState === 'active' ? 1 : 0.78,
                evidence: heuristic.evidence,
                metadata: { ...(heartbeat?.metadata ?? {}), heuristic: heuristic.evidence },
            };
        }

        return {
            clientId: descriptor.clientId,
            displayName: descriptor.displayName,
            state: heuristic.state,
            source: heuristic.source,
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

    private resolveExplicitState(heartbeat?: ClientHeartbeatState): Exclude<ClientStatus, 'primaryActive' | 'installed'> | 'offline' {
        if (!heartbeat) return 'offline';
        const now = Date.now();
        if (heartbeat.lastDisconnect && (!heartbeat.lastHeartbeat || heartbeat.lastDisconnect > heartbeat.lastHeartbeat)) {
            const sinceDisconnect = now - heartbeat.lastDisconnect;
            return sinceDisconnect < 6 * 60 * 60 * 1000 ? 'idle' : 'offline';
        }
        if (!heartbeat.lastHeartbeat) return 'offline';
        const age = now - heartbeat.lastHeartbeat;
        if (age < 3 * 60 * 1000) return 'active';
        if (age < 6 * 60 * 60 * 1000) return 'idle';
        return 'offline';
    }

    private detectHeuristic(descriptor: ClientDescriptor): {
        state: Exclude<ClientStatus, 'primaryActive'>;
        source: ClientSource;
        confidence: number;
        evidence: string[];
        lastSeen?: number;
    } {
        const evidence: string[] = [];
        let lastSeen = 0;

        const envSignal = this.detectEnvSignal(descriptor.clientId);
        if (envSignal) {
            evidence.push(envSignal);
        }
        const bootstrapSignal = this.detectBootstrapSignal(descriptor.clientId);
        if (bootstrapSignal.evidence) {
            evidence.push(bootstrapSignal.evidence);
            lastSeen = Math.max(lastSeen, bootstrapSignal.updatedAt ?? 0);
        }

        const processOutput = this.readProcessSnapshot();
        if (descriptor.aliases.some((alias) => processOutput.includes(alias))) {
            evidence.push('process marker detected');
        }

        let configPresent = false;
        for (const configPath of descriptor.configPaths) {
            if (fs.existsSync(configPath)) {
                configPresent = true;
                evidence.push(`config:${path.basename(configPath)}`);
                lastSeen = Math.max(lastSeen, this.safeMtime(configPath));
            }
        }

        let recentSession = false;
        for (const recentPath of descriptor.recentPaths) {
            if (fs.existsSync(recentPath)) {
                const recentMtime = this.walkRecentMtime(recentPath);
                if (recentMtime > 0) {
                    recentSession = true;
                    evidence.push(`recent:${path.basename(recentPath)}`);
                    lastSeen = Math.max(lastSeen, recentMtime);
                }
            }
        }

        if (envSignal) {
            return {
                state: 'active',
                source: 'env',
                confidence: 0.96,
                evidence,
                lastSeen: Date.now(),
            };
        }

        if (recentSession) {
            return {
                state: 'idle',
                source: 'recent-session',
                confidence: 0.63,
                evidence,
                lastSeen: lastSeen || undefined,
            };
        }

        if (bootstrapSignal.state === 'installed') {
            return {
                state: 'installed',
                source: 'heuristic',
                confidence: 0.68,
                evidence,
                lastSeen: lastSeen || undefined,
            };
        }

        if (evidence.includes('process marker detected')) {
            return {
                state: 'idle',
                source: 'process',
                confidence: 0.74,
                evidence,
                lastSeen: Date.now(),
            };
        }

        if (configPresent) {
            return {
                state: 'installed',
                source: 'heuristic',
                confidence: 0.42,
                evidence,
                lastSeen: lastSeen || undefined,
            };
        }

        return { state: 'offline', source: 'none', confidence: 0, evidence: [] };
    }

    private detectBootstrapSignal(clientId: string): {
        state: 'installed' | 'offline';
        evidence?: string;
        updatedAt?: number;
    } {
        const manifest = readBootstrapManifest();
        if (!manifest?.clients?.length) {
            return { state: 'offline' };
        }
        const targetId = this.toBootstrapClientId(clientId);
        const match = manifest.clients.find((client) => client.clientId === targetId);
        if (!match) {
            return { state: 'offline' };
        }
        if (match.state === 'installed' || match.state === 'drifted') {
            return {
                state: 'installed',
                evidence: `bootstrap:${match.state}`,
                updatedAt: match.updatedAt,
            };
        }
        return { state: 'offline' };
    }

    private toBootstrapClientId(clientId: string): string {
        if (clientId === 'claude-code') return 'claude';
        if (clientId === 'openclaw') return 'antigravity';
        return clientId;
    }

    private getPrimaryCandidate(records: ClientRecord[]): ClientRecord | undefined {
        const preferredClientId = this.detectCurrentClientId();
        const visible = records.filter((record) => record.state !== 'offline');
        if (preferredClientId) {
            const preferred = visible.find((record) => record.clientId === preferredClientId);
            if (preferred) return preferred;
        }
        return [...visible].sort((a, b) => this.rankState(a.state) - this.rankState(b.state)
            || this.rankSource(a.source) - this.rankSource(b.source)
            || (b.lastSeen ?? 0) - (a.lastSeen ?? 0)
            || a.displayName.localeCompare(b.displayName))[0];
    }

    private detectCurrentClientId(): string | undefined {
        if (process.env.CODEX_HOME || process.env.CODEX_SESSION) return 'codex';
        if (process.env.CURSOR_HOME || process.env.CURSOR_SESSION) return 'cursor';
        if (process.env.CLAUDE_CODE || process.env.CLAUDE_SESSION_ID || process.env.CLAUDE_PROJECT_DIR) return 'claude-code';
        if (process.env.OPENCODE_HOME) return 'opencode';
        if (process.env.OPENCLAW_HOME || process.env.ANTIGRAVITY_HOME) return 'antigravity';
        if (process.env.WINDSURF_HOME || process.env.WINDSURF_SESSION) return 'windsurf';
        if (process.env.MCP_CLIENT_NAME) {
            return this.resolveDescriptor(process.env.MCP_CLIENT_NAME).clientId;
        }
        try {
            const ps = execSync(`ps -p ${process.ppid} -o comm=`, { encoding: 'utf8', timeout: 400 }).trim().toLowerCase();
            if (ps.includes('codex')) return 'codex';
            if (ps.includes('cursor')) return 'cursor';
            if (ps.includes('claude')) return 'claude-code';
            if (ps.includes('opencode')) return 'opencode';
            if (ps.includes('windsurf')) return 'windsurf';
            if (ps.includes('antigravity') || ps.includes('openclaw')) return 'antigravity';
        } catch {
            // ignore
        }
        return undefined;
    }

    private detectEnvSignal(clientId: string): string | undefined {
        if (clientId === 'codex' && (process.env.CODEX_HOME || process.env.CODEX_SESSION)) {
            return 'env:CODEX detected';
        }
        if (clientId === 'cursor' && (process.env.CURSOR_HOME || process.env.CURSOR_SESSION)) {
            return 'env:CURSOR detected';
        }
        if (clientId === 'claude-code' && (process.env.CLAUDE_CODE || process.env.CLAUDE_SESSION_ID || process.env.CLAUDE_PROJECT_DIR)) {
            return 'env:CLAUDE detected';
        }
        if (clientId === 'opencode' && process.env.OPENCODE_HOME) {
            return 'env:OPENCODE detected';
        }
        if (clientId === 'antigravity' && (process.env.OPENCLAW_HOME || process.env.ANTIGRAVITY_HOME)) {
            return 'env:ANTIGRAVITY detected';
        }
        if (clientId === 'windsurf' && (process.env.WINDSURF_HOME || process.env.WINDSURF_SESSION)) {
            return 'env:WINDSURF detected';
        }
        return undefined;
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

    private rankState(state: ClientStatus): number {
        return {
            primaryActive: 0,
            active: 1,
            idle: 2,
            installed: 3,
            offline: 4,
        }[state];
    }

    private rankSource(source: ClientSource): number {
        return {
            manual: 0,
            'adapter-heartbeat': 1,
            env: 2,
            process: 3,
            'recent-session': 4,
            heuristic: 5,
            none: 6,
        }[source];
    }
}

function normalizeDisplayName(value: string): string {
    if (value === 'openclaw') return 'Antigravity';
    if (value === 'claude-code') return 'Claude Code';
    if (value === 'cursor') return 'Cursor';
    if (value === 'windsurf') return 'Windsurf';
    if (value === 'opencode') return 'Opencode';
    if (value === 'mcp') return 'MCP';
    return value
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}
