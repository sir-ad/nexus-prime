# AGENTS.md

Nexus Prime is orchestrator-first. Treat it as a control plane, not just a bag of optional tools.

## Default Operating Rule

For any non-trivial task, start with `nexus_orchestrate`.

Use raw prompts when possible:

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

If the caller does not explicitly constrain Nexus, let Nexus choose the crew, specialists, skills, workflows, hooks, automations, worker count, and token strategy by itself.

## Context Acquisition Order

Run this order unless the user explicitly asks for a low-level tool:

1. `nexus_recall_memory(query="<task in 10 words>", k=8)`
2. `nexus_memory_stats()`
3. `nexus_plan_execution(goal="<task>", files=[...])` for planning-only inspection
4. `nexus_list_skills()`, `nexus_list_workflows()`, `nexus_list_specialists()`, `nexus_list_crews()` when you need catalog awareness before execution
5. `nexus_list_hooks()` and `nexus_list_automations()` only when changing operating behavior, retries, follow-up runs, or recurring execution logic
6. `nexus_optimize_tokens(...)` before reading 3+ files
7. `nexus_mindkit_check(...)` before risky mutation

Do not start with broad repo exploration if memory, planner, or catalog data can narrow the problem first.

## Subsystem Trigger Matrix

### Memories
- Use for prior learnings, bug roots, architecture history, and session handoff.
- Call `nexus_recall_memory` before re-researching.
- Call `nexus_store_memory` when you find a root cause, durable pattern, or non-obvious decision.

### Skills
- Use for reusable execution guidance and tool bindings.
- Discover with `nexus_list_skills`.
- Runtime-selected skills are written into worker context under `.agent/runtime/context.json` and `.agent/runtime/context.md`.
- Do not invent a skill choice blindly if the catalog already contains a relevant one.

### Roster
- Use when specialist authority, mission, workflow, and deliverables matter.
- Discover with `nexus_list_specialists`.
- Specialist context is injected into worker manifests and worker context packets.

### Crews
- Use when task shape matters more than a single specialist.
- Discover with `nexus_list_crews`.
- Crew choice influences review gates, specialist mixes, fallback paths, and swarm shape.

### Plan
- Use for a live ledger of what Nexus would choose before mutation.
- Call `nexus_plan_execution` when you need to inspect the current crew, specialist, skill, workflow, tool, and review-gate selection without executing.

### Workflows
- Use for reusable execution flows, verification patterns, and tool/action bundles.
- Discover with `nexus_list_workflows`.
- Workflows are not just verifier commands; they also shape worker context and expected outputs.

### Hooks
- Use for runtime checkpoint behavior at `run.created`, `before-read`, `before-mutate`, `before-verify`, failure, verification, promotion, memory store, and shield block.
- Discover with `nexus_list_hooks`.
- Hooks are an operating-layer tool, not a default task entrypoint.

### Automations
- Use for bounded follow-up runs, event-triggered actions, or connector delivery.
- Discover with `nexus_list_automations`.
- Automations are for continuation and operating behavior, not for replacing normal execution planning.

### Governance
- Use before risky mutation and when auditing memory quality or promotion safety.
- `nexus_mindkit_check` is mandatory before destructive or ambiguous operations.
- Treat failed governance results as blockers, not suggestions.

### Federation
- Use when prior learnings from peer nodes or relay state might materially improve execution.
- Call `nexus_federation_status` for current mesh and relay status.
- If relay is unconfigured, treat federation as degraded, not absent.

## Runtime Contract

- The orchestrator decides intent, decomposition, artifact selection, swarm shape, continuation, and learning.
- The runtime executes manifests, worktrees, hooks, workflows, verification, merge/apply, and governance.
- Dashboard truth comes from persisted runtime snapshots, not whichever process happened to host the UI.
- Token telemetry is persisted. The dashboard token dial should show lifetime totals even after restart.
- Runtime execution clamps to at least 2 coder workers. Do not assume `workers: 1` will produce a single-coder POD.

## Worker Context

Each worker writes:

- `.agent/runtime/context.json`
- `.agent/runtime/context.md`

Treat these as the canonical handoff for:

- selected crew
- specialist profile excerpts
- active skills
- active workflows
- review gates
- continuation data
- phase hook additions

## Session Protocol

### Start

```txt
nexus_recall_memory(query="<today's task in 10 words>", k=8)
nexus_memory_stats()
```

If the task is non-trivial, either:

- call `nexus_orchestrate(...)`, or
- call `nexus_plan_execution(...)` first when you explicitly want to inspect the ledger before running

### During Work

Call:

```txt
nexus_store_memory(
  content="<specific durable learning>",
  priority=0.8,
  tags=["#bug", "#architecture", "#decision"]
)
```

Store memories for:

- root causes
- architecture decisions
- patterns worth reusing
- repeated failure modes
- task-specific file maps

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

For 3+ files:

```txt
nexus_optimize_tokens(
  task="<what you're doing>",
  files=["src/foo.ts", "src/bar.ts", "..."]
)
```

Follow the plan:

- `read` or `full` means read fully
- `partial` means read only the proposed range or chunk
- `outline` means inspect structure only
- `skip` means skip

Do not ignore the optimizer and then bulk-read the repo anyway.

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

### Bug Fix
- `nexus_recall_memory`
- `nexus_plan_execution`
- `nexus_optimize_tokens`
- `nexus_orchestrate`
- `nexus_store_memory` with root cause

### Multi-file Feature
- `nexus_recall_memory`
- `nexus_plan_execution`
- `nexus_list_skills`
- `nexus_list_workflows`
- `nexus_optimize_tokens`
- `nexus_orchestrate`

### Refactor
- `nexus_recall_memory`
- `nexus_ghost_pass`
- `nexus_plan_execution`
- `nexus_mindkit_check`
- `nexus_orchestrate`

### Release Prep
- `nexus_recall_memory`
- `nexus_plan_execution`
- `nexus_list_workflows`
- `nexus_list_automations`
- `nexus_orchestrate`

### Operating-layer Change
- `nexus_plan_execution`
- `nexus_list_hooks`
- `nexus_list_automations`
- `nexus_mindkit_check`
- mutate only after you know whether the behavior belongs in a hook, automation, workflow, or skill

## Anti-Patterns

- Do not skip `nexus_orchestrate` and manually wire every subsystem unless the task is explicitly low-level or diagnostic.
- Do not read 10+ files before `nexus_optimize_tokens`.
- Do not treat populated catalogs as proof that a subsystem was used in this runtime.
- Do not use hooks or automations as generic replacements for planning.
- Do not store vague memories like "fixed a bug"; store the exact cause and effect.
- Do not hardcode tool counts in docs or prompts; the surface evolves.

## Key MCP Surfaces

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

Memory persists under `~/.nexus-prime/`. Worker-selected runtime context is written inside each worker worktree under `.agent/runtime/`.
