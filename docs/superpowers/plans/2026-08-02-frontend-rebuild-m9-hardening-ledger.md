# M9 Hardening (full parity / release bar) — SDD ledger & carry-forward register

**THE FINALE. With this merge the frontend rebuild (M1–M9) is code-complete.**

Preserved from the gitignored SDD progress ledger at merge time. Plan:
`docs/superpowers/plans/2026-08-02-frontend-rebuild-m9-hardening.md` (commit
`8f761bb` + plan-review revisions `7a724a2`). Merged to `main` as a clean
fast-forward from `c2c87a7` (M8). Milestone HEAD at merge: `e7d85c9`.

Unlike M2–M8, M9 is a cross-cutting **hardening sweep** against the spec §10
release bar — "all rebuilt surfaces, zero reproducible Critical/High findings
from the 2026-07-31 audit, every quarantined test re-enabled, and the legacy
redirects restored" — and it is the ONE milestone that deliberately touches
protected server paths (the "full parity" pass).

## Owner decisions (locked 2026-08-02, via AskUserQuestion)

- **D1 — §5 server-hydration → DEFERRED** as a documented post-release
  fast-follow (see Tracked deferrals). Large, latency-only, not in the §10
  release bar, correctness/security-independent.
- **D2 — canRequestApproval → ADD IT.** Non-publishers could not submit a
  reply for approval via the UI though the server accepts it.
- **D3 — auth enumeration → NORMALIZE.** Collapse the sign-in enumeration
  channels to a generic error.

## Sanctioned protected-path edits — the ENTIRE protected footprint (5 files)

`git diff --stat main..e7d85c9 -- app/api lib/server lib/domain supabase
scripts instrumentation.ts next.config.ts` is **exactly** these five, nothing
else:

1. **`app/api/locations/[id]/posts/[postId]/approval/route.ts`** (SEC-1, `7789b90`)
   — `requireLocationAccess(sql, session, id)` added as the first `withTenant`
   statement in the **reject** branch (approve was already safe). Throws 404
   `review_not_found` (not 403 — no existence disclosure); a zero-assignment
   member still passes; only an assigned-elsewhere member is blocked. Proven by
   `tests/integration/routes/post-approval-access.test.ts`.
2. **`lib/server/password-auth.ts`** (D3, `3c6f8d7`) — login-path
   `email_not_verified` (403) + `auth_rate_limited` (429) collapsed into a
   generic `invalid_credentials` (401); genuine infra failures (502/503/504)
   still surface distinctly. Sign-up/reset/resend 429s intentionally retained
   (documented residual). Sign-in client got an always-visible "Resend
   confirmation email" affordance (non-protected).
3. **`next.config.ts`** (S3, `410179c`) — `Referrer-Policy`
   strict-origin-when-cross-origin, `X-Frame-Options` DENY, `X-Content-Type-Options`
   nosniff, and a conservative CSP. `img-src` allows the Google thumbnail hosts
   (`*.googleusercontent.com`, `*.ggpht.com`) actually used by review media +
   photos — the R1 blocking plan-review fix (a bare `img-src 'self'` would have
   shipped broken thumbnails that the `media:[]` e2e fixtures could not catch).
   `'unsafe-inline'` is a commented, accepted tradeoff (nonce follow-up noted).
4. **`app/api/privacy/export/route.ts`** (`d3e840f`) — GET→POST so the subject
   is in the JSON body, never a URL/query (no PII in referrers/logs);
   `requireRole(owner)` + private/no-store + attachment + 404
   `privacy_subject_not_found` byte-identical; legacy GET removed (405s). Client
   `lib/api/privacy.ts` repointed (non-protected).
5. **`lib/server/capabilities.ts`** (D2, `a8042d9`) — additive
   `canRequestApproval` on every `ReviewCapabilities` branch (owner/admin/viewer
   = false; member = `canEdit && !canPublish && organisation.approval_required`).
   Purely additive — no publish/edit escalation; reuses the existing publish
   transition guard. `app/api/reviews/route.ts:139` inline fallback kept
   **byte-identical** (R5 — verified not in the diff).

## Non-protected work

- **Release-bar tests** — `playwright workers:1` (§9; kills the journeys
  8/9-worker CPU flake); revived `routing.spec` (guards the 4 legacy redirects,
  the `/reviews→/inbox` one hardened path+query against the LOCAL_BOOTSTRAP
  auto-select race); revived + adapted `accessibility.spec` (repo-wide axe sweep,
  both themes, dialogs-open, ~dozen stale-locator drifts fixed test-side, real
  journey-cookie for role-gated pages, virtual clock for the stale banner);
  retired `review-provider-races.spec` (tested the epoch/scope machine §6
  removed). **`testIgnore` is now empty — every quarantined test re-enabled.**
- **canRequestApproval UX** (D2) — a reachable, humane "Submit for approval"
  inbox affordance for non-publishers, mirroring the publish transition guard.
- **a11y / UX / token nits** — variant-aware `alert` role; label-in-name;
  error/not-found landmarks + `error.tsx` `<main id="main">` skip-link target;
  hours-editor stable synthetic keys; `DangerZoneDialog` empty-name guard
  (`&& expectedName.trim().length > 0`); neutral console "Category" fallback;
  photos `accept="image/jpeg,image/png"`; `formatDelta` clock-skew guard; honest
  inbox/delete toast copy incl. `publish_in_progress`; backfill `lastErrorCode`;
  chart/toast/checkbox token nits; `table.tsx` scrollable-region focusability;
  inbox mobile list↔detail focus management.
- **Final carry-forward closeout** (`e7d85c9`) — legal-hold `reviewId` →
  `z.uuid()` (+ invalid-UUID + trim tests); removed a dead `timezone?` prop from
  `reply-locations-table`; `InvitationRow` distinguishable Accept/Decline pending
  state (+ TDD test); the M2 auth nit cluster (deduped "Back to sign in" /
  "Go to sign in" links, focus-to-banner + `focusField` on server errors, the
  owed reset-token-max / same-email-invite tests).

## Gate at merge (independently re-run from scratch on `e7d85c9`, GATE GREEN)

typecheck clean; lint 0 errors (3 pre-existing test-file warnings); unit +
component **658 passed** (5 new closeout tests); build "Compiled successfully"
(webpack, 64 routes); e2e **160 passed** at **workers:1** (all 12 specs, both
themes — the standing zero-console-error/pageerror + axe-incl-heading-order
guard; the intermittent doc-title timing flake did not recur under serial
workers); integration **188 passed** (byte-parity oracle + the SEC-1 /
enumeration / capability security tests). Protected footprint = exactly the 5
sanctioned files.

## Whole-branch review (four parallel opus agents on `88b806b`)

- **General: APPROVED** — tokens/copy/React-correctness clean; the 3 release-bar
  fixes + non-protected cleanup verified; no jsdom-blind regressions. 2 minors
  (the byte-identical `reviews/route.ts:139` fallback; a cosmetic SVG
  `font-size:var()` on chart axes).
- **Capability/tenant-security: APPROVED** — all 5 named risks pass against the
  real code: SEC-1 (404-not-403, zero-assignment passes, approve/reject
  consistent, RLS preserved); D3 (no sign-in enumeration channel, infra 5xx still
  distinct); S3 (CSP covers the only two client `<img>` sites, not
  over-permissive); privacy POST-only, no PII-in-URL; canRequestApproval purely
  additive, no escalation, viewer cannot even create the prerequisite draft.
- **Independent gate (from scratch): GATE GREEN.**
- **Completeness critic** — all 5 audit Critical/High **CLOSED and
  diff-verified**; every named punch-list carry-forward CLOSED; found 5 *Minor*
  lower-priority carry-forwards owed to M9 but dropped without documentation. All
  5 were then addressed in the closeout: 4 closed, 1 documented-deferred (below).

## Tracked post-release deferrals (the ONLY things M9 ships without)

1. **§5 server-hydration (D1)** — the RSC-prefetch/dehydrate retrofit across all
   read surfaces. Extract the remaining inline-SQL read-services
   (analytics/overview — 17-SQL, the fattest — counts, members, invitations,
   privacy, legal-holds; connections/inbox-list/location-tabs services already
   exist) for byte-parity under the integration oracle (which is subset-matching
   `toMatchObject`, not exact-byte — note for the retrofit), then RSC
   prefetch+dehydrate into the existing Query keys across ~18 pages. Latency-only.
2. **M6 #2 — import location-specific timezone** (`lib/queries/use-location-import.ts`).
   The import still stamps the browser IANA zone
   (`Intl.DateTimeFormat().resolvedOptions().timeZone`) rather than the imported
   location's real timezone. Closing it for real requires **a protected edit** to
   `app/api/google/locations/route.ts`: `DiscoveredLocation` carries no timezone
   field and the GBP discovery API does not expose one directly, so a
   derivation step must be added server-side. Out of a non-protected closeout's
   scope; low impact (single-region product today). An in-code comment marks the
   intended behaviour.

---

**Rebuild status: M1–M9 all merged to `main` (`e7d85c9`). The frontend rebuild
is complete.** The standing e2e guard (zero console/pageerror + axe incl.
heading-order, every route, both themes) caught a real jsdom-invisible defect in
M3, M5, M6, M7 (×2), M8, and M9 — it is load-bearing; never weaken it.
