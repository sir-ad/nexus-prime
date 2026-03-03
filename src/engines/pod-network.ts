import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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
    private podPath: string;

    constructor() {
        this.podPath = path.join(os.homedir(), '.nexus-prime', 'pod.json');
        if (!fs.existsSync(path.dirname(this.podPath))) {
            fs.mkdirSync(path.dirname(this.podPath), { recursive: true });
        }
        this.loadMessages();

        // Basic poll for changes from other workers (cross-process)
        // In a high-traffic swarm, this could transition to a socket or redis
        setInterval(() => this.loadMessages(), 5000);
    }

    private loadMessages(): void {
        try {
            if (fs.existsSync(this.podPath)) {
                const data = fs.readFileSync(this.podPath, 'utf-8');
                if (!data) return;

                const fileMessages: PodMessage[] = JSON.parse(data);

                // Merge and deduplicate by ID
                const existingIds = new Set(this.messages.map(m => m.id));
                const newMessages = fileMessages.filter(m => !existingIds.has(m.id));

                if (newMessages.length > 0) {
                    this.messages.push(...newMessages);
                    // Broadcast new findings to local subscribers
                    newMessages.forEach(m => this.broadcast(m));
                }
            }
        } catch (e) {
            // Ignore parse/read errors if file is being written
        }
    }

    private saveMessages(): void {
        try {
            // TTL: Only keep messages from the last 1 hour to prevent file bloat
            const oneHourAgo = Date.now() - (60 * 60 * 1000);
            this.messages = this.messages.filter(m => m.timestamp > oneHourAgo);

            fs.writeFileSync(this.podPath, JSON.stringify(this.messages, null, 2));
        } catch (e) {
            console.error('Failed to save POD messages:', e);
        }
    }

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
        this.saveMessages();
        this.broadcast(msg);
        return msg;
    }

    /** Recall relevant POD context for a specific task */
    recall(tags: string[], minConfidence: number = 0.5): PodMessage[] {
        this.loadMessages(); // Refresh from file before recall
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
        if (fs.existsSync(this.podPath)) {
            fs.unlinkSync(this.podPath);
        }
    }
}

export const podNetwork = new PODNetwork();
