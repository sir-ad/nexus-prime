## Runtime Rewrite Plan

### Problem
- `execute()` and `executeSwarm()` still simulate work.
- MCP swarm/NXL surfaces do not share one real execution backend.
- Live skills, backend selection, and run artifacts have no runtime contract.

### Files To Change
- `src/index.ts`
- `src/engines/index.ts`
- `src/engines/nxl-interpreter.ts`
- `src/engines/runtime-backends.ts`
- `src/engines/skill-runtime.ts`
- `src/phantom/index.ts`
- `src/phantom/runtime.ts`
- `src/engines/orchestrator.ts`
- `src/agents/adapters/mcp.ts`
- `test/basic.test.ts`
- `test/phantom.test.ts`

### Risks And Mitigations
- Core execution paths change shape.
  - Keep compatibility summary strings where callers still expect them.
- Worktree execution can leave residue.
  - Centralize create/apply/cleanup in one runtime.
- Verification may fail after merge.
  - Keep patch-based rollback and artifact logging.
- Live skill deployment can become unsafe.
  - Allow guarded hot deploy only for read/orchestrate skills.

### Implementation Tasks
1. Add runtime/backend interfaces and defaults.
2. Build shared worktree execution kernel and artifact recorder.
3. Add skill runtime with validation, deployment, promotion, and revocation.
4. Wire `execute()`, swarm orchestration, and NXL compilation onto the shared runtime.
5. Rewire MCP worker/NXL tools to the runtime.
6. Add contract tests for runtime artifacts, real diffs, and NXL execution.

### Validation
- `npm run build`
- targeted runtime tests if available
- `npm test`

### Rollback
- Revert the runtime wiring changes only.
- Keep new interfaces if needed, but fall back to the prior execution calls until green.
