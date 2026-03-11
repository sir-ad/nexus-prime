import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import http from 'http';
import { execSync } from 'child_process';

function setupFixtureRepo(): string {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-prime-dashboard-'));
  fs.writeFileSync(path.join(repoRoot, 'README.md'), '# Dashboard Fixture\n', 'utf8');
  fs.writeFileSync(
    path.join(repoRoot, 'package.json'),
    JSON.stringify({
      name: 'nexus-prime-dashboard-fixture',
      version: '1.0.0',
      private: true,
      scripts: {
        build: 'node -e "process.exit(0)"'
      }
    }, null, 2),
    'utf8'
  );

  execSync('git init -b main', { cwd: repoRoot, stdio: 'ignore' });
  execSync('git config user.name "Nexus Prime Dashboard Test"', { cwd: repoRoot, stdio: 'ignore' });
  execSync('git config user.email "nexus-prime-dashboard@test.local"', { cwd: repoRoot, stdio: 'ignore' });
  execSync('git add README.md package.json', { cwd: repoRoot, stdio: 'ignore' });
  execSync('git commit -m "fixture"', { cwd: repoRoot, stdio: 'ignore' });

  return repoRoot;
}

async function fetchStreamChunk(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      res.setEncoding('utf8');
      res.once('data', (chunk) => {
        req.destroy();
        resolve(String(chunk));
      });
      res.once('error', reject);
    });
    req.on('error', reject);
  });
}

async function waitForAddress(server: { getAddress(): string | null }, timeoutMs: number = 4000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const address = server.getAddress();
    if (address) {
      return address;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('dashboard did not publish an address in time');
}

async function startIncompatibleServer(port: number): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body>legacy dashboard</body></html>');
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  return server;
}

async function closeHttpServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url);
  assert.ok(response.ok, `expected OK from ${url}, received ${response.status}`);
  return response.json();
}

function assertHealthContract(health: any, address: string): void {
  assert.strictEqual(health.dashboardApiVersion, '3', 'health should expose dashboard API version');
  assert.strictEqual(health.dashboardUrl, address, 'health should report the active dashboard URL');
  assert.strictEqual(health.capabilities.runs, true, 'runs capability should be advertised');
  assert.strictEqual(health.capabilities.memory, true, 'memory capability should be advertised');
  assert.strictEqual(health.capabilities.pod, true, 'pod capability should be advertised');
  assert.strictEqual(health.capabilities.clients, true, 'clients capability should be advertised');
  assert.strictEqual(health.capabilities.events, true, 'events capability should be advertised');
  assert.strictEqual(health.capabilities.stream, true, 'stream capability should be advertised');
  assert.strictEqual(health.capabilities.specialists, true, 'specialists capability should be advertised');
  assert.strictEqual(health.capabilities.crews, true, 'crews capability should be advertised');
  assert.strictEqual(health.capabilities.planner, true, 'planner capability should be advertised');
}

async function test() {
  console.log('🧪 Testing dashboard topology console...\n');

  const repoRoot = setupFixtureRepo();
  const port = 4400 + Math.floor(Math.random() * 400);
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-prime-dashboard-state-'));
  const memoryDbPath = path.join(stateDir, 'memory.db');

  process.env.NEXUS_DASHBOARD_PORT = String(port);
  process.env.NEXUS_DASHBOARD_DISABLED = '0';
  process.env.NEXUS_STATE_DIR = stateDir;
  process.env.NEXUS_MEMORY_DB_PATH = memoryDbPath;

  const { createSubAgentRuntime } = await import('../dist/phantom/index.js');
  const { createMemoryEngine } = await import('../dist/engines/memory.js');
  const { podNetwork } = await import('../dist/engines/pod-network.js');
  const { ClientRegistry } = await import('../dist/engines/client-registry.js');
  const { DashboardServer } = await import('../dist/dashboard/server.js');

  const memory = createMemoryEngine(memoryDbPath);
  const clientRegistry = new ClientRegistry();
  clientRegistry.recordHeartbeat('codex', { source: 'manual' });
  clientRegistry.recordHeartbeat('claude-code', { source: 'manual' });

  const rootMemoryId = memory.store('Dashboard smoke memory root linked to exec_dashboard_run', 0.93, ['#dashboard', '#memory']);
  memory.store('Dashboard smoke child snapshot linked to workflow_dashboard_demo', 0.82, ['#dashboard', '#timeline'], rootMemoryId, 1);
  podNetwork.publish('worker-dashboard', 'Dashboard smoke pod signal', 0.88, ['#dashboard', '#pod']);

  const runtime = createSubAgentRuntime({ repoRoot, memory, artifactsRoot: path.join(stateDir, 'runs') });
  await runtime.run({
    goal: 'Create dashboard smoke artifacts',
    files: ['README.md', 'package.json'],
    workers: 1,
    verifyCommands: ['npm run build'],
    workflowSelectors: ['backend-execution-loop'],
    actions: [
      {
        type: 'append_file',
        path: 'README.md',
        content: '\nDashboard smoke run.\n'
      }
    ]
  });

  const makeServer = () => new DashboardServer({
    runtimeProvider: () => runtime,
    memoryProvider: () => memory,
    adaptersProvider: () => [],
    clientRegistryProvider: () => clientRegistry,
    repoRoot: process.cwd(),
  });

  const occupied = await startIncompatibleServer(port);

  try {
    const fallbackServer = makeServer();
    fallbackServer.start();
    const fallbackAddress = await waitForAddress(fallbackServer);
    assert.notStrictEqual(fallbackAddress, `http://127.0.0.1:${port}`, 'server should move to a new port when default port is occupied by an incompatible listener');

    const fallbackHealth = await fetchJson(`${fallbackAddress}/api/health`);
    assertHealthContract(fallbackHealth, fallbackAddress);

    fallbackServer.stop();
    await new Promise((resolve) => setTimeout(resolve, 100));
  } finally {
    await closeHttpServer(occupied);
  }

  const primaryServer = makeServer();
  const reuseServer = makeServer();
  primaryServer.start();

  try {
    const primaryAddress = await waitForAddress(primaryServer);
    assert.strictEqual(primaryAddress, `http://127.0.0.1:${port}`, 'primary dashboard should bind to the configured default port when free');

    reuseServer.start();
    const reusedAddress = await waitForAddress(reuseServer);
    assert.strictEqual(reusedAddress, primaryAddress, 'second dashboard instance should reuse the compatible dashboard listener');

    const [
      htmlRes,
      runsRes,
      skillsRes,
      workflowsRes,
      hooksRes,
      automationsRes,
      specialistsRes,
      crewsRes,
      backendsRes,
      healthRes,
      memoryRes,
      memoryAuditRes,
      memoryQuarantineRes,
      memoryNetworkRes,
      podRes,
      clientsRes,
      federationRes,
      eventsRes,
    ] = await Promise.all([
      fetch(`${primaryAddress}/`),
      fetch(`${primaryAddress}/api/runs`),
      fetch(`${primaryAddress}/api/skills`),
      fetch(`${primaryAddress}/api/workflows`),
      fetch(`${primaryAddress}/api/hooks`),
      fetch(`${primaryAddress}/api/automations`),
      fetch(`${primaryAddress}/api/specialists`),
      fetch(`${primaryAddress}/api/crews`),
      fetch(`${primaryAddress}/api/backends`),
      fetch(`${primaryAddress}/api/health`),
      fetch(`${primaryAddress}/api/memory`),
      fetch(`${primaryAddress}/api/memory/audit`),
      fetch(`${primaryAddress}/api/memory/quarantine`),
      fetch(`${primaryAddress}/api/memory/${encodeURIComponent(rootMemoryId)}/network`),
      fetch(`${primaryAddress}/api/pod`),
      fetch(`${primaryAddress}/api/clients`),
      fetch(`${primaryAddress}/api/federation`),
      fetch(`${primaryAddress}/api/events?limit=20`),
    ]);

    const html = await htmlRes.text();
    const runs = await runsRes.json();
    const skills = await skillsRes.json();
    const workflows = await workflowsRes.json();
    const hooks = await hooksRes.json();
    const automations = await automationsRes.json();
    const specialists = await specialistsRes.json();
    const crews = await crewsRes.json();
    const backends = await backendsRes.json();
    const health = await healthRes.json();
    const memories = await memoryRes.json();
    const memoryAudit = await memoryAuditRes.json();
    const memoryQuarantine = await memoryQuarantineRes.json();
    const memoryNetwork = await memoryNetworkRes.json();
    const pod = await podRes.json();
    const clients = await clientsRes.json();
    const federation = await federationRes.json();
    const events = await eventsRes.json();
    const streamChunk = await fetchStreamChunk(`${primaryAddress}/stream`);

    assert.ok(html.includes('Memory Topology Graph'), 'dashboard HTML should render topology graph shell');
    assert.ok(html.includes('Connected Ecosystem'), 'dashboard HTML should render restored ecosystem rail');
    assert.ok(html.includes('status-banner'), 'dashboard HTML should include compatibility banner shell');
    assert.ok(html.includes('data-library-mode="hooks"'), 'dashboard HTML should expose hooks library mode');
    assert.ok(html.includes('data-library-mode="automations"'), 'dashboard HTML should expose automations library mode');
    assert.ok(html.includes('data-library-mode="specialists"'), 'dashboard HTML should expose specialist roster mode');
    assert.ok(html.includes('data-library-mode="crews"'), 'dashboard HTML should expose crew mode');
    assert.ok(html.includes('data-library-mode="planning"'), 'dashboard HTML should expose planner mode');
    assert.ok(html.includes('data-library-mode="governance"'), 'dashboard HTML should expose governance library mode');
    assert.ok(html.includes('data-library-mode="federation"'), 'dashboard HTML should expose federation library mode');
    assert.ok(html.includes('id="plan-button"'), 'dashboard HTML should expose planner preview action');
    assert.ok(html.includes('data-event-filter="hooks"'), 'dashboard HTML should expose hooks event filter');
    assert.ok(html.includes('data-event-filter="automations"'), 'dashboard HTML should expose automations event filter');
    assert.ok(html.includes('data-event-filter="shield"'), 'dashboard HTML should expose shield event filter');
    assert.ok(html.includes('data-event-filter="federation"'), 'dashboard HTML should expose federation event filter');
    assert.ok(html.includes('height: 100vh;'), 'dashboard CSS should bind the shell to the viewport');
    assert.ok(html.includes('height: clamp(280px, 38vh, 420px);'), 'graph stage should have an explicit bounded height');
    assert.ok(!html.includes('Auto-seed skills and workflows on first load'), 'dashboard bootstrap should not mutate runtime state on load');
    assert.ok(!html.includes("if (state.skills.length === 0)"), 'dashboard bootstrap should not auto-seed when skills are empty');
    assert.ok(Array.isArray(runs) && runs.length > 0, 'runs API should return recorded runs');
    assert.ok(Array.isArray(skills) && skills.length > 0, 'skills API should return artifacts');
    assert.ok(Array.isArray(workflows) && workflows.length > 0, 'workflows API should return artifacts');
    assert.ok(Array.isArray(hooks) && hooks.length > 0, 'hooks API should return artifacts');
    assert.ok(Array.isArray(automations) && automations.length > 0, 'automations API should return artifacts');
    assert.ok(Array.isArray(specialists) && specialists.length > 20, 'specialists API should return the imported roster');
    assert.ok(Array.isArray(crews) && crews.length > 0, 'crews API should return crew templates');
    assert.ok(backends.memory && backends.compression && backends.dsl, 'backends API should return grouped catalogs');
    assertHealthContract(health, primaryAddress);
    assert.strictEqual(health.docs.pagesWorkflowValid, true, 'health API should report fixed Pages workflow syntax');
    assert.ok(Array.isArray(memories) && memories.length >= 2, 'memory API should return snapshots');
    assert.ok(typeof memoryAudit.scanned === 'number', 'memory audit API should return a scan count');
    assert.ok(Array.isArray(memoryQuarantine), 'memory quarantine API should return a list');
    assert.ok(memoryAudit.findings.length > 0, 'memory audit API should expose governance findings');
    assert.ok(Array.isArray(memoryNetwork.nodes) && memoryNetwork.nodes.length > 0, 'memory network API should return graph nodes');
    assert.ok(Array.isArray(pod.messages) && pod.messages.length > 0, 'pod API should return messages');
    assert.ok(Array.isArray(clients) && clients.some((client: any) => client.clientId === 'codex' && client.state === 'active'), 'client API should surface explicit heartbeat clients');
    assert.ok(Array.isArray(federation.knownPeers), 'federation API should return peer inventory');
    assert.ok(Array.isArray(hooks) && hooks.some((hook: any) => hook.trigger), 'hooks API should expose trigger metadata');
    assert.ok(Array.isArray(automations) && automations.some((automation: any) => automation.triggerMode), 'automations API should expose trigger metadata');
    assert.ok(Array.isArray(events) && events.length > 0, 'events API should return normalized event cards');
    assert.ok(events.every((event: any) => event.title && event.category && typeof event.time === 'number'), 'events API should normalize event cards');
    assert.ok(streamChunk.includes('retry: 3000') || streamChunk.includes('event: bootstrap'), 'stream endpoint should emit SSE prelude');

    const deploySkill = await fetch(`${primaryAddress}/api/skills/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillId: skills[0].skillId }),
    });
    const deployWorkflow = await fetch(`${primaryAddress}/api/workflows/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflowId: workflows[0].workflowId }),
    });
    const deployHook = await fetch(`${primaryAddress}/api/hooks/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hookId: hooks[0].hookId }),
    });
    const deployAutomation = await fetch(`${primaryAddress}/api/automations/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ automationId: automations[0].automationId }),
    });
    const executeRun = await fetch(`${primaryAddress}/api/runtime/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goal: 'Dashboard control plane run',
        files: ['README.md'],
        workers: 1,
        crewSelectors: ['crew_implementation'],
        specialistSelectors: [specialists[0].specialistId],
        optimizationProfile: 'standard',
        verifyCommands: ['npm run build'],
        hookSelectors: ['run-created-brief'],
        automationSelectors: ['verified-followup-automation'],
        actions: [{ type: 'append_file', path: 'README.md', content: '\nControl plane run.\n' }]
      }),
    });
    const planRun = await fetch(`${primaryAddress}/api/runtime/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goal: 'Plan a dashboard runtime task',
        files: ['README.md'],
        crewSelectors: ['crew_implementation'],
        specialistSelectors: [specialists[0].specialistId],
        optimizationProfile: 'max',
      }),
    });
    const runAutomation = await fetch(`${primaryAddress}/api/automations/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ automationId: automations[0].automationId, goal: 'Dashboard automation smoke run' }),
    });
    const reconnectClient = await fetch(`${primaryAddress}/api/clients/codex/reconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    assert.strictEqual(deploySkill.status, 200, 'skill deploy route should succeed');
    assert.strictEqual(deployWorkflow.status, 200, 'workflow deploy route should succeed');
    assert.strictEqual(deployHook.status, 200, 'hook deploy route should succeed');
    assert.strictEqual(deployAutomation.status, 200, 'automation deploy route should succeed');
    assert.strictEqual(planRun.status, 200, 'runtime plan route should succeed');
    assert.strictEqual(executeRun.status, 201, 'runtime execute route should create a run');
    assert.strictEqual(runAutomation.status, 201, 'automation run route should create a run');
    assert.strictEqual(reconnectClient.status, 200, 'client reconnect route should succeed');

    const planned = await planRun.json();
    assert.ok(planned.selectedCrew?.crewId, 'runtime plan should expose selected crew');
    assert.ok(Array.isArray(planned.selectedSpecialists), 'runtime plan should expose specialists');
    assert.ok(Array.isArray(planned.ledger) && planned.ledger.length > 0, 'runtime plan should expose live ledger rows');

    console.log('✅ Dashboard compatibility, APIs, topology shell, and control plane are healthy\n');
  } finally {
    reuseServer.stop();
    primaryServer.stop();
    memory.close();
    delete process.env.NEXUS_DASHBOARD_PORT;
    delete process.env.NEXUS_DASHBOARD_DISABLED;
    delete process.env.NEXUS_STATE_DIR;
    delete process.env.NEXUS_MEMORY_DB_PATH;
  }
}

test().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
