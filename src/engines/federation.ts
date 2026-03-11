import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { nexusEventBus } from './event-bus.js';
import { MemoryEngine } from './memory.js';
import { nexusNetRelay, type NexusNetRelayStatus } from './nexusnet-relay.js';
import { resolveNexusStateDir } from './runtime-registry.js';

export interface TraceEntry {
    taskId: string;
    goal: string;
    findings: string[];
    confidence: number;
    timestamp: number;
}

export interface FederatedPeer {
    peerId: string;
    displayName: string;
    source: 'local' | 'relay' | 'manual';
    capabilities: string[];
    trust: 'low' | 'medium' | 'high';
    lastHeartbeat: number;
    active: boolean;
    health: 'active' | 'stale' | 'offline';
}

export interface FederationLearning {
    learningId: string;
    summary: string;
    sourcePeerId: string;
    timestamp: number;
    tags: string[];
}

export interface FederationSnapshot {
    localNode: {
        nodeId: string;
        displayName: string;
        startedAt: number;
    };
    knownPeers: FederatedPeer[];
    activePeerLinks: number;
    relayLearnings: FederationLearning[];
    tracesPublished: number;
    relay: NexusNetRelayStatus;
}

interface FederationState {
    localNode: FederationSnapshot['localNode'];
    peers: FederatedPeer[];
    learnings: FederationLearning[];
    traces: TraceEntry[];
}

const FEDERATION_PATH = path.join(process.env.NEXUS_STATE_DIR
    ? path.resolve(process.env.NEXUS_STATE_DIR)
    : path.join(os.homedir(), '.nexus-prime'), 'federation.json');

export class FederationEngine {
    private memory: MemoryEngine;
    private state: FederationState;

    constructor(memory?: MemoryEngine) {
        this.memory = memory || new MemoryEngine();
        this.state = this.loadState();
    }

    heartbeat(peerId: string, input: {
        displayName?: string;
        source?: FederatedPeer['source'];
        capabilities?: string[];
        trust?: FederatedPeer['trust'];
    } = {}): FederatedPeer {
        const existing = this.state.peers.find((peer) => peer.peerId === peerId);
        const now = Date.now();
        const peer: FederatedPeer = existing ?? {
            peerId,
            displayName: input.displayName ?? peerId,
            source: input.source ?? 'local',
            capabilities: input.capabilities ?? [],
            trust: input.trust ?? 'medium',
            lastHeartbeat: now,
            active: true,
            health: 'active',
        };

        peer.displayName = input.displayName ?? peer.displayName;
        peer.source = input.source ?? peer.source;
        peer.capabilities = dedupeStrings([...(peer.capabilities ?? []), ...(input.capabilities ?? [])]);
        peer.trust = input.trust ?? peer.trust;
        peer.lastHeartbeat = now;
        peer.active = true;
        peer.health = 'active';

        if (!existing) this.state.peers.push(peer);
        this.persist();

        nexusEventBus.emit('federation.heartbeat', {
            peerId: peer.peerId,
            source: peer.source,
            health: peer.health,
            capabilities: peer.capabilities.length,
        });
        nexusEventBus.emit('nexusnet.sync', { newItemsCount: this.state.learnings.length });
        return peer;
    }

    publishTrace(trace: TraceEntry): { id: string; url: string } {
        const traceId = `trace_${randomUUID().slice(0, 10)}`;
        this.state.traces.unshift(trace);
        this.state.traces = this.state.traces.slice(0, 100);
        this.persist();

        nexusEventBus.emit('nexusnet.publish', {
            type: 'knowledge_trace',
            byteSize: JSON.stringify(trace).length,
        });

        this.memory.store(
            `Federated trace published for task ${trace.taskId} on local federation node ${this.state.localNode.nodeId}.`,
            0.78,
            ['#federation', '#trace', '#local-federation']
        );

        return { id: traceId, url: `nexus://federation/${traceId}` };
    }

    sync(): number {
        this.agePeers();
        this.persist();
        nexusEventBus.emit('nexusnet.sync', { newItemsCount: this.state.learnings.length });
        return this.state.learnings.length;
    }

    recordRelayLearning(summary: string, sourcePeerId: string, tags: string[] = []): FederationLearning {
        const learning: FederationLearning = {
            learningId: `learn_${randomUUID().slice(0, 8)}`,
            summary,
            sourcePeerId,
            timestamp: Date.now(),
            tags,
        };
        this.state.learnings.unshift(learning);
        this.state.learnings = this.state.learnings.slice(0, 200);
        this.persist();
        return learning;
    }

    getSnapshot(): FederationSnapshot {
        this.agePeers();
        return {
            localNode: this.state.localNode,
            knownPeers: [...this.state.peers].sort((a, b) => b.lastHeartbeat - a.lastHeartbeat),
            activePeerLinks: this.state.peers.filter((peer) => peer.health === 'active').length,
            relayLearnings: this.state.learnings.slice(0, 30),
            tracesPublished: this.state.traces.length,
            relay: nexusNetRelay.getStatus(),
        };
    }

    private loadState(): FederationState {
        try {
            if (fs.existsSync(FEDERATION_PATH)) {
                const raw = JSON.parse(fs.readFileSync(FEDERATION_PATH, 'utf8')) as FederationState;
                return {
                    localNode: raw.localNode,
                    peers: raw.peers ?? [],
                    learnings: raw.learnings ?? [],
                    traces: raw.traces ?? [],
                };
            }
        } catch {
            // fall through
        }

        return {
            localNode: {
                nodeId: `node_${randomUUID().slice(0, 8)}`,
                displayName: 'Nexus Prime Local Node',
                startedAt: Date.now(),
            },
            peers: [],
            learnings: [],
            traces: [],
        };
    }

    private agePeers(): void {
        const now = Date.now();
        for (const peer of this.state.peers) {
            const age = now - peer.lastHeartbeat;
            peer.health = age < 60_000 ? 'active' : age < 10 * 60_000 ? 'stale' : 'offline';
            peer.active = peer.health === 'active';
        }
    }

    private persist(): void {
        fs.mkdirSync(resolveNexusStateDir(), { recursive: true });
        fs.mkdirSync(path.dirname(FEDERATION_PATH), { recursive: true });
        fs.writeFileSync(FEDERATION_PATH, JSON.stringify(this.state, null, 2), 'utf8');
    }
}

function dedupeStrings(values: string[]): string[] {
    return [...new Set(values.filter(Boolean))];
}

export const federation = new FederationEngine();
