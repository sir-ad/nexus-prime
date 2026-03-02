# 📖 NEXUS — Language Specification

> Nexus Prime defines a **meta-language for AI agent operation** — a set of primitives, patterns, and protocols that agents can use to reason, remember, plan, and collaborate.

---

## Core Primitives

### Memory

The fundamental unit of knowledge in Nexus Prime is a **Memory** — a piece of information with:

```
Memory {
  id: uuid
  content: string          // The knowledge
  priority: float (0-1)    // How important is this?
  tags: string[]           // Categorical labels
  createdAt: timestamp
  lastAccessed: timestamp
  accessCount: int         // Recall frequency → promotes to Cortex
  links: uuid[]            // Zettelkasten connections
}
```

**Tiers** (inspired by human cognition):
- `prefrontal` — Active working memory, 7 items, instant recall
- `hippocampus` — Recent session context, 200 items
- `cortex` — Long-term permanent storage, unlimited, SQLite

### Embedding

Each memory gets a 128-dimensional TF-IDF vector for semantic search.  
Recall is hybrid: `score = 0.5×similarity + 0.25×priority + 0.15×recency + 0.1×access_bonus`

---

## Tool API

### `STORE(content, priority, tags[])` → id

Writes a memory to the prefrontal tier.  
If `priority ≥ 0.9` → auto-promoted to cortex immediately.  
If `priority ≥ 0.8` → generates Zettelkasten links to related memories.

```typescript
nexus_store_memory("SQLite flush called on SIGINT before process.exit", 0.9, ["#bug", "#architecture"])
```

### `RECALL(query, k)` → string[]

Semantic nearest-neighbor search across all tiers.  
Returns top-k memory contents ordered by hybrid score.

```typescript
nexus_recall_memory("login not working")
// → finds "authentication broken for OAuth2" via vector similarity
//   even with zero word overlap
```

### `OPTIMIZE(task, files[])` → ReadingPlan

Analyzes files by relevance to task, returns a reading plan:

```
ReadingPlan {
  files: [
    { path, action: "full" | "outline" | "skip", reason, estimatedTokens }
  ]
  totalTokens: int
  savings: int       // tokens saved vs reading everything
}
```

**Algorithm:**
1. Score each file by keyword overlap with task
2. Apply recency bonus (recently modified files score higher)
3. Apply size penalty (large files default to outline unless highly relevant)
4. Distribute token budget across files by score

### `GHOST(goal, files[])` → GhostReport

Pre-flight analysis without modifying anything:

```
GhostReport {
  taskId: uuid
  riskAreas: string[]              // e.g. ["concurrent writes", "schema migration"]
  workerAssignments: WorkerTask[]  // Suggested parallel approach split
  totalEstimatedTokens: int
  readingPlan: ReadingPlan
}
```

### `CHECK(action, tokenCount?, filesToModify?, isDestructive?)` → GuardrailResult

```
GuardrailResult {
  passed: boolean
  score: int          // 0-100
  violations: [{ id, rule, detail, suggestion }]
  warnings:   [{ id, rule, detail, suggestion }]
  summary: string     // Human-readable formatted output
}
```

---

## Worker Language

The Phantom Worker system defines a **task language** for parallel execution:

### WorkerTask

```
WorkerTask {
  id: uuid
  goal: string        // What to accomplish
  approach: string    // "minimal" | "full" | "experimental" | custom
  files: FileRef[]    // Scope
  tokenBudget: int    // Max tokens to spend
  context: string     // Prior memory recalled for this task
}
```

### WorkerResult

```
WorkerResult {
  workerId: string
  approach: string
  diff: string        // git diff of changes made
  outcome: "success" | "partial" | "failed"
  confidence: float   // 0-1, worker's self-assessed certainty
  tokensUsed: int
  learnings: string[] // Key insights to store in memory
}
```

### MergeDecision

```
MergeDecision {
  action: "apply" | "synthesize" | "reject"
  winner?: WorkerResult
  synthesized?: string
  rationale: string
  confidence: float
  learnings: string[]
}
```

---

## Orchestration Patterns

### Pattern 1: Single Worker (Standard)

```
GhostPass → PhantomWorker → apply diff
```
Use when the task is well-understood. One approach, confident.

### Pattern 2: Parallel Exploration (Phantom)

```
GhostPass → [WorkerA ‖ WorkerB] → MergeOracle → apply winner
```
Use when you're uncertain which approach is better.  
Workers compete; the one with higher confidence + success wins.

### Pattern 3: Synthesize

```
GhostPass → [WorkerA ‖ WorkerB] → MergeOracle(synthesize) → combined
```
MergeOracle extracts the best parts of both approaches when neither is clearly better.

### Pattern 4: Reject + Retry

```
GhostPass → [WorkerA ‖ WorkerB] → MergeOracle(reject) → GhostPass(refined)
```
If both workers fail, the oracle rejects both and a new pass begins with refined understanding.

---

## Memory Patterns

### Session Continuity

```
# Session start
recall(query=<today's task>)
→ Trust results, skip re-reading known files

# During session
store(finding, priority=0.8, tags=["#decision"])

# Session end
store(summary, priority=0.85, tags=["#session-summary"])
```

### Zettelkasten Linking

Memories link to each other automatically when they share semantic context.  
High-priority stores trigger **fission** — the memory broadcasts to related existing memories, strengthening their links.

When you recall a topic, you get the memory + its **context network** — related memories up to 2 hops away.

### Fission Protocol

When `priority ≥ 0.9`:
1. Store in cortex immediately (not just prefrontal)
2. Find top-5 semantically related memories
3. Create bidirectional Zettelkasten links
4. Update access timestamps on linked memories

---

## Guardrail Language

Guardrails are **machine-checkable predicates** over agent actions.

```
GuardrailRule {
  id: string           // "TOKEN_BUDGET"
  rule: string         // Human-readable description
  severity: "error" | "warn" | "info"
  check: (GuardrailContext) → GuardrailViolation | null
}
```

**Custom rules** can be added by extending `GuardrailEngine`:

```typescript
const engine = new GuardrailEngine([
  {
    id: 'NO_MAIN_WRITES',
    rule: 'Do not write to main branch directly',
    severity: 'error',
    check: (ctx) => ctx.filesToModify?.some(f => f.includes('main'))
      ? { id: 'NO_MAIN_WRITES', severity: 'error',
          rule: 'Direct main write blocked',
          detail: 'Use a feature branch or phantom worktree',
          suggestion: 'Create a PhantomWorker first' }
      : null
  }
]);
```

---

## Skill Language

Skills are markdown files describing capability patterns:

```markdown
---
name: code-review-agent
description: Review code for correctness, security, and style
tags: [code-review, quality, security]
---

## When to Use
Trigger this skill when reviewing PRs or evaluating generated code.

## Steps
1. Use nexus_optimize_tokens to plan which files to read
2. Read files per the plan
3. Check for: security issues, type safety, test coverage
4. Store findings with nexus_store_memory priority=0.7

## Output Format
Structured review: issues by severity, suggestions for each
```

Skills live in `.agent/skills/` and are loaded by `SkillLoader`.

---

## Workflow Language

Workflows are slash-command scripts:

```markdown
---
description: End-of-session memory flush
---
# /session-close

1. Run nexus_memory_stats to review what was stored
// turbo
2. Store session summary with nexus_store_memory priority=0.85 tags=#session-summary
// turbo
3. Review any pending decisions that need documenting
```

`// turbo` above a step = auto-execute without user approval.  
`// turbo-all` anywhere = auto-execute ALL steps.

---

## Token Budget Protocol

Token budget is the **central constraint** of every Nexus session:

```
Phase 1: Pre-flight
  → nexus_optimize_tokens(task, files[])
  → Only read files marked "full" or "outline"
  → Skip everything else

Phase 2: Work
  → Monitor running total
  → nexus_mindkit_check at 70k (warn) / 100k (block)

Phase 3: Compact
  → When approaching budget, use differential context
  → Only pass WHAT CHANGED since last session
  → ~70% token savings vs full re-read
```

**Budget allocation formula:**
- Critical files (score > 0.8): `full read`
- Moderate files (score 0.4-0.8): `outline only`
- Low relevance (score < 0.4): `skip`
- Token budget per file: `budget × (file_score / total_score)`

---

## Version

Nexus Prime v0.2.0 — Language spec v1.0  
*"The framework that rewrites itself."*
