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

  const server = new DashboardServer({
    runtimeProvider: () => runtime,
    memoryProvider: () => memory,
    adaptersProvider: () => [],
    clientRegistryProvider: () => clientRegistry,
    repoRoot: process.cwd(),
  });

  server.start();
  await new Promise((resolve) => setTimeout(resolve, 250));

  try {
    const address = server.getAddress();
    assert.ok(address, 'dashboard should report an address');

    const [
      htmlRes,
      runsRes,
      skillsRes,
      workflowsRes,
      backendsRes,
      healthRes,
      memoryRes,
      memoryNetworkRes,
      podRes,
      clientsRes,
      eventsRes,
    ] = await Promise.all([
      fetch(`${address}/`),
      fetch(`${address}/api/runs`),
      fetch(`${address}/api/skills`),
      fetch(`${address}/api/workflows`),
      fetch(`${address}/api/backends`),
      fetch(`${address}/api/health`),
      fetch(`${address}/api/memory`),
      fetch(`${address}/api/memory/${encodeURIComponent(rootMemoryId)}/network`),
      fetch(`${address}/api/pod`),
      fetch(`${address}/api/clients`),
      fetch(`${address}/api/events?limit=20`),
    ]);

    const html = await htmlRes.text();
    const runs = await runsRes.json();
    const skills = await skillsRes.json();
    const workflows = await workflowsRes.json();
    const backends = await backendsRes.json();
    const health = await healthRes.json();
    const memories = await memoryRes.json();
    const memoryNetwork = await memoryNetworkRes.json();
    const pod = await podRes.json();
    const clients = await clientsRes.json();
    const events = await eventsRes.json();
    const streamChunk = await fetchStreamChunk(`${address}/stream`);

    assert.ok(html.includes('Memory Topology Graph'), 'dashboard HTML should render topology graph shell');
    assert.ok(html.includes('Connected Ecosystem'), 'dashboard HTML should render restored ecosystem rail');
    assert.ok(Array.isArray(runs) && runs.length > 0, 'runs API should return recorded runs');
    assert.ok(Array.isArray(skills) && skills.length > 0, 'skills API should return artifacts');
    assert.ok(Array.isArray(workflows) && workflows.length > 0, 'workflows API should return artifacts');
    assert.ok(backends.memory && backends.compression && backends.dsl, 'backends API should return grouped catalogs');
    assert.strictEqual(health.docs.pagesWorkflowValid, true, 'health API should report fixed Pages workflow syntax');
    assert.ok(Array.isArray(memories) && memories.length >= 2, 'memory API should return snapshots');
    assert.ok(Array.isArray(memoryNetwork.nodes) && memoryNetwork.nodes.length > 0, 'memory network API should return graph nodes');
    assert.ok(Array.isArray(pod.messages) && pod.messages.length > 0, 'pod API should return messages');
    assert.ok(Array.isArray(clients) && clients.some((client: any) => client.clientId === 'codex' && client.state === 'active'), 'client API should surface explicit heartbeat clients');
    assert.ok(Array.isArray(events) && events.length > 0, 'events API should return normalized event cards');
    assert.ok(streamChunk.includes('retry: 3000') || streamChunk.includes('event: bootstrap'), 'stream endpoint should emit SSE prelude');

    const deploySkill = await fetch(`${address}/api/skills/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillId: skills[0].skillId }),
    });
    const deployWorkflow = await fetch(`${address}/api/workflows/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflowId: workflows[0].workflowId }),
    });
    const executeRun = await fetch(`${address}/api/runtime/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goal: 'Dashboard control plane run',
        files: ['README.md'],
        workers: 1,
        verifyCommands: ['npm run build'],
        actions: [{ type: 'append_file', path: 'README.md', content: '\nControl plane run.\n' }]
      }),
    });
    const reconnectClient = await fetch(`${address}/api/clients/codex/reconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    assert.strictEqual(deploySkill.status, 200, 'skill deploy route should succeed');
    assert.strictEqual(deployWorkflow.status, 200, 'workflow deploy route should succeed');
    assert.strictEqual(executeRun.status, 201, 'runtime execute route should create a run');
    assert.strictEqual(reconnectClient.status, 200, 'client reconnect route should succeed');

    console.log('✅ Dashboard APIs, topology shell, and control plane are healthy\n');
  } finally {
    server.stop();
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
