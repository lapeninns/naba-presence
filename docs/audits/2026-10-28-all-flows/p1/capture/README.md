# p1 capture harness (reference copy)

`capture.spec.ts.txt` and `capture.config.ts.txt` are the exact files that
produced `../evidence/before/` and `../evidence/after/`. They ran from a
gitignored copy under `.omo/p1-capture/` (renamed `.ts` → `.txt` here, so
neither typecheck nor lint picks them up).

To rerun from the repo root, after `pnpm build`:

```sh
mkdir -p .omo/p1-capture
cp docs/audits/2026-10-28-all-flows/p1/capture/capture.spec.ts.txt .omo/p1-capture/capture.spec.ts
cp docs/audits/2026-10-28-all-flows/p1/capture/capture.config.ts.txt .omo/p1-capture/capture.config.ts
export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 PLAYWRIGHT_PORT=3510 PLAYWRIGHT_GOOGLE_STUB_PORT=3511
# plus the placeholder NEXTAUTH_SECRET, TOKEN_ENCRYPTION_KEY, CRON_SECRET and
# NEXT_TELEMETRY_DISABLED from .github/workflows/ci.yml
CAPTURE_OUT=after node scripts/run-test-command.mjs e2e \
  pnpm exec playwright test --config .omo/p1-capture/capture.config.ts
CAPTURE_OUT=after CAPTURE_MFA=1 node scripts/run-test-command.mjs e2e \
  pnpm exec playwright test --config .omo/p1-capture/capture.config.ts
```

`CAPTURE_ONLY=f01,f04` limits the run to some flows. Each run starts its own
throwaway PostgreSQL and the e2e stub bridge's fixture tenant; every auth API
call is stubbed. PNGs land in `evidence/<side>/png/`; the committed images
were converted with `cwebp -q 78 -m 6`.
