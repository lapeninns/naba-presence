# UX flows audit: results

Phase 3 of the frictionless-flows work (AMA-13, verified in AMA-25). It records what Phase 2 changed against the 123 findings in [findings.md](findings.md) and the slices in [plan.md](plan.md).

## Scope and evidence

- **App verified:** `main` at `de999679` (16 Oct 2026, after #202). Every Phase 2 source PR is merged and none are open. All 123 findings are claimed by a slice in the plan's Order table.
- **Before:** `main` at `4e0fa805`. Taps come from the "Steps per flow" tables in findings.md. Measurements come from [`baseline/`](baseline/). For `audit:mobile` the "before" is P01's re-baseline (`baseline/mobile-audit-hit-area-totals.json`), not the 260 in `baseline/mobile-audit-totals.json`, as the plan's Phase 3 hooks require.
- **After:** each finding was checked against the code on `de999679` and against its PR body. Release & QA did this read-only, split by lane (Platform, Listings, Reviews). Every status below cites a `path:line` on main or a reason. "Counted from code" in the steps tables means the taps were counted along the code path on main, not measured in a browser.
- **Not re-captured yet:** the seeded `naba_visual` harness could not run for this check (see [What is still to run](#what-is-still-to-run)). The phone flow library "Naba Presence Mobile - Flows (after)", the desktop captures, the final-main `audit:mobile` run, perf-lab and G4–G7 are still to come. Until they run, the after figures here come from the build-only checks and the code, plus each lane's own measurements on its PR, which are marked as such.

**Status key:** **fixed**: the finding's problem is gone on main. **Partly fixed**: the main problem is gone, and the named remainder is an open follow-up. **Deferred**: left out by an owner or leader decision (reason given). **Open**: not fixed and not deferred. No finding was marked won't-fix.

## Summary

| Severity | Fixed | Partly fixed | Deferred | Open | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| P0 | 1 | 0 | 0 | 0 | 1 |
| P1 | 28 | 5 | 0 | 0 | 33 |
| P2 | 74 | 11 | 3 | 1 | 89 |
| **All** | **103** | **16** | **3** | **1** | **123** |

- **The P0 is fixed.** Food-menu changes read as plain rows at consent (LST-01, `lib/locations/menu-diff.ts:145-151`). A unit test (`tests/menu-diff.test.ts:275-284`) asserts that no row is raw JSON.
- **Partly fixed P1s:**
  - INB-05: the badge works, and the notification kinds are deferred (D2).
  - LST-06 and LST-07: the height targets were missed but accepted by the leader: 45.5% and 35% against the target of under 30%.
  - LST-14: Review & publish is not streamed.
  - CLR-19: wording and bucket order.
- **Deferred:** SET-27 (P21, D10), DSK-23 (P23, stage 4) and INB-19 (R10, stage 4).
- **Open:** CLR-06, the location / listing / venue wording in Clients and Reports. P11's helper merged (#136), but no Clients or Reports file uses it.

## Gates on the final main (`de999679`)

| Gate | Result |
| --- | --- |
| G1 `pnpm verify` | **Pass.** Typecheck and lint (0 warnings) are clean. Vitest: 595 files passed and 163 skipped; **7,787 tests passed** and 1,399 skipped. |
| G2 `pnpm check:design --ratchet` | **Pass.** 104 token bypasses in 42 files (R1 12, R2 9, R3 54, R4 12, R5 1, R6 2, R7 14), down from 106 in 43. `scripts/design-baseline.json` still records 106: the 2 R7 hits removed from `components/editors/editor-frame.tsx` by P02 were never locked in with `--update-baseline`. |
| G3 `pnpm check:contrast` | **Pass.** All 212 pairs clear their target in both themes, the same as before. |
| `pnpm build` (webpack, production) | **Pass.** Compiled, and all 109 static pages were generated. |
| `route-js.mjs` | **Pass** against the no-regression ceilings in `tests/perf/budgets-baseline.json` (`--max-chunk 70 --max-shared 400 --max-route 560`, exit 0). It does not meet the redesign targets in `tests/perf/budgets.json` (`--max-chunk 50 --max-shared 250 --max-route 400`, exit 1), and neither did the baseline. See [Bundles](#bundles-route-js). |
| G4 `test:e2e:touch` and `test:a11y` | **Not run on final main:** the harness is blocked. Most source PRs ran them at their own head; the 12 stage-1 PRs in item 12 under [Phase 2 verification](#phase-2-verification-what-didnt-match) did not. The integration PRs re-ran the combined gates locally (for example #201/#202, with the same tree as main: 7,787 tests plus build). Hosted CI did not run (Actions budget). |
| G5 flow e2e specs | Not run on final main, for the same reason. |
| G6 screenshots | Not re-captured: the harness is blocked. Lane before/after shots are under [`phase2/`](phase2/). |
| G7 measurements | Build-only figures below. `audit:mobile` and perf-lab are not re-run: the harness is blocked. |

## Measurements before and after

### Design and contrast

| Check | Before (`4e0fa805`) | After (`de999679`) |
| --- | --- | --- |
| `check:design` token bypasses | 106 in 43 files | 104 in 42 files |
| R7 literal breakpoint `[@media(min-height:620px)]` | 16 | 14 |
| `check:contrast` | 212 of 212 pass | 212 of 212 pass |

### Bundles (`route-js`)

`route-js.mjs` gives an upper bound on first-load client JS per route, in gzip KB, from the build manifests. The full after table is in [`after/route-js.md`](after/route-js.md), and the before table is [`baseline/route-js.md`](baseline/route-js.md).

| Route | Before | After | Change |
| --- | ---: | ---: | ---: |
| `/inbox` | 513.0 | 478.1 | -34.9 |
| `/listings/[id]/profile` | 543.7 | 475.7 | -68.0 |
| `/listings/[id]/people` | 509.7 | 475.7 | -34.0 |
| `/listings/[id]/hours` | 500.0 | 475.7 | -24.3 |
| `/listings/[id]/posts` | 504.8 | 475.7 | -29.1 |
| `/listings` | 363.8 | 375.4 | +11.6 |
| `/reports` | 456.4 | 475.1 | +18.7 |
| `/clients` | 396.5 | 416.8 | +20.3 |
| `/clients/[clientId]` | 445.9 | 462.8 | +16.9 |
| `/team` | 423.5 | 441.5 | +18.0 |
| `/settings` | 461.8 | 471.3 | +9.5 |
| `/settings/notifications` | 477.8 | 487.6 | +9.8 |
| `/settings/billing` | 479.2 | 484.7 | +5.5 |
| `/notifications` | 388.6 | 408.1 | +19.5 |
| `/sign-in` | 379.1 | 389.1 | +10.0 |
| `/invite/[token]` | 387.0 | 421.5 | +34.5 |
| `/design-system` | 453.1 | 510.6 | +57.5 |
| Dashboard shell (chunks every dashboard route names) | 359.1 (42 files) | 373.5 (49 files) | +14.4 |

- **Inbox and the listing areas got lighter.** These are net changes across all of Phase 2 since `4e0fa805`. `/inbox` is 34.9 KB lighter. #190 (R09) says most of its own saving came from zod-free contracts and the lazy bulk bar, not the dialogs (about 3 KB). Every listing area now lists the same 475.7 KB set, and `/profile` is 68 KB lighter. #156 reports that L16 itself raised this upper bound by 16–26 KB, so the drop comes from other slices.
- **Most other routes in the table rose by about 5 to 20 KB.** Much of that is the shell's +14.4 KB of shared primitives: overlays, feedback, the optimistic-mutation hook, ListRow actions and the scope chip. Every route stays under the no-regression ceiling of 560 KB, and the shell under its 400 KB. Both were already over the 400 KB route and 250 KB shell targets at baseline.
- **`/design-system` rose by 57.5 KB.** That's expected: every new pattern was added there first.
- **`/invite/[token]` rose by 34.5 KB.** It now shows the role and expiry (P19b). That's worth a look in the next perf pass.
- **perf-lab's exact transfer figures are still to be measured on final main** (see below). On its own PR, R09 measured `/inbox` first-load JS at 549 → 518.8 KB, under the 520 KB budget with about 1–3 KB of headroom (#190).

### `audit:mobile`

| Metric | Before (P01 re-baseline, `4e0fa805`) | After (`de999679`) |
| --- | ---: | --- |
| touchTargetBelow44 (effective hit area) | 36 | not re-run (harness blocked) |
| touchBoxBelow44 (drawn box) | 259 | not re-run |
| targetSize (WCAG 2.5.8) | 0 | not re-run |
| clippedText | 76 | not re-run |
| axe violations, focus obscured, horizontal overflow, load and console errors | 0 | not re-run |
| textUnder14Phone | 2,019 | not re-run |
| phone chrome max / smallest text | 20.4% / 12px | not re-run |

These are interim figures from lane G7 runs on their own heads, not on final main, so treat them as orientation only:
- touchTargetBelow44: 31 after P04 and 34 after P05, then 17 after P12 (run against `e3766ae5`).
- clippedText: 0 after P05 (#130), then 3 in later lane runs against `e3766ae5` (#169, #170, #172). SET-07 is fixed in code (`components/app-shell/app-bar.tsx:527`).
- Lanes report ±2 run-to-run noise on touchTargetBelow44.

### perf-lab

| Route (mobile, 4× CPU, Slow 4G, median of 3) | Before (`baseline/perf-mobile.md`) | Lane measurement on its PR | Final main |
| --- | --- | --- | --- |
| `/inbox` first-load JS | 552 KB (over the 520 budget) | 518.8 KB (#190, R09) | not re-run |
| `/settings/billing` with billing off: LCP / lazy JS | 3,336 ms / 72 KB (over budget) | 1,252 ms / 6 KB (#144, P22) | not re-run |
| `/settings/billing` with billing on (D11, fixture only) | not measured | LCP 1,216 ms, CLS 0, first-load JS 460 KB, all budgets met (#177, `phase2/p22/billing-enabled.md`) | not re-run |
| `/listings/{loc}/profile` LCP / TBT / CLS | 1,244 ms / 177 ms / 0.789 | 1,260 ms / 81 ms / 0.053 (#156, L16) | not re-run |
| `/listings/{loc}/people` LCP / TBT / CLS | 1,244 ms / 154 ms / 0.181 | 1,952 ms / 49 ms / 0.000 (#156). LCP is now the real summary, which arrives about 3.7 s sooner | not re-run |
| Desk listing areas: RSC requests on load | 19 extra (MEA-04) | 0 per area, and 2 on Review & publish (#156) | not re-run |
| `/team` CLS | not measured (the lane's before was 0.352, #172) | 0.060 (#172), then 0.000 (#195, P20) | not re-run |

The L16 "before" figures are the lane's own run on main `6ec4e885`, not `4e0fa805`.

## Findings by status

The columns are: ID, severity, short title, slice, PR(s) with merge date, status, and the evidence on main or the reason. IDs folded into another finding take that finding's status: DSK-02 is in LST-04; LST-22 is in SET-13; LST-30, CLR-23 and the INB-12 truncation are in SET-07; DSK-17 is in SET-29; DSK-19 is in SET-16; DSK-13 is in INB-11; DSK-21 is in INB-16; DSK-04 and INB-20 are in CLR-19; DSK-03 is in LST-18; and DSK-16 is split between CLR-05 (the client hub) and LST-18 (hours and service metadata).

| ID | Sev | Title (short) | Slice | PR(s) | Status | Evidence on main (path:line) / reason |
| --- | --- | --- | --- | --- | --- | --- |
| MEA-01 | P1 | Touch count measures the wrong box | P01 | #122 (15 Oct) | fixed | `tests/visual/mobile-audit-lib.mjs:314` `effectiveHitArea`; `:456-457`, `:489-490` two metrics (`touchTargetBelow44` effective, `touchBoxBelow44` drawn). Re-baseline committed (`baseline/mobile-audit-hit-area-totals.json`) |
| MEA-02 | P2 | Disabled billing route 3.3 s paint | P22 | #144 (15 Oct), #177 (15 Oct, measurement) | fixed | `app/(dashboard)/settings/billing-disabled.tsx:21-37` returns `NotFoundContent` before any session read; used by `billing/page.tsx:14`, `billing/confirming/page.tsx:11`, `usage/page.tsx:11`. LCP 3,376 → 1,252 ms in #144's own runs (3,336 ms in `baseline/perf-mobile.md`) |
| MEA-03 | P2 | Tabs narrower than 44px | P04 | #132 (15 Oct) | fixed | `components/ui/tabs.tsx:175`, `:193` `min-w-(--np-touch)` (dropped at desk). `/notifications` `tabs-tab` offenders gone (#132 G7) |
| MEA-04 | P2 | Desk listing pages make 19 extra RSC requests | L16 | #156 (16 Oct) | fixed | `area-frame.tsx:158` (`prefetch="intent"`). perf-lab in #156: desk RSC 15 → 0 per area (16 → 2 on Review & publish) |
| INB-01 | P1 | "Live on Google" beside "Google is reviewing" | R01a | #118 | fixed | `lib/inbox/reply-state.ts:300,407-418` ("Sent · waiting for Google's check" when PENDING); toast `lib/inbox/actions.ts:187-195` |
| INB-02 | P1 | "Publish reply" parks in two-person mode | R01b | #154 | fixed | `lib/inbox/reply-state.ts:230-235` (`publishSubmitsForApproval`), label "Submit for approval" `:111`, `components/inbox/action-bar.tsx:396` |
| INB-03 | P1 | Requester offered "Approve reply" | R01b | #154, #183 | fixed | Server scope wins `lib/inbox/reply-state.ts:244`; `components/inbox/action-bar.tsx:285-296`; "Waiting for another approver" `components/inbox/detail/reply-exception.tsx:140,156,180`; row `canApprove` `lib/server/reviews-query.ts:203-209` |
| INB-04 | P1 | Regenerate during approval withdraws it | R02 | #121 | fixed | `components/inbox/reply-composer.tsx:222-232` (parked = read-only), `:495-519` (note, no tone/Generate); "Edit reply" in ⋯ `components/inbox/action-bar.tsx:459` |
| INB-05 | P1 | Approvers get no badge or notification | R03 | #194 | partly fixed | Badge and title count approvals: `components/app-shell/use-needs-reply-count.ts:37-56`, `lib/inbox/waiting.ts:26`, `lib/server/review-counts.ts:81`. Notification kinds deferred (D2: needs a migration to the kind CHECK in `supabase/migrations/0078_operational_notifications.sql:9-11`) |
| INB-06 | P1 | Connection actions send members to Access denied | R04 | #120 | fixed | `components/inbox/empty-states.tsx:120-160,461-466`; `components/inbox/detail/reply-exception.tsx:78-82,125-129,261-263` |
| INB-07 | P1 | Scope treated as a filter; Clear all resets it | R05 | #159 | fixed | `components/inbox/inbox-view.tsx:319-332` (keeps `clientId`); `components/inbox/filter-toolbar.tsx:47-55`; `components/inbox/active-filter-chips.tsx:130-135` (chip only when there is no switcher) |
| INB-08 | P1 | Single triage takes 4 taps via Select | R06a | #162 | fixed | Row swipe + ⋯ `components/inbox/review-list.tsx:349-368`; detail ⋯ with Assign… `components/inbox/review-detail.tsx:349-360`; `components/inbox/review-triage.tsx` |
| INB-09 | P2 | Confirm dialogs where Undo fits | R06b | #193 | partly fixed | "No reply needed" acts at once with Undo: `components/inbox/review-triage.tsx:47-74,109-111`, `app/api/reviews/bulk/route.ts:154,191` (no migration). Remains: the Regenerate "Discard your edits?" confirm `components/inbox/reply-composer.tsx:414-419,521-550` |
| INB-10 | P2 | Filters sheet long and mixed | R07 | #163 | fixed | Sheet groups `components/inbox/more-filters.tsx:176-287` (no Client or Reply status; Venue is a `Select` at `:187-202`); quick chips `components/inbox/filter-controls.tsx:23-78` |
| INB-11 | P2 | "–" for zero; counts ignore filters | R07 | #163 | fixed | `components/inbox/queue-tabs.tsx:117-160` (no dash; figures hidden while filtered, except Failed) |
| INB-12 | P2 | Count repeats; badge ignores scope | R07 | #163 | fixed | Scoped badge `components/app-shell/use-needs-reply-count.ts:42-56`; no figure on the active tab or Needs reply `components/inbox/queue-tabs.tsx:122-123` |
| INB-13 | P2 | Two header bars, name twice | R08 | #164 | fixed | No `HeadFrame`; position and ‹ › on the name row `components/inbox/review-detail.tsx:285-330`; composer h2 is "Reply as {location}" `:1155-1160`. Not in the app bar as the plan said, but the extra band and the second name are gone |
| INB-14 | P2 | AI unavailable still offers Retry/Generate | R08 | #164 | partly fixed | No Retry, no credits, Generate replaced by text: `components/inbox/reply-composer.tsx:101,476,566,588-596`. Remains: only known after one failed attempt (no server signal), per #164 |
| INB-15 | P2 | Approval copy jargon, "manager" | R01a | #118 | fixed | `components/inbox/detail/reply-exception.tsx:176`; `lib/inbox/actions.ts:209-211` |
| INB-16 | P2 | Composer pushes the box down; guidance looks tappable | R08 | #164 | fixed | Text box before Generate `components/inbox/reply-composer.tsx:660,709`; count hidden while empty `:724`; guidance only with text `lib/inbox/reply-guidance.ts:72-73`; tick or dot, "Good replies" `reply-composer.tsx:738-775` |
| INB-17 | P2 | Two Select exits | R09 | #190 | fixed | One "Cancel selection" `components/inbox/list-header.tsx:194`; bulk bar passes no cancel to `SelectionBar` (`components/ui/selection-bar.tsx:131-142` is optional) |
| INB-18 | P2 | Sticky sync error; no freshness on phones | R09 | #190 | fixed | Toasts with one id `components/inbox/sync-reviews-button.tsx:18-38,79`; freshness on phones `components/inbox/list-header.tsx:156-162` |
| INB-19 | P2 | List controls out of thumb reach | R10 | none | deferred | Stage 4 (R10), deferred by the leader |
| INB-21 | P2 | Notifications wait on server, unclear labels | R11 | #191 | partly fixed | Pending-change overlay plus error toast `components/notifications/use-notification-changes.ts:115-129`; empty-state action `components/notifications/notifications-view.tsx:276-282`; button hidden when nothing is unread `:242-247`. Remains: says "Mark shown as read" while more pages exist or under Open (`:244-246`); settings link is icon-only below sm (`:210`); "Open" beside "Unread" still unexplained (`:56-59`) |
| INB-22 | P2 | Refresh bar ignores reduced motion | R09 | #190 | fixed | `components/inbox/review-list.tsx:274` (`Progress`) |
| INB-23 | P1 | Inbox ships every dialog; over JS budget | R09 | #190 | fixed | `next/dynamic` at `components/inbox/review-detail.tsx:374,430`, `components/inbox/bulk-action-bar.tsx:137`, `components/inbox/lazy-bulk-action-bar.tsx:24`. perf-lab in #190: 549 KB → 518.8 KB (budget 520 KB) |
| INB-24 | P2 | Scope-switch toasts pile up | P07 | #133 (15 Oct) | fixed | `components/app-shell/scope-sheet-model.tsx:139` `toast.add({ id: SWITCH_TOAST_ID, … })`; `components/ui/toast.tsx:473` `withReplacementReset`; `lib/queries/use-optimistic-mutation.ts` |
| LST-01 | P0 | Raw JSON in menu diff at consent | L01 | #117 (15 Oct) | fixed | `lib/locations/menu-diff.ts:145-151`: `display()` goes through `describeValue` (`:126-143`) and `describeNode` (`:91-124`, "Lunch — 2 sections · 9 items", price via `priceOf`/`formatMenuPrice`). `JSON.stringify` is used only for signatures and row keys (`:49`, `:240`, `:348`...). Test `tests/menu-diff.test.ts:275-284`: no row starts with `{`/`[` or contains `nanos`/`units`. Consumers unchanged: `review-publish.tsx:257`, `menu-tab.tsx:112,140` |
| LST-02 | P1 | Activity shows API keys as words | L02 | #124 (15 Oct) | fixed | `lib/listings/activity-outcome.ts:49` (`OTHER_CHANGE`), `:71-72` ("Sent to Google"), `:99`, `:125` ("Regular hours"), `:245` (error copy). `components/locations/activity-panel.tsx:77-91,111` uses only the label maps; `humaniseActivity` has no callers left |
| LST-03 | P1 | Menu picker is a 20px sliver | L07 | #149 (15 Oct) | fixed | `components/locations/menu-editor.tsx:846` (`basis-full` on a phone, `sm:min-w-56`) |
| LST-04 | P1 | Editor bar: 3 buttons on 2 rows; idle desk bar (incl. DSK-02) | P02 | #131 (15 Oct) | fixed | `components/editors/editor-footer.tsx:172` returns null when clean; `:195-215` Save here / Discard edits as secondaries; `editor-frame.tsx` has no `min-height:620px` or sticky left |
| LST-05 | P1 | Review & publish bar docked by hand | P02 | #131 (15 Oct) | fixed | `components/listings/review-publish.tsx:986-988` `<ActionBar dock statusRow>` |
| LST-06 | P1 | Five header rows before content | L03 | #152 (15 Oct) | partly fixed | Header is two rows: `area-frame.tsx:574-604` (listing switcher plus overflow; H1 = `AreaTitleSwitcher` `:182`). Freshness is in the pill popover `:294-299`, with one meta line from `md` `:309-335`. **Remains:** G7 is 45.5% against the plan's <30% target (leader accepted). The rest went to AMA-23 (P05b #178: label only, height unchanged) and AMA-18 (profile-editor trim: no PR found). The Hours time-zone line is still its own row (`hours-tab.tsx:541-552`) |
| LST-07 | P1 | Board: five control rows above first listing | L04 | #166 (15 Oct) | partly fixed | `listings-board.tsx:935` (`hideWhenZero`), `:114,122` (one "Order listings" chip), `:992-994` (count is an sr-only live region), `:445,621,1100` (Add listings at the list end). **Remains:** G7 is 35.0% against <30% (leader accepted). The page description is handed to AMA-23/AMA-18 |
| LST-08 | P1 | Two write models in one profile form | L14 | #157 (15 Oct) | fixed | `components/reviewed-write/combined-review.tsx:77` (route note), `:243` (`CombinedReviewSheet`), used at `profile-editor.tsx:1097`. `SaveModelTag` is gone from `section-card.tsx`. Booking and people now also use `ReviewedWriteSheet` (L08, L13) |
| LST-09 | P1 | Verification page is jargon, offers start on verified | L12 | #119 (15 Oct) | fixed | `verification-tab.tsx:77-90` (`verifiedAtRest` puts tools behind "Verification tools"), `verification-observation.tsx:60` ("Verified. Google confirms you manage this listing."). Residual jargon is listed under item 9 of Phase 2 verification |
| LST-10 | P1 | Booking review is a one-off sheet, inline primary | L08 | #150 (15 Oct) | fixed | `place-action-approval-sheet.tsx:119` (`ReviewedWriteSheet`), `:250` (`OutcomeSummary`), `:263` (`ConsentSlot`). `booking-tab.tsx:887-905` (docked `ActionBar`, shown once a URL is entered) |
| LST-11 | P1 | Post can't be published from composer | L10 | #151 (15 Oct), #174 (16 Oct) | fixed | D4 met. `post-composer-sheet.tsx:1199-1213`: the consent `<p data-slot="publish-consent">` is drawn by the same `gate` condition as the Publish button `:1239-1253`, linked by `aria-describedby={consentId}`, and visible at every width. Publish is bound to the saved revision: `lib/server/posts.ts:1445-1454`, `app/api/locations/[id]/posts/[postId]/route.ts:53` |
| LST-12 | P1 | Composer has no photo | L10 | #151 (15 Oct) | fixed | `post-composer-sheet.tsx:1037-1043` (Photo row), `:1258` (`PostPhotoPicker`). The consent says ", with its photo," when one is set (`:1209-1213`) |
| LST-13 | P1 | Publish failure said three times plus raw code | L11 | #147 (15 Oct) | fixed | `lib/editors/use-publish-flow.ts:32` (toast "Publishing stopped. See the steps."), `review-publish.tsx:962-972` (one banner with the next action), `components/ui/publish-steps.tsx:142` (code under `SupportDetails`) |
| LST-14 | P1 | Seven areas fetch after hydration; header remounts | L16 | #156 (16 Oct) | partly fixed | New `app/(dashboard)/listings/[id]/layout.tsx`. `StreamedTab` is on 9 area pages (profile, menu, booking, people, verification and suggestions added). **Remains:** `changes` (Review & publish) is still not streamed and draws its own header (PR states this). Mobile LCP on `/people` went from 1,244 to 1,952 ms, because real content is now the LCP element (within budget) |
| LST-15 | P2 | Photo sheet contradicts itself | L15 | #127 (15 Oct) | fixed | `add-photo-dialog.tsx:334-336` ("Add photos", "Photos go to Google when you tap Upload."), `:588` (one primary); `FileCard` rows `:470` |
| LST-16 | P2 | Hours list long, closed days repeat | L06 | #155 (16 Oct) | fixed | `hours-editor.tsx:545-571` (one `ListRow` per day plus a trailing `Switch`), `:501-509` (one "Copy Monday to…" in the group header). G7: page height 2375 → 1184 px |
| LST-17 | P2 | 24-hour fields, 12-hour confirm | L05 | #148 (15 Oct) | fixed | `lib/locations/hours-diff.ts:27-29` (`clockTime` uses `formatTimeOfDay`), `lib/format/time.ts:20` |
| LST-18 | P1 | No hours on Google reads green "In sync" | L05 + L18 | #148, #168 (15 Oct) | fixed | Page: `hours-tab.tsx:432,472` (`emptyOnGoogle`), `lib/editors/hours-notes.ts:66` (hint), `:32-40` (service note moved to the service group). Roll-up: `lib/contracts/location-summary.ts:67`, `lib/server/location-summary.ts:120-123`, `lib/listings/health.ts:125,185-188`, `lib/listings/area-state.ts:143-151`. Client health through `lib/server/clients.ts:280-307`. L05's viewer gap is closed by the L18 card state |
| LST-19 | P2 | Raw IANA zone IDs | L05 | #148 (15 Oct) | partly fixed | Hours: `hours-tab.tsx:436-440` plus `lib/format/time.ts:87-113` ("UK time", hidden when it matches the viewer's zone). **Remains:** Calendar still prints raw IDs (`publication-calendar.tsx:176-178`, `calendar-grid.tsx:93`). See item 5 of Phase 2 verification |
| LST-20 | P2 | Five tool rows for one item; bad plural | L07 | #149 (15 Oct) | fixed | `menu-editor.tsx:74-75,519-522` (threshold), `:1092-1093` (`countNoun`) |
| LST-21 | P2 | Templated info-sheet title | L03 | #152 (15 Oct) | fixed | `area-frame.tsx:274,294` (fixed title "How changes reach Google"); the template is gone |
| LST-23 | P2 | Overview repeats health | L04 | #166 (15 Oct) | fixed | `health-strip.tsx:116-172` (two `SettingsRow`s: "Google connection", "Last published") |
| LST-24 | P2 | Every post headed "Update"; "Lifecycle" | L09 | #123 (15 Oct) | fixed | `post-card.tsx:40` (headline is the first line), `:146` ("History") |
| LST-25 | P2 | Composer repeats draft copy; bare fields | L09 | #123 (15 Oct) | fixed | Draft note only in the footer (`post-composer-sheet.tsx:1217-1221`), `:533` ("Write the post first."); no `BARE` inputs left |
| LST-26 | P2 | Invite jumps sheet to panel; jargon toast | L13 | #153 (15 Oct) | fixed | `invite-sheet.tsx:188-192` (one `ReviewedWriteSheet`), `:132` ("Invitation ready to approve"), `invitations.tsx:158` ("Invite someone"), `components/ui/stepper.tsx:83` plus `reviewed-write/steps.tsx:70` (`showLabels`) |
| LST-27 | P2 | Read-only member view is greyed editor | L11 | #147 (15 Oct) | partly fixed | `editor-frame.tsx:72,111-117` (`readView`), passed by hours/menu/profile (`hours-tab.tsx:465`, `menu-tab.tsx:290`, `profile-editor.tsx:998`). `review-publish.tsx:737` (capability copy). Nav hiding at `lib/listings/area-nav.ts:119-126`. **Remains:** the header "Review & publish (n)" is not gated by role (see item 1 of Phase 2 verification) |
| LST-28 | P2 | Calendar off is a dead end; no current nav item | L17 | #158 (16 Oct) | partly fixed | `publication-calendar.tsx:187-226` (no description, "Go to Listings"), `components/app-shell/app-shell.tsx:265-269` (Calendar stays current while on `/calendar`). **Remains:** "Contact support" for owners is deferred until D10 (P21 not merged; no support address exists) |
| LST-29 | P2 | "Copy to…" name lacks visible label | L05 (kept by L06) | #148, #155 | fixed | `hours-editor.tsx:1145-1149` (`aria-label="Copy to… (Monday's hours)"`) |
| LST-31 | P2 | "Action link" jargon in Booking | L08 | #150 (15 Oct) | fixed | No "action link" left in `booking-tab.tsx` or `place-actions/*`. Expiry only within the hour (`place-action-approval-sheet.tsx:42`, `saved-place-action-work.tsx:52`). Server error strings still say "action link" (`lib/server/place-action-attempts.ts:34,43`); PR states this, out of scope |
| CLR-01 | P1 | Two scope controls; 6 taps on Reports | R12a | #161 | fixed | Period chips on phone `components/reporting/report-toolbar.tsx:72-112`; scope comes from the app-bar chip |
| CLR-02 | P1 | Figures below a screen of chrome | R12a | #161 | fixed | Description hidden below md `app/(dashboard)/reports/page.tsx:23`; one caption with an info sheet `components/reporting/presence-provenance.tsx:160-185`; Refresh in ⋯ `components/reporting/report-actions-menu.tsx:151-164`. "First KPI above the fold" not measured (G7) |
| CLR-03 | P2 | Provenance lines contradict | R12b | #192 | fixed | Disjoint status `lib/domain/report-coverage.ts:106-191`, used at `lib/server/presence-report.ts:219`; copy `components/reporting/presence-provenance.tsx:105-120` |
| CLR-04 | P2 | Charts misread; 10px bars | R13 | #129 | fixed | `components/reporting/report-bar-chart.tsx:36-39,84-104,201-233` (dated labels, scrub, weekly grouping, `kind="line"`) |
| CLR-05 | P2 | Internal words and GBP jargon | R15 | #125 | partly fixed | Hub done: "Google login:" `components/clients/client-hub.tsx:436`, "Past reviews" `:733-736`, "Replies that didn't post" `:247`. Reports half not done: "vs the previous window" `components/reporting/delta-badge.tsx:28-33`; "in this window" `components/reporting/reply-figures.tsx:92,94,197`; "Impressions since" `components/performance/keywords-tab.tsx:93` |
| CLR-06 | P2 | location / listing / venue | R15 (+P11) | #125 (deferred inside) | open | P11 merged (#136) but no Clients or Reports file adopted it: TODOs still at `components/clients/client-hub.tsx:253,537`; "Venues" `components/share/shared-client-report.tsx:228`; "locations" `components/performance/performance-view.tsx:81`, `components/reporting/partial-coverage-alert.tsx:38` |
| CLR-07 | P2 | Refresh refreshes everyone, no progress | R13, R12b (D7) | #129, #192 | fixed | Polling with "Refreshing…" `components/performance/refresh-google-button.tsx:24-26,77-86`; label "Check for new data across clients" on a client report `components/reporting/report-actions-menu.tsx:160-163` (not "Refresh all clients": see item 8 of Phase 2 verification) |
| CLR-08 | P2 | Tabs load with different shapes | R13 | #129 | fixed | `components/reporting/reports-skeleton.tsx:97-133`; `components/performance/google-performance-tab.tsx:138`; `components/performance/keywords-tab.tsx:85-87,153` |
| CLR-09 | P2 | One-location waterfall | R13 | #129 | fixed | `components/performance/location-report.tsx:72-90` (figures mount while the directory loads) |
| CLR-10 | P2 | No share from All clients | R12a | #161 | fixed | "Share a client's report" plus client picker `components/reporting/report-actions-menu.tsx:140-150,177-185` |
| CLR-11 | P2 | Share sheet actions and rows hand-built | R14 | #165 | fixed | `components/clients/share-report-dialog.tsx:311-322` (`OptionRowGroup`), `:344-387` (`DialogFooter`), `ListRow` import `:39` |
| CLR-12 | P2 | Public report: metadata first; reload to top | R14 | #165 | fixed | `components/share/shared-client-report.tsx:112,137` (`#main`), metadata in footer `:225-248` |
| CLR-13 | P1 | "Needs attention" with "up to date" | R15 | #125 | fixed | `lib/clients/health.ts:539-545`; `components/clients/client-hub.tsx:180`. No link to the cause (left out in #125) |
| CLR-14 | P2 | Four stacked header actions | R15 | #125 | fixed | `components/clients/client-hub.tsx:201,325-389` (Open inbox plus More) |
| CLR-15 | P2 | Duplicate count; pill on every row | R15 | #125 | fixed | Pills only for non-default states `components/clients/client-hub.tsx:610-628` |
| CLR-16 | P1 | Inline save bar; no leave guard | R17 | #126 | fixed | `components/clients/client-form.tsx:57,167-168,199`; `components/clients/client-settings.tsx:1039-1042` (`dock`, `visible={dirty}`) |
| CLR-17 | P2 | Colour picker toggles read hex | R17 | #126 | fixed | `components/clients/client-colour-field.tsx:58-97` (`RadioGroup`, preview, "Use the automatic colour") |
| CLR-18 | P1 | Connect hint points off-screen | R18 | #128 | fixed | Logins first as `OptionRow` `components/setup/step-connect.tsx:127-168`, then "Or sign in with another Google account" `:305`; hint `lib/setup/steps.ts:277`; scroll `components/setup/setup-wizard.tsx:179` |
| CLR-19 | P1 | Health chips: empty buckets, clipped | R16 | #160 | partly fixed | Shared `FilterChip`, zero buckets hidden, wraps from md `components/clients/health-filter.tsx:53-88`; search on its own row `components/clients/clients-index.tsx:299-316`; "Some listings not checked yet" `lib/clients/health.ts:250`. Remains: "Action needed" wording `lib/clients/health.ts:255`, urgent-bucket ordering, Listings still says "Partially checked" |
| CLR-20 | P2 | "Synced Not yet"; nested link | R16 | #160 | fixed | `components/clients/clients-index.tsx:464-479` (sentences), `:722-745` (plain text, no link) |
| CLR-21 | P2 | Second back button; anchor chevrons | R17 | #126 | fixed | `components/clients/client-settings.tsx:180-183` (`max-md:hidden`); phone index removed `:114-117` |
| CLR-22 | P2 | Archive: confirm, checkbox, then Undo | R17 | #126 | fixed | `components/clients/client-settings.tsx:817-860` (`SettingsDestructiveAction`, one tap, Undo toast) |
| CLR-24 | P2 | Tab switch silently changes the period | R12a | #161 | fixed | `?range_kw=` and nearest equivalent `components/performance/performance-view.tsx:130-216`; note `components/reporting/report-toolbar.tsx:80-82` |
| SET-01 | P1 | Member role promises listing edits | P13 | #140 (15 Oct) | fixed | `lib/settings/roles.ts:26` "Can’t edit a listing’s profile, hours or menu"; `tests/role-copy.test.ts` ties copy to the real gates |
| SET-02 | P1 | Team member cards 7-8 lines tall | P12 | #172 (15 Oct) | fixed | `components/settings/members-table.tsx:386-467` `ListRows`/`ListRow`; `:654` `MemberSheet` (`components/settings/member-sheet.tsx`). About 4.5 members per screen (#172) |
| SET-03 | P1 | Invite sheet hides Client access | P13 | #140 (15 Oct) | fixed | `lib/settings/gating.ts:91-95` order Member, Viewer, Admin, Owner; `components/settings/member-dialogs.tsx:46-109` `OptionRow` picker; `invitations-panel.tsx:608` role, `:620` Client access, `:661` Can publish, `:692` submit |
| SET-04 | P2 | Settings back control twice | P15 | #167 (15 Oct) | fixed | No "All settings" anywhere in `components`/`app`; `components/settings/settings-nav.tsx:64` tab row is `max-md:hidden` |
| SET-05 | P2 | Hand-rolled 3-row notification block | P14 | #169 (15 Oct) | fixed | `components/settings/notification-preferences.tsx:197` `SettingsRow` switch rows; `:249-291` chevron row with titled select (`SelectContent title="Email: …"`) |
| SET-06 | P2 | Toggles not optimistic; bulk has no Undo | P14 | #169 (15 Oct) | fixed | `notification-preferences.tsx:77` `useOptimisticMutation`; `:203` only the saving row is disabled; `:140-160` bulk Undo toast. Team publishing switch is per member (`publishingUserIds`, #169 rebase) |
| SET-07 | P2 | App-bar name, title and chip truncate (incl. LST-30, CLR-23, INB-12 truncation) | P05 (+P05b) | #130 (15 Oct), #178 (15 Oct) | fixed | `components/app-shell/app-bar.tsx:527` name and echo share one cell; `lib/navigation/destinations.ts:433` `shortBackLabel`, `:407` `listingAreaParent`. `clippedText` 76 → 0 (#130), 3 in later lane runs on `e3766ae5` |
| SET-08 | P2 | Scope chip on org-wide pages | P05 | #130 (15 Oct) | fixed | `lib/navigation/destinations.ts:160`, `:172`, `:185` `scoped: false` (Notifications, Team, Settings); `app-bar.tsx:318`, `:354-358` show search and bell |
| SET-09 | P2 | Placeholders don't match content | P08, P12 | #134 (15 Oct), #172 (15 Oct) | fixed | `components/ui/query-states.tsx:70-79` spinner only without a skeleton; `components/settings/team-list.tsx:94` `MembersSkeleton`, used by `app/(dashboard)/team/loading.tsx:32` and `members-table.tsx:151` |
| SET-10 | P2 | Role chip not tappable | P12 | #172 (15 Oct) | fixed | `components/settings/team-list.tsx:59-78` chip button "<Role>: change <name>’s role"; `members-table.tsx:452`, `:533` `openRole` |
| SET-11 | P2 | Setup has no back and no active tab | P15 | #167 (15 Oct) | fixed | `lib/navigation/destinations.ts:334` `/setup` → clients (agency) / listings (business); `:341` `adoptingDestination`; `lib/navigation/back-target.ts:39` |
| SET-12 | P2 | "Step 1 of 6" vs Done numbered 7 | R18 | #128 | fixed | `components/ui/stepper.tsx:34,110-112,148`; `components/setup/setup-wizard.tsx:283` |
| SET-13 | P2 | Sheets differ by primitive (incl. LST-22) | P03 (+L04, L08) | #137 (15 Oct); L04 #166, L08 #150 | fixed | `components/ui/select.tsx:124` `title` required; `components/ui/overlay.tsx:454` `OverlayGrabber`, `:349` Cancel only without ×. Follow-ups: `components/locations/booking-tab.tsx:842` picker only when >1 type; `components/listings/area-frame.tsx:372-407` single Activity shown as a button |
| SET-14 | P2 | Invite success has two primaries | P13 | #140 (15 Oct) | fixed | `invitations-panel.tsx:235-250` one primary (Share, or Copy link); `:718` Done is ghost |
| SET-15 | P2 | Retention is a mono number spinner | P16 | #141 (15 Oct) | fixed | `components/settings/policy-form.tsx:647-669` `Select` of presets, "How long we keep review text" |
| SET-16 | P2 | "Sidebar" copy; approval said 3 times (incl. DSK-19) | P16 | #141 (15 Oct) | fixed | `policy-form.tsx:553`, `agency-name-form.tsx:139` "at the top of the app"; `policy-form.tsx:595-610` one `Alert` per branch |
| SET-17 | P2 | Invitation page hides the role | P19b | #176 (15 Oct), #184 (15 Oct, test) | fixed | `app/api/invitations/[token]/route.ts:52-72` role and expiry for a live invite only (410/409 with no details); `components/auth/invitation-view.tsx:69-90` Role and Link expires rows (D8) |
| SET-18 | P2 | Confirm password and composition rules | P19b | #176 (15 Oct) | fixed | `lib/domain/auth.ts:25-38` length 12–128 code points only (D9); `components/auth/password-requirements.tsx:12-21` one rule; `sign-in-form.tsx:439-450` and `reset-password-form.tsx:204` one `PasswordField` each. Breached-password check is an owner follow-up (D9) |
| SET-19 | P2 | Access denied shows 403; wrong primary | P08 | #134 (15 Oct) | fixed | `components/app-shell/access-denied.tsx:165-183` "Ask for access" primary, "Back to <shell target>" secondary; no "403" in the file; `app/(dashboard)/team/page.tsx:21` area "Team" |
| SET-20 | P2 | 404 shows UUID path, goes to Inbox | P08 (+P22) | #134 (15 Oct), #144 (15 Oct) | fixed | `components/app-shell/not-found-content.tsx:47-60` back target, `:84` path under `SupportDetails`; `components/app-shell/boundary.tsx:96` one title for both 404s (minor tab-title gap, see item 9 of Phase 2 verification) |
| SET-21 | P2 | Operations in engineering words | P18 | #142 (15 Oct) | fixed | `components/settings/scheduled-jobs-panel.tsx:38-43` one summary `Alert`; `operations-view.tsx:263` `summariseScheduler`; no "Heartbeat" or "Job runner" left |
| SET-22 | P2 | Settings data loads after hydration | P20 | #195 (16 Oct) | partly fixed | Team, Notifications and Reply policy hydrate from the server: `app/(dashboard)/team/page.tsx:6`, `settings/notifications/page.tsx:15`, `settings/reply-policy-content.tsx:45`. Connections was already hydrated by the layout. **Remains:** Operations, named in the finding, still fetches on the client (`settings/operations/page.tsx` has no prefetch; `operations-view.tsx:122` `useQuery`) |
| SET-23 | P2 | Auth errors ignore the surface; "agency" | P19a | #143 (15 Oct) | fixed | `lib/api/auth-errors.ts:23-29` titles per surface, `:94` "Sign in to continue.", `:177-180` `surface` required |
| SET-24 | P2 | Typed email confirm has no @ key | P09 | #139 (15 Oct) | fixed | `components/ui/typed-confirmation.tsx:69-72`, `:187` `inputMode="email"` when expected has "@"; `connection-card.tsx:308-314` no repeated description |
| SET-25 | P2 | Page primaries scroll away | P17 | #170 (15 Oct) | partly fixed | Connections: `connections-workspace.tsx:58-59` registers a `PageChrome` action; `app-bar.tsx:351-352` shows it once the header actions scroll away. **Remains:** Team's "Invite a teammate", the finding's other example, is still only in the page header (`components/settings/team-view.tsx:102-111`). The plan's P17 covered Connections only |
| SET-26 | P2 | Theme only in More; "Match system" wraps | P15 | #167 (15 Oct) | fixed | `components/settings/settings-index.tsx:83` `AppearanceRow`; `components/app-shell/account-menu.tsx:511-519` `SegmentedControl` |
| SET-27 | P2 | No help or feedback route | P21 | none | deferred | D10: no help or feedback channel exists in the repo. Confirmed: nothing in `destinations.ts`, `more-sheet.tsx` or `settings-index.tsx` |
| SET-28 | P2 | Disconnect most prominent on card | P17 | #170 (15 Oct) | fixed | `components/settings/connection-card.tsx:547-555` Disconnect is last in a ⋯ menu ("Actions for <email>") |
| SET-29 | P2 | Email warning to everyone; live selects (incl. DSK-17) | P14 | #169 (15 Oct) | fixed | `notification-preferences.tsx:218-245` reason as text for every role, plus the Operations link only for owners and admins. The cadence rows are left out, not drawn disabled (a choice the PR flagged for review) |
| SET-30 | P2 | Replay name assumes London time | P18 | #142 (15 Oct) | fixed | `operations-view.tsx:121` org zone from settings, `:226` label via `formatZonedTime` (`lib/operations/zoned-time.ts:20-28`); relative time while the zone is unknown |
| DSK-01 | P2 | Area tabs overflow at 1280 | L03 (P04 landed) | #152 (15 Oct) | fixed | `area-frame.tsx:154` (`overflow="more"`), `:659` (Review & publish as a header action) |
| DSK-05 | P2 | Same place four times; crumbs cut to stubs | L03 | #152 (15 Oct) | partly fixed | `context-health-chip.tsx:87-91` (`shrink` plus `title`). Client caption dropped on area pages (`area-frame.tsx:536-558`). **Remains:** no "…" collapse of middle crumbs (`breadcrumbs-context.tsx:107-116` still truncates every crumb), and at `wide` the listing name is still in both the crumb and the header row |
| DSK-06 | P2 | Overview switcher shows the client's name | L03 | #152 (15 Oct) | fixed | `area-frame.tsx:596-603` (the overview H1 is `SiblingSwitcher` with the listing name), `:559-562` (client as plain text) |
| DSK-07 | P2 | One-crumb trails echo h1; Settings trail | P06 | #138 (15 Oct) | fixed | `components/app-shell/breadcrumbs-context.tsx:93` no trail for a lone unlinked crumb; `:61-62` `/settings` → "Settings / Reply policy" |
| DSK-08 | P2 | Desk sidebar hides Team and Settings | P06 | #138 (15 Oct) | fixed | `components/app-shell/nav.tsx:148`, `:288` permanent "Workspace" group; the "More" disclosure has been removed |
| DSK-09 | P2 | Two `aria-current` rows | P06 | #138 (15 Oct) | fixed | `nav.tsx:205-248` one `current` from `currentHref` (`lib/navigation/destinations.ts:313`); Clients gets `containsCurrent`, not `aria-current` |
| DSK-10 | P2 | Hub listings as phone cards at 1280 | R15 | #125 | partly fixed | Full-width table, cards below `components/clients/client-hub.tsx:275-279,575-580`. Listings-board columns (Health, Waiting) not added: the client payload lacks them, and adding them would change the contract (#125) |
| DSK-11 | P2 | "2 to reply" in mono | R16 | #160 | fixed | `components/clients/clients-index.tsx:717,730` (`font-sans`) |
| DSK-12 | P2 | Venue line wraps rows to 3 lines | R09 | #190 | fixed | `components/inbox/review-list.tsx:488-505` (truncate, full text in `title`) |
| DSK-14 | P2 | Posts empty state points elsewhere | L09 | #123 (15 Oct) | fixed | `posts-tab.tsx:322-333` (`Empty action={composer}`) |
| DSK-15 | P2 | Status words and card verbs differ | L03 | #152 (15 Oct) | fixed | `lib/listings/health.ts:264-267` ("In sync"), used by `editor-footer.tsx:23`, `editor-status.tsx:154` and `review-publish.tsx:409`. `area-cards.tsx:283-284` ("Open" instead of "Check"). Non-compared areas keep "On Google"/"Nothing waiting" (`area-state.ts:166,219`) |
| DSK-18 | P2 | Short fields span the desk column | P09 | #139 (15 Oct) | fixed | `components/ui/field.tsx:55-63`, `:108-111` `measure="short"` → `desk:max-w-md`; applied at `policy-form.tsx:539`, `agency-name-form.tsx:125`, `identity-section.tsx:92`, `:118` |
| DSK-22 | P2 | Broken-image glyph | R08 | #164 | fixed | `components/inbox/review-detail.tsx:773-779,854-859` ("Photo unavailable") |
| DSK-23 | P2 | No desk quick-look panel | P23 | none | deferred | Stage 4, deferred by the leader. No panel in `clients-index.tsx` or `listings-board.tsx` |

## Deferred by decision

| Item | Findings | Reason |
| --- | --- | --- |
| P21 Help and feedback entry | SET-27, and the "Contact support" part of LST-28 | D10: the repo has no help or feedback channel. The only contact is the privacy email in `lib/legal/operator.ts`, which is for privacy requests. Name a channel and P21 comes back. |
| R03, notification half | INB-05 (the badge and title half is fixed, #194) | D2: the `approval_requested` and `reply_sent_back` kinds need a migration to the kind `CHECK` in `supabase/migrations/0078_operational_notifications.sql:9-11`. |
| R10 Inbox bottom toolbar | INB-19 | Stage 4, optional. Deferred by the leader. |
| P23 Desk quick-look panel | DSK-23 | Stage 4, optional. Deferred by the leader. |
| R06b Undo for "No reply needed" | INB-09 | **Not deferred.** It shipped without a schema change (D3): `app/api/reviews/bulk/route.ts:154,191`, and no migration has landed since `4e0fa805`. The Regenerate "Discard your edits?" confirmation remains (see below). |

## Phase 2 verification: what didn't match

Each lane's closing evidence was checked against findings.md and the code on main. No regression against a finding's before state was found. No migration has landed since `4e0fa805` (`git log 4e0fa805..de999679 -- supabase/migrations` is empty), which matches D2, D3, D6 and the no-schema rule. D9 is confirmed:
- `lib/domain/auth.ts:25-38` keeps only the 12–128 length rule, with no character-class rules.
- "Confirm password" is dropped only where `PasswordField` has its "Show password" toggle (`components/auth/sign-in-form.tsx:442`, `components/auth/reset-password-form.tsx:204`).

These items differ from what a PR or the plan claimed, or are new gaps:

1. **"Review & publish (n)" shows to roles that can't publish (LST-27; L03 against L11).** L11 leaves the step out of the area list for a role that can neither edit nor publish (`lib/listings/area-nav.ts:119-126`). L03 later added the same link as a header action and a phone overflow item, and that path checks only the pending count (`components/listings/area-frame.tsx:347-369`, `:446-453`, `:659`).
   - Scenario: an admin saves hours "here" without publishing. A viewer who then opens `/listings/{loc}/hours` sees "Review & publish (1)" in the header at 1280 and in ⋯ on a phone.
   - Low severity: publishing stays gated on the page. Owner: Listings.
2. **CLR-06 is not done.** #125 deferred it until P11, and nothing picked it up after P11 merged.
   - The TODOs are still at `components/clients/client-hub.tsx:253,537`.
   - A shared report says "Venues" (`components/share/shared-client-report.tsx:228`), while Reports says "locations" (`components/performance/performance-view.tsx:81`).
   - Owner: Reviews.
3. **CLR-05 is half done, although #125 claims it.** The hub copy changed, but Reports still says "vs the previous window" (`components/reporting/delta-badge.tsx:33`), "in this window" (`components/reporting/reply-figures.tsx:92`) and "Impressions since" (`components/performance/keywords-tab.tsx:93`).
4. **INB-09: a confirmation is still there.** The R06b row asked for "no regenerate confirm", but #193 removed only the "No reply needed" dialog. "Discard your edits?" still shows before Regenerate (`components/inbox/reply-composer.tsx:414-419,521-550`).
5. **LST-19: the Calendar half isn't done.** The Calendar still prints raw IANA zone IDs (`components/calendar/publication-calendar.tsx:176-178`, `components/calendar/calendar-grid.tsx:93`). The Replay accessible name also adds the raw zone (`lib/operations/zoned-time.ts:26`) instead of P11's `formatTimeZoneLabel`.
6. **SET-22: Operations still loads on the client** (`components/settings/operations-view.tsx:122`). The finding names it, but P20 covered only Team, Notifications and Reply policy.
7. **SET-25: Team's "Invite a teammate" still scrolls away** (`components/settings/team-view.tsx:102-111`). P17 gave only Connections the app-bar action.
8. **The D7 label differs from the brief.** A client-scoped report reads "Check for new data across clients" (`components/reporting/report-actions-menu.tsx:162`), not "Refresh all clients". #192 records this as the leader's revised wording, because the endpoint claims only due checkpoints. It's a wording difference, not a defect.
9. **Smaller wording left behind:**
   - "merchant standing" after a verification request (`components/locations/administration/verification-attempt-status.tsx:42,86,98`, LST-09).
   - "Raw review content kept for" on `/settings/privacy` (`components/settings/retention-status-card.tsx:75`, SET-15/16).
   - "All reporting locations complete through …" (`components/reporting/presence-provenance.tsx:103`, CLR-03).
   - With billing off, the 404 tab title reads "Page not found" (`app/(dashboard)/settings/billing-disabled.tsx:29`), where the root 404 reads "This page doesn't exist".
10. **Flows that gained a tap by design** (reported as they are, not as reductions):
    - Sharing from a client hub goes 6 → 7, because Share report moved into More (CLR-14).
    - The default-tone AI draft goes from 3 at least to 4, because tone is part of Generate.
    - Saving a menu on a phone goes 4 → 5, because P02 put "Save here" in the overflow.
    - Disconnecting a Google login goes 5 → 6, because Disconnect moved into ⋯ (SET-28).
11. **Plan targets missed and accepted:**
    - First content row: L03 at 45.5% and L04 at 35%, against under 30%. The AMA-18 profile-editor trim they were handed to has no PR.
    - P12 role change: 4 taps against a target of 3.
    - P14 page height: −49% without an email provider, and about −23% with one, against −40%.
12. **Evidence gaps, not code gaps:**
    - Seven stage-1 Reviews PRs (#118, #120, #121, #125, #126, #128, #129) and five Listings PRs (#117, #119, #123, #124, #127) merged with G4–G7 "not run" in their bodies, because the env links did not exist yet. AMA-15 says the Listings gates ran later, in its comments.
    - There are no e2e cases for the client hub (R15) or the client form and archive (R17).
    - L18's "No hours on Google" state has not been seen in a browser (no fixture for it).
    - Hosted CI did not run for any integration PR.

## Steps per flow, before and after

Before counts are copied from findings.md. "Code" means counted from the code path on main. Rows marked "needs re-capture" wait for the flow library re-capture.

| Family | Flow | Task | Before (taps) | After (taps) | Source |
| --- | --- | --- | --- | --- | --- |
| Inbox | Inbox | Open the next review that needs a reply | 1 | 1 (no change) | Code: default queue is still Needs reply (`lib/inbox/url-state.ts:17`) |
| Inbox | Replying | Write and publish a reply | 3 | 3 (no change). The status now says "Sent · waiting for Google's check" while Google moderates | Code (`lib/inbox/reply-state.ts:407-418`); #154 e2e journeys expect "Reply sent" |
| Inbox | Suggested reply | Publish an AI draft | 4 (tone optional, so 3 at least) | 4: open; Generate ▾; tone; Publish. Picking a tone is now part of Generate, so the default-tone path is 4 rather than 3 | Code (`components/inbox/reply-composer.tsx:588-628`) |
| Inbox | Approving | Requester submits, approver approves | Requester 3; approver 3; phone Reject 6 | Requester 3 (typed) or 4 (AI: Generate ▾ plus tone), with "Submit for approval" and no dead-end Approve; approver 3; phone Reject 6 (Reject still in ⋯ beside Approve) | #154 G7 table (labels, Approve press removed); code `components/inbox/action-bar.tsx:356-366,462-469` |
| Inbox | Review detail ⋯ | See history or details | 2 | 2 (no change; loaded on demand, with a loading shell) | Code (`components/inbox/review-detail.tsx:374,430`); #190 |
| Inbox | Filtering | 5★ reviews with text | 4 | 2: ★5 chip, "With text" chip | Code (`components/inbox/filter-controls.tsx:23-78`); #163 e2e. No browser tap count in a PR |
| Inbox | Searching | Find a review | 1 plus typing; Cancel | 1 plus typing; Cancel (no change) | Code (`components/inbox/inbox-toolbar.tsx:63-134`); R10 deferred |
| Inbox | Syncing | Pull new reviews | 1 (owners and admins) | 1 (no change). Errors are now toasts; freshness shows on phones for every role | Code (`components/inbox/sync-reviews-button.tsx:35-38`, `components/inbox/list-header.tsx:156`) |
| Inbox | Switching client scope | Work on one client | 2 | 2 (no change). No filter chip or count added; Clear all keeps the scope | Code (`components/inbox/inbox-view.tsx:319-332`); #159 e2e "Clear all filters keeps the client scope" |
| Inbox | Inbox › Select | Mark one review "No reply needed" | 4 | 2: row ⋯ (or swipe), then "No reply needed". No confirm; Undo in the toast | #162 title ("two taps"); code `components/inbox/review-list.tsx:349-368`, `components/inbox/review-triage.tsx:58-70` |
| Inbox | Notifications | Check problems | 1 | 1 (no change) | Code; no notifications seeded, so not seen with rows |
| Clients/Reports | Reports | Choose whose figures and which period | 6 | 3: app-bar chip; client; period chip | Code (`components/reporting/report-toolbar.tsx:72-112`); #161 G7 "not measured" |
| Clients/Reports | Reports | Switch Reply / Google / Keywords | 1 | 1. Period now carried to the nearest equivalent, with a note | Code (`components/performance/performance-view.tsx:130-216`) |
| Clients/Reports | Reports | Reach the first figure on Google / Keywords | About one screen of scrolling | not measured (needs re-capture) | #161 took screenshots but gave no measurement |
| Clients/Reports | Sharing | Share a client's report from its hub | 6 | 7: Clients; card; More; Share report; Create link; Share link; target. Share report moved into More (CLR-14) | Code (`components/clients/client-hub.tsx:357-389`) |
| Clients/Reports | Sharing | Share from Reports with "All clients" | 7 | 5: ⋯; "Share a client's report"; client; Create link; Share link | Code (`components/reporting/report-actions-menu.tsx:131-185`) |
| Clients/Reports | Sharing | Recipient changes the period | 2 | 2. The reload now lands on `#main` | Code (`components/share/shared-client-report.tsx:137`) |
| Clients/Reports | Clients | Create a client and start set-up | About 12-14 | not measured (needs re-capture). The connect step order changed, not its count | #128 G7 not run |
| Clients/Reports | Clients | Find a client that needs work | 3 (plus a strip scroll) | 3. Empty buckets are hidden, so no strip scroll in the fixture | Code (`components/clients/health-filter.tsx:69`); #160 e2e |
| Clients/Reports | Clients | Switch the app-wide client scope | 2 | 2 (no change) | Code (not touched by Reviews slices) |
| Clients/Reports | Clients | Edit a client's name, colour or notes | 3 | 3: More; Settings; Save changes (docked, when dirty). The phone anchor tap is gone; More was added | Code (`components/clients/client-hub.tsx:381-389`, `components/clients/client-settings.tsx:1039-1042`) |
| Clients/Reports | Clients | File or move a listing | 4 | 4: More; Settings; Move to… (after scrolling; no phone anchor); client | Code (`components/clients/client-settings.tsx:114-117`) |
| Clients/Reports | Clients | Archive a client | 5 | 3 from the hub: More; Settings; Archive (Undo is optional). #126's "5 → 2" counts from the settings page | Code (`components/clients/client-settings.tsx:817-860`); #126 |
| Listings | Index / overview | Open a listing; switch to a sibling; Activity | Open 1, Switch 2, Activity 2 | Open 1, Switch 2. Activity: 1 on a phone when the overflow holds only Activity (otherwise 2); 1 on a desk | Counted from code: `area-frame.tsx:398-411`, `activity-drawer.tsx:54-60`. Not measured in a browser |
| Listings | Editing the profile | Change the business name and publish | 3 plus typing | 3 plus typing (card, Review changes, Publish to Google) | #157 G7 ("Taps are unchanged") |
| Listings | Editing hours | Open Monday 09–17 and copy to the weekdays | 6 | 6 (Monday switch, "Copy Monday to…", Weekdays, Copy to 4 days, Review changes, Publish); +1 to open the day sheet for times | Counted from code: `hours-editor.tsx:501-509,561-570,1353`. #155 G7 measured page height (2375 → 1184 px), not taps |
| Listings | Editing the menu | Start a menu with one item and save | 4 plus about 5 fields; publish +2 | Desk 4; phone 5 ("Save here" is now in "More actions", P02); publish +2 | Counted from code: `editor-footer.tsx:207-233`, `action-bar.tsx:56-57`. Not measured (needs re-capture) |
| Listings | Managing photos | Upload a photo from the library | 4 plus OS picker | 3 plus OS picker (Add photos, Choose from library, Upload N photos) | #127 body ("2 → 1" from files chosen to upload); browser G7 not in PR body |
| Listings | Creating a post | Write an update and publish it | 4 to 5 | 2 (New post, Publish to Google); a photo adds the Photo row plus a pick | #174 G4–G7 (throwaway browser spec: "goes live in 2 taps", one stub create); #151 code count |
| Listings | Reviewing Google suggestions | Check for and accept suggestions | 1 (Check Google now) | 1 (own button, `suggestions-page.tsx:208`). Accept/ignore not measured (no fixture) | Counted from code |
| Listings | Adding a booking link | Add a "Reserve a table" link | 7 | 5 by the baseline's counting (card, URL plus preferred tick, Review booking link, Approve, Send); 6 with the consent tick before Send | Counted from code: `booking-tab.tsx:887-905`, `place-action-approval-sheet.tsx:175,183,263`. #150 G7 not measured |
| Listings | Checking verification | Find out whether the listing is verified | 1 to 2, then a long page | 1 to 2; the answer is the first line, tools collapsed | Counted from code: `verification-tab.tsx:79-90` |
| Listings | Change history and approvals | Publish all saved areas; read history | Publish 3; History 2 | Publish: phone 3, desk 2 (header "Review & publish (n)", then Publish). History: phone 1 or 2 (see first row), desk 1 | Counted from code: `area-frame.tsx:347-369,446-453,659`. Not measured |
| Listings | Requester view | Member looks at a listing | Read only | Read only, now as a read view (no greyed boxes) | #147 G5 e2e "read-only views" |
| Listings | Managing people | Invite a manager | 4 (to Approve) | 4 (to Approve); 6 to send, unchanged; one surface instead of two | #153 G7 table |
| Calendar | Calendar | See scheduled posts | Agency 2, Business 1, lands on a dead end | Off: still out of the nav except on `/calendar`; 1 tap out via "Go to Listings". On: not measured (needs re-capture) | #158 G6 plus `app-shell.tsx:265-269` |
| Team/Settings | 01 Signing in | Sign in with email | 2 fields + 1 tap | 2 fields + 1 tap (unchanged) | Code: `sign-in-form.tsx:419` (no slice changed the sign-in path) |
| Team/Settings | 01 Signing in | Create an account | 2 taps + 4 fields + email, plus 3 composition rules | 2 taps + 3 fields + email; 1 rule (length). Fits one 390 screen (977 → 844px) | #176 G7 ("4 fields → 3", "rules 4 → 1") |
| Team/Settings | 01a Resetting a password | Reset a forgotten password | 3 taps + 3 fields | 3 taps + 2 fields (email, new password) | #176 G7 ("2 password fields → 1"); `reset-password-form.tsx:204` |
| Team/Settings | 01b Accepting an invite | Join an organisation | 1 tap + 3 fields; role not shown | 1 tap + 2 fields (name, password); Role and Link expires shown | #176 G7; `invitation-view.tsx:89-90` |
| Team/Settings | 02 Setting up | Set up a client to Done | about 10-12 taps | not measured (needs re-capture). Setup now has "‹ Clients" and a current tab (P15). The R18 counter fix is a Reviews slice | #167; #128 G7 says no tap measurement |
| Team/Settings | 02a Managing Google connections | Disconnect a Google login | 5 taps + typing | 6 taps + typing (More, Settings, Google connections, ⋯, Disconnect…, Disconnect). The email keyboard now has "@" | #170 ("2 taps before, 3 now"); #139 |
| Team/Settings | 08a Inviting a member | Invite a teammate | 6 taps + typing + a scroll inside the sheet | 6 taps + typing, no scroll (Client access sits above the button at 390×844) | Code count, `invitations-panel.tsx:608-692`; #140 e2e at 390×844 |
| Team/Settings | 08b Changing a role | Make a viewer a member | 5 taps + scroll | 4 taps counted from More (3 from the Team page: role chip, role, confirm); no scroll to reach the row | #172 G7. The plan's target was 3 in the audit's counting, and #172 reports 4 |
| Team/Settings | 10a Notification settings | Turn one alert off | 4 taps; email cadence +2 | 4 taps; cadence +2 (row, then option) when email is set up. Page height at 390 is 3,379 → 1,725px (−49%) | #169 G7; `notification-preferences.tsx:197`, `:249-291` |
| Team/Settings | 10b Reply policy | Change approval or retention | 5 taps | 5 taps for approval; 6 for retention (open the select, then pick), where before it was typed | Code count, `policy-form.tsx:647-669`; no tap figure in #141 |
| Team/Settings | 10c Checking operations | See whether background work is healthy | 3 taps + about 3 screens of scrolling, no summary | 3 taps; the answer is one `Alert` at the top, with no scroll | Code, `scheduled-jobs-panel.tsx:38-43`; #142 |
| Team/Settings | 10d Switching to dark mode | Choose Dark | 2 taps (More, Dark) | 2 taps (More, Dark segment). Also 4 from Settings (More, Settings, Appearance, Dark), because choosing applies and closes the sheet | #167; `account-menu.tsx:511`, `settings-index.tsx:83` |
| Team/Settings | Shell | Switch client scope | 2 taps; toasts stack | 2 taps, one toast (replaced by id). No chip on Team, Settings or Notifications | #133; `scope-sheet-model.tsx:139`; #130 |
| Team/Settings | 11b Permission denied | Ask for access | 1-2 taps after scrolling, plus leaving the app to paste | 1 tap ("Ask for access" is the primary at the top; it opens the share sheet, or copies the request and link) | Code, `access-denied.tsx:165-173`; #134 |
| Team/Settings | 11c Missing page | Get back on track | 1 tap, to the wrong place (Inbox) | 1 tap, to the shell back target (for example "Back to Clients") | Code, `not-found-content.tsx:47-60`; #134 |

**The largest reductions:**
- Publishing a post: 4–5 → 2 (#174, measured in a browser).
- Filtering to 5★ with text: 4 → 2.
- Marking one review "No reply needed": 4 → 2, with Undo instead of a confirmation.
- Choosing a client and a period on Reports: 6 → 3.
- Sharing from Reports with all clients in scope: 7 → 5.
- Adding a booking link: 7 → 5.
- Archiving a client: 5 → 3.
- Asking for access: one tap from the top of the page.

## Open follow-ups

### From AMA-13 decisions and reviews
1. **AMA-29: the Inbox unread-count model** (Reviews lane, in backlog). Three cases: poll-after-removal, no pin when the badge isn't loaded at the first change, and a new notification arriving mid-change. These were deferred out of #191 by the owner ("ship 6dd", 16 Oct 2026).
2. **From the Release & QA review of #191 at `8bcf591f`, not yet ticketed:**
   - **Inline-confirmation focus loss (a11y, should-fix).** Under All or Unread, "Yes, resolve" or "Cancel" removes the focused button while the row stays, so focus falls to the body (`components/notifications/notifications-view.tsx:337-341,438-458`). Return focus to the row's own action.
   - **Partial saves revert silently.** A turn that saved fewer rows than it sent (for example 1 of 50) reverts all of them to unread with no toast until the refetch. Only `updated: 0` is tested.
   - **Duplicate ID in a turn.** The server counts a duplicated ID once, so the turn is treated as unsaved. It's unlikely with cursor paging, and the cost is a revert and a refetch.
   - **"Load more" failure wording.** A failed "Load more" shows "could not be refreshed".
   - **Empty list with a failed refetch.** It shows "Nothing matches this filter" without the out-of-date notice.
3. **D2:** the notification kinds for approval requests and send-backs need a migration (owner).
4. **D10 / P21:** name a help or feedback channel and P21 can ship. This includes "Contact support" on the Calendar off state (LST-28).
5. **Stage 4:** R10 (INB-19) and P23 (DSK-23), both optional.
6. **Passwords (owner):** move to a 15-character minimum with a breached-password check. D9 kept 12–128 because no breached-password check exists in the codebase, and one would need a new external service. Before release, the owner should also confirm that:
   - hosted Supabase Auth requires no character classes, or letters-only passwords are refused (`lib/server/password-auth.ts:311-313`, `:465`);
   - whether the provider's 72-byte cap applies.

### Found or confirmed in this verification
7. Gate "Review & publish (n)" by role in the area header and the phone overflow (item 1 above, Listings).
8. CLR-06 wording, and the Reports half of CLR-05 (Reviews).
9. INB-09: replace the Regenerate "Discard your edits?" confirmation with Undo (Reviews).
10. LST-19: friendly zone names in the Calendar and the Replay name (Listings and Platform).
11. SET-22: prefetch Operations on the server. SET-25: an app-bar invite action on Team (Platform).
12. Lower `scripts/design-baseline.json` to 104 with `pnpm check:design --update-baseline` (Platform), so the 2 removed R7 hits can't come back.
13. The AMA-18 profile-editor trim (section heading and per-field meta lines), which the L03 and L04 height targets were handed to. It has no PR.
14. e2e coverage for the client hub (R15) and the client form and archive (R17). A browser check of L18's no-hours state.

### Carried from PR bodies (non-blocking)
- **L02 (#124):** the activity cursor regex lacks `bulk:` and `schedule:` (`lib/contracts/location-activity.ts:41`), so paging past those rows may return `invalid_cursor`.
- **L10 (#151, #174):**
  - A lost answer to a save can leave a second draft.
  - After a reconcile, a false-positive 409 is possible.
  - No test asserts that the PATCH route passes `expectedRevision`.
- **L16 (#156):** Review & publish isn't streamed yet (it needs `review-publish.tsx` split).
- **L18 (#168):**
  - `listingAttentionReason()` isn't wired into the board or the health strip.
  - The client attention sentence doesn't mention missing hours.
- **R01b (#154):** an approval recorded before a failed publish can still qualify after a reject and resubmit. This needs a server-lane ticket.
- **R03 (#194):** approvers' counts include:
  - a review marked "No reply needed" while awaiting approval;
  - a parked reply with no verified draft;
  - approvals under read-only billing.
- **R09 (#190):**
  - `/inbox` has about 1–3 KB of budget headroom, so the next addition needs a lazy boundary.
  - The shell-wide zod chunk remains.
  - The sticky selection header in landscape (844×390).
- **R13 (#129):** "Refreshing…" can show for up to 90 s on a sync that changed nothing.
- **P20 (#195):** old-role controls can show on a replayed page; the server still checks every action.
- **`tests/server/request-metrics.test.ts`** is flaky on main (#175), and `operations-features.spec.ts` has a calendar clock-change flake (#192).

## What is still to run

Phase 3's own captures need the seeded `naba_visual` harness: `tests/visual/with-visual-db.sh` reads the database URLs from the worktree's `.env.local`. This verification ran in its own worktree, `naba-presence-redesign/ux-results`. Linking the env files there was refused by the agent's permission layer, and Release & QA does not read env files or work around that. So these steps wait for the owner to link `.env` and `.env.local` into that worktree, as for the `ux-*` worktrees. Then they run there under the `naba-visual` lock, one at a time, with SIGINT afterwards:

1. **The flow library.** Re-capture it into "Naba Presence Mobile - Flows (after)" on the owner's machine, with the same structure as the 141-screen, 42-flow library. Re-take the 15 desktop captures with `tests/visual/shoot.mjs`.
2. **`audit:mobile`** with P01's combos: `node tests/visual/mobile-audit.mjs --base http://localhost:3220 --combos 320:light,390:light,390:dark,1280:light,1280:dark --out <dir>`. Fill the After column above.
3. **perf-lab** with the baseline's profiles: mobile with 3 runs and desktop with 2, on a production build. Fill the "Final main" column.
4. **G4 and G5** on final main: `pnpm test:e2e:touch`, `pnpm test:a11y` and the flow specs.
5. **The steps tables.** Replace the "needs re-capture" rows and the code-counted rows with tap counts from the new library.
