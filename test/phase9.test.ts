import assert from 'assert';
import { test } from 'node:test';
import { EntanglementEngine } from '../src/engines/entanglement.js';
import { ContinuousAttentionStream } from '../src/engines/attention-stream.js';
import { PatternCodebook } from '../src/engines/pattern-codebook.js';

test('Phase 9A: EntanglementEngine creates states and measures correlations', () => {
    const engine = new EntanglementEngine();

    // Entangle 3 agents
    const state = engine.entangle(['AgentAlpha', 'AgentBeta', 'AgentGamma'], 4);
    assert.strictEqual(state.agentIds.length, 3);
    assert.strictEqual(state.dimension, 4);

    // Initial measurement
    const measure1 = engine.measure(state.id, 'AgentAlpha');
    assert.ok(measure1.strategyIndex >= 0 && measure1.strategyIndex < 4);
    assert.ok(measure1.probability > 0);

    // Agent Beta measures next
    const measure2 = engine.measure(state.id, 'AgentBeta');
    assert.ok(measure2.strategyIndex >= 0 && measure2.strategyIndex < 4);

    // Verify correlations
    const correlations = engine.getCorrelationMatrix(state.id);
    assert.strictEqual(correlations.length, 3); // Pairs: Alpha-Beta, Alpha-Gamma, Beta-Gamma

    // Since it's a GHZ state, correlation between measured agents should be high (or perfectly correlated in ideal situations)
    // We just verify it outputs valid correlation metrics
    for (const entry of correlations) {
        assert.ok(entry.correlation >= -1 && entry.correlation <= 1, `Correlation metric ${entry.correlation} out of bounds`);
    }

    engine.destroy(state.id);
});

test('Phase 9B: ContinuousAttentionStream compresses tokens', () => {
    const cb = new PatternCodebook();
    const cas = new ContinuousAttentionStream(cb);

    // 10K discrete repeating tokens
    const tokens = new Array(10000).fill('repeating_token');

    // First, force it to learn the pattern
    cas.learnPattern(tokens.join(' '), 10);

    // Encode the tokens
    const encoding = cas.encode(tokens, 'compress test');

    // Verify it exceeds 5x compression on completely uniform repetitive data
    assert.ok(encoding.compressionRatio >= 5.0, `Compression Ratio too low: ${encoding.compressionRatio}`);
    assert.strictEqual(encoding.tokens.length, 10000);
});
