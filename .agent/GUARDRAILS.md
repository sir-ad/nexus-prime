# 🛡️ Mindkit Universal Guardrails

These rules apply to **every** agent skill in Mindkit. No exceptions.

---

## 1. Token Economy

| Rule | Detail |
|---|---|
| **Budget declaration** | Every skill declares cost: `S` (<2K tokens), `M` (2-8K), `L` (8K+) |
| **Outline before content** | Always use `view_file_outline` before reading full files |
| **Context dumps first** | Read `.mindkit/memory/` summaries before raw source files |
| **Batch tool calls** | Make independent calls in parallel, never sequentially |
| **Prune context** | Drop irrelevant files from context after reading — summarize, don't hoard |

## 2. Output Standards

| Rule | Detail |
|---|---|
| **Max 100 lines** | No agent output exceeds 100 lines unless the orchestrator explicitly overrides |
| **Structured format** | Every output must contain: `## Summary` (≤5 lines), `## Findings` (list), `## Actions` (prioritized) |
| **No prose dumps** | Use tables, bullet lists, and headers — not paragraphs |
| **Cite evidence** | Every finding must reference a specific file:line or command output |

## 3. Safety

| Rule | Detail |
|---|---|
| **Read-only by default** | Agents analyze and report. They do NOT modify code unless orchestrator escalates. |
| **No secrets** | Never output API keys, tokens, passwords, or `.env` contents |
| **No installs** | Never run `npm install`, `pip install`, or equivalent without explicit user approval |
| **No network calls** | No `curl`, `fetch`, or API calls unless the skill explicitly requires it and declares it |

## 4. Project Agnosticism

| Rule | Detail |
|---|---|
| **No hardcoded paths** | Use discovery patterns: "find the `package.json`", "locate the `src/` directory" |
| **No assumed stack** | Don't assume React/Node/Python — detect the stack first |
| **Portable output** | All reports should make sense without knowing the project name |

## 5. Agent Coordination

| Rule | Detail |
|---|---|
| **Orchestrator authority** | Only the orchestrator decides which skills run and in what order |
| **No recursive invocation** | A skill must never invoke itself |
| **Declare dependencies** | If skill A needs output from skill B, declare it in the skill header |
| **Fail gracefully** | If a skill can't complete, return `## Summary: INCOMPLETE` with reason |

## 6. Memory Protocol

| Rule | Detail |
|---|---|
| **Tag everything** | Every finding gets at least one semantic marker: `#bug`, `#debt`, `#insight`, `#decision`, `#architecture`, `#risk` |
| **Session close** | At end of session, the context-manager must flush a session report to `.mindkit/sessions/` |
| **No duplication** | Before writing a memory entry, check if an equivalent one exists |
| **Prune stale** | Memory entries older than 30 sessions without reference should be flagged for review |
