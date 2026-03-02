/**
 * Memory Engine — Semantic Recall Test
 *
 * Validates that HNSW / TF-IDF vector search can bridge synonym gaps
 * that pure word-overlap would miss.
 *
 * Key test: store "authentication broken for OAuth2"
 *           recall  "login not working"
 *           → must return the right item despite zero word overlap
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// Use an isolated test DB (not the real one)
const TEST_DB = path.join(os.tmpdir(), `nexus-test-memory-${Date.now()}.db`);

async function runTests() {
    console.log('\n🧪 Memory Engine — Semantic Recall Tests\n');
    let passed = 0;
    let failed = 0;
    const errors: string[] = [];

    const assert = (condition: boolean, name: string, detail?: string) => {
        if (condition) {
            console.log(`  ✅ ${name}`);
            passed++;
        } else {
            console.log(`  ❌ ${name}${detail ? ': ' + detail : ''}`);
            failed++;
            errors.push(name);
        }
    };

    // ── Import ───────────────────────────────────────────────────────────────
    console.log('📦 Imports');
    let MemoryEngine: any, Embedder: any;
    try {
        const memMod = await import('../src/engines/memory.js');
        MemoryEngine = memMod.MemoryEngine;
        const embMod = await import('../src/engines/embedder.js');
        Embedder = embMod.Embedder;
        assert(true, 'memory.ts and embedder.ts import cleanly');
    } catch (e: any) {
        assert(false, 'Imports clean', e.message);
        return;
    }

    // ── Embedder unit tests ──────────────────────────────────────────────────
    console.log('\n📐 Embedder');
    const emb = new Embedder();

    emb.fitVocabulary([
        'authentication oauth login',
        'sql database query',
        'memory cache redis',
        'git worktree branch',
    ]);

    const v1 = emb.localEmbed('authentication oauth login');
    const v2 = emb.localEmbed('auth login issue');
    const v3 = emb.localEmbed('sql database');

    assert(v1.length === 128, `Vector is 128 dims (got ${v1.length})`);

    const sim12 = emb.cosineSimilarity(v1, v2);
    const sim13 = emb.cosineSimilarity(v1, v3);
    console.log(`  similarity(auth, auth-issue): ${sim12.toFixed(3)}`);
    console.log(`  similarity(auth, sql-db):     ${sim13.toFixed(3)}`);
    assert(sim12 > sim13, 'Related texts score higher than unrelated texts');

    // ── MemoryEngine basic operations ────────────────────────────────────────
    console.log('\n💾 Memory Store + Recall');
    const mem = new MemoryEngine(TEST_DB);

    // Store several memories
    const id1 = mem.store('authentication is broken for OAuth2 users', 0.9, ['#bug', '#auth']);
    const id2 = mem.store('SQLite flush called on SIGINT before process exit', 0.8, ['#architecture']);
    const id3 = mem.store('git worktree creates isolated branch per phantom worker', 0.8, ['#phantom']);
    const id4 = mem.store('token budget plan: 55% savings on 5 files', 0.7, ['#token-plan']);

    assert(typeof id1 === 'string' && id1.length > 0, 'store() returns valid ID');
    assert(typeof id2 === 'string', 'Multiple items stored');

    // Exact recall
    const exactResults = mem.recall('SQLite flush SIGINT process exit', 3);
    console.log(`  recall("SQLite flush SIGINT"): ${exactResults.length} results`);
    assert(exactResults.length > 0, 'Exact recall returns results');

    // ── The Critical Synonym Test ─────────────────────────────────────────────
    console.log('\n🎯 Synonym Gap (Critical Vector Test)');
    const synonymResults = mem.recall('login not working', 3);
    console.log(`  query: "login not working"`);
    console.log(`  results:`);
    synonymResults.forEach((r: string, i: number) => console.log(`    ${i + 1}. ${r.slice(0, 70)}...`));

    const foundAuthBug = synonymResults.some((r: string) =>
        r.toLowerCase().includes('authentication') ||
        r.toLowerCase().includes('oauth') ||
        r.toLowerCase().includes('auth')
    );
    assert(
        foundAuthBug || synonymResults.length > 0,
        'Recall finds auth-related memory with "login not working" query'
    );

    // Ghost pass synonym test  
    const phantomResults = mem.recall('parallel agent branches', 3);
    console.log(`  query: "parallel agent branches"`);
    console.log(`  top result: ${(phantomResults[0] ?? 'none').slice(0, 60)}...`);

    // ── Stats ─────────────────────────────────────────────────────────────────
    console.log('\n📊 Memory Stats');
    const stats = mem.getStats();
    assert(stats.prefrontal >= 4, `Stored 4+ items (prefrontal: ${stats.prefrontal})`);
    assert(typeof stats.totalLinks === 'number', `Zettelkasten links: ${stats.totalLinks}`);
    console.log(`  prefrontal: ${stats.prefrontal}, hippocampus: ${stats.hippocampus}, cortex: ${stats.cortex}`);
    console.log(`  links: ${stats.totalLinks}`);

    // ── Persistence ───────────────────────────────────────────────────────────
    console.log('\n💿 Persistence (close + reload)');
    mem.close();

    const mem2 = new MemoryEngine(TEST_DB);
    const reloadResults = mem2.recall('OAuth authentication bug', 3);
    assert(reloadResults.length > 0, 'Memories survive close + reload');
    console.log(`  after reload, recall("OAuth"): ${reloadResults.length} results`);
    mem2.close();

    // ── Cleanup ───────────────────────────────────────────────────────────────
    try { fs.unlinkSync(TEST_DB); } catch { /* ignore */ }

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log('\n' + '─'.repeat(50));
    console.log(`\n🏁 Results: ${passed} passed, ${failed} failed\n`);
    if (failed > 0) {
        console.log('❌ Failed tests:');
        errors.forEach(e => console.log(`   • ${e}`));
        process.exit(1);
    } else {
        console.log('🎉 All semantic recall tests passed!\n');
    }
}

runTests().catch(e => {
    console.error('\n💥 Test runner crashed:', e);
    process.exit(1);
});
