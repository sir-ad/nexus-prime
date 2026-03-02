# 🧬 AGENTS.md — Nexus Prime Agent Protocol

> One-pager for any AI model (Gemini, Claude, GPT-4, etc.) operating inside a Nexus Prime project.

---

## What Is Nexus Prime?

Nexus Prime is a **meta-framework** running as an MCP server. It gives you:
- **Cross-session memory** — store findings, recall them later
- **Token optimization** — pre-flight reading plans before touching files
- **Guardrails** — machine-checked rules before risky operations
- **Phantom Workers** — parallel git worktree sub-agents for big tasks

---

## 🚦 Session Start (MANDATORY — do this first, always)

```
1. nexus_recall_memory(query="<today's task in 10 words>", k=8)
   → Trust the results. Skip re-reading files it tells you about.

2. nexus_memory_stats()
   → If cortex > 20, you have rich context. Use it.
```

---

## ⚡ Before Reading Files (3+ files = MANDATORY)

```
nexus_optimize_tokens(
  task="<what you're doing>",
  files=["src/foo.ts", "src/bar.ts", ...]
)
```

**Follow the plan exactly:**
- `✅ Read fully` → `view_file`
- `✂️ Read partially` → `view_file` with line range
- `🔍 Outline only` → `view_file_outline`
- `⏭️ Skip` → do NOT read

---

## 🛡️ Before Risky Operations

```
nexus_mindkit_check(
  action="<describe what you're about to do>",
  tokenCount=<estimate>,
  filesToModify=["path/to/file"],
  isDestructive=false
)
```

If it returns `passed: false` → stop and address the violations first.

**Auto-triggered on:**
- Token count > 70k (warn) / 100k (block)
- `isDestructive: true` without confirmation
- Writing to system paths (`/etc`, `/usr`, `/bin`)

---

## 💾 Store Key Findings (during work)

```
nexus_store_memory(
  content="<specific, actionable finding>",
  priority=0.8,
  tags=["#bug", "#architecture", "#decision"]
)
```

**Store when you find:**
- Root cause of a bug
- Why a design decision was made
- A pattern that works (or doesn't)
- Any key file for a task type

**Priority guide:** `1.0` = critical · `0.8` = important · `0.5` = routine

---

## 🔮 Before Large Rewrites (RECOMMENDED)

```
nexus_ghost_pass(
  goal="<what you want to accomplish>",
  files=["affected/file1.ts", "affected/file2.ts"]
)
```

Returns: risk areas, reading plan, worker approaches.
Use risk areas as a checklist before making changes.

---

## 🔚 Session End (MANDATORY)

```
nexus_store_memory(
  content="Session YYYY-MM-DD: <1-3 sentences: what changed, files modified, decisions made>",
  priority=0.85,
  tags=["#session-summary"]
)
```

---

## 🤖 Sub-Agent Protocol (Phantom Workers)

When a task is too large for one agent or benefits from parallel exploration:

```
1. nexus_ghost_pass() → get task analysis + risk areas
2. Spawn 2 approaches as sub-agents in parallel:
   - Worker A: "minimal" — conservative, safe approach
   - Worker B: "full" — ambitious, complete approach
3. Each worker produces: { learnings, confidence, diff }
4. MergeOracle picks winner based on confidence + outcome
5. Apply winning approach, run build verification
```

**Key rule:** Sub-agents operate in isolated git worktrees.  
Changes don't reach main until MergeOracle approves.

---

## 📋 Tag Taxonomy

| Tag | Use for |
|-----|---------|
| `#bug` | Bug found or fixed |
| `#architecture` | Structural decisions |
| `#decision` | Non-obvious choices |
| `#session-summary` | End-of-session wrap-up |
| `#token-plan` | File reading strategies |
| `#ghost-pass` | Pre-flight analysis |
| `#guardrail` | Guardrail violations |
| `#phantom` | Phantom Worker learnings |

---

## ❌ Anti-Patterns

| Don't | Do instead |
|-------|-----------|
| Read 10+ files without a plan | `nexus_optimize_tokens` first |
| Research something you might know | `nexus_recall_memory` first |
| Store "fixed a bug" | Store "Fixed SQLite flush bug in memory.ts — flush() now on SIGINT" |
| Skip session-end memory | Always store a session summary |
| Modify files outside your worktree | Stay in your worktree until MergeOracle approves |

---

## 🔧 Available MCP Tools (6)

| Tool | Purpose |
|------|---------|
| `nexus_store_memory` | Store knowledge |
| `nexus_recall_memory` | Recall by semantic query |
| `nexus_memory_stats` | Check memory health |
| `nexus_optimize_tokens` | Pre-flight reading plan |
| `nexus_ghost_pass` | Pre-flight task analysis |
| `nexus_mindkit_check` | Guardrail check |

---

*MCP server starts with: `node /path/to/nexus-prime/dist/cli.js mcp`*  
*Memory persists to: `~/.nexus-prime/memory.db`*
