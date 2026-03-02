# Quality Gates

All of these must pass before considering any change complete.

## Build
```bash
npm run build   # Must succeed with zero errors
npx tsc --noEmit  # TypeScript must compile cleanly
```

## Test
```bash
npm test         # All tests must pass
npm test -- --coverage  # Target: ≥80% coverage
```

## Lint
```bash
npm run lint     # Must be clean (no warnings treated as errors)
```

## Commit Standards
- Commit after each working feature (20-100 lines)
- Never commit broken code
- Format: `type(scope): description`
- Types: `feat`, `fix`, `test`, `refactor`, `docs`, `chore`

## Code Standards
- Functions < 50 lines
- Files < 500 lines
- No `any` types (unless justified with comment)
- All public functions have return types
- Error handling on all async operations
- No hardcoded secrets or paths
