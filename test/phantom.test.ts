/**
 * Phantom Workers — End-to-End Integration Test
 *
 * Tests the full pipeline:
 *   GhostPass (analysis) → PhantomWorker × 2 (git worktrees) → MergeOracle (consensus)
 *
 * Requirements:
 *   - Must be run inside a git repository
 *   - Requires git >= 2.5 (worktree support)
 *   - No leftover worktrees after test completes
 */

import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// ---- helpers ----------------------------------------------------------------

function setupFixtureRepo(): string {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-prime-phantom-'));
    fs.mkdirSync(path.join(repoRoot, 'src', 'phantom'), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, 'src', 'engines'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, 'src', 'phantom', 'index.ts'), 'export const phantom = true;\n', 'utf8');
    fs.writeFileSync(path.join(repoRoot, 'src', 'engines', 'memory.ts'), 'export const memory = true;\n', 'utf8');
    fs.writeFileSync(path.join(repoRoot, 'README.md'), '# Phantom Fixture\n', 'utf8');

    execSync('git init -b main', { cwd: repoRoot, stdio: 'ignore' });
    execSync('git config user.name "Nexus Prime Phantom Test"', { cwd: repoRoot, stdio: 'ignore' });
    execSync('git config user.email "nexus-prime-phantom@test.local"', { cwd: repoRoot, stdio: 'ignore' });
    execSync('git add .', { cwd: repoRoot, stdio: 'ignore' });
    execSync('git commit -m "fixture"', { cwd: repoRoot, stdio: 'ignore' });

    return repoRoot;
}

/** Check git is available and repo exists */
function isGitRepo(dir: string): boolean {
    try {
        execSync('git rev-parse --git-dir', { cwd: dir, stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

/** Get current git branch */
function currentBranch(dir: string): string {
    return execSync('git branch --show-current', { cwd: dir }).toString().trim();
}

// ---- mock memory engine (standalone, no SQLite needed for test) ---------------

class MockMemoryEngine {
    private items: Array<{ id: string; content: string; priority: number; tags: string[] }> = [];

    store(content: string, priority: number = 0.7, tags: string[] = []): string {
        const id = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        this.items.push({ id, content, priority, tags });
        return id;
    }

    recall(query: string, k: number = 5): string[] {
        const qWords = query.toLowerCase().split(/\s+/);
        return this.items
            .map(item => ({
                item,
                score: qWords.filter(w => item.content.toLowerCase().includes(w)).length
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, k)
            .map(r => r.item.content);
    }

    getStats() {
        return {
            prefrontal: this.items.length,
            hippocampus: 0,
            cortex: 0,
            totalLinks: 0,
            topTags: [],
            oldestEntry: null
        };
    }

    flush(): void { /* no-op for test */ }
    load(): void { /* no-op for test */ }
    close(): void { /* no-op for test */ }
}

// ---- test suite -------------------------------------------------------------

async function runTests() {
    console.log('\n🧪 Phantom Workers — End-to-End Integration Tests\n');
    const REPO_ROOT = setupFixtureRepo();
    process.env.NEXUS_POD_PATH = path.join(REPO_ROOT, '.nexus-prime-pod.json');
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

    // ── Environment checks ───────────────────────────────────────────────────
    console.log('📋 Environment');
    const gitAvailable = isGitRepo(REPO_ROOT);
    assert(gitAvailable, 'Is a git repository');

    if (!gitAvailable) {
        console.log('\n  ⚠️  Skipping git-dependent tests (not a git repo)\n');
        console.log(`  Passed: ${passed}  Failed: ${failed}\n`);
        return;
    }

    const branch = currentBranch(REPO_ROOT);
    console.log(`  🌿 Current branch: ${branch}`);

    // ── Import phantom workers ───────────────────────────────────────────────
    console.log('\n📦 Imports');
    let GhostPass: any, PhantomWorker: any, MergeOracle: any;
    try {
        const phantom = await import('../dist/phantom/index.js');
        GhostPass = phantom.GhostPass;
        PhantomWorker = phantom.PhantomWorker;
        MergeOracle = phantom.MergeOracle;
        assert(true, 'phantom/index.ts imports cleanly');
    } catch (e: any) {
        assert(false, 'phantom/index.ts imports cleanly', e.message);
        console.log('\n  ⚠️  Cannot continue without phantom imports\n');
        return;
    }

    // ── Ghost Pass ───────────────────────────────────────────────────────────
    console.log('\n👻 GhostPass (read-only analysis)');
    const ghost = new GhostPass(REPO_ROOT);

    const testFiles = [
        { path: path.join(REPO_ROOT, 'src/phantom/index.ts'), sizeBytes: 19000 },
        { path: path.join(REPO_ROOT, 'src/engines/memory.ts'), sizeBytes: 5000 },
    ];

    const ghostReport = await ghost.analyze('add getWorktreeList helper to phantom agents', testFiles);

    assert(typeof ghostReport.taskId === 'string' && ghostReport.taskId.length > 0, 'GhostPass returns taskId');
    assert(ghostReport.workerAssignments.length > 0, 'GhostPass generates worker assignments');
    assert(ghostReport.readingPlan !== undefined, 'GhostPass produces a reading plan');
    assert(ghostReport.totalEstimatedTokens > 0, 'GhostPass estimates token cost');
    console.log(`  📊 Risk areas: ${ghostReport.riskAreas.join(', ') || 'none'}`);
    console.log(`  🔀 Worker approaches: ${ghostReport.workerAssignments.map((w: any) => w.approach).join(', ')}`);

    // ── PhantomWorker (single, with test executor) ───────────────────────────
    console.log('\n⚡ PhantomWorker (git worktree isolation)');

    // Pre-cleanup: remove any orphaned phantom branches from previous runs
    const orphans = await PhantomWorker.purgeOrphanedWorktrees(REPO_ROOT);
    if (orphans > 0) {
        console.log(`  🧹 Cleaned ${orphans} orphaned worktrees from previous runs`);
    }

    const worktreesBefore = await PhantomWorker.getWorktreeList(REPO_ROOT);
    assert(worktreesBefore.length === 0, 'No phantom worktrees before test');

    // Test executor: writes a small PHANTOM_TEST.md file in the worktree
    const testExecutor = async (worktreeDir: string, task: any) => {
        const testFile = path.join(worktreeDir, 'PHANTOM_TEST.md');
        fs.writeFileSync(testFile, `# Phantom Test\n\nTask: ${task.goal}\nApproach: ${task.approach}\nTimestamp: ${Date.now()}\n`);
        return {
            learnings: [`Wrote test file at ${testFile}`, `Approach was: ${task.approach}`],
            confidence: task.approach === 'minimal' ? 0.6 : 0.85
        };
    };

    // Spawn two workers in parallel
    const task1 = {
        id: 'test-task-001',
        goal: 'improve phantom worker cleanup reliability',
        files: testFiles,
        approach: 'minimal',
        tokenBudget: 5000,
        context: 'Test context from mock memory'
    };

    const task2 = {
        id: 'test-task-002',
        goal: 'improve phantom worker cleanup reliability',
        files: testFiles,
        approach: 'standard',
        tokenBudget: 8000,
        context: 'Test context from mock memory'
    };

    let result1: any, result2: any;
    try {
        [result1, result2] = await Promise.all([
            new PhantomWorker(REPO_ROOT).spawn(task1, testExecutor),
            new PhantomWorker(REPO_ROOT).spawn(task2, testExecutor),
        ]);
        assert(true, 'Both workers spawned and ran in parallel');
    } catch (e: any) {
        assert(false, 'Both workers spawned and ran in parallel', e.message);
        console.log('  ⚠️  Worker spawn failed — checking worktrees post-failure:');
        const leftovers = await PhantomWorker.getWorktreeList(REPO_ROOT);
        console.log(`  Leftovers: ${leftovers.length}`);
        await PhantomWorker.purgeOrphanedWorktrees(REPO_ROOT);
        return;
    }

    assert(result1.workerId !== result2.workerId, 'Workers have unique IDs');
    assert(['success', 'partial', 'failed'].includes(result1.outcome), `Worker 1 outcome valid (${result1.outcome})`);
    assert(['success', 'partial', 'failed'].includes(result2.outcome), `Worker 2 outcome valid (${result2.outcome})`);
    console.log(`  Worker 1: ${result1.outcome} (confidence: ${result1.confidence.toFixed(2)}, tokens: ${result1.tokensUsed})`);
    console.log(`  Worker 2: ${result2.outcome} (confidence: ${result2.confidence.toFixed(2)}, tokens: ${result2.tokensUsed})`);

    // Verify cleanup
    const worktreesAfter = await PhantomWorker.getWorktreeList(REPO_ROOT);
    assert(worktreesAfter.length === 0, 'All worktrees cleaned up after workers complete');

    // ── MergeOracle ──────────────────────────────────────────────────────────
    console.log('\n🔮 MergeOracle (Byzantine consensus)');

    const memory = new MockMemoryEngine() as any;
    const oracle = new MergeOracle(memory);

    // Test with both successful results
    const decision = await oracle.merge([result1, result2]);

    assert(typeof decision.action === 'string', `Oracle produces a decision (action: ${decision.action})`);
    assert(['apply', 'synthesize', 'reject'].includes(decision.action), `Decision action is valid: ${decision.action}`);
    assert(typeof decision.confidence === 'number', `Decision has confidence score: ${decision.confidence.toFixed(2)}`);
    assert(Array.isArray(decision.learnings), 'Decision includes learnings list');
    console.log(`  📋 Decision: ${decision.action} (confidence: ${decision.confidence.toFixed(2)})`);
    console.log(`  📝 Rationale: ${decision.rationale}`);
    if (decision.learnings.length > 0) {
        console.log(`  💡 Learnings: ${decision.learnings.slice(0, 2).join(' | ')}`);
    }

    // Test with empty results (should reject)
    const emptyDecision = await oracle.merge([]);
    assert(emptyDecision.action === 'reject', 'Empty worker list → reject decision');

    // Test with single worker (should still work)
    const singleDecision = await oracle.merge([result1]);
    assert(singleDecision.action !== undefined, 'Single worker → valid decision');

    // ── Memory integration ───────────────────────────────────────────────────
    console.log('\n🧠 Memory integration');
    const storedCount = memory.items?.length ?? 0;
    assert(storedCount > 0, `Oracle stored ${storedCount} learnings in memory`);

    // ── Summary ──────────────────────────────────────────────────────────────
    console.log('\n' + '─'.repeat(50));
    console.log(`\n🏁 Results: ${passed} passed, ${failed} failed\n`);

    if (failed > 0) {
        console.log('❌ Failed tests:');
        errors.forEach(e => console.log(`   • ${e}`));
        process.exit(1);
    } else {
        console.log('🎉 All Phantom Worker tests passed!\n');
    }
}

runTests().catch(e => {
    console.error('\n💥 Test runner crashed:', e);
    process.exit(1);
});
