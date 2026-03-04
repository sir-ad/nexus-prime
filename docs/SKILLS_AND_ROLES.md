# Nexus Prime — Sub-Agent Roles & Skill Cards

## Sub-Agent Roles

| Sub-Agent | Trigger | Behavior |
|-----------|---------|----------|
| **Ghost Pass Analyst** | `nexus_ghost_pass()` | Reads AST, identifies risk areas, suggests approaches. |
| **Phantom Worker** | `nexus_spawn_workers()` | Executes tasks in isolated git worktrees independently. |
| **Merge Oracle** | Post-worker | Byzantine vote on worker outputs, synthesizes winning diff. |
| **Evolution Auditor** | `nexus_audit_evolution()` | Scans memory for hotspots and recurring failure patterns. |
| **Guardrail Enforcer** | `nexus_mindkit_check()` | Machine-checks actions against Token Budget and Destructive rules. |
| **Token Budget Planner** | `nexus_optimize_tokens()` | Scores file relevance and builds optimized reading plans. |
| **Memory Librarian** | `nexus_store_memory()` | Manages 3-tier memory (Prefrontal, Hippocampus, Cortex). |
| **CAS Compressor** | `nexus_cas_compress()` | Encodes discrete tokens into continuous attention streams. |
| **Entanglement Coordinator** | `nexus_entangle()` | Coordinates entangled agent states for correlated decisions. |
| **KV Bridge Manager** | `nexus_kv_bridge_*` | Bridges local KV cache to vLLM/Ollama providers. |

## Skill Cards (Default Set)

### 1. `debug_typescript_error`
- **Description**: Standard procedure for fixing TS compiler errors.
- **Trigger**: "tsc error", "type mismatch", "TS1234"
- **Steps**:
  1. Read error message + location
  2. Map file:line to source code
  3. Analyze type definitions
  4. Apply fix (refactor or cast)
  5. Run `npm run build` to verify

### 2. `optimize_token_budget`
- **Description**: Drastic reduction of context window usage.
- **Trigger**: "token limit", "high context", "out of memory"
- **Steps**:
  1. Inventory all open files
  2. Call `nexus_optimize_tokens`
  3. Close or truncate low-relevance files
  4. Summarize long documentation files

### 3. `parallel_refactor`
- **Description**: Splitting complex rewrites across parallel workstreams.
- **Trigger**: "refactor", "migration", "rewrite"
- **Steps**:
  1. `nexus_ghost_pass` to analyze blast radius
  2. `nexus_spawn_workers` with multiple strategies
  3. Monitor POD network for convergence
  4. Apply MergeOracle winning decision

### 4. `memory_first_research`
- **Description**: Prevent re-researching solved problems.
- **Trigger**: "how to", "research", "lookup"
- **Steps**:
  1. `nexus_recall_memory` with high k (k=8)
  2. Cross-reference Zettelkasten links
  3. Verify if current task overlaps with past session findings
