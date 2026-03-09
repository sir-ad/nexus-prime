import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { nexusEventBus, type NexusEvent } from '../engines/event-bus.js';
import type { SubAgentRuntime } from '../phantom/runtime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.NEXUS_DASHBOARD_PORT || '3377', 10);
const HOST = process.env.NEXUS_DASHBOARD_HOST || '127.0.0.1';

interface DashboardServerOptions {
    runtimeProvider?: () => SubAgentRuntime | undefined;
    repoRoot?: string;
}

export class DashboardServer {
    private server: http.Server;
    private clients: Set<http.ServerResponse> = new Set();
    private unsubscribeBus: (() => void) | null = null;
    private runtimeProvider?: () => SubAgentRuntime | undefined;
    private repoRoot: string;

    constructor(options: DashboardServerOptions = {}) {
        this.runtimeProvider = options.runtimeProvider;
        this.repoRoot = options.repoRoot ?? process.cwd();
        this.server = http.createServer(this.requestHandler.bind(this));
    }

    start(): void {
        if (process.env.NEXUS_DASHBOARD_DISABLED === '1') {
            console.error('[Dashboard] Disabled by NEXUS_DASHBOARD_DISABLED=1');
            return;
        }

        this.server.listen(PORT, HOST, () => {
            const address = this.server.address();
            const printablePort = typeof address === 'object' && address ? address.port : PORT;
            console.error(`[Dashboard] Runtime console live at http://${HOST}:${printablePort}`);
        });

        this.server.on('error', (e: any) => {
            if (e.code === 'EADDRINUSE') {
                console.error(`[Dashboard] Port ${PORT} occupied. Bridging to active dashboard cluster.`);
            } else {
                console.error(`[Dashboard] Server error:`, e.message);
            }
        });

        this.unsubscribeBus = nexusEventBus.onEvent((event: NexusEvent) => {
            this.broadcast(event);
        });

        nexusEventBus.startFilePolling(1500);
    }

    stop(): void {
        if (this.unsubscribeBus) {
            this.unsubscribeBus();
            this.unsubscribeBus = null;
        }

        nexusEventBus.stopFilePolling();

        for (const res of this.clients) {
            res.end();
        }
        this.clients.clear();

        this.server.close();
    }

    getAddress(): string | null {
        const address = this.server.address();
        if (!address || typeof address === 'string') return null;
        return `http://${HOST}:${address.port}`;
    }

    private requestHandler(req: http.IncomingMessage, res: http.ServerResponse): void {
        const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);

        if (url.pathname === '/' || url.pathname === '/index.html') {
            this.serveDashboard(res);
            return;
        }

        if (url.pathname === '/stream') {
            this.serveSSE(req, res);
            return;
        }

        if (url.pathname === '/api/runs') {
            this.respondJson(res, this.getRuntime()?.listRuns(20) ?? []);
            return;
        }

        if (url.pathname.startsWith('/api/runs/')) {
            const runId = decodeURIComponent(url.pathname.replace('/api/runs/', ''));
            const run = this.getRuntime()?.getRun(runId);
            this.respondJson(res, run ?? { error: 'run-not-found', runId }, run ? 200 : 404);
            return;
        }

        if (url.pathname === '/api/skills') {
            this.respondJson(res, this.getRuntime()?.listSkills() ?? []);
            return;
        }

        if (url.pathname === '/api/workflows') {
            this.respondJson(res, this.getRuntime()?.listWorkflows() ?? []);
            return;
        }

        if (url.pathname === '/api/backends') {
            this.respondJson(res, this.getRuntime()?.getBackendCatalog() ?? {});
            return;
        }

        if (url.pathname === '/api/health') {
            this.respondJson(res, this.collectHealth());
            return;
        }

        res.writeHead(404);
        res.end('Not found');
    }

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

    private serveSSE(req: http.IncomingMessage, res: http.ServerResponse): void {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });

        res.write('retry: 3000\n\n');
        res.write(`event: bootstrap\ndata: ${JSON.stringify({ connected: true, timestamp: Date.now() })}\n\n`);

        const history = nexusEventBus.getHistory();
        for (const evt of history) {
            res.write(`data: ${JSON.stringify(evt)}\n\n`);
        }

        this.clients.add(res);

        const pingInterval = setInterval(() => {
            res.write(':\n\n');
        }, 20000);
        pingInterval.unref();

        req.on('close', () => {
            clearInterval(pingInterval);
            this.clients.delete(res);
        });
    }

    private broadcast(event: NexusEvent): void {
        const dataStr = `data: ${JSON.stringify(event)}\n\n`;
        for (const res of this.clients) {
            res.write(dataStr);
        }
    }

    private respondJson(res: http.ServerResponse, data: unknown, statusCode: number = 200): void {
        res.writeHead(statusCode, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
            'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify(data, null, 2));
    }

    private getRuntime(): SubAgentRuntime | undefined {
        return this.runtimeProvider?.();
    }

    private collectHealth(): Record<string, unknown> {
        const packageJsonPath = path.join(this.repoRoot, 'package.json');
        const workflowPath = path.join(this.repoRoot, '.github', 'workflows', 'pages.yml');
        const docsDir = path.join(this.repoRoot, 'docs');
        const runtime = this.getRuntime();

        let packageVersion = 'unknown';
        if (fs.existsSync(packageJsonPath)) {
            try {
                packageVersion = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')).version ?? 'unknown';
            } catch {
                packageVersion = 'unknown';
            }
        }

        let pagesWorkflowValid = false;
        if (fs.existsSync(workflowPath)) {
            const raw = fs.readFileSync(workflowPath, 'utf-8');
            pagesWorkflowValid = raw.includes('steps.deployment.outputs.page_url');
        }

        return {
            connection: {
                stream: this.clients.size > 0 ? 'connected' : 'idle',
                subscribers: this.clients.size,
            },
            runtime: runtime?.getHealth() ?? { runtime: 'unavailable' },
            release: {
                packageVersion,
            },
            docs: {
                present: fs.existsSync(docsDir),
                pagesWorkflowValid,
            },
            ci: {
                lintScriptPresent: fs.existsSync(packageJsonPath),
                eventHistory: nexusEventBus.getHistory().length,
            },
        };
    }
}
