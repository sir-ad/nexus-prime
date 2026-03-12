import assert from 'assert';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';

async function withServer(handler: http.RequestListener): Promise<{ baseUrl: string; close: () => Promise<void> }> {
    const server = http.createServer(handler);
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            resolve();
        });
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string', 'expected test server to expose a numeric port');
    return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((resolve, reject) => {
            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        }),
    };
}

async function test() {
    console.log('🧪 Testing RAG collection store safety...\n');

    const { RagCollectionStore } = await import('../dist/engines/rag-collections.js');
    const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-prime-rag-'));
    const store = new RagCollectionStore(stateRoot, { requestTimeoutMs: 100 });

    const outsidePath = path.join(stateRoot, 'escape.json');
    fs.writeFileSync(outsidePath, JSON.stringify({ ok: true }), 'utf8');

    assert.strictEqual(store.getCollection('../escape'), undefined, 'unsafe collection ids should not resolve outside the RAG store');
    assert.strictEqual(store.deleteCollection('../escape'), false, 'unsafe collection ids should not delete files outside the RAG store');
    assert.ok(fs.existsSync(outsidePath), 'outside files should remain intact after unsafe delete attempts');

    const collection = store.createCollection({
        name: 'Timeout fixture',
        description: 'Exercise hanging URL ingestion paths',
    });

    const hangingServer = await withServer((req, res) => {
        void req;
        void res;
        // Intentionally keep the connection open so the client-side timeout fires.
    });

    try {
        await assert.rejects(
            store.ingestCollection(collection.collectionId, [{
                url: `${hangingServer.baseUrl}/hang`,
                label: 'hanging-source',
            }]),
            /Timed out fetching RAG URL after 100ms/,
            'hanging URL ingestion should fail with a timeout'
        );
    } finally {
        await hangingServer.close();
    }

    const afterTimeout = store.getCollection(collection.collectionId);
    assert.ok(afterTimeout, 'collection should still be readable after timeout failure');
    assert.strictEqual(afterTimeout?.sources.length, 0, 'timed-out ingests should not append partial sources');
    assert.strictEqual(afterTimeout?.chunks.length, 0, 'timed-out ingests should not append partial chunks');

    console.log('✅ RAG collection store safety checks passed\n');
}

await test();
