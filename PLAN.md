## Dashboard Restoration Plan

### Problem
- The current runtime console replaced the earlier topology-first dashboard with a shallow card layout.
- Memory, POD, client presence, and control-plane actions are either missing or not operational.
- The dashboard does not preserve useful state across refresh well enough and hides the richer runtime artifacts already available.

### Files To Change
- `src/dashboard/index.html`
- `src/dashboard/server.ts`
- `src/engines/memory.ts`
- `src/engines/pod-network.ts`
- `src/engines/event-bus.ts`
- `src/engines/client-registry.ts`
- `src/index.ts`
- `src/core/types.ts`
- `src/agents/adapters.ts`
- `src/phantom/runtime.ts`
- `test/dashboard.test.ts`

### Risks And Mitigations
- The dashboard can become visually closer to the old UI while still remaining data-shallow.
  - Add real DTOs and control routes before rewriting the HTML.
- Client detection can become misleading.
  - Use heartbeat first, heuristic second, and label heuristic-only clients as `inferred`.
- Run state can disappear after refresh.
  - Fallback to persisted runtime artifacts when in-memory runs are absent.
- Dashboard actions can bypass safety.
  - Route all actions through existing runtime methods and bounded POST handlers only.

### Implementation Tasks
1. Add dashboard-facing memory, pod, event, and persisted-run APIs.
2. Add a client registry with heartbeat, heuristic detection, and stale-state aging.
3. Extend the dashboard server with new GET endpoints and safe POST control routes.
4. Rebuild the dashboard around the old topology-first concept with graph modes, side drawer inspection, and operational tabs.
5. Expand dashboard smoke tests to cover the new APIs, client detection, and control plane.

### Validation
- `npm run build`
- `npm test`
- `npm run lint`

### Rollback
- Revert the dashboard and server surface changes together.
- Keep runtime DTO additions if needed, but restore the prior dashboard shell if the new UI regresses.
