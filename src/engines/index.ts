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
export { KnowledgeFabricEngine } from './knowledge-fabric.js';
export type {
  ContextProvenanceTrace,
  KnowledgeFabricBundle,
  KnowledgeFabricSnapshot,
  ModelTierPolicy,
  ModelTierTrace,
  SourceMixDecision,
  TokenBudgetAllocation,
} from './knowledge-fabric.js';
export { RagCollectionStore } from './rag-collections.js';
export type {
  RagCollection,
  RagCollectionSummary,
  RagRetrievalHit,
} from './rag-collections.js';
export { PatternRegistry } from './pattern-registry.js';
export type {
  PatternCard,
  PatternSearchResult,
} from './pattern-registry.js';
export {
  InstructionGateway,
  DEFAULT_REQUIRED_SEQUENCE,
  createExecutionLedger,
  markExecutionLedgerStep,
  renderInstructionPacketMarkdown,
  PACKET_TOKEN_LIMIT,
} from './instruction-gateway.js';
export type {
  ClientInstructionEnvelope,
  ExecutionLedger,
  ExecutionLedgerStep,
  ExecutionLedgerStepId,
  GovernanceSnapshot,
  InstructionPacket,
  OrchestrationExecutionMode,
  PacketCompileInput,
  TokenPolicySnapshot,
} from './instruction-gateway.js';

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
export type { AgentArchetype, SwarmConfig, NXLExecutionSpec } from './nxl-interpreter.js';

export {
  createRuntimeBackendRegistry,
  normalizeReadingPlan,
  createSQLiteMemoryBackend,
  createDeterministicCompressionBackend,
  createDeterministicDSLCompilerBackend,
  buildRunId
} from './runtime-backends.js';
export type {
  BackendDescriptor,
  BackendMode,
  MemoryBackend,
  CompressionBackend,
  CompressionPlanResult,
  CompressionShadow,
  DSLExecutionSpec,
  DSLCompilationResult,
  DSLCompilerBackend,
  RuntimeBackendRegistry
} from './runtime-backends.js';

export { SkillRuntime, createSkillRuntime } from './skill-runtime.js';
export type {
  SkillArtifact,
  SkillBinding,
  SkillBindingType,
  SkillCheckpoint,
  SkillDeploymentRecord,
  SkillRiskClass,
  SkillRuntimeMetrics,
  SkillScope,
  SkillValidationResult
} from './skill-runtime.js';

export { WorkflowRuntime, createWorkflowRuntime } from './workflow-runtime.js';
export type {
  WorkflowArtifact,
  WorkflowDeploymentRecord,
  WorkflowRuntimeMetrics,
  WorkflowStep
} from './workflow-runtime.js';

export type {
  RuntimeBinding,
  RuntimeBindingType
} from './runtime-assets.js';
