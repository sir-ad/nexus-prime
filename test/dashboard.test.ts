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
  console.log('🧪 Testing dashboard runtime console...\n');

  const repoRoot = setupFixtureRepo();
  const port = 4400 + Math.floor(Math.random() * 400);
  process.env.NEXUS_DASHBOARD_PORT = String(port);
  process.env.NEXUS_DASHBOARD_DISABLED = '0';

  const { createSubAgentRuntime } = await import('../dist/phantom/index.js');
  const { DashboardServer } = await import('../dist/dashboard/server.js');

  const runtime = createSubAgentRuntime({ repoRoot });
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
    repoRoot: process.cwd(),
  });

  server.start();
  await new Promise((resolve) => setTimeout(resolve, 200));

  try {
    const address = server.getAddress();
    assert.ok(address, 'dashboard should report an address');

    const [htmlRes, runsRes, skillsRes, workflowsRes, backendsRes, healthRes] = await Promise.all([
      fetch(`${address}/`),
      fetch(`${address}/api/runs`),
      fetch(`${address}/api/skills`),
      fetch(`${address}/api/workflows`),
      fetch(`${address}/api/backends`),
      fetch(`${address}/api/health`),
    ]);

    const html = await htmlRes.text();
    const runs = await runsRes.json();
    const skills = await skillsRes.json();
    const workflows = await workflowsRes.json();
    const backends = await backendsRes.json();
    const health = await healthRes.json();
    const streamChunk = await fetchStreamChunk(`${address}/stream`);

    assert.ok(html.includes('Nexus Prime Runtime Console'), 'dashboard HTML should load');
    assert.ok(Array.isArray(runs) && runs.length > 0, 'runs API should return recorded runs');
    assert.ok(Array.isArray(skills) && skills.length > 0, 'skills API should return artifacts');
    assert.ok(Array.isArray(workflows) && workflows.length > 0, 'workflows API should return artifacts');
    assert.ok(backends.memory && backends.compression && backends.dsl, 'backends API should return grouped catalogs');
    assert.strictEqual(health.docs.pagesWorkflowValid, true, 'health API should report fixed Pages workflow syntax');
    assert.ok(streamChunk.includes('retry: 3000') || streamChunk.includes('event: bootstrap'), 'stream endpoint should emit SSE prelude');

    console.log('✅ Dashboard endpoints and stream are healthy\n');
  } finally {
    server.stop();
    delete process.env.NEXUS_DASHBOARD_PORT;
    delete process.env.NEXUS_DASHBOARD_DISABLED;
  }
}

test().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
