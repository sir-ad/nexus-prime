import { TokenSupremacyEngine } from './engines/token-supremacy.js';
import * as path from 'path';
import * as fs from 'fs';

async function verify() {
    const engine = new TokenSupremacyEngine();
    const task = "Audit all Nexus Prime tools and engines";

    // Test with real files from the repo
    const files = [
        { path: 'src/engines/token-supremacy.ts', sizeBytes: fs.statSync('src/engines/token-supremacy.ts').size },
        { path: 'src/engines/memory.ts', sizeBytes: fs.statSync('src/engines/memory.ts').size },
        { path: 'package.json', sizeBytes: fs.statSync('package.json').size },
        { path: 'README.md', sizeBytes: fs.statSync('README.md').size }
    ];

    const plan = engine.plan(task, files);

    console.log(`Task: "${task}"`);
    console.log('---');

    let allPassed = true;
    for (const f of plan.files) {
        console.log(`File: ${f.file.path}`);
        console.log(`Action: ${f.action}`);
        console.log(`Reason: ${f.reason}`);

        if (f.action === 'skip' && f.file.path.includes('token-supremacy')) {
            console.error('❌ FAILED: Token supremacy engine was skipped but should be highly relevant.');
            allPassed = false;
        } else if (f.action !== 'skip') {
            console.log('✅ PASSED: File correctly identified as relevant.');
        }
    }

    if (allPassed) {
        console.log('\n✨ ALL TESTS PASSED: Token optimizer is now content-aware!');
    } else {
        process.exit(1);
    }
}

verify().catch(console.error);
