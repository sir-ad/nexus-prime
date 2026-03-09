import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { nexusEventBus } from './event-bus.js';

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
    private pollHandle: ReturnType<typeof setInterval> | null = null;
    public static instance: PODNetwork;

    constructor() {
        PODNetwork.instance = this;
        this.podPath = resolvePodPath();
        this.loadMessages();

        // Basic poll for changes from other workers (cross-process)
        // unref() allows the Node process to exit even if the timer is still active
        this.pollHandle = setInterval(() => this.loadMessages(), 5000);
        this.pollHandle.unref();
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
        nexusEventBus.emit('pod.signal' as any, {
            workerId: msg.workerId,
            type: msg.type,
            content: msg.content.substring(0, 50) + (msg.content.length > 50 ? '...' : '')
        });

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

    /** Stop the poll timer and release resources */
    destroy(): void {
        if (this.pollHandle) {
            clearInterval(this.pollHandle);
            this.pollHandle = null;
        }
    }
}

export const podNetwork = new PODNetwork();

function resolvePodPath(): string {
    const configured = process.env.NEXUS_POD_PATH;
    if (configured) {
        fs.mkdirSync(path.dirname(configured), { recursive: true });
        return configured;
    }

    const preferredRoot = process.env.NEXUS_STATE_DIR
        ? path.resolve(process.env.NEXUS_STATE_DIR)
        : path.join(os.homedir(), '.nexus-prime');
    try {
        fs.mkdirSync(preferredRoot, { recursive: true });
        return path.join(preferredRoot, 'pod.json');
    } catch {
        const fallbackRoot = path.join(os.tmpdir(), 'nexus-prime-state');
        fs.mkdirSync(fallbackRoot, { recursive: true });
        return path.join(fallbackRoot, 'pod.json');
    }
}
