## Summary

<!-- What changes and why. Link the issue this closes. -->

## Validation

- [ ] `pnpm typecheck && pnpm lint && pnpm test` passes locally
- [ ] New environment variables are in `.env.example` AND `lib/server/env.ts`
      (`tests/env-flags.test.ts` fails on drift between the two)
- [ ] `docs/api/openapi.json` regenerated (`pnpm openapi:generate`) if an API
      route contract changed (`pnpm openapi:check` runs in CI)
- [ ] Operator-facing behaviour changes are reflected in `docs/runbook.md` or
      `docs/observability.md`

## Risk

<!-- What breaks if this is wrong, and which kill switch
     (docs/runbook.md#kill-switches) or rollback covers it. -->
