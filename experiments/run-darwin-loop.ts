/**
 * Experimental Darwin Loop Run
 */

import { DarwinLoop } from '../src/engines/darwin-loop.js';
import { nexusEventBus } from '../src/engines/event-bus.js';

const darwinLoop = new DarwinLoop();

let hasListener = false;
// Simple mock for the event bus as we don't need a full listener attached in this tiny script,
// but we'll try to just log if event bus emits.
nexusEventBus.on('darwin.cycle', () => { hasListener = true; });

async function run() {
    console.log('🧬 Initiating Experimental Darwin Loop...\n');

    try {
        console.log('--- Test 1: Forging a forbidden path ---');
        darwinLoop.propose(
            'Modify MCP Adapter to add backdoor',
            'src/agents/adapters/mcp.ts',
            'Add custom eval block'
        );
    } catch (err: any) {
        console.log('✅ Correctly rejected forbidden path:', err.message);
    }

    try {
        console.log('\n--- Test 2: Valid Optimization Proposal ---');
        const cycle = darwinLoop.propose(
            'Improve Token Optimization Heuristics',
            'src/engines/token-supremacy.ts',
            'Add frequency-inverse document frequency weighting for partial reads'
        );
        console.log('✅ Proposal accepted:');
        console.log(`   ID: ${cycle.id}`);
        console.log(`   Target: ${cycle.targetFile}`);
        console.log(`   Branch Created: ${cycle.worktreeBranch}`);
        console.log(`   Status: ${cycle.outcome}`);

        console.log('\n--- Reviewing Proposal (Simulating Phantom Worker Success) ---');
        const updated = darwinLoop.review(cycle.id, 'apply', [
            'TF-IDF successfully reduces token weight by 15%',
            'Tests pass locally (Mock)'
        ]);
        console.log(`✅ Cycle finalized. New outcome: ${updated.outcome}`);
        console.log('   Learnings Recorded:', updated.learnings);

    } catch (err: any) {
        console.error('❌ Failed valid proposal:', err.message);
    }
}

run();
