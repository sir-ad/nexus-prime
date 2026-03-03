/**
 * POD Network — Cross-Worker Memory Synchronization
 * 
 * POD (Prompt Observation Distribution) Network allows parallel phantom workers 
 * to share findings in real-time. This prevents redundant work and enables 
 * swarm-level "meta-logic".
 */

import { randomUUID } from 'crypto';

export interface PodMessage {
    id: string;
    workerId: string;
    type: 'observation' | 'fact' | 'instruction';
    content: string;
    timestamp: number;
    tags: string[];
    confidence: number;
}

export class PODNetwork {
    private messages: PodMessage[] = [];
    private subscribers: Map<string, Set<(msg: PodMessage) => void>> = new Map();

    /** Publish a finding to the network */
    publish(workerId: string, content: string, confidence: number = 0.8, tags: string[] = []): PodMessage {
        const msg: PodMessage = {
            id: randomUUID(),
            workerId,
            content,
            confidence,
            tags,
            timestamp: Date.now(),
            type: tags.includes('#instruction') ? 'instruction' : 'observation'
        };

        this.messages.push(msg);
        this.broadcast(msg);
        return msg;
    }

    /** Recall relevant POD context for a specific task */
    recall(tags: string[], minConfidence: number = 0.5): PodMessage[] {
        return this.messages.filter(m =>
            m.confidence >= minConfidence &&
            (tags.length === 0 || tags.some(t => m.tags.includes(t)))
        ).sort((a, b) => b.timestamp - a.timestamp);
    }

    /** Internal broadcast to active sub-agent listeners */
    private broadcast(msg: PodMessage): void {
        for (const tag of msg.tags) {
            this.subscribers.get(tag)?.forEach(cb => cb(msg));
        }
        // Universal subscriber
        this.subscribers.get('*')?.forEach(cb => cb(msg));
    }

    /** Sub-agents can listen for specific events/topics */
    subscribe(tag: string, callback: (msg: PodMessage) => void): () => void {
        if (!this.subscribers.has(tag)) {
            this.subscribers.set(tag, new Set());
        }
        this.subscribers.get(tag)!.add(callback);

        return () => {
            this.subscribers.get(tag)?.delete(callback);
        };
    }

    clear(): void {
        this.messages = [];
    }
}

export const podNetwork = new PODNetwork();
