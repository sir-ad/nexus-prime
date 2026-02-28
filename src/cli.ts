#!/usr/bin/env node

/**
 * Nexus Prime CLI
 */

import { Command } from 'commander';
import { createNexusPrime, NexusPrime } from './index.js';
import { AdapterType } from './agents/adapters.js';

const program = new Command();

let nexus: NexusPrime | null = null;

program
  .name('nexus-prime')
  .description('🧬 Nexus Prime - The Self-Evolving Agent Operating System')
  .version('0.1.0');

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
      .action((query: string, options: { top: string }) => {
        if (!nexus) {
          console.log('⚠️  Nexus Prime not running. Run "nexus-prime start" first.');
          return;
        }
        const results = nexus.searchMemory(query, parseInt(options.top));
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

program.parse();
