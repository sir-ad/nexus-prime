## Summary
- What changed?
- Why now?

## Release Surface
- [ ] Only intended release files are included
- [ ] Local-only artifacts such as `.playwright-cli/` and `.taskmaster/` are excluded

## Risk Review
- [ ] External-client flow still starts with `nexus_session_bootstrap` / `nexus_orchestrate`
- [ ] Planner, token, and runtime-truth fields are recorded where expected
- [ ] Session-scoped RAG and synthesized artifacts do not silently promote into long-term memory
- [ ] Dashboard/API surfaces read persisted runtime truth rather than host-process state
- [ ] README, docs, and release notes reflect shipped behavior and avoid stale claims

## Verification
- [ ] `npm run build`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm pack --dry-run`

## Manual Smoke
- [ ] MCP autonomous profile shows `nexus_session_bootstrap` and `nexus_orchestrate` first
- [ ] A non-trivial orchestrated run records planner/token/sequence fields
- [ ] Dashboard shows updated runtime truth and token/provenance surfaces
- [ ] Docs landing page, integrations, and knowledge base render and link correctly

## Review Outcome
- [ ] Peer review completed
- [ ] Blockers resolved or explicitly tracked
