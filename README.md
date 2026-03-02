# 🧬 Nexus Prime

**The AI meta-framework that makes agents smarter about themselves.**

Nexus Prime is an MCP server that gives AI coding agents cross-session memory, token optimization, parallel sub-agent orchestration, and machine-checked guardrails — running as a background process that any agent can call as native tools.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://typescriptlang.org)

---

## Why?

Every AI coding session starts cold. The agent re-reads the same files, re-discovers the same patterns, makes the same mistakes. Nexus Prime fixes this:

- **Memory persists between sessions** — findings survive restarts
- **Token usage is optimized** — agents read only what they need
- **Parallel sub-agents** explore multiple solutions simultaneously
- **Guardrails prevent mistakes** before code is written

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   AI Agent (Claude / Gemini / GPT)   │
│                                                       │
│  Session Start         During Work          Shutdown  │
│  nexus_recall_memory   nexus_store_memory   store     │
│  nexus_memory_stats    nexus_optimize_tokens summary  │
│  nexus_mindkit_check   nexus_ghost_pass              │
└────────────────────────┬────────────────────────────┘
                         │ MCP (stdio)
┌────────────────────────▼────────────────────────────┐
│                   NEXUS PRIME MCP SERVER             │
│                                                       │
│  MemoryEngine          TokenSupremacyEngine           │
│  ├─ Prefrontal (7)     ├─ FileScorer                  │
│  ├─ Hippocampus (200)  ├─ BudgetAllocator             │
│  └─ Cortex (∞, SQLite) └─ DifferentialContext        │
│                                                       │
│  PhantomWorkers        GuardrailEngine                │
│  ├─ GhostPass          ├─ TokenBudget                 │
│  ├─ PhantomWorker      ├─ DestructiveGuard            │
│  └─ MergeOracle        └─ MemoryFirst                 │
│                                                       │
│  Embedder (TF-IDF 128-dim + optional OpenAI API)     │
└─────────────────────────────────────────────────────┘
         │
         ▼
    ~/.nexus-prime/memory.db  (SQLite, survives restarts)
```

---

## Quick Start

```bash
# Clone and install
git clone https://github.com/sir-ad/nexus-prime
cd nexus-prime
npm install
npm run build

# Start MCP server (connects to your AI agent)
node dist/cli.js mcp
```

### Wire into AntiGravity / Claude Desktop

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

## The 6 MCP Tools

### Memory

```typescript
nexus_store_memory(content: string, priority?: number, tags?: string[])
// Store a finding. priority: 0-1. High-priority items auto-fission to long-term.

nexus_recall_memory(query: string, k?: number)
// Semantic recall. Returns top-k memories matching the query.

nexus_memory_stats()
// Shows memory tier counts, top tags, Zettelkasten link graph stats.
```

### Intelligence

```typescript
nexus_optimize_tokens(task: string, files?: string[], budget?: number)
// Pre-flight reading plan. Returns: which files to read fully/outline/skip.
// Saves avg 55% token usage.

nexus_ghost_pass(goal: string, files?: string[])
// Read-only pre-flight analysis. Returns risk areas + worker approaches.

nexus_mindkit_check(action: string, tokenCount?: number, filesToModify?: string[], isDestructive?: boolean)
// Guardrail check. Returns PASS/FAIL, score 0-100, violations + suggestions.
```

---

## Memory System

Three-tier architecture modelled on human memory:

| Tier | Size | Backed by | Purpose |
|------|------|-----------|---------|
| **Prefrontal** | 7 items | RAM | Active working set |
| **Hippocampus** | 200 items | RAM | Recent session context |
| **Cortex** | Unlimited | SQLite | Long-term persistence |

**Recall** uses hybrid scoring: vector similarity (TF-IDF, 128-dim) + priority + recency + access count.

---

## Phantom Workers

Parallel sub-agent framework using real git worktrees:

```
GhostPass (read-only analysis)
  → N PhantomWorkers (parallel, isolated git worktrees)
    → MergeOracle (Byzantine vote, confidence-weighted merge)
      → Apply winning diff to main branch
```

Each worker gets an isolated copy of the repo to experiment in.  
The `MergeOracle` evaluates outcomes by confidence score and approach quality.

```typescript
// Spawn 2 workers in parallel to implement the same feature 2 ways
const [resultA, resultB] = await Promise.all([
  new PhantomWorker(REPO_ROOT).spawn(taskA, workerAExecutor),
  new PhantomWorker(REPO_ROOT).spawn(taskB, workerBExecutor),
]);
const decision = await oracle.merge([resultA, resultB]);
// → decision.action: 'apply' | 'synthesize' | 'reject'
```

---

## Guardrails (Mindkit)

6 machine-checked rules that run before any significant operation:

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
│   ├── agents/adapters/mcp.ts      # MCP server, 6 tools
│   ├── engines/
│   │   ├── memory.ts               # Three-tier memory system
│   │   ├── embedder.ts             # TF-IDF + optional OpenAI embeddings
│   │   ├── token-supremacy.ts      # Token optimization engine
│   │   └── guardrails-bridge.ts    # 6-rule GuardrailEngine
│   └── phantom/
│       ├── index.ts                # GhostPass, PhantomWorker, MergeOracle
│       └── phase4-orchestrator.ts  # Example: Phase 4 built by itself
├── packages/
│   └── mindkit/                    # Standalone npm package (guardrails + MCP)
├── test/
│   ├── phantom.test.ts             # 19/19 E2E Phantom Workers test
│   └── memory.test.ts              # Semantic recall test
├── AGENTS.md                       # ← Read this first (AI agent protocol)
├── NEXUS.md                        # Nexus Prime language specification
└── GEMINI.md                       # Session protocol for AntiGravity
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

## Mindkit Package

A standalone npm package that any project can use:

```bash
cd packages/mindkit && npm install && npm run build

mindkit init          # Scaffold .agent/ into your project
mindkit check "..."   # CLI guardrail check
mindkit mcp           # Start Mindkit MCP server (3 tools)
mindkit skills        # List available skills
mindkit workflows     # List slash commands
```

---

## License

MIT — [sir-ad](https://github.com/sir-ad)
