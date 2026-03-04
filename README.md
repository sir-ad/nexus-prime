# 🧬 Nexus Prime

**The Self-Evolving Agent Operating System. Give your AI agent a brain that persists, thinks, and learns.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://typescriptlang.org)
[![Version](https://img.shields.io/badge/Version-1.2.0-orange.svg)](#-quickstart)

> [!IMPORTANT]
> **Nexus Prime** is a Meta-Framework exposed as an MCP (Model Context Protocol) server. It runs alongside your existing AI agents (Claude, Cursor, AntiGravity) to provide persistent memory, token optimization, and orchestrate parallel worker swarms.

---

## 🎯 The Problem & Value Proposition

Every AI agent session starts with **total amnesia**. Your agent forgets yesterday's bug fix. It wastes 80% of its context window re-reading files it already understood. And when a task is complex enough to need multiple approaches, it works alone — sequentially, slowly.

Nexus Prime gives your agent four superpowers:

| Superpower | What It Does |
|:---|:---|
| **🧠 Persistent Memory** | 3-tier knowledge system (Prefrontal → Hippocampus → Cortex). 820+ Zettelkasten links. Survives restarts. Automatically links related concepts. |
| **⚡ Token Supremacy** | HyperTune™ optimizer reads only the relevant chunks. Continuous Attention Streams (CAS) compress discrete tokens into weighted continuous semantics. Saves 50-90% context. |
| **🐝 Phantom Swarms** | Parallel workers in isolated Git Worktrees. Ghost Pass risk analysis → Spawn Parallel Workers → Byzantine Merge. |
| **🛡️ MindKit Guardrails** | Machine-checked safety. Scores 0-100. Blocks destructive operations (like deleting test fixtures) before they happen. |

---

## ⚡ 30-Second Quickstart

```bash
# Clone and build
git clone https://github.com/sir-ad/nexus-prime.git
cd nexus-prime && npm install && npm run build

# Start the dashboard and background daemon
npm run start
```

Add to your agent's MCP config (Cursor, Claude Desktop, etc.):

```json
{
  "nexus-prime": {
    "command": "node",
    "args": ["/absolute/path/to/nexus-prime/dist/cli.js", "mcp"]
  }
}
```

> [!TIP]
> Once connected, ask your agent to call `nexus_memory_stats()` to confirm the cortex is online.

---

## 📊 Real-Time Dashboard

Nexus Prime includes a **built-in visualization dashboard** powered by Server-Sent Events (SSE). Watch your agent's memory stores, token optimizations, phantom dispatches, and guardrail checks stream in real time — zero polling.

**Access it locally at:** `http://127.0.0.1:3377`

---

## 🧠 Core Primitives

### Memory Tiers
The fundamental unit of knowledge is a Memory, structured in 3 tiers (inspired by human cognition):
- `prefrontal` — Active working memory, 7 items, instant recall.
- `hippocampus` — Recent session context, ~200 items.
- `cortex` — Long-term permanent storage backed by SQLite.

### Zettelkasten Linking
Memories link to each other automatically when they share semantic context. High-priority stores trigger **fission** — the memory broadcasts to related existing memories, strengthening their links.

### Context Compression (CAS Engine)
The Continuous Attention Stream (CAS) Engine replaces discrete tokens with weighted continuous fluid potentials. Common patterns get compressed; novel information gets expanded. Achieves extreme context expansion.

---

## 🛠️ MCP Tool API

Nexus Prime exposes powerful tools to the AI agent:

### `nexus_store_memory(content, priority, tags[])`
Writes a memory to the prefrontal tier. If `priority ≥ 0.9`, it is auto-promoted to the Cortex. If `priority ≥ 0.8`, it generates Zettelkasten links.

### `nexus_recall_memory(query, k)`
Semantic nearest-neighbor search across all memory tiers. Uses hybrid scoring (`0.5×similarity + 0.25×priority + 0.15×recency + 0.1×access_bonus`).

### `nexus_optimize_tokens(task, files[])`
Analyzes files by relevance to the task, returning a structured reading plan (e.g., `full`, `outline`, or `skip`). Distributes the token budget securely.

### `nexus_ghost_pass(goal, files[])`
Read-only pre-flight analysis. Identifies risk areas (e.g., concurrent writes) and suggests parallel worker strategies before modifying files.

### `nexus_spawn_workers(goal, files[])`
Spawns parallel Phantom Workers in mathematically isolated Git Worktrees. Evaluates different implementation approaches simultaneously. Returns a `MergeDecision` from the Oracle to synthesize or apply the best approach.

### `nexus_mindkit_check(action, filesToModify, isDestructive)`
Evaluates high-risk actions against machine-checked Guardrail predicates. Returns `PASS/FAIL` and actionable suggestions to prevent disaster.

---

## 🤖 Sub-Agent Roles

Nexus Prime manages a crew of specialized sub-agents:

| Role | Trigger Tool | Responsibility |
|------|--------------|----------------|
| **Ghost Pass Analyst** | `nexus_ghost_pass` | Reads AST, identifies risk areas, suggests approaches. |
| **Phantom Worker** | `nexus_spawn_workers` | Executes tasks in isolated git worktrees independently. |
| **Merge Oracle** | Post-worker | Byzantine vote on worker outputs, synthesizes winning diff. |
| **Evolution Auditor** | `nexus_audit_evolution` | Scans memory for hotspots and recurring failure patterns. |
| **Guardrail Enforcer**| `nexus_mindkit_check` | Machine-checks actions against Token Budget and Destructive rules. |
| **Token Budgeteer** | `nexus_optimize_tokens` | Scores file relevance and builds optimized reading plans. |
| **Memory Librarian** | `nexus_store_memory` | Promotes/demotes items across Prefrontal, Hippocampus, and Cortex. |

---

## 🧩 Default Skill Cards

Skills are built-in behaviors the orchestrator can call upon:

1. **`debug_typescript_error`**: Standard procedure for TS compiler errors. Triggers on "tsc error".
2. **`optimize_token_budget`**: Drastic reduction of context usage. Triggers on "token limit" or "out of memory". Opens `nexus_optimize_tokens`.
3. **`parallel_refactor`**: Uses `nexus_ghost_pass` and `nexus_spawn_workers` to explore refactoring strategies asynchronously.
4. **`memory_first_research`**: Triggers `nexus_recall_memory` with high k to prevent re-researching solved problems.

---

## 📜 License

Nexus Prime is released under the MIT License. See [LICENSE](LICENSE) for details.
