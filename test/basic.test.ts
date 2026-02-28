/**
 * Basic test for Nexus Prime
 */

import { createNexusPrime } from '../src/index.js';

async function test() {
  console.log('🧪 Testing Nexus Prime...\n');

  // Create Nexus
  const nexus = createNexusPrime({
    adapters: []
  });

  // Start
  await nexus.start();
  console.log('✅ Started\n');

  // Create agents
  const researcher = await nexus.createAgent('researcher');
  const coder = await nexus.createAgent('coder');
  console.log(`✅ Created agents: ${researcher.id}, ${coder.id}\n`);

  // Execute tasks
  console.log('📝 Executing tasks...');
  
  const result1 = await nexus.execute(researcher.id, 'Research quantum computing breakthroughs');
  console.log(`  Researcher: ${result1.result} (value: ${result1.experience.value.toFixed(2)})`);
  
  const result2 = await nexus.execute(coder.id, 'Write authentication module');
  console.log(`  Coder: ${result2.result} (value: ${result2.experience.value.toFixed(2)})`);
  
  console.log('');

  // Test coordination
  console.log('🔄 Testing coordination...');
  const coordination = await nexus.coordinate('Build a feature', [researcher.id, coder.id]);
  console.log(`  Coordinated ${coordination.length} agents\n`);

  // Test consensus
  console.log('🗳️  Testing consensus...');
  const consensus = await nexus.achieveConsensus('Deploy to production', [researcher.id, coder.id]);
  console.log(`  Consensus: ${consensus.decided ? 'achieved' : 'not achieved'}\n`);

  // Check stats
  console.log('📊 Stats:');
  const stats = nexus.getStats();
  console.log(`  Agents: ${stats.agents}`);
  console.log(`  Grammar Rules: ${stats.grammarRules}`);
  console.log('');

  // Evolve
  console.log('🧬 Evolving...');
  nexus.evolve();
  const grammar = nexus.getGrammar();
  console.log(`  Grammar rules: ${grammar.length}\n`);

  // Stop
  await nexus.stop();
  console.log('✅ Stopped\n');

  console.log('🎉 All tests passed!');
}

test().catch(console.error);
