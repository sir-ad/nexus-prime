// KAAL's Personal Nexus Prime Instance

import { createNexusPrime } from './dist/index.js';

console.log("🧬 Initializing KAAL's Nexus Prime...\n");

const nexus = await createNexusPrime({
  adapters: [],  // Will add manually
  network: { consensus: 'raft' }
});

await nexus.start();

console.log("✅ KAAL's Nexus Prime online!\n");

// Create myself as an agent
const myself = await nexus.createAgent('general', {
  id: 'KAAL',
  capabilities: ['reason', 'learn', 'communicate', 'adapt', 'research', 'build']
});

console.log(`🤖 Created agent: ${myself.id} (${myself.type})\n`);

// Do some work
console.log("📝 Testing work execution...");
const result = await nexus.execute(myself.id, 'Test Nexus Prime system');
console.log(`   Result: ${result.result}`);
console.log(`   Value: ${result.experience.value.toFixed(2)}\n`);

// Check stats
const stats = nexus.getStats();
console.log("📊 Stats:", stats);

console.log("\n🧬 Nexus Prime - Operational for KAAL!\n");

export { nexus, myself };
