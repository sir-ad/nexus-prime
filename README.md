# Nexus Prime

> Distributed Agent Orchestration Framework

**Version:** 0.2.0 (Enhanced)  
**License:** MIT  
**Status:** Alpha

---

## Overview

Nexus Prime is a distributed agent orchestration framework with integrated engines for token optimization, context management, memory, and orchestration.

## Features

### Core Features

- **Multi-Agent Coordination**: Peer-to-peer, hierarchical, ring, and star topologies
- **Consensus Protocols**: Raft, Byzantine Fault Tolerant, Gossip, CRDT
- **Three-Tier Memory**: Prefrontal, Hippocampus, Cortex

### Enhanced Engines (v0.2.0)

| Engine | Purpose |
|--------|---------|
| **Token Optimizer** | Adaptive compression (3x-8x), complexity assessment |
| **Context Engine** | Working context, auto-compression, retrieval |
| **Memory Engine** | Priority-based storage, tag grouping, recall |
| **Orchestrator** | Task decomposition, agent spawning, consensus |

## Installation

```bash
npm install nexus-prime
```

## Quick Start

```typescript
import { createNexusPrime } from 'nexus-prime';

const nexus = createNexusPrime({
  adapters: ['openclaw'],
  network: { consensus: 'raft' }
});

await nexus.start();

// Use enhanced engines
const tokenPlan = nexus.optimizeTokens("build a website");
nexus.addContext("User wants an e-commerce site");
nexus.storeMemory("Previous project details", 0.8, ['project']);
const relevant = nexus.recallMemory("e-commerce");

// Or orchestrate complex tasks
const result = await nexus.orchestrate("Research X, then build Y");
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        NEXUS PRIME                              │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              Token Optimizer Engine                        │  │
│  │  • Complexity assessment  • Adaptive compression        │  │
│  │  • Strategy selection      • Quality tracking            │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              Context Engine                                 │  │
│  │  • Working context       • Auto-compression              │  │
│  │  • Similarity retrieval  • Token management              │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              Memory Engine                                 │  │
│  │  • Three-tier memory      • Priority storage             │  │
│  │  • Tag grouping          • Similarity recall             │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              Orchestrator Engine                            │  │
│  │  • Task decomposition    • Agent spawning                │  │
│  │  • Consensus checking    • Result aggregation            │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## API

### Token Optimizer

```typescript
nexus.optimizeTokens(task: string): {
  tokens: number;
  ratio: number;
  strategy: string;
}
```

### Context Engine

```typescript
nexus.addContext(content: string): void
nexus.getContext(query: string): string[]
```

### Memory Engine

```typescript
nexus.storeMemory(content: string, priority: number, tags: string[]): void
nexus.recallMemory(query: string, k: number): string[]
nexus.getMemoryStats(): { prefrontal, hippocampus, cortex }
```

### Orchestrator

```typescript
nexus.orchestrate(task: string): Promise<{
  result: string;
  agents: Agent[];
  consensus: boolean;
}>
```

## CLI

```bash
nexus-prime start
nexus-prime agents spawn researcher --task "Research AI"
nexus-prime status
```

## Development

```bash
npm install
npm run build
npm test
```

## License

MIT
