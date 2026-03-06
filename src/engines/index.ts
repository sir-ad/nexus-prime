/**
 * Nexus Prime Engines
 * 
 * All core engines for the Nexus Prime system.
 */

export { TokenSupremacyEngine as TokenOptimizer, createTokenSupremacyEngine as createTokenOptimizer } from './token-supremacy.js';
export { SLERPCompressor, createSLERPCompressor } from './token-optimizer.js';
export { ContextEngine, createContextEngine } from './context.js';

export { MemoryEngine, createMemoryEngine } from './memory.js';
export type { MemoryItem } from './memory.js';

export { OrchestratorEngine, createOrchestrator } from './orchestrator.js';
export type { Agent, AgentType, Task } from './orchestrator.js';

export { CacheManager, createCacheManager } from './cache-manager.js';
export type { CacheEntry, AgentDelta } from './cache-manager.js';

export {
  MetaLearner,
  AdaptiveInterpolator,
  TokenRetention,
  createMetaLearner,
  createAdaptiveInterpolator,
  createTokenRetention
} from './meta-learner.js';
export type { CompressionFeatures } from './meta-learner.js';

export {
  BenchmarkSuite,
  createBenchmarkSuite,
  EXPECTED_RESULTS
} from './benchmark.js';
export type { BenchmarkResult } from './benchmark.js';

// Phase 9A: Quantum-Inspired Entanglement
export { EntanglementEngine, entanglementEngine } from './entanglement.js';
export type { EntangledState, MeasurementResult, CorrelationEntry } from './entanglement.js';

// Phase 9B: Continuous Attention Streams
export { PatternCodebook } from './pattern-codebook.js';
export { ContinuousAttentionStream } from './attention-stream.js';
export type { AttentionFluid, CASStats } from './attention-stream.js';

// Phase 9C: AdaptiveKVMerge Bridge
export { ByzantineConsensus } from './byzantine-consensus.js';
export type { ConsensusProposal, ConsensusResult } from './byzantine-consensus.js';
export { KVBridge, createKVBridge } from './kv-bridge.js';
export type { KVBridgeConfig, MergeDecision, BridgeMetrics } from './kv-bridge.js';
// Phase 10: Nexus Layer & NXL
export { NXLInterpreter, nxl } from './nxl-interpreter.js';
export type { AgentArchetype, SwarmConfig } from './nxl-interpreter.js';
