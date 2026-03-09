import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { nexusEventBus, type NexusEvent, type NexusEventType } from '../engines/event-bus.js';
import type { Adapter } from '../core/types.js';
import type { MemoryEngine } from '../engines/memory.js';
import { podNetwork } from '../engines/pod-network.js';
import { ClientRegistry } from '../engines/client-registry.js';
import type { SubAgentRuntime } from '../phantom/runtime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HOST = process.env.NEXUS_DASHBOARD_HOST || '127.0.0.1';
const DEFAULT_PORT = parseInt(process.env.NEXUS_DASHBOARD_PORT || '3377', 10);
const MAX_PORT_SCAN = 24;
const DASHBOARD_API_VERSION = '2';
const REQUIRED_CAPABILITIES = {
    runs: true,
    memory: true,
    pod: true,
    clients: true,
    events: true,
    stream: true,
} as const;

interface DashboardServerOptions {
    runtimeProvider?: () => SubAgentRuntime | undefined;
    memoryProvider?: () => MemoryEngine | undefined;
    adaptersProvider?: () => Adapter[];
    clientRegistryProvider?: () => ClientRegistry | undefined;
    repoRoot?: string;
}

interface DashboardEventCard {
    id: string;
    type: NexusEventType;
    title: string;
    source: string;
    time: number;
    severity: 'good' | 'info' | 'warn' | 'bad';
    category: 'memory' | 'tokens' | 'runtime' | 'pod' | 'skills' | 'workflows' | 'clients' | 'system';
    summary: string;
    payload: unknown;
}

interface DashboardCompatibilityProbe {
    status: 'free' | 'compatible' | 'incompatible';
    url: string;
    health?: DashboardHealthResponse;
    reason?: string;
}

interface DashboardProbeResponse {
    statusCode: number;
    body: string;
}

interface DashboardHealthResponse {
    dashboardApiVersion: string;
    capabilities: Record<string, boolean>;
    dashboardUrl: string | null;
    dashboardMode: 'idle' | 'bound' | 'reused';
    connection: unknown;
    runtime: unknown;
    memory: unknown;
    pod: unknown;
    clients: unknown;
    release: unknown;
    docs: unknown;
    ci: unknown;
}

export class DashboardServer {
    private server: http.Server;
    private cachedDashboardHtml: string | null = null;
    private clients: Set<http.ServerResponse> = new Set();
    private unsubscribeBus: (() => void) | null = null;
    private runtimeProvider?: () => SubAgentRuntime | undefined;
    private memoryProvider?: () => MemoryEngine | undefined;
    private adaptersProvider?: () => Adapter[];
    private clientRegistryProvider?: () => ClientRegistry | undefined;
    private repoRoot: string;
    private dashboardUrl: string | null = null;
    private dashboardMode: 'idle' | 'bound' | 'reused' = 'idle';
    private activePort: number | null = null;
    private started = false;
    private initializePromise: Promise<void> | null = null;

    constructor(options: DashboardServerOptions = {}) {
        this.runtimeProvider = options.runtimeProvider;
        this.memoryProvider = options.memoryProvider;
        this.adaptersProvider = options.adaptersProvider;
        this.clientRegistryProvider = options.clientRegistryProvider;
        this.repoRoot = options.repoRoot ?? process.cwd();
        this.server = http.createServer((req, res) => {
            void this.requestHandler(req, res);
        });
        this.server.on('error', (error: NodeJS.ErrnoException) => {
            if (this.dashboardMode === 'bound') {
                console.error('[Dashboard] Server error:', error.message);
            }
        });
    }

    start(): void {
        if (process.env.NEXUS_DASHBOARD_DISABLED === '1') {
            console.error('[Dashboard] Disabled by NEXUS_DASHBOARD_DISABLED=1');
            return;
        }
        if (this.started) {
            return;
        }
        this.started = true;
        this.initializePromise = this.initialize().catch((error) => {
            this.started = false;
            this.dashboardMode = 'idle';
            this.dashboardUrl = null;
            this.activePort = null;
            console.error('[Dashboard] Failed to start dashboard:', error instanceof Error ? error.message : String(error));
        });
    }

    stop(): void {
        if (this.unsubscribeBus) {
            this.unsubscribeBus();
            this.unsubscribeBus = null;
        }

        if (this.dashboardMode === 'bound') {
            nexusEventBus.stopFilePolling();

            for (const res of this.clients) {
                res.end();
            }
            this.clients.clear();

            this.server.close();
        }

        this.dashboardMode = 'idle';
        this.dashboardUrl = null;
        this.activePort = null;
        this.started = false;
    }

    getAddress(): string | null {
        return this.dashboardUrl;
    }

    private async initialize(): Promise<void> {
        const probe = await this.probeDashboard(DEFAULT_PORT);

        if (probe.status === 'compatible') {
            this.dashboardMode = 'reused';
            this.dashboardUrl = probe.url;
            this.activePort = DEFAULT_PORT;
            console.error(`[Dashboard] Reusing compatible dashboard at ${probe.url}`);
            return;
        }

        const startPort = probe.status === 'incompatible' ? DEFAULT_PORT + 1 : DEFAULT_PORT;
        const fallbackPort = await this.bindFirstAvailablePort(startPort, DEFAULT_PORT + MAX_PORT_SCAN);

        this.dashboardMode = 'bound';
        this.activePort = fallbackPort;
        this.dashboardUrl = this.buildUrl(fallbackPort);
        this.unsubscribeBus = nexusEventBus.onEvent((event) => this.broadcast(event));
        nexusEventBus.startFilePolling();

        if (probe.status === 'incompatible') {
            console.error(`[Dashboard] Incompatible dashboard detected at ${probe.url} (${probe.reason || 'missing compatibility contract'}). New dashboard started at ${this.dashboardUrl}`);
            return;
        }

        console.error(`[Dashboard] Topology console listening at ${this.dashboardUrl}`);
    }

    private async requestHandler(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
      try {
        const url = new URL(req.url || '/', this.dashboardUrl ?? this.buildUrl(this.activePort ?? DEFAULT_PORT));

        if (req.method === 'OPTIONS') {
            this.respondOptions(res);
            return;
        }

        if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
            this.serveDashboard(res);
            return;
        }

        if (req.method === 'GET' && url.pathname === '/stream') {
            this.serveSSE(req, res);
            return;
        }

        if (req.method === 'GET' && url.pathname === '/api/runs') {
            const limit = parseInt(url.searchParams.get('limit') || '20', 10);
            this.respondJson(res, this.getRuntime()?.listRuns(limit) ?? []);
            return;
        }

        if (req.method === 'GET' && url.pathname.startsWith('/api/runs/')) {
            const runId = decodeURIComponent(url.pathname.replace('/api/runs/', ''));
            const run = this.getRuntime()?.getRun(runId);
            this.respondJson(res, run ?? { error: 'run-not-found', runId }, run ? 200 : 404);
            return;
        }

        if (req.method === 'GET' && url.pathname === '/api/skills') {
            this.respondJson(res, this.getRuntime()?.listSkills() ?? []);
            return;
        }

        if (req.method === 'GET' && url.pathname === '/api/workflows') {
            this.respondJson(res, this.getRuntime()?.listWorkflows() ?? []);
            return;
        }

        if (req.method === 'GET' && url.pathname === '/api/backends') {
            this.respondJson(res, this.getRuntime()?.getBackendCatalog() ?? {});
            return;
        }

        if (req.method === 'GET' && url.pathname === '/api/health') {
            this.respondJson(res, this.collectHealth());
            return;
        }

        if (req.method === 'GET' && url.pathname === '/api/memory') {
            const limit = parseInt(url.searchParams.get('limit') || '40', 10);
            const tier = url.searchParams.get('tier') ?? undefined;
            const tag = url.searchParams.get('tag') ?? undefined;
            const linkedType = url.searchParams.get('linkedType') ?? undefined;
            const recencyMs = url.searchParams.get('recencyMs');
            const memory = this.getMemory();
            this.respondJson(res, memory?.listSnapshots(limit, {
                tier: tier as 'prefrontal' | 'hippocampus' | 'cortex' | undefined,
                tag,
                linkedType: linkedType as 'session' | 'run' | 'skill' | 'workflow' | undefined,
                recencyMs: recencyMs ? parseInt(recencyMs, 10) : undefined,
            }) ?? []);
            return;
        }

        if (req.method === 'GET' && url.pathname.startsWith('/api/memory/') && url.pathname.endsWith('/network')) {
            const id = decodeURIComponent(url.pathname.replace('/api/memory/', '').replace('/network', '').replace(/\/$/, ''));
            const depth = parseInt(url.searchParams.get('depth') || '2', 10);
            const limit = parseInt(url.searchParams.get('limit') || '18', 10);
            const memory = this.getMemory();
            this.respondJson(res, memory?.getNetworkSnapshot(id, depth, limit) ?? { focusId: id, nodes: [], links: [] });
            return;
        }

        if (req.method === 'GET' && url.pathname.startsWith('/api/memory/')) {
            const id = decodeURIComponent(url.pathname.replace('/api/memory/', ''));
            const memory = this.getMemory();
            const detail = memory?.getDetail(id);
            this.respondJson(res, detail ?? { error: 'memory-not-found', id }, detail ? 200 : 404);
            return;
        }

        if (req.method === 'GET' && url.pathname === '/api/pod') {
            const limit = parseInt(url.searchParams.get('limit') || '40', 10);
            this.respondJson(res, podNetwork.getDashboardSnapshot(limit));
            return;
        }

        if (req.method === 'GET' && url.pathname.startsWith('/api/pod/')) {
            const workerId = decodeURIComponent(url.pathname.replace('/api/pod/', ''));
            const limit = parseInt(url.searchParams.get('limit') || '20', 10);
            this.respondJson(res, podNetwork.getWorker(workerId, limit));
            return;
        }

        if (req.method === 'GET' && url.pathname === '/api/clients') {
            this.respondJson(res, this.getClientRegistry()?.listClients(this.getAdapters()) ?? []);
            return;
        }

        if (req.method === 'GET' && url.pathname === '/api/events') {
            const category = url.searchParams.get('category');
            const type = url.searchParams.get('type');
            const limit = parseInt(url.searchParams.get('limit') || '80', 10);
            const events = this.getEventCards()
                .filter((event) => !category || event.category === category)
                .filter((event) => !type || event.type === type)
                .slice(0, Math.max(limit, 1));
            this.respondJson(res, events);
            return;
        }

        if (req.method === 'POST' && url.pathname === '/api/skills/deploy') {
            const body = await this.readJsonBody(req);
            const runtime = this.getRuntime();
            const deployed = runtime?.deploySkill(String(body.skillId), body.scope);
            if (deployed) {
                nexusEventBus.emit('skill.deploy', {
                    skillId: deployed.skillId,
                    scope: deployed.scope,
                    status: deployed.rolloutStatus,
                });
            }
            this.respondJson(res, deployed ?? { error: 'skill-not-found' }, deployed ? 200 : 404);
            return;
        }

        if (req.method === 'POST' && url.pathname === '/api/skills/revoke') {
            const body = await this.readJsonBody(req);
            const runtime = this.getRuntime();
            const revoked = runtime?.revokeSkill(String(body.skillId));
            if (revoked) {
                nexusEventBus.emit('skill.revoke', {
                    skillId: revoked.skillId,
                    status: revoked.rolloutStatus,
                });
            }
            this.respondJson(res, revoked ?? { error: 'skill-not-found' }, revoked ? 200 : 404);
            return;
        }

        if (req.method === 'POST' && url.pathname === '/api/workflows/deploy') {
            const body = await this.readJsonBody(req);
            const runtime = this.getRuntime();
            const deployed = runtime?.deployWorkflow(String(body.workflowId), body.scope);
            if (deployed) {
                nexusEventBus.emit('workflow.deploy', {
                    workflowId: deployed.workflowId,
                    scope: deployed.scope,
                    status: deployed.rolloutStatus,
                });
            }
            this.respondJson(res, deployed ?? { error: 'workflow-not-found' }, deployed ? 200 : 404);
            return;
        }

        if (req.method === 'POST' && url.pathname === '/api/workflows/run') {
            const body = await this.readJsonBody(req);
            const runtime = this.getRuntime();
            if (!runtime) {
                this.respondJson(res, { error: 'runtime-unavailable' }, 503);
                return;
            }
            try {
                const run = await runtime.runWorkflow(String(body.workflowId), body.goal ? String(body.goal) : undefined);
                nexusEventBus.emit('workflow.run', {
                    workflowId: String(body.workflowId),
                    runId: run.runId,
                    status: run.state,
                });
                this.respondJson(res, run);
            } catch (error) {
                this.respondJson(res, { error: error instanceof Error ? error.message : 'workflow-run-failed' }, 400);
            }
            return;
        }

        if (req.method === 'POST' && url.pathname === '/api/runtime/execute') {
            const body = await this.readJsonBody(req);
            const runtime = this.getRuntime();
            if (!runtime) {
                this.respondJson(res, { error: 'runtime-unavailable' }, 503);
                return;
            }
            if (!body.goal || typeof body.goal !== 'string') {
                this.respondJson(res, { error: 'goal-required' }, 400);
                return;
            }
            const run = await runtime.run(body as Parameters<SubAgentRuntime['run']>[0]);
            nexusEventBus.emit('dashboard.action', {
                action: 'runtime.execute',
                status: run.state,
                target: run.runId,
            });
            this.respondJson(res, run, 201);
            return;
        }

        if (req.method === 'POST' && url.pathname.startsWith('/api/clients/') && url.pathname.endsWith('/reconnect')) {
            const clientId = decodeURIComponent(url.pathname.replace('/api/clients/', '').replace('/reconnect', '').replace(/\/$/, ''));
            const registry = this.getClientRegistry();
            if (!registry) {
                this.respondJson(res, { error: 'client-registry-unavailable' }, 503);
                return;
            }
            const client = registry.reconnect(clientId);
            nexusEventBus.emit('dashboard.action', {
                action: 'client.reconnect',
                status: 'ok',
                target: clientId,
            });
            this.respondJson(res, client);
            return;
        }

        if (req.method === 'POST' && url.pathname.startsWith('/api/clients/') && url.pathname.endsWith('/clear')) {
            const clientId = decodeURIComponent(url.pathname.replace('/api/clients/', '').replace('/clear', '').replace(/\/$/, ''));
            const registry = this.getClientRegistry();
            if (!registry) {
                this.respondJson(res, { error: 'client-registry-unavailable' }, 503);
                return;
            }
            registry.clear(clientId);
            nexusEventBus.emit('dashboard.action', {
                action: 'client.clear',
                status: 'ok',
                target: clientId,
            });
            this.respondJson(res, { ok: true, clientId });
            return;
        }

        res.writeHead(404);
        res.end('Not found');
      } catch (error) {
        if (!res.headersSent) {
            if (error instanceof Error && error.message === 'Request body too large') {
                res.writeHead(413, { 'Content-Type': 'text/plain' });
                res.end('Request body too large');
            } else {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal server error');
            }
        }
      }
    }

    private serveDashboard(res: http.ServerResponse): void {
        const securityHeaders = {
            'Content-Type': 'text/html',
            'Content-Security-Policy': [
                "default-src 'self'",
                "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
                "font-src 'self' https://fonts.gstatic.com",
                "script-src 'unsafe-inline'",
                "connect-src 'self'",
                "img-src 'self' data:",
            ].join('; '),
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
        };

        if (this.cachedDashboardHtml) {
            res.writeHead(200, securityHeaders);
            res.end(this.cachedDashboardHtml);
            return;
        }

        const htmlPath = path.join(__dirname, 'index.html');
        fs.readFile(htmlPath, 'utf8', (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading dashboard HTML');
                return;
            }
            this.cachedDashboardHtml = data;
            res.writeHead(200, securityHeaders);
            res.end(data);
        });
    }

    private serveSSE(req: http.IncomingMessage, res: http.ServerResponse): void {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'Access-Control-Allow-Origin': this.getCorsOrigin(),
        });

        res.write('retry: 3000\n\n');
        res.write(`event: bootstrap\ndata: ${JSON.stringify({ connected: true, timestamp: Date.now() })}\n\n`);

        const history = this.getEventCards();
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
        const normalized = this.normalizeEvent(event);
        const dataStr = `data: ${JSON.stringify(normalized)}\n\n`;
        for (const res of this.clients) {
            res.write(dataStr);
        }
    }

    private getCorsOrigin(): string {
        return this.dashboardUrl || `http://${HOST}:${this.activePort || DEFAULT_PORT}`;
    }

    private respondOptions(res: http.ServerResponse): void {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': this.getCorsOrigin(),
            'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        });
        res.end();
    }

    private respondJson(res: http.ServerResponse, data: unknown, statusCode: number = 200): void {
        res.writeHead(statusCode, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
            'Access-Control-Allow-Origin': this.getCorsOrigin(),
        });
        res.end(JSON.stringify(data, null, 2));
    }

    private async readJsonBody(req: http.IncomingMessage): Promise<Record<string, any>> {
        const MAX_BODY = 1024 * 1024; // 1MB
        const chunks: Buffer[] = [];
        let totalLength = 0;
        for await (const chunk of req) {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            totalLength += buf.length;
            if (totalLength > MAX_BODY) {
                throw new Error('Request body too large');
            }
            chunks.push(buf);
        }
        if (!chunks.length) return {};
        try {
            return JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
            return {};
        }
    }

    private getRuntime(): SubAgentRuntime | undefined {
        return this.runtimeProvider?.();
    }

    private getMemory(): MemoryEngine | undefined {
        return this.memoryProvider?.();
    }

    private getAdapters(): Adapter[] {
        return this.adaptersProvider?.() ?? [];
    }

    private getClientRegistry(): ClientRegistry | undefined {
        return this.clientRegistryProvider?.();
    }

    private getEventCards(): DashboardEventCard[] {
        return nexusEventBus.getHistory().map((event) => this.normalizeEvent(event)).reverse();
    }

    private normalizeEvent(event: NexusEvent): DashboardEventCard {
        const category = mapEventCategory(event.type);
        const severity = mapEventSeverity(event.type, event.data as Record<string, unknown>);

        return {
            id: event.id,
            type: event.type,
            title: mapEventTitle(event.type),
            source: mapEventSource(event.type, event.data as Record<string, unknown>),
            time: event.timestamp,
            severity,
            category,
            summary: summarizeEvent(event.type, event.data as Record<string, unknown>),
            payload: event.data,
        };
    }

    private collectHealth(): DashboardHealthResponse {
        const packageJsonPath = path.join(this.repoRoot, 'package.json');
        const workflowPath = path.join(this.repoRoot, '.github', 'workflows', 'pages.yml');
        const docsDir = path.join(this.repoRoot, 'docs');
        const runtime = this.getRuntime();
        const memory = this.getMemory();
        const clientRegistry = this.getClientRegistry();
        const podSnapshot = podNetwork.getDashboardSnapshot(20);

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

        const clients = clientRegistry?.listClients(this.getAdapters()) ?? [];

        return {
            dashboardApiVersion: DASHBOARD_API_VERSION,
            capabilities: { ...REQUIRED_CAPABILITIES },
            dashboardUrl: this.getAddress(),
            dashboardMode: this.dashboardMode,
            connection: {
                stream: this.clients.size > 0 ? 'connected' : 'idle',
                subscribers: this.clients.size,
            },
            runtime: runtime?.getHealth() ?? { runtime: 'unavailable' },
            memory: memory?.getStats() ?? { prefrontal: 0, hippocampus: 0, cortex: 0, totalLinks: 0, oldestEntry: null, topTags: [] },
            pod: {
                workers: podSnapshot.activeWorkers.length,
                lastMessageTimestamp: podSnapshot.lastMessageTimestamp,
                confidenceBands: podSnapshot.confidenceBands,
            },
            clients: {
                total: clients.length,
                active: clients.filter((client) => client.state === 'active').length,
                inferred: clients.filter((client) => client.state === 'inferred').length,
            },
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

    private buildUrl(port: number): string {
        return `http://${HOST}:${port}`;
    }

    private async probeDashboard(port: number): Promise<DashboardCompatibilityProbe> {
        const url = this.buildUrl(port);

        try {
            const response = await this.requestProbe(`${url}/api/health`);

            if (response.statusCode !== 200) {
                return {
                    status: 'incompatible',
                    url,
                    reason: `health-status-${response.statusCode}`,
                };
            }

            let payload: DashboardHealthResponse | null = null;
            try {
                payload = JSON.parse(response.body) as DashboardHealthResponse;
            } catch {
                return {
                    status: 'incompatible',
                    url,
                    reason: 'health-invalid-json',
                };
            }

            if (this.isCompatibleHealth(payload)) {
                return {
                    status: 'compatible',
                    url,
                    health: payload,
                };
            }

            return {
                status: 'incompatible',
                url,
                health: payload,
                reason: 'health-incompatible',
            };
        } catch (error) {
            if (this.isFreePortProbeError(error)) {
                return {
                    status: 'free',
                    url,
                    reason: error instanceof Error ? error.message : 'connection-refused',
                };
            }

            return {
                status: 'incompatible',
                url,
                reason: error instanceof Error ? error.message : 'probe-failed',
            };
        }
    }

    private isCompatibleHealth(payload: DashboardHealthResponse | null | undefined): payload is DashboardHealthResponse {
        if (!payload || payload.dashboardApiVersion !== DASHBOARD_API_VERSION) {
            return false;
        }

        return Object.entries(REQUIRED_CAPABILITIES).every(([key, expected]) => payload.capabilities?.[key] === expected);
    }

    private isFreePortProbeError(error: unknown): boolean {
        const code = typeof error === 'object' && error && 'code' in error ? String((error as NodeJS.ErrnoException).code) : '';
        return code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EHOSTUNREACH' || code === 'ENOTFOUND';
    }

    private requestProbe(url: string): Promise<DashboardProbeResponse> {
        return new Promise((resolve, reject) => {
            const req = http.get(url, { timeout: 1200 }, (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk) => {
                    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                });
                res.on('end', () => {
                    resolve({
                        statusCode: res.statusCode ?? 0,
                        body: Buffer.concat(chunks).toString('utf8'),
                    });
                });
            });

            req.on('timeout', () => {
                req.destroy(new Error('probe-timeout'));
            });
            req.on('error', reject);
        });
    }

    private async bindFirstAvailablePort(startPort: number, endPort: number): Promise<number> {
        let lastError: unknown = null;

        for (let port = startPort; port <= endPort; port += 1) {
            try {
                await this.listenOnPort(port);
                return port;
            } catch (error) {
                lastError = error;
                const code = typeof error === 'object' && error && 'code' in error ? String((error as NodeJS.ErrnoException).code) : '';
                if (code !== 'EADDRINUSE') {
                    throw error;
                }
            }
        }

        throw lastError instanceof Error
            ? lastError
            : new Error(`No free dashboard port found in range ${startPort}-${endPort}`);
    }

    private listenOnPort(port: number): Promise<void> {
        return new Promise((resolve, reject) => {
            const handleListening = () => {
                cleanup();
                resolve();
            };
            const handleError = (error: NodeJS.ErrnoException) => {
                cleanup();
                reject(error);
            };
            const cleanup = () => {
                this.server.off('listening', handleListening);
                this.server.off('error', handleError);
            };

            this.server.once('listening', handleListening);
            this.server.once('error', handleError);
            this.server.listen(port, HOST);
        });
    }
}

function mapEventCategory(type: NexusEventType): DashboardEventCard['category'] {
    if (type.startsWith('memory.')) return 'memory';
    if (type.startsWith('pod.')) return 'pod';
    if (type.startsWith('phantom.')) return 'runtime';
    if (type.startsWith('client.')) return 'clients';
    if (type.startsWith('skill.')) return 'skills';
    if (type.startsWith('workflow.')) return 'workflows';
    if (type.startsWith('tokens.') || type.startsWith('cas.') || type.startsWith('kv.')) return 'tokens';
    return 'system';
}

function mapEventSeverity(type: NexusEventType, payload: Record<string, unknown>): DashboardEventCard['severity'] {
    if (type === 'guardrail.check') {
        return payload.passed ? 'good' : 'bad';
    }
    if (type === 'phantom.merge' || type === 'phantom.merge.complete' || type === 'workflow.run') {
        return payload.status === 'failed' ? 'bad' : 'good';
    }
    if (type === 'client.inferred') return 'warn';
    if (type === 'dashboard.action' && payload.status === 'failed') return 'bad';
    if (type === 'pod.signal') return 'info';
    return 'info';
}

function mapEventTitle(type: NexusEventType): string {
    return {
        'system.boot': 'Runtime boot',
        'memory.store': 'Memory stored',
        'memory.recall': 'Memory recall',
        'pod.signal': 'POD signal',
        'tokens.optimized': 'Tokens optimized',
        'phantom.worker.start': 'Worker start',
        'phantom.worker.complete': 'Worker complete',
        'phantom.merge.complete': 'Merge complete',
        'phantom.merge': 'Merge decision',
        'guardrail.check': 'Guardrail check',
        'ghost.pass': 'Ghost pass',
        'graph.query': 'Graph query',
        'darwin.cycle': 'Darwin cycle',
        'session.dna': 'Session DNA',
        'skill.register': 'Skill registered',
        'skill.deploy': 'Skill deployed',
        'skill.revoke': 'Skill revoked',
        'workflow.deploy': 'Workflow deployed',
        'workflow.run': 'Workflow run',
        'client.heartbeat': 'Client heartbeat',
        'client.inferred': 'Client inferred',
        'client.status': 'Client status',
        'dashboard.action': 'Dashboard action',
        'nexusnet.publish': 'NexusNet publish',
        'nexusnet.sync': 'NexusNet sync',
        'entanglement.create': 'Entanglement created',
        'entanglement.collapse': 'Entanglement collapsed',
        'entanglement.correlate': 'Entanglement correlated',
        'cas.encode': 'CAS encode',
        'cas.decode': 'CAS decode',
        'cas.pattern_learned': 'CAS pattern',
        'kv.merge': 'KV merge',
        'kv.adapt': 'KV adapt',
        'kv.consensus': 'KV consensus',
    }[type] ?? type;
}

function mapEventSource(type: NexusEventType, payload: Record<string, unknown>): string {
    if (type.startsWith('client.')) return String(payload.displayName ?? payload.clientId ?? 'client');
    if (type === 'pod.signal') return String(payload.workerId ?? 'pod');
    if (type.startsWith('phantom.')) return String(payload.workerId ?? payload.winner ?? 'runtime');
    if (type.startsWith('skill.')) return String(payload.skillId ?? payload.name ?? 'skill');
    if (type.startsWith('workflow.')) return String(payload.workflowId ?? 'workflow');
    return 'nexus-prime';
}

function summarizeEvent(type: NexusEventType, payload: Record<string, unknown>): string {
    switch (type) {
        case 'memory.store':
            return `Priority ${payload.priority ?? 'n/a'} · ${(payload.tags as string[] | undefined)?.join(', ') ?? 'no tags'}`;
        case 'memory.recall':
            return `Recalled ${payload.count ?? 0} memories for "${payload.query ?? ''}"`;
        case 'pod.signal':
            return String(payload.content ?? 'POD signal received');
        case 'tokens.optimized':
            return `Saved ${payload.savings ?? 0} tokens across ${payload.files ?? 0} files`;
        case 'phantom.worker.start':
            return `${payload.approach ?? 'worker'} started for ${payload.goal ?? 'task'}`;
        case 'phantom.worker.complete':
            return `Confidence ${payload.confidence ?? 0}`;
        case 'phantom.merge':
            return `${payload.action ?? 'merge'} · ${payload.winner ?? 'unknown winner'}`;
        case 'client.heartbeat':
        case 'client.inferred':
        case 'client.status':
            return JSON.stringify(payload);
        case 'dashboard.action':
            return `${payload.action ?? 'action'} → ${payload.status ?? 'unknown'}`;
        default:
            return JSON.stringify(payload);
    }
}
