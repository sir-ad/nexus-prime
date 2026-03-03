import { GuardrailEngine } from './engines/guardrails-bridge.js';

function verify() {
    const engine = new GuardrailEngine();

    console.log('--- Guardrails Sync Verification ---');

    const testCases = [
        {
            name: 'NO_SECRETS',
            ctx: { action: 'The API key is sk-123456789012345678901234567890123456789012345678' },
            expectedId: 'NO_SECRETS'
        },
        {
            name: 'NO_INSTALLS',
            ctx: { action: 'I will run npm install lodash' },
            expectedId: 'NO_INSTALLS'
        },
        {
            name: 'OUTLINE_FIRST',
            ctx: { action: 'I will read src/index.ts now' },
            expectedId: 'OUTLINE_FIRST'
        },
        {
            name: 'QUALITY_GATES',
            ctx: { action: 'I will modify memory.ts', filesToModify: ['src/engines/memory.ts'] },
            expectedId: 'QUALITY_GATES'
        }
    ];

    let allPassed = true;
    for (const test of testCases) {
        const result = engine.check(test.ctx as any);
        const found = [...result.violations, ...result.warnings].some(v => v.id === test.expectedId);

        if (found) {
            console.log(`✅ PASSED: ${test.name} correctly triggered.`);
        } else {
            console.error(`❌ FAILED: ${test.name} did not trigger.`);
            console.log('Result:', JSON.stringify(result, null, 2));
            allPassed = false;
        }
    }

    if (allPassed) {
        console.log('\n✨ ALL GUARDRAIL TESTS PASSED!');
    } else {
        process.exit(1);
    }
}

verify();
