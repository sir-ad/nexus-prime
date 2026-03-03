# 🧬 Nexus Prime

**The AI meta-framework that makes agents smarter about themselves.**

Nexus Prime is an MCP server that gives AI coding agents cross-session memory, token optimization, parallel sub-agent orchestration, and machine-checked guardrails — running as a background process that any agent can call as native tools.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://typescriptlang.org)
[![npm](https://img.shields.io/npm/v/nexus-prime)](https://www.npmjs.com/package/nexus-prime)

---

## The Super Intellect Stack

Nexus Prime is the **runtime layer** in a 4-project ecosystem:

```
┌─────────────────────────────────────────────────┐
│  Phantom (PM)                                    │
│  "What to build" — PRDs, releases, docs         │
│  github.com/sir-ad/phantom                      │
├─────────────────────────────────────────────────┤
│  MindKit (Skills)                                │
│  "How to think" — 22 skills, guardrails, routing │
│  github.com/sir-ad/mindkit                      │
├─────────────────────────────────────────────────┤
│  Nexus Prime (OS)  ← YOU ARE HERE               │
│  "How to run" — memory, tokens, workers, POD     │
│  github.com/sir-ad/nexus-prime                  │
├─────────────────────────────────────────────────┤
│  Grain (Language)                                │
│  "How to speak" — 10 universal AI primitives     │
│  github.com/sir-ad/grain                        │
└─────────────────────────────────────────────────┘
```

---

## Why?

Every AI coding session starts cold. The agent re-reads the same files, re-discovers the same patterns, makes the same mistakes. Nexus Prime fixes this:

- **Memory persists between sessions** — findings survive restarts
- **Token usage is optimized** — agents read only what they need (50-90% savings)
- **Parallel sub-agents** explore multiple solutions simultaneously via git worktrees
- **Guardrails prevent mistakes** before code is written
- **Self-evolution** — learns from past sessions and adapts

---

## Architecture

```mermaid
flowchart TB
    %% Styling
    classDef client fill:#1e1e1e,stroke:#00ffcc,stroke-width:2px,color:#fff
    classDef adapter fill:#2a2a2a,stroke:#4a90e2,stroke-width:2px,color:#fff
    classDef engine fill:#1e293b,stroke:#a855f7,stroke-width:2px,color:#fff
    classDef subengine fill:#0f172a,stroke:#8b5cf6,stroke-width:1px,color:#cbd5e1
    classDef data fill:#064e3b,stroke:#10b981,stroke-width:2px,color:#fff
    classDef swarm fill:#450a0a,stroke:#ef4444,stroke-width:2px,color:#fff
    classDef external fill:#171717,stroke:#fbbf24,stroke-width:2px,color:#fff

    %% External Actors
    User["AI Coding Agent<br/>e.g., AntiGravity"]:::client

    subgraph "External Ecosystem"
        MindKitRepo["sir-ad/mindkit GitHub Repo"]:::external
        Codebase["Target Git Repository"]:::external
    end

    subgraph "Nexus Prime Meta-Framework (~/.nexus-prime)"
        
        %% Entry Point
        MCP["MCP Adapter (stdio)<br/>Exposes 8 standard tools"]:::adapter

        subgraph "Core Engines"
            direction TB
            
            subgraph "Memory Engine"
                Prefrontal["Prefrontal (RAM)<br/>Active Working Set (Top 7)"]:::subengine
                Hippocampus["Hippocampus (RAM)<br/>Session Context (Top 200)"]:::subengine
                Cortex["Cortex (SQLite)<br/>Long-term Persistence"]:::subengine
            end

            subgraph "Token Supremacy Engine"
                Scoring["Content-Aware Scoring"]:::subengine
                Optimizer["Budget Allocator<br/>(Reads 50-90% less)"]:::subengine
            end

            subgraph "Guardrail Engine (MindKit Sync)"
                Guard1["Token Budget Guard"]:::subengine
                Guard2["Destructive Action Guard"]:::subengine
                Sync["GitHub API Sync<br/>Push Findings to MindKit"]:::subengine
            end

            Embedder["Embedder Engine<br/>TF-IDF 128-dim + API fallback"]:::subengine
            HyperTuning["HyperTuning Engine<br/>Adaptive Budgeting"]:::subengine
            Learner["Agent Learner<br/>Evolution & Hotspot Detection"]:::subengine
        end
        
        %% Phantom Swarm Infrastructure
        subgraph "Phantom Swarm"
            Coordinator["Swarm Coordinator"]:::swarm
            GhostPass["Ghost Pass<br/>Pre-flight Risk Analysis"]:::swarm
            
            subgraph "Parallel Workers (Git Worktrees)"
                W1["Phantom Worker A<br/>Isolated Worktree 1"]:::swarm
                W2["Phantom Worker B<br/>Isolated Worktree 2"]:::swarm
            end

            POD["P.O.D. Network<br/>Worker Comms & Synapses"]:::swarm
            MergeOracle["Merge Oracle<br/>Byzantine Vote & Synthesis"]:::swarm
        end

        %% Data Layer
        DB[("memory.db<br/>(SQLite Database)")]:::data
    end

    %% Data Flow
    User -->|"Calls Tools<br/>e.g. nexus_recall_memory"| MCP
    MCP -->|"Routes Request"| Guard1
    Guard1 -->|"Passes"| MemoryEngine
    Guard1 -->|"Passes"| TokenOptimizer
    
    %% Engine Internal Flow
    Prefrontal <-->|"Promotes/Demotes"| Hippocampus
    Hippocampus <-->|"Persists/Fetches"| Cortex
    Cortex <-->|"Reads/Writes"| DB
    
    MemoryEngine -->|"Vector Search"| Embedder
    TokenOptimizer -->|"Dynamically Adjusts"| HyperTuning

    %% Swarm Flow
    MCP -->|"nexus_spawn_workers"| Coordinator
    Coordinator -->|"1. Reads AST"| GhostPass
    Coordinator -->|"2. Spawns"| W1
    Coordinator -->|"2. Spawns"| W2
    W1 <-->|"Broadcasts Findings"| POD
    W2 <-->|"Broadcasts Findings"| POD
    POD -->|"Aggregates State"| MergeOracle
    MergeOracle -->|"Returns Synthesized Decision"| MCP
    W1 -->|"Modifies"| Codebase
    W2 -->|"Modifies"| Codebase

    %% Guardrails & Evolution
    Sync -->|"Pushes Evolution Candidates"| MindKitRepo
    Learner -->|"Detects Patterns"| Sync
    Cortex -->|"Feeds Historical Data"| Learner
    
    %% Layout constraints
    TokenOptimizer ~~~ GuardrailEngine
    PhantomSwarm ~~~ CoreEngines
```

---

## Quick Start

```bash
# Install from npm
npm install -g nexus-prime

# Or clone and build
git clone https://github.com/sir-ad/nexus-prime
cd nexus-prime
npm install
npm run build
```

### Wire into your AI agent

Add to your MCP config (AntiGravity, Claude Desktop, etc.):

```json
{
  "mcpServers": {
    "nexus-prime": {
      "command": "node",
      "args": ["/path/to/nexus-prime/dist/cli.js", "mcp"]
    }
  }
}
```

---

## The 8 MCP Tools

### Memory

| Tool | When | What |
|------|------|------|
| `nexus_store_memory` | After discoveries | Store findings, bugs, decisions. Priority 0-1. |
| `nexus_recall_memory` | Session start + mid-session | Semantic recall. Top-k memories matching query. |
| `nexus_memory_stats` | Session start | Tier counts, top tags, Zettelkasten link stats. |

### Intelligence

| Tool | When | What |
|------|------|------|
| `nexus_optimize_tokens` | Before reading 3+ files | Pre-flight reading plan. 50-90% token savings. |
| `nexus_ghost_pass` | Before modifying 3+ files | Risk analysis + worker approach suggestions. |
| `nexus_mindkit_check` | Before destructive ops | Guardrail check. PASS/FAIL with score 0-100. |

### Parallel Work

| Tool | When | What |
|------|------|------|
| `nexus_spawn_workers` | Complex multi-file refactors | Phantom Workers in isolated git worktrees. |
| `nexus_audit_evolution` | Sprint boundaries / post-bug | Find recurring patterns, file hotspots. |

---

## Memory System

Three-tier architecture modelled on human memory:

| Tier | Size | Backed by | Purpose |
|------|------|-----------|---------:|
| **Prefrontal** | 7 items | RAM | Active working set |
| **Hippocampus** | 200 items | RAM | Recent session context |
| **Cortex** | Unlimited | SQLite | Long-term persistence |

**Recall** uses hybrid scoring: TF-IDF vectors (128-dim) + priority + recency + access count.

---

## Phantom Workers

Parallel sub-agent framework using real git worktrees:

```
GhostPass (read-only analysis)
  → N PhantomWorkers (parallel, isolated git worktrees)
    → POD Network (asynchronous learning exchange)
      → MergeOracle (Byzantine vote, confidence-weighted merge)
```

Each worker gets an isolated copy of the repo. Workers broadcast findings via the **POD Network**. The `MergeOracle` evaluates outcomes by confidence score.

---

## Session Telemetry

Every MCP response includes a telemetry footer:

```
─── 📡 Nexus Prime (12s) ───
3 calls │ 20.3k tokens saved │ 2 stored │ 5 recalled │ 59 Zettel links
```

---

## Guardrails (MindKit)

6 machine-checked rules + external rules synced from [MindKit](https://github.com/sir-ad/mindkit):

| Rule | Trigger | Action |
|------|---------|--------|
| `TOKEN_BUDGET` | Context > 100k tokens | 🚫 Block |
| `TOKEN_WARN` | Context > 70k tokens | ⚠️ Warn |
| `DESTRUCTIVE_GUARD` | `isDestructive: true` | 🚫 Block |
| `BULK_FILE_GUARD` | > 10 files modified | ⚠️ Warn |
| `NO_PROD_WRITES` | `/etc`, `/usr`, `/bin` | 🚫 Block |
| `MEMORY_FIRST` | "research" / "look up" | ℹ️ Remind |

---

## Project Structure

```
nexus-prime/
├── src/
│   ├── index.ts                    # NexusPrime main class
│   ├── cli.ts                      # CLI entry (node dist/cli.js mcp)
│   ├── agents/
│   │   ├── adapters/mcp.ts         # MCP server, 8 tools + telemetry
│   │   ├── coordinator.ts          # Worker dispatch orchestration
│   │   ├── orchestrator.ts         # Context-aware agent runner
│   │   └── learner.ts              # SQL-based evolution detection
│   ├── engines/
│   │   ├── memory.ts               # Three-tier memory + queryByTags
│   │   ├── embedder.ts             # TF-IDF + optional OpenAI embeddings
│   │   ├── token-supremacy.ts      # Content-aware token optimization
│   │   ├── guardrails-bridge.ts    # GuardrailEngine + MindKit sync
│   │   └── meta-learner.ts         # HyperTuning adaptive parameters
│   └── phantom/
│       ├── index.ts                # GhostPass, PhantomWorker, MergeOracle
│       └── phase4-orchestrator.ts  # Self-built phase orchestrator
├── packages/
│   └── mindkit/                    # Standalone npm package
├── test/
│   ├── phantom.test.ts             # E2E Phantom Workers test
│   └── memory.test.ts              # Semantic recall test
├── GEMINI.md                       # Session protocol for AI agents
├── AGENTS.md                       # Agent overview
└── NEXUS.md                        # Language specification
```

---

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `NEXUS_EMBED_MODE` | `local` | `local` (TF-IDF) or `api` (OpenAI-compatible) |
| `NEXUS_EMBED_URL` | — | API endpoint when mode=api |
| `NEXUS_EMBED_KEY` | — | API key when mode=api |
| `NEXUS_EMBED_MODEL` | — | Model name when mode=api |

---

## License

MIT — [sir-ad](https://github.com/sir-ad)
