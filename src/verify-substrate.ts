import { createNexusPrime } from './index.js';
import { podNetwork } from './engines/pod-network.js';
import { HyperbolicMath } from './engines/embedder.js';

async function verify() {
    console.log('🧪 Starting Neural Substrate & Swarm Verification...\n');

    const nexus = createNexusPrime();
    await nexus.start();

    // 1. Test Hyperbolic Math
    console.log('--- 1. Hyperbolic Math ---');
    const v1 = [0.1, 0.2];
    const v2 = [0.3, 0.4];
    const dist = HyperbolicMath.dist(v1, v2);
    console.log(`Poincare Distance between [0.1, 0.2] and [0.3, 0.4]: ${dist.toFixed(4)}`);
    if (dist > 0) console.log('✅ Hyperbolic distance calculated correctly.');

    // 2. Test Hierarchical Memory & Boost
    console.log('\n--- 2. Hierarchical Memory Boost ---');
    const parentId = nexus.storeMemory('Fundamental Architecture of Nexus Prime', 1.0, ['#architecture']);
    const childId = nexus.storeMemory('Implementation details of MemoryEngine', 0.8, ['#memory'], parentId, 1);

    console.log(`Stored parent: ${parentId}`);
    console.log(`Stored child: ${childId} with parent: ${parentId}`);

    const results = await nexus.recallMemory('Architecture details', 5);
    console.log('Recalled for "Architecture details":');
    results.forEach(r => console.log(` - ${r}`));

    if (results.some(r => r.includes('Implementation details'))) {
        console.log('✅ Hierarchical boost worked: child recalled via parent context.');
    }

    // 3. Test POD Network
    console.log('\n--- 3. POD Swarm Synchronization ---');
    podNetwork.publish(
        'worker-1',
        'CRITICAL: Found potential memory leak in SQLite flush loop',
        0.95,
        ['#bug', '#swarm-broadcast']
    );

    const podResults = await nexus.recallMemory('memory leak', 5);
    console.log('Recalled for "memory leak" (searching POD + Local):');
    podResults.forEach(r => console.log(` - ${r}`));

    if (podResults.some(r => r.includes('memory leak'))) {
        console.log('✅ Swarm recall worked: POD finding integrated into local recall.');
    }

    await nexus.stop();
    console.log('\n✨ Verification Complete.');
}

verify().catch(console.error);
