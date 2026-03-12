# AGENTS.md

Nexus Prime is orchestrator-first. Treat it as a control plane, not a loose bag of tools.

## Default Rule
- For any non-trivial task, start with `nexus_session_bootstrap`, then call `nexus_orchestrate`.
- Use raw prompts unless the caller provides hard constraints.
- Only bypass the orchestrator for explicit low-level, diagnostic, or manual runtime work.
```txt
nexus_session_bootstrap(
  goal="<the user request in plain language>",
  files=[optional candidate files]
)
```
```txt
nexus_orchestrate(
  prompt="<the user request in plain language>",
  files=[optional hard constraints],
  skills=[optional hard constraints],
  workflows=[optional hard constraints],
  hooks=[optional hard constraints],
  automations=[optional hard constraints],
  crews=[optional hard constraints],
  specialists=[optional hard constraints]
)
```
If the caller does not constrain Nexus, let Nexus choose the crew, specialists, skills, workflows, hooks, automations, worker count, and token strategy.
## Context Order
Run this sequence unless the user explicitly asks for a low-level tool:
1. `nexus_session_bootstrap(goal="<task>", files=[...])`
2. `nexus_recall_memory(query="<task in 10 words>", k=8)` when you need the raw matches directly
3. `nexus_memory_stats()`
4. `nexus_plan_execution(goal="<task>", files=[...])` only when you want the ledger before execution
5. `nexus_list_skills()`, `nexus_list_workflows()`, `nexus_list_specialists()`, `nexus_list_crews()` when catalog awareness will narrow execution
6. `nexus_list_hooks()` and `nexus_list_automations()` only for operating-layer behavior, retries, continuations, or recurring execution
7. `nexus_optimize_tokens(...)` before reading 3+ files when you need to inspect or override the runtime decision
8. `nexus_mindkit_check(...)` before risky mutation
Do not start with broad repo exploration if memory, planner, or catalog data can narrow the problem first.
## Subsystem Triggers
- Memories: use for prior learnings, root causes, architecture history, and handoff. Call `nexus_store_memory` for durable findings.
- Skills: use for reusable execution guidance and tool bindings. Discover with `nexus_list_skills`.
- Roster: use when specialist authority, mission, workflow, or deliverables matter. Discover with `nexus_list_specialists`.
- Crews: use when task shape matters more than a single specialist. Discover with `nexus_list_crews`.
- Plan: use `nexus_plan_execution` to inspect what Nexus would choose before mutation.
- Workflows: use for reusable execution flows, verification patterns, and expected outputs. Discover with `nexus_list_workflows`.
- Hooks: use for runtime checkpoints like `run.created`, `before-read`, `before-mutate`, `before-verify`, failure, promotion, memory store, and shield blocks. Discover with `nexus_list_hooks`.
- Automations: use for bounded follow-up runs, event-triggered actions, and delivery. Discover with `nexus_list_automations`.
- Governance: use before risky mutation or promotion. Treat failed `nexus_mindkit_check` results as blockers.
- Federation: use when peer learnings or relay status could materially improve execution. Treat an unconfigured relay as degraded, not absent.
## Runtime Contract
- The orchestrator decides intent, decomposition, artifact selection, swarm shape, continuation, and learning.
- The runtime executes manifests, worktrees, hooks, workflows, verification, merge/apply, and governance.
- Dashboard truth comes from persisted runtime snapshots, not whichever process happens to host the UI.
- Token telemetry is persisted; the token dial should show lifetime totals after restart.
- Runtime execution clamps to at least 2 coder workers.
## Worker Handoff
Each worker writes `.agent/runtime/context.json` and `.agent/runtime/context.md`.
The instruction gateway writes `.agent/runtime/packet.json` and `.agent/runtime/packet.md`.
Use the packet as the machine-facing brief. Treat `AGENTS.md` as the human operator manual.
## Session Protocol
### Start
```txt
nexus_session_bootstrap(goal="<today's task>", files=[...])
```
For non-trivial work, call `nexus_orchestrate(...)` next, or `nexus_plan_execution(...)` first if you explicitly want to inspect the ledger before running.
### During Work
```txt
nexus_store_memory(
  content="<specific durable learning>",
  priority=0.8,
  tags=["#bug", "#architecture", "#decision"]
)
```
Good memories include root causes, architecture decisions, reuse patterns, failure modes, and file maps.
### End
```txt
nexus_session_dna(action="generate")
nexus_store_memory(
  content="Session YYYY-MM-DD: <what changed, why, and what remains>",
  priority=0.85,
  tags=["#session-summary"]
)
```
## Before Reading Files
```txt
nexus_optimize_tokens(
  task="<what you're doing>",
  files=["src/foo.ts", "src/bar.ts", "..."]
)
```
Use this for 3+ files.
Follow the optimizer output. Do not bulk-read the repo anyway.
## Before Risky Operations
```txt
nexus_mindkit_check(
  action="<what you're about to do>",
  tokenCount=<estimate>,
  filesToModify=["path/to/file"],
  isDestructive=false
)
```
If `passed` is false, stop and resolve the violation first.
## Operating Recipes
- Bug fix: bootstrap, inspect plan if needed, orchestrate, store the root cause.
- Multi-file feature: bootstrap, inspect plan if needed, discover skills and workflows only when you need explicit control, orchestrate.
- Refactor: bootstrap, run `nexus_ghost_pass`, inspect plan if needed, run governance, orchestrate.
- Release prep: bootstrap, inspect plan, review workflows and automations, orchestrate.
- Operating-layer change: inspect plan, review hooks and automations, run governance, then mutate only after you know whether the behavior belongs in a hook, automation, workflow, or skill.
## Anti-Patterns
- Do not skip `nexus_session_bootstrap` and start with broad repo exploration.
- Do not skip `nexus_orchestrate` and manually wire every subsystem unless the task is explicitly low-level or diagnostic.
- Do not read 10+ files before `nexus_optimize_tokens`.
- Do not treat populated catalogs as proof that a subsystem was used in this runtime.
- Do not use hooks or automations as generic replacements for planning.
- Do not store vague memories like "fixed a bug"; store the exact cause and effect.
- Do not hardcode tool counts in docs or prompts; the surface evolves.
## Key MCP Surfaces
- `nexus_session_bootstrap`
- `nexus_orchestrate`
- `nexus_recall_memory`
- `nexus_memory_stats`
- `nexus_store_memory`
- `nexus_plan_execution`
- `nexus_optimize_tokens`
- `nexus_mindkit_check`
- `nexus_ghost_pass`
- `nexus_spawn_workers`
- `nexus_session_dna`
- `nexus_list_skills`
- `nexus_list_workflows`
- `nexus_list_hooks`
- `nexus_list_automations`
- `nexus_list_specialists`
- `nexus_list_crews`
- `nexus_federation_status`

Memory persists under `~/.nexus-prime/`. Worker-selected runtime context and the compiled packet are written under `.agent/runtime/`.
