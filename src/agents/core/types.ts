/**
 * Core types for Nexus Prime
 */

export interface WavePattern {
  amplitude: number;  // 0-1, importance
  phase: number;     // -π to π, context
  frequency: number; // Hz, urgency
  wavelength: number; // tokens, depth
}

export interface Pattern {
  id: string;
  structure: number[]; // Embedding vector
  weight: number;     // Learned importance
  confidence: number; // How certain
  origin: string;    // Agent who discovered
  timestamp: number;
  examples: string[];
}

export interface Agent {
  id: string;
  type: AgentType;
  capabilities: string[];
  memory: AgentMemory;
  attention: number;
  state: AgentState;
}

export type AgentType =
  | 'researcher'
  | 'coder'
  | 'reviewer'
  | 'tester'
  | 'architect'
  | 'planner'
  | 'executor'
  | 'general';

export interface AgentState {
  current: string;
  history: string[];
}

export interface AgentMemory {
  cortex: CortexMemory;    // Long-term
  hippocampus: HippocampusMemory; // Medium
  prefrontal: PrefrontalMemory;  // Working
}

export interface CortexMemory {
  patterns: Map<string, Pattern>;
  synapses: Map<string, number>; // pattern_id -> weight
  semanticGraph: SemanticGraph;
}

export interface SemanticGraph {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge[]>;
}

export interface GraphNode {
  id: string;
  type: 'pattern' | 'agent' | 'concept';
  embedding: number[];
  metadata: Record<string, unknown>;
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
  type: string;
}

export interface HippocampusMemory {
  recentPatterns: Pattern[];
  window: number; // hours
  bindings: Map<string, string>; // temporary associations
}

export interface PrefrontalMemory {
  activeContext: string[]; // Current task context
  maxItems: number; // ~7 (Miller's Law)
}

export interface Intent {
  type: 'goal' | 'question' | 'action' | 'learn';
  target: string;
  urgency: number;
  valueEstimate: number;
}

export interface Experience {
  agentId: string;
  action: string;
  outcome: string;
  value: number;
  timestamp: number;
}

export interface NetworkMessage {
  id: string;
  sender: string;
  receiver?: string;
  type: 'wave' | 'pattern' | 'intent' | 'control';
  payload: WavePattern | Pattern | Intent | ControlMessage;
  timestamp: number;
}

export interface ControlMessage {
  action: 'join' | 'leave' | 'sync' | 'fission';
  data?: unknown;
}

export interface EvolutionPolicy {
  mutationRate: number;
  selectionPressure: number;
  coherenceThreshold: number;
  diversityWeight: number;
}

export interface GrammarRule {
  id: string;
  pattern: string[];
  weight: number;
  adoptionRate: number;
  confidence: number;
}

export interface ConsensusState {
  type: 'raft' | 'bft' | 'gossip' | 'crdt';
  leader?: string;
  term: number;
  nodes: Map<string, NodeState>;
}

export interface NodeState {
  id: string;
  status: 'active' | 'failed' | 'suspected';
  lastSeen: number;
  votes?: number;
}

export interface NexusConfig {
  network: NetworkConfig;
  memory: MemoryConfig;
  evolution: EvolutionConfig;
  adapters: string[];
}

export interface NetworkConfig {
  port: number;
  peers: string[];
  consensus: 'raft' | 'bft' | 'gossip' | 'crdt';
}

export interface MemoryConfig {
  cortex: {
    enabled: boolean;
    storage: 'sqlite' | 'postgresql';
    vector: 'hnsw' | 'flat';
  };
  hippocampus: {
    window: string;
    consolidation: string;
  };
  prefrontal: {
    items: number;
  };
}

export interface EvolutionConfig {
  mutationRate: number;
  selectionPressure: number;
  coherenceThreshold: number;
}

export interface Adapter {
  name: string;
  type: 'openclaw' | 'claude-code' | 'ruflo' | 'langchain' | 'autogen' | 'custom' | 'mcp' | 'codex' | 'opencode' | 'cursor' | 'windsurf';
  connected: boolean;
  agents: string[];
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(message: NetworkMessage): Promise<void>;
  receive(message: NetworkMessage): void;
}
