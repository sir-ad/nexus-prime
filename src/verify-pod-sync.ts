import { PODNetwork } from './engines/pod-network.js';
import { fork } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

async function verify() {
    const pod = new PODNetwork();
    pod.clear();

    console.log('--- POD Sync Verification ---');

    // Publish from main process
    pod.publish('main', 'Main process observation', 1.0, ['#test']);

    // Simulate a worker process
    const workerScript = `
        import { PODNetwork } from './dist/engines/pod-network.js';
        const pod = new PODNetwork();
        pod.publish('worker-1', 'Worker observation', 0.9, ['#test']);
        process.exit(0);
    `;

    const workerFile = 'temp-worker.mjs';
    fs.writeFileSync(workerFile, workerScript);

    console.log('Spawning worker process...');
    const worker = fork(workerFile, { stdio: 'inherit' });

    await new Promise(resolve => worker.on('exit', resolve));
    fs.unlinkSync(workerFile);

    console.log('Worker finished. Checking if main saw worker message...');

    // Wait a bit for the poll/sync
    await new Promise(resolve => setTimeout(resolve, 1000));

    const messages = pod.recall(['#test']);
    console.log(`Total messages recalled: ${messages.length}`);

    const hasMain = messages.some(m => m.workerId === 'main');
    const hasWorker = messages.some(m => m.workerId === 'worker-1');

    if (hasMain && hasWorker) {
        console.log('✅ PASSED: Cross-process synchronization works!');
    } else {
        console.error('❌ FAILED: One or more messages missing.');
        console.log('Messages found:', messages.map(m => m.workerId));
        process.exit(1);
    }

    process.exit(0);
}

verify().catch(console.error);
