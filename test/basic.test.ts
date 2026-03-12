/**
 * Basic runtime test for Nexus Prime
 */

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';

process.env.NEXUS_DASHBOARD_PORT = '0';

function setupFixtureRepo(): string {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-prime-basic-'));
  fs.writeFileSync(path.join(repoRoot, 'README.md'), '# Fixture Repo\n', 'utf8');
  fs.writeFileSync(
    path.join(repoRoot, 'package.json'),
    JSON.stringify({
      name: 'nexus-prime-runtime-fixture',
      version: '1.0.0',
      private: true,
      scripts: {
        build: 'node -e "process.exit(0)"'
      }
    }, null, 2),
    'utf8'
  );
  fs.mkdirSync(path.join(repoRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'src', 'app.ts'), 'export const fixture = "ok";\n', 'utf8');

  execSync('git init -b main', { cwd: repoRoot, stdio: 'ignore' });
  execSync('git config user.name "Nexus Prime Test"', { cwd: repoRoot, stdio: 'ignore' });
  execSync('git config user.email "nexus-prime@test.local"', { cwd: repoRoot, stdio: 'ignore' });
  execSync('git add README.md package.json src/app.ts', { cwd: repoRoot, stdio: 'ignore' });
  execSync('git commit -m "fixture"', { cwd: repoRoot, stdio: 'ignore' });

  return repoRoot;
}

async function test() {
  console.log('🧪 Testing Nexus Prime runtime execution...\n');

  const originalCwd = process.cwd();
  const repoRoot = setupFixtureRepo();
  process.env.NEXUS_DASHBOARD_DISABLED = '1';
  process.env.NEXUS_MEMORY_DB_PATH = path.join(repoRoot, '.nexus-prime-test.db');
  process.env.NEXUS_POD_PATH = path.join(repoRoot, '.nexus-prime-pod.json');
  process.env.NEXUS_STATE_DIR = path.join(repoRoot, '.nexus-state');
  process.env.CODEX_HOME = path.join(repoRoot, '.codex');
  fs.mkdirSync(process.env.CODEX_HOME, { recursive: true });

  process.chdir(repoRoot);

  try {
    const { createNexusPrime } = await import('../dist/index.js');
    const { createAdapter } = await import('../dist/agents/adapters.js');
    const nexus = createNexusPrime({ adapters: [] });
    await nexus.start();
    console.log('✅ Started\n');

    const runtime = nexus.getRuntime();
    const orchestrator = nexus.getOrchestrator();
    assert.ok(runtime.listSkills().some((skill) => skill.name === 'django-builder'), 'expanded bundled skills should include django-builder');
    assert.ok(runtime.listWorkflows().some((workflow) => workflow.name === 'gtm-approval-loop'), 'expanded bundled workflows should include gtm-approval-loop');
    assert.ok(runtime.listHooks().some((hook) => hook.name === 'run-created-brief'), 'bundled hooks should be available');
    assert.ok(runtime.listAutomations().some((automation) => automation.name === 'verified-followup-automation'), 'bundled automations should be available');
    assert.ok(runtime.listSpecialists().length > 20, 'native specialist roster should be available');
    assert.ok(runtime.listCrews().length > 0, 'crew catalog should be available');

    const planner = await runtime.planExecution({
      goal: 'Plan a bounded implementation task with release review',
      files: ['README.md', 'package.json', 'src/app.ts'],
      crewSelectors: ['crew_implementation'],
      optimizationProfile: 'standard',
    });
    assert.ok(planner.selectedCrew?.crewId, 'planner should choose a crew');
    assert.ok(planner.ledger.length > 0, 'planner should emit a live ledger');
    assert.ok(planner.reviewGates.length > 0, 'planner should emit review gates');

    const coder = await nexus.createAgent('coder');
    console.log(`✅ Created agent: ${coder.id}\n`);

    const result = await nexus.execute(coder.id, 'Apply a real runtime patch to the fixture repo', {
      files: ['README.md', 'package.json', 'src/app.ts'],
      workers: 1,
      verifyCommands: ['npm run build'],
      skillNames: ['node-builder', 'orchestration-playbook'],
      workflowSelectors: ['backend-execution-loop'],
      hookSelectors: ['run-created-brief', 'before-verify-approval'],
      automationSelectors: ['verified-followup-automation'],
      skillPolicy: { mode: 'guarded-hot', allowMutateSkills: true },
      backendSelectors: {
        memoryBackend: 'temporal-hyperbolic-memory',
        compressionBackend: 'meta-compression',
        dslCompiler: 'agentlang-neural-compiler'
      },
      backendMode: 'experimental',
      shieldPolicy: 'balanced',
      memoryPolicy: { mode: 'balanced', quarantineTag: '#quarantine' },
      actions: [
        {
          type: 'append_file',
          path: 'README.md',
          content: '\nRuntime execution succeeded.\n'
        },
        {
          type: 'write_file',
          path: 'runtime-output.txt',
          content: 'runtime ok\n'
        }
      ]
    });

    console.log(`📝 Result: ${result.result}`);
    console.log(`📊 Value: ${result.experience.value.toFixed(2)}`);
    console.log(`🧠 State: ${result.execution.state}`);
    console.log(`📁 Artifacts: ${result.execution.artifactsPath}\n`);

    assert.strictEqual(result.execution.state, 'merged', 'execution should merge a verified patch');
    assert.ok(fs.existsSync(path.join(repoRoot, 'runtime-output.txt')), 'runtime output file should exist');
    assert.ok(
      fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8').includes('Runtime execution succeeded.'),
      'README should contain runtime marker'
    );
    assert.ok(fs.existsSync(result.execution.artifactsPath), 'artifacts path should exist');
    assert.ok(
      result.execution.workerResults.some(worker => worker.verified),
      'at least one worker should pass verification'
    );
    assert.ok(result.execution.plannerResult, 'planner result should be present');
    assert.ok(result.execution.plannerState, 'planner state should be present');
    assert.ok(result.execution.plannerResult?.selectedCrew?.crewId, 'planner result should include selected crew');
    assert.ok((result.execution.plannerResult?.selectedSpecialists?.length || 0) > 0, 'planner result should include selected specialists');
    assert.ok((result.execution.plannerResult?.ledger?.length || 0) > 0, 'planner result should include planning ledger rows');
    const plannerManifest = result.execution.workerManifests.find((manifest) => manifest.role === 'planner');
    const coderManifests = result.execution.workerManifests.filter((manifest) => manifest.role === 'coder');
    const coderManifest = coderManifests[0];
    assert.ok(plannerManifest, 'planner worker manifest should exist');
    assert.ok(coderManifest, 'coder worker manifest should exist');
    assert.ok(coderManifests.length >= 2, 'runtime should clamp to at least two coder workers');
    assert.ok(!plannerManifest?.allowedTools.includes('write_file'), 'planner worker should stay read scoped even when the run mutates files');
    assert.ok(coderManifest?.allowedTools.includes('write_file'), 'coder worker should retain write tools required for explicit actions');
    assert.ok(coderManifest?.context?.specialist?.mission, 'coder worker context should include specialist mission');
    assert.ok((coderManifest?.context?.activeWorkflows?.length || 0) > 0, 'coder worker context should include active workflows');
    assert.ok(Array.isArray(coderManifest?.context?.reviewGates), 'coder worker context should include review gates');
    assert.ok(result.execution.verificationResults.length > 0, 'verifier results should be present');
    assert.ok(result.execution.activeSkills.length > 0, 'skills should be active');
    assert.ok(result.execution.activeWorkflows.length > 0, 'workflows should be active');
    assert.ok(result.execution.activeHooks.length > 0, 'hooks should be active');
    assert.ok(result.execution.activeAutomations.length > 0, 'automations should be active');
    assert.ok(result.execution.instructionPacket, 'execution should expose the compiled instruction packet');
    assert.ok(result.execution.executionLedger, 'execution should expose the orchestration ledger');
    assert.strictEqual(result.execution.executionLedger?.executionMode, 'autonomous', 'execution ledger should mark autonomous orchestration mode');
    assert.strictEqual(result.execution.executionLedger?.plannerApplied, true, 'execution ledger should record planner application');
    assert.strictEqual(result.execution.executionLedger?.tokenOptimizationApplied, true, 'execution ledger should record token optimization when 3+ files are in play');
    assert.ok(result.execution.executionLedger?.steps.some((step) => step.id === 'compile-instruction-packet' && step.status === 'completed'), 'execution ledger should record instruction packet compilation');
    assert.strictEqual(result.execution.selectedBackends.memoryBackend, 'temporal-hyperbolic-memory');
    assert.strictEqual(result.execution.selectedBackends.compressionBackend, 'meta-compression');
    assert.strictEqual(result.execution.selectedBackends.dslCompiler, 'agentlang-neural-compiler');
    assert.ok(result.execution.promotionDecisions.length > 0, 'promotion decisions should be recorded');
    assert.ok(result.execution.shieldDecisions.length > 0, 'shield decisions should be recorded');
    assert.ok(result.execution.memoryChecks.length > 0, 'memory checks should be recorded');
    assert.ok(result.execution.federationState, 'federation state should be recorded');
    assert.ok((result.execution.federationState as any)?.relay, 'federation state should include relay status');
    assert.ok(result.execution.hookEvents.length > 0, 'hook events should be recorded');
    assert.ok(result.execution.automationEvents.length > 0, 'automation events should be recorded');
    assert.ok(result.execution.continuationChildren.length > 0, 'automation continuations should be recorded');
    assert.ok(result.execution.continuationChildren.some((child) => child.status === 'completed'), 'at least one automation continuation should complete');
    assert.ok((runtime.auditMemory()?.scanned ?? 0) > 0, 'memory audit should be available after execution');
    assert.ok(runtime.listRuns().length > 1, 'bounded automation continuation should create a follow-up run');

    const coderContextPath = path.join(result.execution.artifactsPath, 'workers', coderManifest?.workerId || 'coder-1', 'context.json');
    assert.ok(fs.existsSync(coderContextPath), 'worker context artifact should be persisted');
    const coderContext = JSON.parse(fs.readFileSync(coderContextPath, 'utf8'));
    assert.ok(coderContext.specialist?.mission, 'persisted worker context should include specialist mission');
    assert.ok(Array.isArray(coderContext.activeSkills) && coderContext.activeSkills.length > 0, 'persisted worker context should include active skills');

    const runtimePacketArtifactPath = path.join(result.execution.artifactsPath, 'runtime', 'packet.json');
    const runtimeLedgerArtifactPath = path.join(result.execution.artifactsPath, 'runtime', 'execution-ledger.json');
    assert.ok(fs.existsSync(runtimePacketArtifactPath), 'runtime packet artifact should be persisted');
    assert.ok(fs.existsSync(runtimeLedgerArtifactPath), 'runtime execution ledger artifact should be persisted');
    const runtimePacketArtifact = JSON.parse(fs.readFileSync(runtimePacketArtifactPath, 'utf8'));
    const runtimeLedgerArtifact = JSON.parse(fs.readFileSync(runtimeLedgerArtifactPath, 'utf8'));
    assert.strictEqual(runtimePacketArtifact.packetHash, result.execution.instructionPacket?.packetHash, 'runtime packet artifact should match the execution packet');
    assert.strictEqual(runtimeLedgerArtifact.runId, result.execution.runId, 'runtime ledger artifact should match the execution run');

    const workspacePacketPath = path.join(repoRoot, '.agent', 'runtime', 'packet.json');
    const workspacePacketMarkdownPath = path.join(repoRoot, '.agent', 'runtime', 'packet.md');
    assert.ok(fs.existsSync(workspacePacketPath), 'workspace packet json should be written for orchestrated runs');
    assert.ok(fs.existsSync(workspacePacketMarkdownPath), 'workspace packet markdown should be written for orchestrated runs');
    const workspacePacket = JSON.parse(fs.readFileSync(workspacePacketPath, 'utf8'));
    assert.strictEqual(workspacePacket.packetHash, result.execution.instructionPacket?.packetHash, 'workspace packet should match the execution packet');
    assert.ok(!workspacePacket.protocol.markdown.includes('### Available skills'), 'compiled packet should not dump the full installed skill catalog');
    assert.ok(workspacePacket.catalogShortlist.skills.length <= 4, 'compiled packet should keep skill shortlist bounded');
    assert.ok(new Set(workspacePacket.protocol.sections.map((section: any) => `${section.source}:${section.heading}:${section.content}`)).size === workspacePacket.protocol.sections.length, 'compiled packet should deduplicate repeated protocol sections');

    const workersRoot = path.join(result.execution.artifactsPath, 'workers');
    const commandArtifacts = fs.readdirSync(workersRoot)
      .flatMap((entry) => {
        const target = path.join(workersRoot, entry);
        return fs.statSync(target).isDirectory()
          ? fs.readdirSync(target).map((child) => path.join(target, child))
          : [];
      })
      .filter((filePath) => filePath.endsWith('.json') && !filePath.endsWith('context.json'))
      .map((filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8')))
      .filter((record) => typeof record.command === 'string');
    assert.ok(commandArtifacts.some((record) => record.command.includes('process.exit(0)')), 'active skill tool bindings should execute runtime commands');

    const memoryDispatch = await runtime.storeMemoryAndDispatch('High priority memory escalation', 0.95, ['#security', '#runtime-test']);
    assert.ok(memoryDispatch.hookEvents.some((event) => event.name === 'memory-shield-escalation'), 'explicit memory stores should dispatch memory hooks');
    assert.ok(memoryDispatch.automationDispatches.some((dispatch) => dispatch.name === 'memory-governance-automation'), 'explicit memory stores should dispatch memory automations');

    const usageSnapshot = runtime.getUsageSnapshot();
    assert.strictEqual(usageSnapshot.usage.skills.status, 'used', 'runtime usage should mark skills as used');
    assert.strictEqual(usageSnapshot.usage.plan.status, 'used', 'runtime usage should mark plan as used');
    assert.strictEqual(usageSnapshot.usage.federation.status, 'used', 'runtime usage should mark federation as used');
    assert.strictEqual(usageSnapshot.instructionPacketHash, result.execution.instructionPacket?.packetHash, 'runtime snapshot should persist the active instruction packet hash');
    assert.strictEqual(usageSnapshot.executionMode, 'autonomous', 'runtime snapshot should persist autonomous execution mode');
    assert.strictEqual(usageSnapshot.plannerApplied, true, 'runtime snapshot should persist planner application');
    assert.strictEqual(usageSnapshot.tokenOptimizationApplied, true, 'runtime snapshot should persist token optimization application');
    assert.ok(result.execution.tokenTelemetry, 'execution should persist token telemetry');
    assert.ok(runtime.getTokenTelemetrySummary().totalRuns > 0, 'runtime should aggregate token telemetry across runs');
    assert.ok(runtime.getTokenTelemetryForRun(result.execution.runId), 'runtime should expose per-run token telemetry');
    assert.strictEqual(runtime.getInstructionPacket()?.packetHash, result.execution.instructionPacket?.packetHash, 'runtime should expose the latest compiled instruction packet');
    assert.strictEqual(runtime.getExecutionLedger()?.runId, result.execution.runId, 'runtime should expose the latest execution ledger');
    assert.strictEqual(orchestrator.getSessionState().lastRunId, result.execution.runId, 'orchestrator session state should track the last run');
    assert.ok(orchestrator.getSessionState().selectedSkills.length > 0, 'orchestrator should record selected skills');
    assert.ok(['single-pass', 'bounded-swarm', 'continuation-capable'].includes(orchestrator.getSessionState().mode), 'orchestrator should record an execution mode for the run');
    assert.strictEqual(runtime.getUsageSnapshot().clients?.primary?.clientId, 'codex', 'runtime snapshot should record Codex as the primary client when CODEX env is active');

    const packet = runtime.getInstructionPacket();
    assert.ok(packet, 'runtime should retain the instruction packet after execution');
    const adapterExpectations: Array<[string, string]> = [
      ['codex', 'markdown'],
      ['claude-code', 'markdown'],
      ['openclaw', 'skill-md'],
      ['opencode', 'markdown'],
      ['cursor', 'mdc'],
      ['windsurf', 'windsurfrules'],
    ];
    for (const [adapterType, expectedFormat] of adapterExpectations) {
      const adapter = createAdapter(adapterType as any) as any;
      await adapter.connect();
      await adapter.send({
        id: `msg-${adapterType}`,
        sender: 'test',
        receiver: adapter.name,
        type: 'control',
        payload: {
          action: 'sync',
          data: { instructionPacket: packet },
        },
        timestamp: Date.now(),
      });
      const envelope = adapter.getLastEnvelope?.();
      assert.ok(envelope, `${adapterType} should render an instruction envelope`);
      assert.strictEqual(envelope.packetHash, packet?.packetHash, `${adapterType} should preserve the packet hash`);
      assert.strictEqual(envelope.format, expectedFormat, `${adapterType} should render the expected client format`);
      await adapter.disconnect();
    }

    await nexus.stop();
    console.log('✅ Stopped\n');
    console.log('🎉 Runtime execution test passed!');
  } finally {
    delete process.env.NEXUS_DASHBOARD_DISABLED;
    delete process.env.NEXUS_MEMORY_DB_PATH;
    delete process.env.NEXUS_POD_PATH;
    delete process.env.NEXUS_STATE_DIR;
    delete process.env.CODEX_HOME;
    process.chdir(originalCwd);
  }
}

test().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
