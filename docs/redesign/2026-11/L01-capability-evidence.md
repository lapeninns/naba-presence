# L01 listing editor capabilities

Implemented in the isolated `codex/presence-l01-capabilities` checkout, based on
merged redesign `c3b76a113537734171f42e4232e0e4b10c9aacaa` and its production
baseline receipt `3574e41053e071780540bb8c6164a1e2d6581870`.

## Behaviour

- An active local link with no active matching Google account, an unusable Google
  connection, or an open reconnect task produces `reconnect_required` in each
  otherwise available resource. Existing role, billing and publishing-switch
  precedence is preserved. Top-level role/entitlement authority is unchanged.
- Normal `expired` credentials remain usable, as do transient error observations
  while the account/connection is usable. No network error is reclassified here.
- An absent active local link still produces `google_location_not_linked`.
- Canonical local editing and saving remain available during a reconnect hold.
  The disposable-DB test saves hours with a revoked connection and reads back
  the exact saved local payload.
- `verified=false` is evidence that verification is not confirmed in the imported
  record. It adds `advisoryCode=verification_unconfirmed` without disabling
  supported writes. The shared hours/profile/menu/booking editor banner consumes
  that advisory. Exact provider operations retain their own eligibility gates.
- Advice does not suppress the hours drift/conflict/empty-schedule notices or
  the profile drift warning. The Google-changed hours recovery action remains
  available beside the verification advisory and changes only the local draft.
- Discontinued API methods remain individually retired in the existing catalogue.
  None of the ten current editor resource keys is wholly retired; supported
  Performance reads are preserved.

## Focused validation

Commands run on Node 24.16.0; fixture DB/browser commands use the existing
`notion-mail-ledger/scripts/with-lock.sh` and `with-e2e-db.sh` wrappers and fresh
local ports. No hosted database, provider write, active Workstream, shared CI run,
or other checkout was modified.

- Test-first unit reproduction: disconnected hours incorrectly returned
  `available`; the wire parser discarded the advisory and the banner was absent.
- `pnpm exec vitest run --project unit tests/editor-gate.test.ts
  tests/location-resource-capabilities.test.ts tests/google-resource-catalogue.test.ts
  tests/capabilities-resource-flags.test.ts tests/capabilities.test.ts` — 46 pass.
- `pnpm exec vitest run --project components tests/components/hours-tab.test.tsx
  tests/components/profile-editor.test.tsx` — 69 pass. The two advisory/drift
  interaction regressions were first reproduced, then fixed; Google hours can
  still be adopted into a draft, and the profile overwrite warning remains.
- `pnpm test:integration tests/integration/routes/location-capabilities.test.ts`
  — 16 pass against disposable PostgreSQL, covering role authority, active/expired,
  revoked/disconnected/missing/inactive account, open/completed reconnect tasks,
  transient error observations, no-link, verification, tenancy and local-save
  readback.
- Changed-file ESLint passes. Production webpack build and its TypeScript check
  pass. The final calibrated advisory copy is rebuilt before browser validation.
- `pnpm test:e2e tests/e2e/editor-capabilities.spec.ts` covers reconnect and
  advisory states at 1440px and 390px, local editing/Save here availability,
  the correct publish-review gate, no publish request, banner screenshots and
  axe checks: four pass on the final calibrated copy, zero banner violations.
  The unverified fixture has genuine Google-dirty hours; its changed-on-Google
  notice and enabled Keep Google’s hours action are asserted at both widths.
  The phone Save here control is in the existing More actions menu. All four
  banner captures were retained; the two phone captures were visually inspected.
- `pnpm exec e2e run tests/agentic/editor-capabilities.e2e.ts --target desktop
  --tag editor-capabilities --output .e2e/l01-review-final-20261105 --no-cache`
  — two selected journeys pass using four actual agent steps and six model calls
  (run `01a1ab3a-eb8d-7199-a615-5ef9f12706d5`, desktop). The report's 16 other
  discovered test/target combinations were excluded by this focused selection.

Run results and screenshots are retained by the release owner under
`outputs/presence-l01-20261105` in the Codex workstream workspace. Full repo QA,
fresh review, final-head shared local CI, merged-main receipt and guarded
production promotion remain release-owner gates; focused results are not those
release gates.
