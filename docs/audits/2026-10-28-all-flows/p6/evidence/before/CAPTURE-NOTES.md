# p6 BEFORE capture notes

- **Checkout:** `/tmp/naba-presence-p6-base`, detached at `origin/ux/all-flows-presence` =
  `e4123d251cf9414c74e69b9cff018ba1c574d762`, served from its own production build (`pnpm build`, then
  `pnpm start` on port 3562). `.env` and `.env.local` were symlinked from the main checkout and not read.
- **Database:** a throwaway PostgreSQL cluster started, migrated and stopped by
  `scripts/run-test-command.mjs e2e` (the repo's e2e harness). The capture didn't use the shared local
  `naba_visual` database: it was missing on 28 Oct (the local cluster on port 54322 then belonged to another
  project). The fixture tenant is the e2e stub bridge's "Sprint 5 Journey tenant", seeded by
  `../../capture/throwaway-fixtures.ts` and destroyed at the end of each run. Google calls went to the local
  stub on port 3563.
- **Fixture settings:** `privacy_settings` and `workspace_mode_change` were switched on for the fixture
  organisation only, with `pnpm ops:pause feature … --operator visual-capture-p6` against the throwaway cluster.
- **Configurations:**
  - **A:** billing off, MFA off. Covers every state except those listed under B.
  - **B:** `BILLING_ENABLED=true MFA_ENABLED=true`, on the app process only. Covers security, billing,
    billing-canceled, billing-admin-denied, billing-confirming, usage, usage-member and
    settings-index-billing-on.
  - **Both:** Stripe keys blank, `EMAIL_PROVIDER=none`, `OPENAI_API_KEY` blank. The browser aborts requests to
    any host other than localhost.
- **Run:** `/tmp/p6-before-pipeline.sh`. It took the visual lock at 22:34 GMT and released it at 22:40 GMT on
  28 Oct 2026. The command is `node scripts/run-test-command.mjs e2e sh …/capture/run-throwaway.sh <out> AB`.
  `shots.mjs` first visits every route once at both widths, then shoots.
- **Result:** 31 states × 3 variants = 93 shots. 93 succeeded and 0 failed. No console errors were recorded,
  and no state overflowed horizontally (`shots.jsonl`).
- **Not interactive beyond opening:** no setup pressed a final confirm.
  - Sheets and dialogs were opened, a role was chosen and a workspace name was typed.
  - At 1280, `team-member-sheet` opens the row's ⋯ menu, because the desk table has no member sheet.
  - `billing-confirming` shows the "confirming" state (no subscription in the fixture), not "delayed".
- **Earlier attempts (discarded):**
  - A first pass ran on `next dev`. Its config B pages looped Fast Refresh reloads, so shots were interrupted.
    All of its images were replaced by this production-build set.
  - An attempt with `naba_visual` failed because that database was missing.
