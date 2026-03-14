# AGENTS.md

Nexus Prime is orchestrator-first. Treat it as a control plane, not a loose bag of tools.

## Default Path
- For any non-trivial task, start with `nexus_session_bootstrap`, then call `nexus_orchestrate`.
- Use raw prompts unless the operator provides hard constraints.
- Only bypass the orchestrator for explicit low-level, diagnostic, or manual runtime work.

```txt
nexus_session_bootstrap(goal="<task>", files=[optional candidate files])
nexus_orchestrate(prompt="<task>", files=[optional hard constraints])
```

## Working Order
1. `nexus_session_bootstrap`
2. `nexus_recall_memory` only when you need raw matches directly
3. `nexus_memory_stats`
4. `nexus_plan_execution` only when you want the ledger before execution
5. `nexus_list_skills`, `nexus_list_workflows`, `nexus_list_specialists`, `nexus_list_crews` when catalog awareness will narrow the run
6. `nexus_list_hooks` and `nexus_list_automations` only for operating-layer behavior
7. `nexus_optimize_tokens` before reading 3+ files
8. `nexus_mindkit_check` before risky mutation

## Runtime Contract
- The orchestrator decides intent, decomposition, artifact selection, swarm shape, continuation, and learning.
- The runtime executes manifests, worktrees, hooks, workflows, verification, merge/apply, and governance.
- Dashboard truth comes from persisted runtime snapshots, not whichever process happens to host the UI.
- Token telemetry is persisted; the token dial should show lifetime totals after restart.
- Runtime execution clamps to at least 2 coder workers.

## Worker Handoff
- Each worker writes `.agent/runtime/context.json` and `.agent/runtime/context.md`.
- The instruction gateway writes `.agent/runtime/packet.json` and `.agent/runtime/packet.md`.
- Use the packet as the machine-facing brief. Treat `AGENTS.md` as the human operator manual.

## Memory and Governance
- Store durable learnings with `nexus_store_memory`.
- Good memories are root causes, architecture decisions, reuse patterns, failure modes, and file maps.
- Memory persists under `~/.nexus-prime/`.
- Use `nexus_federation_status` when relay or peer learnings could materially improve execution.

## Anti-Patterns
- Do not skip `nexus_session_bootstrap` and jump into broad repo exploration.
- Do not skip `nexus_orchestrate` and manually wire every subsystem unless the task is explicitly low-level.
- Do not read 10+ files before `nexus_optimize_tokens`.
- Do not treat populated catalogs as proof that a subsystem was used in this runtime.
- Do not use hooks or automations as a generic replacement for planning.
- Do not store vague memories like “fixed a bug”; store the exact cause and effect.
- Do not hardcode tool counts in docs or prompts; the surface evolves.

<!-- nexus-prime:codex-bootstrap:start -->
## Nexus Prime Bootstrap (managed)

> This block is managed by `nexus-prime setup codex` or automatic bootstrap.
> Keep your project-specific Codex guidance above or below it.

## Nexus Prime Managed Bootstrap

- Start non-trivial work with `nexus_session_bootstrap(goal, files?)`.
- Then call `nexus_orchestrate(prompt=<raw user request>)` unless low-level control is explicitly required.
- Use `nexus_plan_execution` only when a plan-before-run is requested.
- Discover catalogs only when needed: `nexus_list_skills`, `nexus_list_workflows`, `nexus_list_hooks`, `nexus_list_automations`, `nexus_list_specialists`, `nexus_list_crews`.
- Before reading 3+ files, call `nexus_optimize_tokens(...)`.
- Before risky mutation, call `nexus_mindkit_check(...)`.
- Worker context lives in `.agent/runtime/context.json`; the compiled packet lives in `.agent/runtime/packet.json`.
<!-- nexus-prime:codex-bootstrap:end -->
