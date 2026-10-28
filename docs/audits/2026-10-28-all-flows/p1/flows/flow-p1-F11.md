# p1-F11: Read a shared performance report

Worktree `/tmp/naba-presence-p1` @ `e4123d25`, Next 16.4.1. Analysis only. Every claim cites `path:line`; anything not verified in code is marked HYPOTHESIS.

## 1. Flow ID, name, start and end

- **ID:** p1-F11. **Name:** Read a shared performance report.
- **Who:** an outsider (the agency's client) with no account, usually on a phone (`components/share/shared-client-report.tsx:37-40`).
- **Start:** `/share/report/<43-char base64url token>`, opened from a link the agency copied or system-shared out of the share sheet (`components/clients/share-report-dialog.tsx`; that sheet belongs to another team and is out of scope).
- **In-flow navigation:** only `?period=28d|90d|12m` (plain anchors) and the skip link. There are no links into the app.
- **End states:** the report, or one identical "isn't available" page (`app/share/report/[token]/not-found.tsx`), or the read-failure page (`error.tsx`). There is no exit destination: the page is a terminal, read-only surface.
- **Boundaries:** link creation and revocation belong to the Clients/Reports team (POST/DELETE `/api/clients/[clientId]/report-shares`). The figure components (`components/reporting/*`, `components/performance/*`) are shared with Reports.

## 2. Steps today

1. The reader opens the link. The page is `force-dynamic` on nodejs (`app/share/report/[token]/page.tsx:18-19`). Responses carry `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet` and `Cache-Control: private, no-store` (`next.config.ts:108-112,165`), plus robots and referrer meta from the layout (`app/share/layout.tsx:14-24`).
2. The server checks the per-IP `report_share` budget, 120 per 15 min (`lib/server/abuse-limits.ts:153-156`). Over budget, it calls `notFound()` (`page.tsx:50-53`).
3. The token is resolved. A malformed token is refused without a DB call (`lib/server/report-shares.ts:26,40-42,64`). Otherwise the SHA-256 goes to `lookup_report_share`, which returns live links only (`:61-73`). Unknown, expired and revoked all call `notFound()` (`page.tsx:54-55`).
4. `?period` is allowlisted; anything else reads as 28d (`lib/contracts/report-shares.ts:105-116`, `page.tsx:57`).
5. The report loads inside the tenant transaction, narrowed twice: the share viewer and `clientId` (`lib/server/shared-report.ts:95-141`). An archived client returns null, then `notFound()` (`:105-113`, `page.tsx:61`). Google data is included only when ingestion is on **and** `state === "ready"`; otherwise it is `null` (`shared-report.ts:184-225`).
6. The view is counted after the response, best effort (`page.tsx:64`, `report-shares.ts:79-99`).
7. Render (`shared-client-report.tsx`):
   - skip link "Skip to the figures" (`:112-117`)
   - `<header>`: eyebrow "Performance report", h1 client name, the line "{Last 28 days} · {d Mon – d Mon}", and the period nav (`:118-148`)
   - `<main id="main">`: "Reviews and replies" (`ReplyFigures audience="public"`), with "By listing" shown only when there is more than one location (`:179-197`)
   - "Google Business Profile" with `PresenceProvenance`, `PartialCoverageAlert` and `PresenceFigures` (`:200-220`)
   - `<footer>`: a definition list (Listings, Prepared by, Generated) and a disclaimer paragraph (`:223-249`)
8. **Period switch:** a full reload via `href="?period=90d#main"` with `aria-current="page"` on the current period (`:137-141`). It works without JavaScript and every switch is counted as a view.
9. **Failure:** a thrown read renders `error.tsx`: "This report couldn't be loaded" with a "Try again" button that calls `reset()` (`error.tsx:12-28`).

## 3. States inventory

The page makes **no browser API calls**: there are no TanStack queries and every figure is in the server-rendered HTML. A `page.route` stub therefore cannot change what it shows. States come from the URL plus DB seed (or the vitest DOM). The only request on load and on a period switch is the document `GET /share/report/<token>?period=…`. The CSV and chart "values" buttons work locally.

| State | How reached | What the user sees | Notes |
|---|---|---|---|
| Populated, 28d (default) | Create a link as the e2e does: journey owner cookie → `/clients/{clientId}` → "More actions" → "Share report" → footer "Create link" → read textbox "Report link" (`tests/e2e/reports.spec.ts:323-336,403-413`). Then open its **pathname** in a fresh context with no cookie. | See "Seeded data" below | POST needs `mfa: "step_up"` (`app/api/clients/[clientId]/report-shares/route.ts:54-56`), so use the UI path rather than `page.request`. Revoke afterwards (`reports.spec.ts:451-461`). |
| Period 90d / 12m | Click "Last 90 days" or load `?period=90d#main` | Same page. Weekly or monthly bars. Lands scrolled to `#main`, with the period line and tabs above the viewport | Capture at 390×844 straight after the click, without scrolling, to show what the reader lands on |
| Junk period | `?period=foo` | The 28d report, with 28d marked `aria-current` | |
| Not-found (bad/expired/revoked/archived/rate-limited) | `/share/report/nm-capture-invalid-token` (used by `tests/visual/nm-capture.mjs:128`), or a revoked link (`reports.spec.ts:463-501`) | h1 "This report link isn't available", one sentence, no link, no button | HTTP 404. Do not try to reach the rate-limited case: the IP is null locally unless a trusted IP header is configured (`abuse-limits.ts:327-334,387`) |
| Read failure | DB error inside `page.tsx` | "This report couldn't be loaded" with "Try again" | **Not capturable in the harness** without fault injection. Render `ShareReportError` in vitest instead |
| No reviews in either window | Client with no reviews in the window | Framed panel "No reviews in this period" / "No reviews arrived for these listings in the last 28 days." (`reply-figures.tsx:187-207`) | |
| No listings | A client with zero locations | The same panel ("for these listings"), no Google section, footer "Listings: None yet" (`shared-client-report.tsx:231`) | Contradictory (see F5) |
| Google not ready | No `performance_metric_daily` rows in the window | The whole "Google Business Profile" section is absent, with no note (`shared-client-report.tsx:200`, `shared-report.ts:185`) | |
| Partial Google coverage | One linked location without metrics, which **the journey fixture already is** | Warning "Showing 1 of 2 listings" plus the operator-worded list | |
| Divergent review totals | `providerTotals.divergence` | Warning "These figures may be incomplete", in public wording (`divergence-banner.tsx:11-12`) | |
| Dark / print | `colorScheme: "dark"`; `emulateMedia({ media: "print" })` | Tokens flip. In print the nav and buttons hide (`shared-client-report.tsx:109,133`) | See F7 |

**Seeded data, "Sprint 5 Journey" (`tests/e2e/helpers/stub-bridge.ts`, `tests/integration/helpers/tenant.ts:228-331`).** These are predictions from the seed; capture to confirm.

- **Agency and client:** agency (organisation) "Sprint 5 Journey tenant" (`stub-bridge.ts:141-151`); client "Journey Hospitality" (`:935-943`). Both org locations are filed under it: "Stub location xxxxxxxx" ×2, one per `seedLinkedReview` (`:113-137`). Timezone Pacific/Auckland, so the footer reads "Generated 29 Oct 2026, hh:mm NZDT".
- **Reviews and replies (all three periods):**
  - Reviews **2**, ▲ +2 vs the previous period (the previous window had 0 reviews).
  - Response rate **0%**. No replies are seeded, but other journey specs may publish one; on a fresh harness it is 0%.
  - Median response time **"—"**.
  - Average rating **4.5** (5★ + 4★, both `now() - 1 day`), with no delta.
  - Caption: "Changes compare with the 28 days before this period."
  - Charts: one bar of 2.
  - "By listing": 2 rows (5.0 and 4.0, 0%, —, Unresolved 0).
- **Google, one day (today UTC) on the primary location only (`stub-bridge.ts:153-171`):**
  - Search views **400** (140+260).
  - Maps views **No data**, Call button taps **12**, Website clicks **30**, Directions requests **No data**.
  - Other actions: four "No data".
  - No previous window, so no Google deltas.
- **Provenance.** The seeded checkpoint has no `last_succeeded_at` (`stub-bridge.ts:198-204`; no trigger sets it). The page should therefore read: "Figures up to {today} · **Nothing fetched from Google yet**" and "**0 of 2 listings up to date · 1 with figures but no recorded fetch · 1 waiting for a first fetch**" (`presence-provenance.tsx:96-146`, `lib/domain/report-coverage.ts:130-170`).
- **Alert:** "Showing 1 of 2 listings · **Not fetched from Google yet**: Stub location … · Totals include only the listing shown… · Complete for every listing shown through {today}."

These seeded states are good BEFORE evidence for F2.

## 4. Protected rules (must not change)

- One identical `notFound()` (HTTP 404) for malformed, unknown, expired, revoked, archived-client and over-budget tokens, before anything streams (`page.tsx:21-37,53,55,61`; `report-shares.ts:16-22,35-42`; `not-found.tsx:5-10`). **Never add `app/share/**/loading.tsx`:** a Suspense shell would stream a 200 before `notFound()`.
- Token scoping: SHA-256 lookup, live links only, and a double client narrowing (`report-shares.ts:61-73`, `shared-report.ts:24-56,105-141`). The DTO is copied field by field, with names only and no ids (`lib/contracts/report-shares.ts:134-141`, `shared-client-report.tsx:49-64,85-98`).
- The only inputs are the token and the allowlisted `period` (`page.tsx:24-26`, `contracts:100-116`).
- noindex, nofollow, no-referrer and no-store, in headers and metadata (`next.config.ts:108-112,165`, `layout.tsx:14-24`).
- No links into the app (`shared-client-report.tsx:29-33`, `reply-locations-table.tsx:65` with `linked={false}`, `not-found.tsx:9`, `error.tsx:9-10`).
- Period links stay plain `<a>`: they work without JS, avoid prefetch and count the view (`shared-client-report.tsx:129-132`).
- View counting must never fail the page (`page.tsx:63-64`). The abuse budget is unchanged.
- Honesty rules: a missing figure is "—" or "No data", never 0 (`reply-figures.tsx:32-42`, `presence-figures.tsx:66-69`).

## 5. Prior audit status (15 Oct)

- **CLR-12:** fixed and verified.
  - Metadata moved to the footer (`shared-client-report.tsx:223-249`); the header is just the name, period line and nav (`:118-148`).
  - Period links end in `#main` (`:138`), covered by unit (`tests/components/shared-report-page.test.tsx:264-279`) and e2e (`reports.spec.ts:437-446`).
  - Residual: landing on `#main` puts the tabs and period label above the fold (F3).
- **CLR-11** (share sheet): fixed. Out of scope (other team).
- **CLR-06:** partly fixed. The shared report uses `LISTING_TERMS` "listing(s)" throughout (`shared-client-report.tsx:188,227-228,246`); the business-mode remainder is not this page's.
- **CLR-03** (contradictory provenance): fixed for operators (`report-coverage.ts`). On the public page, though, the operator wording is shown to an outsider (F2).
- **SET-17/18/23** do not touch this flow.

## 6. Friction found

| # | Observation | Evidence | Sev | E/H |
|---|---|---|---|---|
| F1 | **"Try again" doesn't re-fetch and has no pending state.** It calls `reset()`, which only clears the boundary and re-renders the same failed server payload, so the error comes straight back. Next 16.4.1 passes the re-fetching function as **`retry`** (it does `router.refresh()` then `reset()`), and never passes `unstable_retry`. The other boundaries read `unstable_retry ?? reset`, so they **also silently fall back to `reset`**. | `app/share/report/[token]/error.tsx:12,22`; `node_modules/next/dist/client/components/error-boundary.js:39-48,114`; `.d.ts:6,32`; `grep unstable_retry node_modules/next/dist` finds only the docs changelog (`error.md:332`). Same pattern in `app/(auth)/error.tsx:26,57`, `app/(dashboard)/error.tsx:40,60`, `app/global-error.tsx:25,96`. Unit tests inject `unstable_retry` by hand, so they can't catch it (`tests/components/system-pages.test.tsx:48`) | P1 | Evidence (behaviour after click: HYPOTHESIS until a unit test proves it) |
| F2 | **Operator diagnostics on a client-facing page.** The reader sees "Last fetched between …", "1 with figures but no recorded fetch", "waiting for a first fetch", "refresh failed for 1", "Not fetched from Google yet", "Could not be refreshed" and "Latest refresh failed…". The same coverage fact is stated twice (the provenance count line and the alert), and "complete through" twice ("All reporting listings complete through" and "Complete for every listing shown through"). In the journey fixture: "Figures up to {today} · Nothing fetched from Google yet", which contradicts itself. The reply half already has a public voice (`DivergenceBanner`, `ReplyFigures` `audience`); the Google half does not. | `shared-client-report.tsx:215,217`; `presence-provenance.tsx:96-146`; `partial-coverage-alert.tsx:24-29,62,86,145`; precedent `divergence-banner.tsx:4-13`, `reply-figures.tsx:78-105` | P2 | Evidence (copy); fixture rendering HYPOTHESIS |
| F3 | **After a period switch the period label and tabs are off-screen.** `#main` starts below the header, so the reader lands on the figures without "Last 90 days · dates" in view. Comparing a third period means scrolling back up each time, which is CLR-12's original complaint moved down the page. `main` states no period range of its own (only "Changes compare with the 90 days before this period", `reply-figures.tsx:279-283`). | `shared-client-report.tsx:123-128,138,150-153` | P2 | Evidence (anchor); viewport HYPOTHESIS (capture at 390×844) |
| F4 | **The Google section disappears with no word.** When Google isn't "ready" for the chosen period (pending, empty, unavailable, ingestion off), the h2 and everything under it vanish. Switching from 12m to 28d can drop half the report unexplained, yet the footer still says "profile figures are as reported by Google". | `shared-report.ts:184-186`; `shared-client-report.tsx:200,245-247`; test `shared-report-page.test.tsx:329-334` | P3 | Evidence |
| F5 | **No-listings report contradicts itself.** "No reviews arrived for these listings in the last 28 days." appears beside "Listings: None yet" in the footer. | `reply-figures.tsx:100-101,203`; `shared-client-report.tsx:231` | P3 | Evidence |
| F6 | **Rate deltas read as relative change.** Response rate shows "80%" (whole number) with a delta "+12.5%" (one decimal), which is a difference in percentage points. An outsider may read it as "12.5% better". | `lib/format/delta.ts:35`; `lib/format/number.ts:7-9`; `reply-figures.tsx:246-250` | P3 | Evidence (shared formatter, so not proposed) |
| F7 | **Printing from dark mode** may give light ink on white paper. There is no `@media print` rule, `.dark` tokens apply in print, and the layout only sets `print:bg-surface` (also a dark token). | `app/globals.css:803-804,931-933` (grep for `@media print`: none); `layout.tsx:32` | P3 | HYPOTHESIS (verify with `emulateMedia({ media: "print", colorScheme: "dark" })`) |
| F8 | The Google caption repeats a second, slightly different date range ("30 Sept – 27 Oct", UTC) beneath the header's range (org zone), with no label saying it is Google's. | `shared-client-report.tsx:125-127,212-214` | P3 | Evidence; reader confusion HYPOTHESIS |

**Fine, leave alone:**
- The period nav marks `aria-current="page"` and draws it with weight plus underline, not colour alone (`tabs.tsx:195`).
- Tab targets are 44px on a phone and 40px on desk, well over the 24px of WCAG 2.5.8 (`tabs.tsx:193`). The nav wraps instead of scrolling sideways (`shared-client-report.tsx:134`).
- One h1, a banner/main/contentinfo landmark set, and a skip link (test `:424-432`).
- Zone-named times (`:239`).
- Print hides the controls and keeps the figures together (`:109`).
- The identical not-found copy (`not-found.tsx:14-17`).
- First-screen hierarchy on a phone: name, then period, then tabs, then tiles (CLR-12).
- The reply wording for outsiders ("Reviews with a reply posted to Google", "Not calls answered", the "Unresolved" explainer, `reply-figures.tsx:65-76`, `metric-labels.ts:63`, `shared-client-report.tsx:190-194`).

## 7. Proposed changes (smallest coherent set)

**C1. A real retry with a pending state** (fixes F1; P1). File: `app/share/report/[token]/error.tsx` (area-local).

- Accept `{ reset, retry, unstable_retry }`, all optional except `reset`.
- Add `const [pending, startTransition] = React.useTransition()`.
- `onClick={() => startTransition(() => { (retry ?? unstable_retry ?? reset)() })}`, with `disabled={pending}` and `aria-busy={pending || undefined}`.
- Add `<RotateCw strokeWidth={1.75} aria-hidden />` and the label `{pending ? "Trying again…" : "Try again"}`. This matches `app/(auth)/error.tsx:32,50-63` verbatim.
- Keep the title and sentence unchanged.

| Aspect | Detail |
|---|---|
| Benefit | The button actually re-runs the server page, so a transient DB blip recovers in one tap, and the reader sees that something is happening. |
| Principle | Nielsen #1 and #9; HIG consistent feedback; WCAG 4.1.3 (busy state exposed). |
| Risk to protected behaviour | None. `retry` refreshes the same URL. A retry costs one budget unit and, if it succeeds, counts one view, exactly like a browser reload. If the token has died meanwhile, the RSC `notFound()` renders the same not-found page. |
| Shared file? | No. |
| Cross-flow (for the coordinator) | The same one-token fix (`retry ??` ahead of `unstable_retry`) applies to `app/(auth)/error.tsx:26-30,57` (p1 area) and to the dashboard and global boundaries (other owners). |

**C2. One public voice for the Google provenance and coverage** (fixes F2 and F8; P2).

(a) `components/share/shared-client-report.tsx:212-215`: replace the caption and `<PresenceProvenance …/>` with one local line:

```tsx
<p className="text-caption text-ink-muted tabular-nums">
  {formatPeriod(presence, "UTC")}
  {presence.freshThrough ? ` · Figures up to ${formatDate(presence.freshThrough, "UTC")}, as reported by Google` : null}
</p>
```

(`formatDate` comes from `@/lib/format`.) This drops "Last fetched…", the coverage counts and "All reporting listings complete through…", which are operator facts already covered by the alert.

(b) `components/reporting/partial-coverage-alert.tsx`: add an opt-in `audience?: ReportAudience` (default `"internal"`, type from `divergence-banner.tsx:4`). With `"public"`:
- MISSING_LABEL becomes:
  - pending: "Not available yet"
  - unavailable: "Temporarily unavailable"
  - no_data: "Google reported nothing for this period"
  - stale: "Google's latest figures end before this period"
- The `behind` line (`:145`) becomes "Figures may stop early for: {names}".
- The title fallback (`:135`) becomes "Some figures may stop early".
- The share page passes `audience="public"` at `:217`.

| Aspect | Detail |
|---|---|
| Benefit | The client reads what the gap means, not how the agency's sync works. Each fact appears once, and the fixture's self-contradiction goes away. |
| Principle | Nielsen #2 (match the real world) and #8 (minimalist); HIG clarity; the DivergenceBanner precedent. |
| Risk to protected behaviour | None. Copy only, no DTO change. Missing listings are still named, and "never counted as zero" stays. |
| Shared file? | (b) only, and opt-in. Callers: `components/performance/google-performance-tab.tsx`, `keywords-tab.tsx`, `location-performance.tsx`, `components/share/shared-client-report.tsx`. Defaults are unchanged, so the operator views don't move. |
| Tests to update | `shared-report-page.test.tsx:366,375` ("Could not be refreshed" becomes "Temporarily unavailable"; delete the "All reporting listings…" assertion). |

**C3. A period switch lands on the period line** (fixes F3; P2). File: `components/share/shared-client-report.tsx`.
- `:123`: add `id="period"` and `scroll-mt-4` to the `<p>`.
- `:138`: change the href to `` `?period=${option.id}#period` ``.
- The skip link stays `#main`.

| Aspect | Detail |
|---|---|
| Benefit | After every switch the label ("Last 90 days · …"), the three tabs and the first tile row are all on screen, so the reader can compare periods without scrolling. This is the "period-specific anchor" CLR-12 itself offered. |
| Principle | HIG preserved context; Nielsen #6 (recognition); WCAG 2.4.3 and 3.2.3 (consistent). |
| Risk to protected behaviour | None. Still plain anchors, still a reload, still counted. |
| Shared file? | No. |
| Tests to update | Hrefs at `shared-report-page.test.tsx:270-273` and `reports.spec.ts:440` become `#period`. Keep `main` in the viewport and add "period line in viewport". |

**C4. Say when Google figures are absent** (fixes F4; P3).
- `shared-client-report.tsx:200-220`: when `!presence && report.venues.length`, render the same `<section aria-labelledby="shared-google">` with its h2.
- The body is one caption: "No Google profile figures for this period."
- Update the test at `:329-334` to expect the heading plus this sentence and no tiles.
- Principle: Nielsen #1. No risk: it reveals nothing beyond "absent". Not a shared file.

**C5. An honest no-listings state** (fixes F5; P3).
- `shared-client-report.tsx:155-198`: when `report.venues.length === 0`, render instead of `<ReplyFigures>` a `ReportingPanel framed titleAs="h3" variant="empty"` with:
  - title "No listings in this report yet"
  - description `` `${report.agencyName} hasn’t added any listings for ${report.clientName} yet. Figures appear here once they do.` ``
- Principle: Nielsen #2; error prevention against a misleading zero. No risk; not a shared file. `ReportingPanel` is already used by `ReplyFigures`.

## 8. Explicitly not proposed

- **Any reason-specific "expired" / "revoked" / "slow down" copy:** this is protected (identical 404).
- **Adding `loading.tsx`:** it would break the 404 status.
- **Using `TabNav` or Next `Link` for periods:** prefetch would count views, and the strip scrolls sideways.
- **"pts" for percentage-point deltas (F6):** the right fix lives in the shared `lib/format/delta.ts`, used app-wide. Route it to Platform/Reviews (P11 vocabulary).
- **A print colour-scheme reset (F7):** it would need a global `@media print` rule in `app/globals.css`. Verify first, then hand to Platform.
- **Showing link expiry in the footer:** it needs `expiresAt` in the `SharedClientReport` DTO (a contract change), so it is an owner decision.
- **The client name in the tab `<title>` via `generateMetadata`:** it needs a second token resolve and budget unit per view.
- **"Venue" instead of "listing":** P11 settled on one place-noun (`lib/workspace/terms.ts:45-53`).
- **The CSV "Google metric" raw-key column:** a shared operator export.
- **A digest or "Reference" on the share error page:** meaningless to an outsider.
- **A no-JS `<a href="">` retry:** inconsistent with the boundary pattern, and the browser's reload already works.
- **Any change to the share sheet:** other team.

## 9. Tests

**Existing coverage:**
- `tests/components/shared-report-page.test.tsx`: identical 404 for each cause, budget before resolve, tenant scoping, period allowlist, view after response, view copy and landmarks.
- `tests/report-shares.test.ts`: token format, hash-only, status, `parseSharePeriod`.
- `tests/integration/routes/report-shares.test.ts`: create, list and revoke.
- `tests/e2e/reports.spec.ts:317-502`: the sheet, the public report's hierarchy and `#main` landing, and revoked equals not-found.
- `tests/visual/nm-capture.mjs:128`: the invalid-token capture.
- `tests/components/system-pages.test.tsx`: other boundaries, which inject `unstable_retry`.
- `accessibility.spec.ts` and `touch-critical.spec.ts` do not visit `/share/**`.

**Worth adding:**
1. **Unit, `ShareReportError`:** with `retry` passed (the real 16.4.1 prop name), a click calls `retry` once rather than `reset`, and while pending the button reads "Trying again…", is disabled and is `aria-busy`. Add a fallback test for `reset` alone. Also add one test per other boundary that passes `retry` rather than `unstable_retry`.
2. **Unit, public coverage copy:** within `main`, `not.toHaveTextContent(/fetch|refresh/i)` for partial, refresh-failed and pending completeness; the alert uses the public labels; the operator views are unchanged (`audience` omitted).
3. **Unit:** the period hrefs end `#period`; the no-listings panel replaces "these listings"; the Google-absent sentence.
4. **E2E (share block):** axe with `WCAG_TAGS` plus `STRUCTURE_RULES` on the populated report at 390 light and dark. After the "Last 90 days" click, the period line and nav are `toBeInViewport()`. A print emulation screenshot in dark mode as evidence for F7.
