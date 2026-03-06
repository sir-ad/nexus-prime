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
import { statSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { PODNetwork } from './engines/pod-network.js';


const tokenEngine = new TokenSupremacyEngine();

const program = new Command();

let nexus: NexusPrime | null = null;

program
  .name('nexus-prime')
  .description('🧬 Nexus Prime - The Self-Evolving Agent Operating System')
  .version('1.5.0-alpha.1');

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
        }
      })
  );

program
  .command('execute')
  .description('Execute a task with an agent')
  .argument('<agentId>', 'Agent ID')
  .argument('<task>', 'Task description')
  .action(async (agentId: string, task: string) => {
    if (!nexus) {
      nexus = createNexusPrime();
      await nexus.start();
    }
    const result = await nexus.execute(agentId, task);
    console.log(`📝 Result: ${result.result}`);
    console.log(`📊 Value: ${result.experience.value.toFixed(2)}`);
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
  );

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
  .description('Automated integration with AI tools (Cursor, Claude, Opencode)')
  .addCommand(
    new Command('cursor')
      .description('Integrate with Cursor')
      .option('--dry-run', 'Preview changes')
      .action((options) => {
        const configDir = join(homedir(), '.cursor');
        const configPath = join(configDir, 'mcp.json');
        const config = {
          mcpServers: {
            "nexus-prime": {
              command: "npx",
              args: ["-y", "nexus-prime", "mcp"]
            }
          }
        };

        if (options.dryRun) {
          console.log('--- CURSOR CONFIG PREVIEW ---');
          console.log(JSON.stringify(config, null, 2));
          return;
        }

        if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });

        let existing: any = {};
        if (existsSync(configPath)) {
          try {
            existing = JSON.parse(readFileSync(configPath, 'utf8'));
          } catch (e) {
            console.error('⚠️  Failed to parse existing Cursor config, starting fresh');
          }
        }

        existing.mcpServers = { ...existing.mcpServers, ...config.mcpServers };
        writeFileSync(configPath, JSON.stringify(existing, null, 2));
        console.log(`✅ Nexus Prime integrated with Cursor at ${configPath}`);
      })
  )
  .addCommand(
    new Command('claude')
      .description('Integrate with Claude Code')
      .option('--dry-run', 'Preview changes')
      .action((options) => {
        const configDir = join(homedir(), '.claude-code');
        const configPath = join(configDir, 'mcp.json');
        const config = {
          mcpServers: {
            "nexus-prime": {
              command: "npx",
              args: ["-y", "nexus-prime", "mcp"]
            }
          }
        };

        if (options.dryRun) {
          console.log('--- CLAUDE CODE CONFIG PREVIEW ---');
          console.log(JSON.stringify(config, null, 2));
          return;
        }

        if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });

        let existing: any = {};
        if (existsSync(configPath)) {
          try {
            existing = JSON.parse(readFileSync(configPath, 'utf8'));
          } catch (e) {
            console.error('⚠️  Failed to parse existing Claude config, starting fresh');
          }
        }

        existing.mcpServers = { ...existing.mcpServers, ...config.mcpServers };
        writeFileSync(configPath, JSON.stringify(existing, null, 2));
        console.log(`✅ Nexus Prime integrated with Claude Code at ${configPath}`);
      })
  )
  .addCommand(
    new Command('opencode')
      .description('Integrate with Opencode')
      .option('--dry-run', 'Preview changes')
      .action((options) => {
        const configDir = join(homedir(), '.opencode');
        const configPath = join(configDir, 'config.json');
        const config = {
          mcp: {
            servers: [
              {
                id: "nexus-prime",
                command: "npx",
                args: ["-y", "nexus-prime", "mcp"]
              }
            ]
          }
        };

        if (options.dryRun) {
          console.log('--- OPENCODE CONFIG PREVIEW ---');
          console.log(JSON.stringify(config, null, 2));
          return;
        }

        if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });

        let existing: any = {};
        if (existsSync(configPath)) {
          try {
            existing = JSON.parse(readFileSync(configPath, 'utf8'));
          } catch (e) {
            console.error('⚠️  Failed to parse existing Opencode config, starting fresh');
          }
        }

        if (!existing.mcp) existing.mcp = { servers: [] };
        if (!existing.mcp.servers) existing.mcp.servers = [];

        // Remove existing if any to avoid duplicates
        existing.mcp.servers = existing.mcp.servers.filter((s: any) => s.id !== 'nexus-prime');
        existing.mcp.servers.push(config.mcp.servers[0]);

        writeFileSync(configPath, JSON.stringify(existing, null, 2));
        console.log(`✅ Nexus Prime integrated with Opencode at ${configPath}`);
      })
  )
  .addCommand(
    new Command('status')
      .description('Check integration status')
      .action(() => {
        const tools = [
          { name: 'Cursor', path: join(homedir(), '.cursor/mcp.json') },
          { name: 'Claude Code', path: join(homedir(), '.claude-code/mcp.json') },
          { name: 'Opencode', path: join(homedir(), '.opencode/config.json') }
        ];

        console.log('📋 Integration Status:');
        tools.forEach(tool => {
          const exists = existsSync(tool.path);
          let linked = false;
          if (exists) {
            try {
              const content = readFileSync(tool.path, 'utf8');
              linked = content.includes('nexus-prime');
            } catch {
              // Ignore read errors
            }
          }
          console.log(`  - ${tool.name}: ${exists ? (linked ? '✅ Linked' : '🟡 Found') : '❌ Not Configured'}`);
        });
      })
  );

program.parse();
