## What and why

<!-- One or two sentences: the change and the reason for it. -->

## Evidence

Hosted CI does not run while the Actions budget blocks it (docs/ci.md), so a
merge rests on the local gate. Paste the summary `pnpm verify:release` prints
for the head commit of this branch (or say which steps you ran instead, and
why).

```text
Local release gate (… min)
  passed   frozen-install …
  …
verify:release passed for <sha12>
```

- [ ] `pnpm verify:release` passed on the head commit (receipt name: `…`)
- [ ] Docs-only change: `pnpm verify` is enough (no code, `scripts/`, `supabase/` or `.github/` changes)

## Risk

<!-- Migrations, new environment variables, production behaviour, rollback. -->
