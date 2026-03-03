/**
 * Nexus Prime Event Bus
 *
 * Centralized, strongly-typed internal event emitter.
 * Broadcasts events from all engines to the Visualization Dashboard via SSE.
 *
 * Phase: 8C (Visualization Dashboard)
 */

import { EventEmitter } from 'events';

// ─────────────────────────────────────────────────────────────────────────────
// Types & Interfaces
// ─────────────────────────────────────────────────────────────────────────────

export type NexusEventType =
    | 'system.boot'
    | 'memory.store'
    | 'memory.recall'
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
    | 'nexusnet.publish'
    | 'nexusnet.sync';

export interface NexusEventPayloads {
    'system.boot': { version: string; toolsCount: number };
    'memory.store': { id: string; priority: number; tags: string[]; tier: string };
    'memory.recall': { query: string; count: number };
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
    'nexusnet.publish': { type: string; byteSize: number };
    'nexusnet.sync': { newItemsCount: number };
}

export interface NexusEvent<T extends NexusEventType = NexusEventType> {
    id: string;
    type: T;
    timestamp: number;
    data: NexusEventPayloads[T];
}

// ─────────────────────────────────────────────────────────────────────────────
// EventBus Singleton
// ─────────────────────────────────────────────────────────────────────────────

class EventBusEngine {
    private emitter = new EventEmitter();
    private history: NexusEvent[] = [];
    private readonly MAX_HISTORY = 1000;

    constructor() {
        // Increase limit for many dashboard connections
        this.emitter.setMaxListeners(50);
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

        // Broadcast
        this.emitter.emit('nexus_event', event);
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
    }
}

// Export a singleton instance
export const nexusEventBus = new EventBusEngine();
