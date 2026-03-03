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

// ─────────────────────────────────────────────────────────────────────────────
// NexusNet Relay
// ─────────────────────────────────────────────────────────────────────────────

export class NexusNetRelay {
    private readonly sourceId: string;

    constructor() {
        // In a real system this would persist or be tied to install ID
        this.sourceId = `nexus_agent_${randomUUID().slice(0, 8)}`;
    }

    private getConfig() {
        const token = process.env.GITHUB_TOKEN;
        const gistId = process.env.NEXUSNET_GIST_ID;

        // For MVP, if missing, we drop to a local mock mode
        return { token, gistId, authReady: !!(token && gistId) };
    }

    /**
     * Publish a message to the shared Gist network.
     */
    async publish(type: NexusNetMessage['type'], payload: NexusNetMessage['payload'], ttl: number = 86400): Promise<{ id: string; bytes: number }> {
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
            console.error('[NexusNet] GITHUB_TOKEN or NEXUSNET_GIST_ID missing. Mock publishing.');
            return { id: message.id, bytes };
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

            return { id: message.id, bytes };
        } catch (error: any) {
            console.error(`[NexusNet] Publish Failed:`, error.message);
            throw new Error(`Failed to publish to NexusNet: ${error.message}`);
        }
    }

    /**
     * Sync messages from the shared Gist network.
     */
    async sync(): Promise<NexusNetMessage[]> {
        const config = this.getConfig();

        if (!config.authReady) {
            console.error('[NexusNet] GITHUB_TOKEN or NEXUSNET_GIST_ID missing. Mock syncing.');
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
            return messages.filter(m => m.sourceId !== this.sourceId && (now - m.timestamp < m.ttl * 1000));
        } catch (error: any) {
            console.error(`[NexusNet] Sync Failed:`, error.message);
            throw new Error(`Failed to sync from NexusNet: ${error.message}`);
        }
    }
}
