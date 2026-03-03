/**
 * Nexus Prime Dashboard Server
 *
 * Zero-dependency HTTP + Server-Sent Events (SSE) server.
 * Streams events from EventBus to the browser dashboard.
 *
 * Phase: 8C (Visualization Dashboard)
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { nexusEventBus, type NexusEvent } from '../engines/event-bus.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.NEXUS_DASHBOARD_PORT || '3377', 10);
const HOST = process.env.NEXUS_DASHBOARD_HOST || '127.0.0.1';

export class DashboardServer {
    private server: http.Server;
    private clients: Set<http.ServerResponse> = new Set();
    private unsubscribeBus: (() => void) | null = null;

    constructor() {
        this.server = http.createServer(this.requestHandler.bind(this));
    }

    /** Start the dashboard server */
    start(): void {
        this.server.listen(PORT, HOST, () => {
            console.error(`[Dashboard] Matrix live at http://${HOST}:${PORT}`);
        });

        // Listen to all Nexus events and broadcast to connected SSE clients
        this.unsubscribeBus = nexusEventBus.onEvent((event: NexusEvent) => {
            this.broadcast(event);
        });
    }

    /** Stop the dashboard server */
    stop(): void {
        if (this.unsubscribeBus) {
            this.unsubscribeBus();
            this.unsubscribeBus = null;
        }

        for (const res of this.clients) {
            res.end();
        }
        this.clients.clear();

        this.server.close();
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // HTTP Handlers
    // ─────────────────────────────────────────────────────────────────────────────

    private requestHandler(req: http.IncomingMessage, res: http.ServerResponse): void {
        const url = req.url || '/';

        if (url === '/' || url === '/index.html') {
            this.serveDashboard(res);
        } else if (url === '/stream') {
            this.serveSSE(req, res);
        } else {
            res.writeHead(404);
            res.end('Not found');
        }
    }

    /** Serve the static HTML dashboard */
    private serveDashboard(res: http.ServerResponse): void {
        const htmlPath = path.join(__dirname, 'index.html');

        fs.readFile(htmlPath, 'utf8', (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading dashboard HTML');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
    }

    /** Handle SSE connections */
    private serveSSE(req: http.IncomingMessage, res: http.ServerResponse): void {
        // Standard SSE headers
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });

        res.write('retry: 3000\n\n');

        // Send history immediately on connect
        const history = nexusEventBus.getHistory();
        for (const evt of history) {
            res.write(`data: ${JSON.stringify(evt)}\n\n`);
        }

        this.clients.add(res);

        // Keep connection alive with pings every 20s
        const pingInterval = setInterval(() => {
            res.write(':\n\n');
        }, 20000);

        req.on('close', () => {
            clearInterval(pingInterval);
            this.clients.delete(res);
        });
    }

    /** Broadcast event to all SSE clients */
    private broadcast(event: NexusEvent): void {
        const dataStr = `data: ${JSON.stringify(event)}\n\n`;
        for (const res of this.clients) {
            res.write(dataStr);
        }
    }
}
