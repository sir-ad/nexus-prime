# .agent Conventions

- `AGENTS.md` is the human operator manual. Keep it short and durable.
- `.agent/rules/*` is the durable machine-rule source loaded by the instruction gateway.
- `.agent/client-bootstrap/*` holds generated client-native instruction files for Claude Code and Opencode setup flows.
- `.agent/runtime/packet.json` and `.agent/runtime/packet.md` are the compiled model-facing handoff for the active run.
- `.agent/runtime/context.json` and `.agent/runtime/context.md` are the worker-facing runtime context handoff.
- `skills/`, `workflows/`, `hooks/`, and `automations/` are local override roots loaded by Nexus Prime at runtime.
