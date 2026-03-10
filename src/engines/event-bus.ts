import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ─────────────────────────────────────────────────────────────────────────────
// Types & Interfaces
// ─────────────────────────────────────────────────────────────────────────────

export type NexusEventType =
    | 'system.boot'
    | 'memory.store'
    | 'memory.recall'
    | 'pod.signal'
    | 'tokens.optimized'
    | 'phantom.worker.start'
    | 'phantom.worker.complete'
    | 'phantom.merge.complete'
    | 'phantom.merge'
    | 'guardrail.check'
    | 'ghost.pass'
    | 'graph.query'
    | 'darwin.cycle'
    | 'session.dna'
    | 'skill.register'
    | 'skill.deploy'
    | 'skill.revoke'
    | 'hook.deploy'
    | 'hook.revoke'
    | 'hook.fire'
    | 'workflow.deploy'
    | 'workflow.run'
    | 'automation.deploy'
    | 'automation.revoke'
    | 'automation.run'
    | 'shield.decision'
    | 'memory.audit'
    | 'federation.heartbeat'
    | 'client.heartbeat'
    | 'client.inferred'
    | 'client.status'
    | 'dashboard.action'
    | 'nexusnet.publish'
    | 'nexusnet.sync'
    // Phase 9A: Quantum-Inspired Entanglement
    | 'entanglement.create'
    | 'entanglement.collapse'
    | 'entanglement.correlate'
    // Phase 9B: Continuous Attention Streams
    | 'cas.encode'
    | 'cas.decode'
    | 'cas.pattern_learned'
    // Phase 9C: AdaptiveKV Bridge
    | 'kv.merge'
    | 'kv.adapt'
    | 'kv.consensus';

export interface NexusEventPayloads {
    'system.boot': { version: string; toolsCount: number };
    'memory.store': { id: string; priority: number; tags: string[]; tier: string };
    'memory.recall': { query: string; count: number };
    'pod.signal': { workerId: string; type: string; content: string; confidence?: number; tags?: string[] };
    'tokens.optimized': { savings: number; pct: number; files: number };
    'phantom.worker.start': { workerId: string; approach: string; goal: string };
    'phantom.worker.complete': { workerId: string; confidence: number };
    'phantom.merge.complete': { workerId: string; confidence: number };
    'phantom.merge': { action: string; winner: string };
    'guardrail.check': { action: string; passed: boolean; score: number };
    'ghost.pass': { task: string; risks: number; workers: number };
    'graph.query': { query: string; resultsCount: number };
    'darwin.cycle': { hypothesis: string; outcome: string };
    'session.dna': { sessionId: string; action: 'generated' | 'loaded' };
    'skill.register': { name: string; id: string };
    'skill.deploy': { skillId: string; scope: string; status: string };
    'skill.revoke': { skillId: string; status: string };
    'hook.deploy': { hookId: string; scope: string; status: string };
    'hook.revoke': { hookId: string; status: string };
    'hook.fire': { hookId: string; name: string; trigger: string; blocked: boolean };
    'workflow.deploy': { workflowId: string; scope: string; status: string };
    'workflow.run': { workflowId: string; runId: string; status: string };
    'automation.deploy': { automationId: string; scope: string; status: string };
    'automation.revoke': { automationId: string; status: string };
    'automation.run': { automationId: string; trigger: string; queued: boolean };
    'shield.decision': { target: string; stage: string; action: string; blocked: boolean };
    'memory.audit': { scanned: number; quarantined: number };
    'federation.heartbeat': { peerId: string; source: string; health: string; capabilities: number };
    'client.heartbeat': { clientId: string; displayName: string; source: string; state: string };
    'client.inferred': { clientId: string; displayName: string; source: string; state: string; evidence: string[] };
    'client.status': { clientId: string; displayName: string; previous: string; next: string; source: string };
    'dashboard.action': { action: string; status: string; target?: string };
    'nexusnet.publish': { type: string; byteSize: number };
    'nexusnet.sync': { newItemsCount: number };
    // Phase 9A
    'entanglement.create': { stateId: string; agents: number; dimension: number; type: string };
    'entanglement.collapse': { stateId: string; agentId: string; strategy: number; probability: number; remainingAgents: number };
    'entanglement.correlate': { stateId: string; pairs: number; avgCorrelation: number };
    // Phase 9B
    'cas.encode': { inputTokens: number; outputTokens: number; compressionRatio: number };
    'cas.decode': { tokens: number };
    'cas.pattern_learned': { pattern: string; codebookSize: number };
    // Phase 9C
    'kv.merge': { layerPair: string; compressionRatio: number };
    'kv.adapt': { taskType: string; shots: number; adaptationTime: number };
    'kv.consensus': { agents: number; syncOverhead: number; conflicts: number };
}

export interface NexusEvent<T extends NexusEventType = NexusEventType> {
    id: string;
    type: T;
    timestamp: number;
    data: NexusEventPayloads[T];
}

// ─────────────────────────────────────────────────────────────────────────────
// EventBus Singleton with Cross-Process JSONL Bridge
// ─────────────────────────────────────────────────────────────────────────────

const EVENTS_FILE = path.join(os.homedir(), '.nexus-prime', 'events.jsonl');

class EventBusEngine {
    private emitter = new EventEmitter();
    private history: NexusEvent[] = [];
    private readonly MAX_HISTORY = 1000;
    private seenIds = new Set<string>();
    private fileOffset = 0;
    private pollHandle: ReturnType<typeof setInterval> | null = null;

    constructor() {
        // Increase limit for many dashboard connections
        this.emitter.setMaxListeners(50);
        // Ensure directory exists
        const dir = path.dirname(EVENTS_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    /**
     * Emit a strongly-typed Nexus Prime event
     */
    emit<T extends NexusEventType>(type: T, data: NexusEventPayloads[T]): void {
        const event: NexusEvent<T> = {
            id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            type,
            timestamp: Date.now(),
            data
        };

        // Store in circular history buffer
        this.history.push(event);
        if (this.history.length > this.MAX_HISTORY) {
            this.history.shift();
        }
        this.seenIds.add(event.id);

        // Broadcast in-process
        this.emitter.emit('nexus_event', event);

        // Write to JSONL file for cross-process bridge
        try {
            fs.appendFileSync(EVENTS_FILE, JSON.stringify(event) + '\n');
        } catch { /* ignore write errors */ }
    }

    /**
     * Poll the JSONL file for events from other processes.
     * Call this from DashboardServer to bridge cross-process events.
     */
    startFilePolling(intervalMs: number = 2000): void {
        if (this.pollHandle) return;

        // Skip to end of file initially so we don't replay old events
        try {
            if (fs.existsSync(EVENTS_FILE)) {
                this.fileOffset = fs.statSync(EVENTS_FILE).size;
            }
        } catch { /* ignore */ }

        this.pollHandle = setInterval(() => {
            try {
                if (!fs.existsSync(EVENTS_FILE)) return;
                const stat = fs.statSync(EVENTS_FILE);
                if (stat.size <= this.fileOffset) {
                    // File was truncated or no new data
                    if (stat.size < this.fileOffset) this.fileOffset = 0;
                    return;
                }

                // Read only new bytes
                const fd = fs.openSync(EVENTS_FILE, 'r');
                const buf = Buffer.alloc(stat.size - this.fileOffset);
                fs.readSync(fd, buf, 0, buf.length, this.fileOffset);
                fs.closeSync(fd);

                // Ensure we only process complete lines (ending in \n)
                const chunk = buf.toString('utf-8');
                const lastNewline = chunk.lastIndexOf('\n');

                if (lastNewline === -1) {
                    // No complete line yet, wait for next tick
                    return;
                }

                const validChunk = chunk.substring(0, lastNewline);
                this.fileOffset += Buffer.byteLength(validChunk) + 1; // +1 for the newline

                // Parse JSONL lines
                const lines = validChunk.split('\n').filter(Boolean);
                for (const line of lines) {
                    try {
                        const event = JSON.parse(line) as NexusEvent;
                        if (!this.seenIds.has(event.id)) {
                            this.seenIds.add(event.id);
                            this.history.push(event);
                            if (this.history.length > this.MAX_HISTORY) this.history.shift();
                            // Broadcast to in-process listeners (SSE clients)
                            this.emitter.emit('nexus_event', event);
                        }
                    } catch { /* skip malformed lines */ }
                }
            } catch { /* ignore poll errors */ }
        }, intervalMs);
        this.pollHandle.unref();
    }

    /** Stop file polling */
    stopFilePolling(): void {
        if (this.pollHandle) {
            clearInterval(this.pollHandle);
            this.pollHandle = null;
        }
    }

    /**
     * Listen to all events (useful for SSE streams)
     */
    onEvent(handler: (event: NexusEvent) => void): () => void {
        this.emitter.on('nexus_event', handler);
        // Return an unsubscribe function
        return () => this.emitter.off('nexus_event', handler);
    }

    /**
     * Listen to specific event types
     */
    on<T extends NexusEventType>(type: T, handler: (data: NexusEventPayloads[T]) => void): () => void {
        const wrapper = (event: NexusEvent) => {
            if (event.type === type) {
                handler(event.data as NexusEventPayloads[T]);
            }
        };
        this.emitter.on('nexus_event', wrapper);
        return () => this.emitter.off('nexus_event', wrapper);
    }

    /**
     * Get historical events
     */
    getHistory(sinceTimestamp: number = 0): NexusEvent[] {
        return this.history.filter(e => e.timestamp > sinceTimestamp);
    }

    /**
     * Clear history
     */
    clear(): void {
        this.history = [];
        this.seenIds.clear();
    }
}

// Export a singleton instance
export const nexusEventBus = new EventBusEngine();
