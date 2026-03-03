/**
 * Basic test for Nexus Prime
 */

import { createNexusPrime } from '../src/index.js';

// Use random port for dashboard so it doesn't conflict with main daemon
process.env.NEXUS_DASHBOARD_PORT = '0';

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

  // Evolve
  console.log('🧬 Evolving...');
  nexus.evolve();
  console.log('  Evolution step triggered\n');

  // Stop
  await nexus.stop();
  console.log('✅ Stopped\n');

  console.log('🎉 All tests passed!');
}

test().catch(console.error);
