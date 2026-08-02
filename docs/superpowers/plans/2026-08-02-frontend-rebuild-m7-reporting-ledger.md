# M7 Reporting — SDD ledger & carry-forward register

Preserved from the gitignored SDD progress ledger at merge time. Plan:
`docs/superpowers/plans/2026-08-02-frontend-rebuild-m7-reporting.md` (commit
`9d972f4` + plan-review revisions `68562e0`). Merged to `main` as a clean
fast-forward from `86ebf5e` (M6). Milestone HEAD at merge: `6c8b808`.

## What shipped (8 tasks, 67 files, +5.8k) — ZERO protected footprint

Reporting = **Home polish + Performance**, entirely client-fetched:

- **Home polish** — widened the (previously lossy) analytics schema to the full
  overview shape; a 7-tile KPI row (labels preserved: "Total reviews"/"Average
  rating"/"Response rate"); the `providerTotals.divergence` trust banner (renders
  only when `divergence === true`); trend chart cards that cross-link to
  `/performance`; the attention list now links each location's **low-rated**
  reviews (`?rating=1,2`); skeleton 3→5.
- **`/performance`** (URL-tabbed via `?tab=`) — **reply-performance** (overview
  series charts, prior-window deltas with non-colour cues, a nulls-last honest-null
  per-location table, the divergence banner); **Google-performance** (presence
  metrics charts, the five-state `no_link|ready|unavailable|pending|empty` handling
  + `ingestionEnabled:false` off-panel, humanised metric labels + unavailable
  reasons, an owner/admin "Refresh Google data" trigger); **keywords** (503
  `keywords_paused` panel, honest "N+" thresholded impressions).
- **Per-location Performance tab** (7th location tab) — assembles review metrics by
  client-filtering `overview.locations[]` by id (overview has no `locationId`
  param) + `presence`/`keywords` by `locationId`; honest "no review activity" when
  a zero-review location is absent from the inner-joined `overview.locations[]`.
- **Foundation** — the first chart primitive (`components/ui/chart.tsx` via the
  already-installed `recharts@3.8.0`, themed to the `--chart-1..5` oklch tokens,
  integer ticks, ChartLegend, distinct states); `StatTile`/`DeltaBadge`
  (non-colour)/`FetchedAtCaption`/`ReportingPanel`/`nullableCell`; the humanisation
  maps (`metric-labels.ts` over all 11 metrics, `unavailable-reasons.ts` with a
  load-bearing fallback); a client `useSession`/`useSessionRole` hook; and the
  **`formatDuration` negative guard** (the M1→M7 carry-forward — closed).
- **Housekeeping** — the `/analytics→/performance` redirect; nav `/performance`
  `prefetch:false→true` (the last remaining false).

## Key decision — client-fetch; §5 server-hydration deferred to M9

No `lib/server` analytics read-service exists (all four reporting routes are inline
SQL), so §5-compliant RSC prefetch would mean net-new service extraction + a
byte-parity refactor of four **protected** routes. Deferring keeps M7 at **zero
protected edits** (reporting reads are `requireSession` + location-scoped
server-side; no new capability; the only privileged action is the pre-existing
owner/admin sync-trigger, gated client-side on `useSessionRole`). §5 for all read
surfaces is consolidated into M9's full-parity pass. Charts use the pre-installed
`recharts` (not a new dep).

## Gate at merge (independently re-run, GATE GREEN on 6c8b808)

typecheck/lint clean; unit+component **590 passed**; build 64 routes; e2e **78
passed / 0 failed** (journeys clean); integration **183/183** (untouched parity
oracle). `performance.spec.ts` 10/10 (twice in isolation), incl. axe-clean
structure (heading-order) in light + dark; `home.spec.ts` + the per-location
Performance test green. `git diff --stat main..HEAD -- app/api lib/server
lib/domain supabase scripts instrumentation.ts` is **EMPTY**.

## Whole-branch review (three parallel agents)

- **General (opus): clean** — zero-protected, tokens (chart colours via
  `--chart` vars), one-h1/one-main, humanisation complete, no new dep.
- **A11y/format/humanisation (opus): clean** — heading order valid on every
  `/performance` tab + Home + per-location; exhaustive metric humanisation with
  fallback; `formatDuration` negative guard feeding response-time cells;
  non-colour deltas; nulls-last honest-null table; identical light/dark chart
  tokens.
- **Independent gate (sonnet): GATE GREEN** after fix-wave 2.

**The jsdom-blindness lesson held twice more this milestone** — both caught only
by the e2e, both fixed without weakening a guard:
1. `reply-performance-tab.tsx` called `resolveReplyRange` (default `now = new
   Date()`) in the render body → a fresh query key every render → an **infinite
   fetch loop** (72 `/api/analytics/overview` requests in 5s). Fixed by memoising
   the range (`bb67f1d`). The reply tab was the sole loop site (every other
   `useAnalyticsOverview` caller uses stable args).
2. Fixing the loop **unmasked** a pre-existing serious a11y defect the axe scan
   could never reach while the page looped: `delta-badge.tsx` put `aria-label` on
   a roleless `<Badge>` span (`aria-prohibited-attr`, WCAG 4.1.2). Fixed with
   `role="img"` (`6c8b808`). Both opus reviewers missed it; the independent e2e
   gate earned its keep.

---

## Carry-forward register → M9 (unless noted)

1. **Server-hydration (§5) for all read surfaces — the big M9 item.** Extract
   `lib/server` analytics/counts read-services from the inline-SQL routes,
   refactor the routes to call them (byte-parity, guarded by the integration
   oracle), then have `/home` + `/performance` (and the M3–M6 surfaces) server-
   prefetch + dehydrate into the existing Query keys. This is a protected,
   cross-cutting refactor best done once in M9.
2. **`formatDelta` negative guard.** `lib/format/delta.ts`/`delta-badge.tsx` guard
   `null` but not `< 0`: a negative clock-skew response-time value shows "—" in the
   StatTile value (correct, via the `formatDuration` guard) but the adjacent
   `DeltaBadge` could still compute a numeric duration delta (e.g. "▼ −7m faster").
   Same class as the value-cell guard — add the negative guard to the delta path.
3. **Token/cleanup pass (M8 or M9):** `chart.tsx` `AXIS_PROPS.fontSize: 11` (SVG
   tick attribute; = `--text-caption`) and `Tooltip contentStyle.fontSize:
   "0.8125rem"` (an HTML div — could use `var(--text-ui)`, genuinely avoidable);
   `React.ReactNode` referenced without an explicit `import * as React` in
   `chart.tsx`/`stat-tile.tsx` (tsc + eslint pass — style nit); the unused optional
   `timezone?` prop on `reply-locations-table.tsx` (brief-verbatim dead prop).
4. **Cosmetic (defer):** percent precision mismatch (KPI tiles integer `"83%"` vs
   `formatDelta` percent one-decimal `"+2.3%"`); sub-minute duration deltas round to
   `"+0m"/"−0m"` while the glyph shows a direction.

## Notes for later milestones

- A full 8/9-worker Playwright run can flake on `journeys.spec.ts` under CPU
  contention on this sandbox (green in isolation / at reduced workers) — consider
  pinning `workers` in `playwright.config.ts` (M9). Did not manifest in the final
  gate runs here.
- Build-orchestration footgun observed: running `pnpm build` twice back-to-back can
  race the first build's `postbuild` (`scripts/prepare-standalone.mjs`) with the
  second's clean, leaving `.next/standalone/.next/static` missing and producing
  false e2e failures (stale CSS → phantom colour-contrast). A single clean
  `rm -rf .next && pnpm build` is reliable.
