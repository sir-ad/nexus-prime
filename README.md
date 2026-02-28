# Nexus Prime

> Distributed Agent Orchestration Framework

**Version:** 0.1.0  
**License:** MIT  
**Status:** Alpha

---

## Overview

Nexus Prime is a distributed agent orchestration framework designed for building scalable, self-organizing multi-agent systems. It provides a unified layer for coordinating agents across different platforms, with built-in support for swarm topologies, consensus protocols, and adaptive resource allocation.

## Features

### Multi-Agent Coordination

- **Swarm Topologies**: Peer-to-peer, hierarchical, ring, and star configurations
- **Consensus Protocols**: Raft, Byzantine Fault Tolerant (BFT), Gossip, and CRDT support
- **Dynamic Scaling**: Add or remove agents without system disruption

### Memory System

- **Three-Tier Architecture**: Working, episodic, and semantic memory layers
- **Vector Storage**: HNSW-based similarity search for fast retrieval
- **Persistent Storage**: SQLite and PostgreSQL backends

### Optimization

- **Token Economics**: Intelligent token allocation based on task complexity
- **Context Management**: Efficient context window utilization
- **Cost Routing**: Automatically routes to most cost-effective handler

### Integration

- **Unified Adapters**: OpenClaw, Claude Code, Ruflo, and custom platforms
- **Extensible**: Plugin architecture for new adapters and capabilities

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        NEXUS PRIME                              │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              Coordination Layer                              │  │
│  │  • Swarm Management  • Consensus  • Message Routing        │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              Memory Layer                                   │  │
│  │  • Working  • Episodic  • Semantic                        │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              Optimization Layer                             │  │
│  │  • Token Allocation  • Context  • Cost Routing            │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              Adapter Layer                                  │  │
│  │  • OpenClaw  • Claude Code  • Ruflo  • Custom            │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Installation

```bash
npm install nexus-prime
```

## Quick Start

```typescript
import { createNexusPrime } from 'nexus-prime';

const nexus = createNexusPrime({
  adapters: ['openclaw', 'claude-code'],
  network: {
    consensus: 'raft'
  }
});

await nexus.start();

// Create agents
const researcher = await nexus.createAgent('researcher');
const coder = await nexus.createAgent('coder');

// Execute tasks
const result = await nexus.execute(researcher.id, 'Research distributed systems');
```

## CLI Usage

```bash
# Start the daemon
nexus-prime start

# Create an agent
nexus-prime agents spawn researcher --task "Research AI"

# Check status
nexus-prime status
```

## Configuration

```typescript
const nexus = createNexusPrime({
  network: {
    port: 3000,
    consensus: 'raft' // raft | bft | gossip | crdt
  },
  memory: {
    cortex: {
      enabled: true,
      storage: 'sqlite',
      vector: 'hnsw'
    },
    hippocampus: {
      window: '48h'
    },
    prefrontal: {
      items: 7
    }
  },
  adapters: ['openclaw', 'claude-code']
});
```

## Supported Agents

| Type | Capabilities |
|------|--------------|
| `researcher` | search, read, summarize, hypothesize |
| `coder` | write, edit, refactor, debug |
| `reviewer` | analyze, critique, suggest |
| `tester` | test, validate, verify |
| `architect` | design, plan, evaluate |
| `planner` | plan, schedule, coordinate |
| `executor` | run, execute, deploy |

## Consensus Protocols

- **Raft**: Leader-based, simple deployments
- **BFT**: Byzantine fault tolerance, adversarial environments
- **Gossip**: Epidemic propagation, eventual consistency
- **CRDT**: Conflict-free, highly available

## Swarm Topologies

```typescript
// Hierarchical (default)
coordinator.setTopology('hierarchical');

// Peer-to-peer mesh
coordinator.setTopology('peer');

// Ring passing
coordinator.setTopology('ring');

// Star hub-and-spoke
coordinator.setTopology('star');
```

## API

### NexusPrime

```typescript
class NexusPrime {
  start(): Promise<void>
  stop(): Promise<void>
  createAgent(type: AgentType, options?: AgentOptions): Promise<Agent>
  execute(agentId: string, task: string): Promise<ExecutionResult>
  coordinate(task: string, agentIds?: string[]): Promise<CoordinationResult>
  achieveConsensus(proposal: string, agentIds?: string[]): Promise<ConsensusResult>
  recall(agentId: string, query: number[]): Pattern[]
  searchMemory(query: string): string[]
}
```

## Development

```bash
# Clone
git clone https://github.com/sir-ad/nexus-prime.git
cd nexus-prime

# Install
npm install

# Build
npm run build

# Test
npm test
```

## Roadmap

- [ ] v0.2: Enhanced consensus protocols
- [ ] v0.3: Learning and adaptation layer
- [ ] v1.0: Production release

## License

MIT

---

Built with ⚡ by [sir-ad](https://github.com/sir-ad)
