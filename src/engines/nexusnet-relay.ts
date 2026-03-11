/**
 * Nexus Prime - NexusNet Relay
 *
 * MVP Cross-machine knowledge federation using a shared GitHub Gist as a pub/sub mechanism.
 * Note: Requires `GITHUB_TOKEN` and `NEXUSNET_GIST_ID` environment variables.
 *
 * Phase: 8G (NexusNet Relay)
 */

import { randomUUID } from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface NexusNetMessage {
    id: string;
    type: 'knowledge' | 'skill' | 'query' | 'response';
    sourceId: string;       // Anonymized agent ID
    payload: {
        content: string;
        tags: string[];
        confidence?: number;
    };
    timestamp: number;
    ttl: number;            // seconds
}

export interface NexusNetRelayStatus {
    configured: boolean;
    mode: 'live' | 'degraded';
    gistId?: string;
    lastError?: string;
    lastSyncAt?: number;
    lastPublishAt?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// NexusNet Relay
// ─────────────────────────────────────────────────────────────────────────────

export class NexusNetRelay {
    private readonly sourceId: string;
    private lastError?: string;
    private lastSyncAt?: number;
    private lastPublishAt?: number;

    constructor() {
        // In a real system this would persist or be tied to install ID
        this.sourceId = `nexus_agent_${randomUUID().slice(0, 8)}`;
    }

    private getConfig() {
        const token = process.env.GITHUB_TOKEN;
        const gistId = process.env.NEXUSNET_GIST_ID;

        return { token, gistId, authReady: !!(token && gistId) };
    }

    getStatus(): NexusNetRelayStatus {
        const config = this.getConfig();
        return {
            configured: config.authReady,
            mode: config.authReady ? 'live' : 'degraded',
            gistId: config.gistId,
            lastError: this.lastError,
            lastSyncAt: this.lastSyncAt,
            lastPublishAt: this.lastPublishAt,
        };
    }

    /**
     * Publish a message to the shared Gist network.
     */
    async publish(type: NexusNetMessage['type'], payload: NexusNetMessage['payload'], ttl: number = 86400): Promise<{ id: string; bytes: number; configured: boolean; mode: NexusNetRelayStatus['mode'] }> {
        const message: NexusNetMessage = {
            id: randomUUID(),
            type,
            sourceId: this.sourceId,
            payload,
            timestamp: Date.now(),
            ttl
        };

        const config = this.getConfig();
        const jsonString = JSON.stringify(message);
        const bytes = Buffer.byteLength(jsonString, 'utf8');

        if (!config.authReady) {
            this.lastError = 'GITHUB_TOKEN or NEXUSNET_GIST_ID missing';
            return { id: message.id, bytes, configured: false, mode: 'degraded' };
        }

        try {
            // Read current
            const response = await fetch(`https://api.github.com/gists/${config.gistId}`, {
                headers: {
                    'Authorization': `Bearer ${config.token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (!response.ok) throw new Error(`Fetch failed: ${response.statusText}`);

            const gistData = (await response.json()) as any;
            const fileContent = gistData.files?.['nexusnet.json']?.content || '[]';
            const messages: NexusNetMessage[] = JSON.parse(fileContent);

            // Filter expired
            const now = Date.now();
            const valid = messages.filter(m => now - m.timestamp < m.ttl * 1000);

            // Append
            valid.push(message);

            // Write back
            const updateResponse = await fetch(`https://api.github.com/gists/${config.gistId}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${config.token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    files: {
                        'nexusnet.json': { content: JSON.stringify(valid, null, 2) }
                    }
                })
            });

            if (!updateResponse.ok) throw new Error(`Update failed: ${updateResponse.statusText}`);

            this.lastError = undefined;
            this.lastPublishAt = Date.now();
            return { id: message.id, bytes, configured: true, mode: 'live' };
        } catch (error: any) {
            this.lastError = String(error?.message ?? error);
            throw new Error(`Failed to publish to NexusNet: ${error.message}`);
        }
    }

    /**
     * Sync messages from the shared Gist network.
     */
    async sync(): Promise<NexusNetMessage[]> {
        const config = this.getConfig();

        if (!config.authReady) {
            this.lastError = 'GITHUB_TOKEN or NEXUSNET_GIST_ID missing';
            return [];
        }

        try {
            const response = await fetch(`https://api.github.com/gists/${config.gistId}`, {
                headers: {
                    'Authorization': `Bearer ${config.token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Cache-Control': 'no-cache, no-store, must-revalidate'
                }
            });

            if (!response.ok) throw new Error(`Fetch failed: ${response.statusText}`);

            const gistData = (await response.json()) as any;
            const fileContent = gistData.files?.['nexusnet.json']?.content || '[]';
            const messages: NexusNetMessage[] = JSON.parse(fileContent);

            // Filter out our own messages and expired ones
            const now = Date.now();
            this.lastError = undefined;
            this.lastSyncAt = now;
            return messages.filter(m => m.sourceId !== this.sourceId && (now - m.timestamp < m.ttl * 1000));
        } catch (error: any) {
            this.lastError = String(error?.message ?? error);
            throw new Error(`Failed to sync from NexusNet: ${error.message}`);
        }
    }
}

export const nexusNetRelay = new NexusNetRelay();
