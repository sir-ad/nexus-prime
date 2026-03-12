#!/usr/bin/env node

/**
 * Nexus Prime CLI
 */

import { Command } from 'commander';
import { createNexusPrime, NexusPrime } from './index.js';
import { AdapterType } from './agents/adapters.js';
import {
  TokenSupremacyEngine,
  formatReadingPlan
} from './engines/token-supremacy.js';
import { summarizeExecution, type ExecutionRun } from './phantom/index.js';
import { statSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PODNetwork } from './engines/pod-network.js';
import { InstructionGateway, type ClientBootstrapArtifact } from './engines/instruction-gateway.js';


const tokenEngine = new TokenSupremacyEngine();

const program = new Command();

let nexus: NexusPrime | null = null;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = join(__dirname, '..');
const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

type SetupClientId = 'cursor' | 'claude' | 'opencode' | 'windsurf' | 'antigravity';

interface SetupDefinition {
  id: SetupClientId;
  label: string;
  configPath?: string;
  instructionFiles: Array<{ path: string; content: string }>;
}

function printExecutionSummary(execution: ExecutionRun): void {
  const verifiedWorkers = execution.workerResults.filter(result => result.verified).length;
  const modifiedFiles = execution.workerResults.reduce((sum, result) => sum + result.modifiedFiles.length, 0);
  console.log(`🧠 Runtime: ${summarizeExecution(execution)}`);
  console.log(`📁 Artifacts: ${execution.artifactsPath}`);
  console.log(`🧪 Verified Workers: ${verifiedWorkers}/${execution.workerResults.length}`);
  console.log(`📝 Modified Files: ${modifiedFiles}`);
  console.log(`⚖️  Decision: ${execution.finalDecision?.action ?? 'none'}`);
  console.log(`🛠️  Backends: memory=${execution.selectedBackends.memoryBackend}, compression=${execution.selectedBackends.compressionBackend}, consensus=${execution.selectedBackends.consensusPolicy}, dsl=${execution.selectedBackends.dslCompiler}`);
  console.log(`🧭 Workflows: ${execution.activeWorkflows.length > 0 ? execution.activeWorkflows.map(workflow => workflow.name).join(', ') : 'none'}`);
  console.log(`🎯 Promotions: ${execution.promotionDecisions.length > 0 ? execution.promotionDecisions.map(decision => `${decision.kind}:${decision.target}:${decision.approved ? 'approved' : 'held'}`).join(', ') : 'none'}`);
}

function ensureParentDir(targetPath: string): void {
  mkdirSync(dirname(targetPath), { recursive: true });
}

function readJson(targetPath: string): any {
  if (!existsSync(targetPath)) return {};
  try {
    return JSON.parse(readFileSync(targetPath, 'utf8'));
  } catch {
    return {};
  }
}

function buildStandardMcpServerConfig() {
  return {
    command: 'npx',
    args: ['-y', 'nexus-prime', 'mcp'],
    env: {
      NEXUS_MCP_TOOL_PROFILE: 'autonomous'
    }
  };
}

function writeStandardMcpConfig(targetPath: string): void {
  const existing = readJson(targetPath);
  existing.mcpServers = existing.mcpServers ?? {};
  existing.mcpServers['nexus-prime'] = buildStandardMcpServerConfig();
  ensureParentDir(targetPath);
  writeFileSync(targetPath, JSON.stringify(existing, null, 2));
}

function writeOpencodeConfig(targetPath: string): void {
  const existing = readJson(targetPath);
  const server = {
    id: 'nexus-prime',
    ...buildStandardMcpServerConfig()
  };
  existing.mcp = existing.mcp ?? {};
  existing.mcp.servers = Array.isArray(existing.mcp.servers) ? existing.mcp.servers : [];
  existing.mcp.servers = existing.mcp.servers.filter((entry: any) => entry?.id !== 'nexus-prime');
  existing.mcp.servers.push(server);
  ensureParentDir(targetPath);
  writeFileSync(targetPath, JSON.stringify(existing, null, 2));
}

function buildInstructionFiles(clientId: SetupClientId): Array<{ path: string; content: string }> {
  const gateway = new InstructionGateway(PACKAGE_ROOT);
  const bundle = gateway.renderClientBootstrapBundle(clientId === 'claude' ? 'claude-code' : clientId, {
    toolProfile: 'autonomous',
  });
  const workspaceRoot = process.cwd();

  if (clientId === 'cursor') {
    return bundle.artifacts.map((artifact: ClientBootstrapArtifact) => ({
      path: join(workspaceRoot, '.cursor', 'rules', artifact.fileName),
      content: artifact.content,
    }));
  }
  if (clientId === 'windsurf') {
    return bundle.artifacts.map((artifact: ClientBootstrapArtifact) => ({
      path: join(workspaceRoot, artifact.fileName),
      content: artifact.content,
    }));
  }
  if (clientId === 'antigravity') {
    return bundle.artifacts.map((artifact: ClientBootstrapArtifact) => ({
      path: join(homedir(), '.antigravity', 'skills', 'nexus-prime', artifact.fileName),
      content: artifact.content,
    }));
  }
  const fileName = clientId === 'claude' ? 'claude-code.md' : 'opencode.md';
  return bundle.artifacts.map((artifact: ClientBootstrapArtifact, index) => ({
    path: join(workspaceRoot, '.agent', 'client-bootstrap', index === 0 ? fileName : `${fileName.replace(/\.md$/, '')}-${index + 1}.md`),
    content: artifact.content,
  }));
}

function getSetupDefinition(clientId: SetupClientId): SetupDefinition {
  const instructionFiles = buildInstructionFiles(clientId);
  if (clientId === 'cursor') {
    return {
      id: clientId,
      label: 'Cursor',
      configPath: join(homedir(), '.cursor', 'mcp.json'),
      instructionFiles,
    };
  }
  if (clientId === 'claude') {
    return {
      id: clientId,
      label: 'Claude Code',
      configPath: join(homedir(), '.claude-code', 'mcp.json'),
      instructionFiles,
    };
  }
  if (clientId === 'opencode') {
    return {
      id: clientId,
      label: 'Opencode',
      configPath: join(homedir(), '.opencode', 'config.json'),
      instructionFiles,
    };
  }
  if (clientId === 'windsurf') {
    return {
      id: clientId,
      label: 'Windsurf',
      configPath: join(homedir(), '.windsurf', 'mcp.json'),
      instructionFiles,
    };
  }
  return {
    id: clientId,
    label: 'Antigravity / OpenClaw',
    configPath: join(homedir(), '.antigravity', 'mcp.json'),
    instructionFiles,
  };
}

function installSetup(definition: SetupDefinition): void {
  if (definition.configPath) {
    if (definition.id === 'opencode') {
      writeOpencodeConfig(definition.configPath);
    } else {
      writeStandardMcpConfig(definition.configPath);
    }
  }
  for (const file of definition.instructionFiles) {
    ensureParentDir(file.path);
    writeFileSync(file.path, file.content, 'utf8');
  }
}

function printSetupPreview(definition: SetupDefinition): void {
  console.log(`--- ${definition.label.toUpperCase()} SETUP PREVIEW ---`);
  if (definition.configPath) {
    console.log(`Config: ${definition.configPath}`);
    console.log(JSON.stringify(definition.id === 'opencode'
      ? {
          mcp: {
            servers: [{ id: 'nexus-prime', ...buildStandardMcpServerConfig() }]
          }
        }
      : {
          mcpServers: {
            'nexus-prime': buildStandardMcpServerConfig()
          }
        }, null, 2));
  }
  for (const file of definition.instructionFiles) {
    console.log(`Instruction: ${file.path}`);
    console.log(file.content);
  }
}

function hasExpectedConfig(definition: SetupDefinition): boolean {
  if (!definition.configPath || !existsSync(definition.configPath)) return false;
  try {
    const parsed = JSON.parse(readFileSync(definition.configPath, 'utf8'));
    if (definition.id === 'opencode') {
      const servers = parsed?.mcp?.servers;
      return Array.isArray(servers) && servers.some((entry: any) =>
        entry?.id === 'nexus-prime'
        && entry?.command === 'npx'
        && Array.isArray(entry?.args)
        && entry.args.includes('nexus-prime')
        && entry?.env?.NEXUS_MCP_TOOL_PROFILE === 'autonomous');
    }
    const server = parsed?.mcpServers?.['nexus-prime'];
    return Boolean(server
      && server.command === 'npx'
      && Array.isArray(server.args)
      && server.args.includes('nexus-prime')
      && server?.env?.NEXUS_MCP_TOOL_PROFILE === 'autonomous');
  } catch {
    return false;
  }
}

function instructionState(definition: SetupDefinition): 'missing' | 'drifted' | 'installed' {
  let hasAny = false;
  for (const file of definition.instructionFiles) {
    if (!existsSync(file.path)) continue;
    hasAny = true;
    if (readFileSync(file.path, 'utf8') !== file.content) {
      return 'drifted';
    }
  }
  if (!hasAny) return 'missing';
  return definition.instructionFiles.every((file) => existsSync(file.path)) ? 'installed' : 'missing';
}

function statusForDefinition(definition: SetupDefinition): { state: 'missing' | 'drifted' | 'installed'; summary: string } {
  const configOk = definition.configPath ? hasExpectedConfig(definition) : true;
  const instructions = instructionState(definition);
  if (configOk && instructions === 'installed') {
    return { state: 'installed', summary: 'Config and client instructions are current' };
  }
  if ((definition.configPath && existsSync(definition.configPath)) || instructions !== 'missing') {
    return { state: 'drifted', summary: 'Setup exists but is missing the autonomous profile or current instructions' };
  }
  return { state: 'missing', summary: 'Setup not installed yet' };
}

program
  .name('nexus-prime')
  .description('🧬 Nexus Prime - The Self-Evolving Agent Operating System')
  .version(packageJson.version);

program
  .command('init')
  .description('Initialize a new Nexus Prime network')
  .action(async () => {
    console.log('Initializing Nexus Prime...');
    nexus = createNexusPrime({
      adapters: ['openclaw']
    });
    await nexus.start();
    console.log('✅ Nexus Prime initialized');
  });

program
  .command('start')
  .description('Start Nexus Prime daemon')
  .action(async () => {
    console.log('Starting Nexus Prime...');
    nexus = createNexusPrime();
    await nexus.start();
    console.log('✅ Nexus Prime running on port 3000');
    console.log('Press Ctrl+C to stop');

    // Keep running
    process.on('SIGINT', async () => {
      if (nexus) {
        await nexus.stop();
      }
      process.exit(0);
    });
  });

program
  .command('stop')
  .description('Stop Nexus Prime daemon')
  .action(async () => {
    if (nexus) {
      await nexus.stop();
      console.log('✅ Nexus Prime stopped');
    } else {
      console.log('⚠️  Nexus Prime not running');
    }
  });

program
  .command('install')
  .description('Install Nexus Prime into your environment')
  .action(() => {
    console.log(`
🚀 Nexus Prime Meta-Framework Installation
========================================

To give your agents (AntiGravity, Cursor, Claude Code) superpowers, add Nexus Prime as an MCP Server in their configuration file.

For Claude Desktop / AntiGravity:
Add this to your "mcpServers" configuration:

"nexus-prime": {
  "command": "npx",
  "args": [
    "nexus-prime",
    "mcp"
  ]
}

Restart your agent to complete the installation.
    `);
  });

program
  .command('mcp')
  .description('Start Nexus Prime as an MCP Server over stdio')
  .action(async () => {
    // stdio transport requires strict JSON-RPC on stdout — no console.log here.
    console.error('Starting Nexus Prime MCP Server...');
    nexus = createNexusPrime({
      adapters: ['mcp']
    });
    await nexus.start();
    console.error('✅ Nexus Prime MCP Server running on stdio');
    console.error('Memory persistence: active (~/.nexus-prime/memory.db)');

    // Graceful shutdown: flush memory to SQLite before exit
    const shutdown = async () => {
      console.error('Flushing memory to disk...');
      nexus?.flushMemory();
      if (nexus) await nexus.stop();
      PODNetwork.instance?.destroy();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

program
  .command('optimize')
  .description('Generate a token-efficient reading plan for a task')
  .argument('<task>', 'Task description')
  .option('-f, --files <files...>', 'File paths to evaluate')
  .action((task: string, options: { files?: string[] }) => {
    const files = (options.files ?? []).map((p: string) => {
      try {
        const stat = statSync(p);
        return { path: p, sizeBytes: stat.size, lastModified: stat.mtimeMs };
      } catch {
        return { path: p, sizeBytes: 0 };
      }
    });

    const plan = tokenEngine.plan(task, files);
    console.log(formatReadingPlan(plan));
  });

program
  .command('adapter')
  .description('Manage adapters')
  .addCommand(
    new Command('add')
      .argument('<type>', 'Adapter type (openclaw, claude-code, ruflo)')
      .action(async (type: AdapterType) => {
        if (!nexus) {
          nexus = createNexusPrime();
          await nexus.start();
        }
        await nexus.addAdapter(type);
        console.log(`✅ Adapter ${type} added`);
      })
  )
  .addCommand(
    new Command('list')
      .action(() => {
        if (!nexus) {
          console.log('⚠️  Nexus Prime not running. Run "nexus-prime start" first.');
          return;
        }
        const adapters = nexus.getAdapters();
        console.log('📦 Adapters:');
        adapters.forEach(a => {
          console.log(`  - ${a.name} (${a.type}) ${a.connected ? '✅' : '❌'}`);
        });
      })
  );

program
  .command('agents')
  .description('Manage agents')
  .addCommand(
    new Command('list')
      .action(() => {
        if (!nexus) {
          console.log('⚠️  Nexus Prime not running. Run "nexus-prime start" first.');
          return;
        }
        const agents = nexus.getAllAgents();
        console.log('🤖 Agents:');
        agents.forEach(a => {
          console.log(`  - ${a.id} (${a.type}) - ${a.state.current}`);
        });
      })
  )
  .addCommand(
    new Command('spawn')
      .argument('<type>', 'Agent type (researcher, coder, reviewer, etc.)')
      .option('-t, --task <task>', 'Initial task')
      .action(async (type: string, options: { task?: string }) => {
        if (!nexus) {
          nexus = createNexusPrime();
          await nexus.start();
        }
        const agent = await nexus.createAgent(type as any);
        console.log(`✅ Spawned agent: ${agent.id}`);

        if (options.task) {
          const result = await nexus.execute(agent.id, options.task);
          console.log(`📝 Result: ${result.result}`);
          printExecutionSummary(result.execution);
        }
      })
  );

program
  .command('execute')
  .description('Execute a task with an agent')
  .argument('<agentId>', 'Agent ID')
  .argument('<task>', 'Task description')
  .option('-f, --files <files...>', 'Files relevant to the execution')
  .option('-w, --workers <number>', 'Number of coder workers')
  .option('--verify <commands...>', 'Verification commands')
  .option('--actions-file <path>', 'JSON file containing runtime action bindings')
  .option('--nxl-file <path>', 'NXL/YAML file to compile and execute')
  .option('--skills <skills...>', 'Runtime skill selectors')
  .option('--workflows <workflows...>', 'Runtime workflow selectors')
  .option('--hooks <hooks...>', 'Runtime hook selectors')
  .option('--automations <automations...>', 'Runtime automation selectors')
  .option('--memory-backend <id>', 'Memory backend selector')
  .option('--compression-backend <id>', 'Compression backend selector')
  .option('--dsl-compiler <id>', 'DSL compiler selector')
  .option('--backend-mode <mode>', 'Backend mode (default, shadow, experimental)')
  .option('--shield-policy <policy>', 'Security shield policy (balanced, strict, permissive)')
  .option('--memory-policy <policy>', 'Memory policy mode (balanced, strict, off)')
  .action(async (
    agentId: string,
    task: string,
    options: {
      files?: string[];
      workers?: string;
      verify?: string[];
      actionsFile?: string;
      nxlFile?: string;
      skills?: string[];
      workflows?: string[];
      hooks?: string[];
      automations?: string[];
      memoryBackend?: string;
      compressionBackend?: string;
      dslCompiler?: string;
      backendMode?: 'default' | 'shadow' | 'experimental';
      shieldPolicy?: 'balanced' | 'strict' | 'permissive';
      memoryPolicy?: 'balanced' | 'strict' | 'off';
    }
  ) => {
    if (!nexus) {
      nexus = createNexusPrime();
      await nexus.start();
    }

    const parsedWorkers = options.workers ? parseInt(options.workers, 10) : undefined;
    const actions = options.actionsFile
      ? JSON.parse(readFileSync(options.actionsFile, 'utf8'))
      : undefined;

    if (options.nxlFile) {
      const rawScript = readFileSync(options.nxlFile, 'utf8');
      const execution = await nexus.getRuntime().runNXL(task, rawScript, 'CLI');
      console.log(`📝 Result: ${execution.result}`);
      printExecutionSummary(execution);
      return;
    }

    const result = await nexus.execute(agentId, task, {
      files: options.files,
      workers: parsedWorkers,
      verifyCommands: options.verify,
      actions,
      skillNames: options.skills,
      workflowSelectors: options.workflows,
      hookSelectors: options.hooks,
      automationSelectors: options.automations,
      backendSelectors: {
        memoryBackend: options.memoryBackend,
        compressionBackend: options.compressionBackend,
        dslCompiler: options.dslCompiler,
      },
      backendMode: options.backendMode,
      shieldPolicy: options.shieldPolicy,
      memoryPolicy: options.memoryPolicy ? { mode: options.memoryPolicy, quarantineTag: '#quarantine' } : undefined,
    });
    console.log(`📝 Result: ${result.result}`);
    console.log(`📊 Value: ${result.experience.value.toFixed(2)}`);
    printExecutionSummary(result.execution);
  });

program
  .command('memory')
  .description('Query memory')
  .addCommand(
    new Command('search')
      .argument('<query>', 'Search query')
      .option('-k, --top <number>', 'Number of results', '10')
      .action(async (query: string, options: { top: string }) => {
        if (!nexus) {
          console.log('⚠️  Nexus Prime not running. Run "nexus-prime start" first.');
          return;
        }
        const results = await nexus.recallMemory(query, parseInt(options.top));
        console.log('🔍 Results:');
        results.forEach(r => console.log(`  - ${r}`));
      })
  )
  .addCommand(
    new Command('audit')
      .option('-l, --limit <number>', 'Maximum memories to scan', '80')
      .action(async (options: { limit: string }) => {
        if (!nexus) {
          nexus = createNexusPrime();
          await nexus.start();
        }
        const audit = nexus.getRuntime().auditMemory(parseInt(options.limit, 10));
        console.log(JSON.stringify(audit ?? { scanned: 0, quarantined: [], findings: [] }, null, 2));
      })
  );

program
  .command('hook')
  .description('Manage runtime hooks')
  .addCommand(
    new Command('generate')
      .requiredOption('--name <name>', 'Hook name')
      .requiredOption('--description <description>', 'Hook description')
      .requiredOption('--trigger <trigger>', 'Hook trigger')
      .option('--risk-class <riskClass>', 'Risk class', 'orchestrate')
      .option('--scope <scope>', 'Hook scope', 'session')
      .action(async (options: { name: string; description: string; trigger: any; riskClass: 'read' | 'orchestrate' | 'mutate'; scope: 'session' | 'worker' | 'global' }) => {
        if (!nexus) {
          nexus = createNexusPrime();
          await nexus.start();
        }
        const hook = nexus.getRuntime().generateHook(options);
        console.log(JSON.stringify(hook, null, 2));
      })
  )
  .addCommand(
    new Command('deploy')
      .argument('<hookId>', 'Hook id or name')
      .option('--scope <scope>', 'Deployment scope', 'session')
      .action(async (hookId: string, options: { scope: 'session' | 'worker' | 'global' }) => {
        if (!nexus) {
          nexus = createNexusPrime();
          await nexus.start();
        }
        const known = nexus.getRuntime().listHooks().find((hook) => hook.hookId === hookId || hook.name === hookId);
        console.log(JSON.stringify(known ? nexus.getRuntime().deployHook(known.hookId, options.scope) : { error: 'hook-not-found' }, null, 2));
      })
  )
  .addCommand(
    new Command('revoke')
      .argument('<hookId>', 'Hook id or name')
      .action(async (hookId: string) => {
        if (!nexus) {
          nexus = createNexusPrime();
          await nexus.start();
        }
        const known = nexus.getRuntime().listHooks().find((hook) => hook.hookId === hookId || hook.name === hookId);
        console.log(JSON.stringify(known ? nexus.getRuntime().revokeHook(known.hookId) : { error: 'hook-not-found' }, null, 2));
      })
  );

program
  .command('automation')
  .description('Manage runtime automations')
  .addCommand(
    new Command('generate')
      .requiredOption('--name <name>', 'Automation name')
      .requiredOption('--description <description>', 'Automation description')
      .option('--trigger-mode <mode>', 'Trigger mode', 'event')
      .option('--event-trigger <trigger>', 'Event trigger')
      .option('--scope <scope>', 'Automation scope', 'session')
      .action(async (options: {
        name: string;
        description: string;
        triggerMode: 'event' | 'schedule' | 'connector';
        eventTrigger?: any;
        scope: 'session' | 'worker' | 'global';
      }) => {
        if (!nexus) {
          nexus = createNexusPrime();
          await nexus.start();
        }
        const automation = nexus.getRuntime().generateAutomation(options);
        console.log(JSON.stringify(automation, null, 2));
      })
  )
  .addCommand(
    new Command('deploy')
      .argument('<automationId>', 'Automation id or name')
      .option('--scope <scope>', 'Deployment scope', 'session')
      .action(async (automationId: string, options: { scope: 'session' | 'worker' | 'global' }) => {
        if (!nexus) {
          nexus = createNexusPrime();
          await nexus.start();
        }
        const known = nexus.getRuntime().listAutomations().find((automation) => automation.automationId === automationId || automation.name === automationId);
        console.log(JSON.stringify(known ? nexus.getRuntime().deployAutomation(known.automationId, options.scope) : { error: 'automation-not-found' }, null, 2));
      })
  )
  .addCommand(
    new Command('revoke')
      .argument('<automationId>', 'Automation id or name')
      .action(async (automationId: string) => {
        if (!nexus) {
          nexus = createNexusPrime();
          await nexus.start();
        }
        const known = nexus.getRuntime().listAutomations().find((automation) => automation.automationId === automationId || automation.name === automationId);
        console.log(JSON.stringify(known ? nexus.getRuntime().revokeAutomation(known.automationId) : { error: 'automation-not-found' }, null, 2));
      })
  )
  .addCommand(
    new Command('run')
      .argument('<automationId>', 'Automation id or name')
      .option('--goal <goal>', 'Optional override goal')
      .action(async (automationId: string, options: { goal?: string }) => {
        if (!nexus) {
          nexus = createNexusPrime();
          await nexus.start();
        }
        const execution = await nexus.getRuntime().runAutomation(automationId, options.goal);
        console.log(`📝 Result: ${execution.result}`);
        printExecutionSummary(execution);
      })
  );

program
  .command('network')
  .description('Inspect local federation status')
  .action(async () => {
    if (!nexus) {
      nexus = createNexusPrime();
      await nexus.start();
    }
    console.log(JSON.stringify(nexus.getRuntime().getNetworkStatus(), null, 2));
  });

program
  .command('status')
  .description('Check Nexus Prime status')
  .action(() => {
    if (!nexus) {
      console.log('⚠️  Nexus Prime not running');
      return;
    }
    const stats = nexus.getStats();
    console.log('📊 Nexus Prime Status:');
    console.log(`  Running: ${stats.running ? '✅' : '❌'}`);
    console.log(`  Agents: ${stats.agents}`);
    console.log(`  Adapters: ${stats.adapters}`);
    console.log(`  Grammar Rules: ${stats.grammarRules}`);
  });

program
  .command('evolution')
  .description('Evolution metrics')
  .addCommand(
    new Command('stats')
      .action(() => {
        if (!nexus) {
          console.log('⚠️  Nexus Prime not running');
          return;
        }
        const grammar = nexus.getGrammar();
        console.log('🧬 Evolution Stats:');
        console.log(`  Grammar Rules: ${grammar.length}`);
        grammar.forEach(r => {
          console.log(`    - ${r.pattern.join(' ')} (weight: ${r.weight.toFixed(2)})`);
        });
      })
  );

program
  .command('setup')
  .description('Install MCP config plus client-native Nexus Prime instructions')
  .addCommand(
    new Command('cursor')
      .description('Integrate with Cursor')
      .option('--dry-run', 'Preview changes')
      .action((options) => {
        const definition = getSetupDefinition('cursor');
        if (options.dryRun) {
          printSetupPreview(definition);
          return;
        }
        installSetup(definition);
        console.log(`✅ Nexus Prime installed for Cursor`);
        console.log(`   MCP: ${definition.configPath}`);
        definition.instructionFiles.forEach((file) => console.log(`   Rule: ${file.path}`));
      })
  )
  .addCommand(
    new Command('claude')
      .description('Integrate with Claude Code')
      .option('--dry-run', 'Preview changes')
      .action((options) => {
        const definition = getSetupDefinition('claude');
        if (options.dryRun) {
          printSetupPreview(definition);
          return;
        }
        installSetup(definition);
        console.log(`✅ Nexus Prime installed for Claude Code`);
        console.log(`   MCP: ${definition.configPath}`);
        definition.instructionFiles.forEach((file) => console.log(`   Instruction: ${file.path}`));
      })
  )
  .addCommand(
    new Command('opencode')
      .description('Integrate with Opencode')
      .option('--dry-run', 'Preview changes')
      .action((options) => {
        const definition = getSetupDefinition('opencode');
        if (options.dryRun) {
          printSetupPreview(definition);
          return;
        }
        installSetup(definition);
        console.log(`✅ Nexus Prime installed for Opencode`);
        console.log(`   MCP: ${definition.configPath}`);
        definition.instructionFiles.forEach((file) => console.log(`   Instruction: ${file.path}`));
      })
  )
  .addCommand(
    new Command('windsurf')
      .description('Integrate with Windsurf')
      .option('--dry-run', 'Preview changes')
      .action((options) => {
        const definition = getSetupDefinition('windsurf');
        if (options.dryRun) {
          printSetupPreview(definition);
          return;
        }
        installSetup(definition);
        console.log(`✅ Nexus Prime installed for Windsurf`);
        console.log(`   MCP: ${definition.configPath}`);
        definition.instructionFiles.forEach((file) => console.log(`   Rule: ${file.path}`));
      })
  )
  .addCommand(
    new Command('antigravity')
      .alias('openclaw')
      .description('Integrate with Antigravity / OpenClaw')
      .option('--dry-run', 'Preview changes')
      .action((options) => {
        const definition = getSetupDefinition('antigravity');
        if (options.dryRun) {
          printSetupPreview(definition);
          return;
        }
        installSetup(definition);
        console.log(`✅ Nexus Prime installed for Antigravity / OpenClaw`);
        console.log(`   MCP: ${definition.configPath}`);
        definition.instructionFiles.forEach((file) => console.log(`   Skill: ${file.path}`));
      })
  )
  .addCommand(
    new Command('status')
      .description('Check integration status')
      .action(() => {
        console.log('📋 Integration Status:');
        (['cursor', 'claude', 'opencode', 'windsurf', 'antigravity'] as SetupClientId[]).forEach((clientId) => {
          const definition = getSetupDefinition(clientId);
          const status = statusForDefinition(definition);
          const icon = status.state === 'installed' ? '✅' : status.state === 'drifted' ? '🟡' : '❌';
          console.log(`  - ${definition.label}: ${icon} ${status.summary}`);
        });
        const codexStatus = existsSync(join(process.cwd(), 'AGENTS.md'))
          ? '✅ Repo-local AGENTS.md present (Codex uses repo instructions plus MCP profile)'
          : '🟡 No repo-local AGENTS.md detected for Codex';
        console.log(`  - Codex: ${codexStatus}`);
      })
  );

program.parse();
