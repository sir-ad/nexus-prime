# .agent Conventions

- Nexus Prime is orchestrator-first. Raw prompts should normally enter through `nexus_orchestrate`, which then selects crews, specialists, skills, workflows, hooks, automations, and worker count.
- `skills/`, `workflows/`, `hooks/`, and `automations/` are local override roots loaded by Nexus Prime at runtime.
- Worker runs write canonical handoff context under `.agent/runtime/context.json` and `.agent/runtime/context.md` inside each isolated worktree.
- Runtime-generated skills still deploy under `.agent/skills/runtime/`, but worker context is the authoritative summary of the selected crew, specialist profile, workflows, review gates, and phase hook additions.
