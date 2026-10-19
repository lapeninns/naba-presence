# AMA-146: controlled mobile performance requalification (2026-10-18)

AMA-12 screenshot QA reported three baseline breaches on `38df396f` from three
uncontrolled samples per route: Inbox first-load JS 523 KB, Business profile
596 KB and LCP 1,512 ms, and a Listings interaction probe that measured
nothing. This remeasures them under controlled conditions, fixes what was
confirmed, and records one owner budget decision. It is a local lab
measurement, not production field data. Raw results are in
[`2026-10-18-ama146/`](2026-10-18-ama146/).

## Instrumentation first (679a54ef)

The probe and the budget check were fixed before anything was measured, and
the same sampler, helpers and budget code measured both builds.

- The Listings probe tapped `[data-slot="segmented-control-item"]`, which the
  board no longer has, and an absent Event Timing entry was recorded as a 0 ms
  interaction. The probe now taps an unpressed health chip and proves its
  pressed state and `health` URL. A health chip with nothing in it is not
  drawn, and the fixture's two listings are both "Not checked", so on plain
  `/listings` the only chip is the pressed "All". There the probe opens the
  order chip instead and proves the menu opened. `/listings?health=attention`
  was added to cover the chip path ("All" is then the unpressed chip).
- Only Event Timing and `first-input` entries attributed to the tapped control
  inside the probe window count. Missing timing stays unavailable.
- A sample fails qualification on a non-200 status, an unexpected landing URL,
  a page or console error, an incomplete quiet window, any missing metric, or
  no first-load JS. `budgets.mjs` fails on a missing required metric and on an
  invalid saved measurement rather than skipping it.

Red/green: with the old fixture state the probe had no target and the run was
rejected (`baseline-diagnostics/listings-probe-no-target.json`). The health
chip path recorded a 64 ms attributed click with `health` going from
`attention` to `all` (`listings-probe-health-chip.json`).

## Method

- Builds: A = `679a54ef` (application code identical to `207ea84b`, the
  production base), BUILD_ID `uTxBpepAr9tyKWSUkwQ1I`. B = `52f88b9d`, BUILD_ID
  `NNPqPAaLVIoZIF1vE99ZS`. Both are webpack standalone builds, copied aside so
  each stays fixed.
- Fixture: a private PostgreSQL 17 cluster (`naba_visual`, all 149
  migrations, CI placeholder secrets, no production data or keys). One
  `tests/visual/fixture-server.ts` process held the seed, Google stub and
  session refresh for every block. Only the app process changed between
  blocks, on the same origin, with the feature flags of `nm-serve.mjs`. The
  state file hash was identical before and after every block
  (`final-ab/ab-meta.json`).
- Profile: `perf-lab.mjs --profile mobile` (390x844, DPR 3, touch, 4x CPU,
  150 ms RTT, 1.6 Mbps down), five cold runs per route in fresh contexts,
  routes interleaved, 5 s quiet window, medians. Blocks ran A, B, B, A, with
  two equal warm-up renders of each route before each block.
- Host: an 18-core Mac shared with other work. Over the run, 1-minute load
  was 3.4 to 15.1 (median 6.6), CPU idle 9 to 90% (median 80%) and memory
  80% free (`final-ab/host.log`, every 4 s). It was not idle. Byte figures
  are identical in every sample, and the timing medians agree across the
  reversed blocks.

## Results against `budgets-baseline.json`

Every block had 15 of 15 valid samples. Medians for blocks 1 and 4 (A) and
2 and 3 (B):

| Route                   | Metric                    |     A (1 / 4) |         B (2 / 3) |      Ceiling |
| ----------------------- | ------------------------- | ------------: | ----------------: | -----------: |
| /inbox                  | first-load JS KB          | 523.1 / 523.1 | **507.4 / 507.4** |          520 |
| /inbox                  | other JS KB               |   33.3 / 33.3 |       54.1 / 54.1 |           60 |
| /inbox                  | LCP ms                    | 1,224 / 1,256 |     1,240 / 1,248 |        5,000 |
| /listings               | LCP ms                    | 3,924 / 4,000 | **1,244 / 1,244** |        1,500 |
| /listings               | CLS                       | 0.015 / 0.015 |     0.000 / 0.000 |          0.1 |
| /listings               | INP probe ms (order menu) |       88 / 96 |           80 / 88 |          150 |
| /listings/{loc}/profile | first-load JS KB          | 596.2 / 596.2 | **586.4 / 586.4** | 520, now 615 |
| /listings/{loc}/profile | other JS KB               |   27.5 / 27.5 |       40.4 / 40.4 |           60 |
| /listings/{loc}/profile | LCP ms                    | 1,240 / 1,256 |     1,248 / 1,248 |        1,500 |
| /listings/{loc}/profile | TBT ms                    |      89 / 109 |           66 / 71 |          200 |

The baseline check exits 1 for A (Inbox JS and Listings LCP, plus Profile JS
before the override) and 0 for both B blocks.

- **Inbox, fixed.** The open review's detail, composer and publish bar now
  load on demand (16 KB less first-load JS). A phone's cold first open of a
  review was checked separately, five runs per block, A/B/B/A: A 332 to
  383 ms, B 330 to 366 ms (`behaviour/`). The pane is preloaded when the
  browser is idle, which accounts for B's extra other JS.
- **Listings LCP, fixed.** The LCP element was a row's health pill, painted
  after hydration fetched `/api/listings/summary`. The summaries are now
  prefetched on the server. AMA-12's 1,264 ms came from a fixture whose
  summary never resolved, so it never drew the pill. The held fixture
  refreshes the stub connection, which is closer to a real tenant and showed
  the late paint.
- **Profile, owner decision.** The closed review sheets now load on first
  open (9.8 KB less first-load JS). The same code still arrives after
  hydration through other lazy chunks, so total JS transferred is unchanged.
  The listing frame shared by every area page is about 525 KB on its own, so
  the 520 KB default cannot be met by any area page; hours, photos and posts
  already have ceilings of 545 to 565. The owner chose an explicit Profile
  ceiling at the measured 586.4 KB plus about 5%: 615 KB. Note that 615 would
  also have admitted A's 596 KB.
- Profile LCP: AMA-12's 1,512 ms did not reproduce as a median (1,240 to
  1,256). Single samples reached 1,496, 1,524 and 1,976 ms, so the 1,500 ms
  ceiling has little headroom for this route.

Two confirmation blocks followed. Build C (BUILD_ID `5yrJjh-1Eh_HLduzj93L0`)
differs from B only in the review pane's error fallback and in tests. Build
D (`08df800a`, BUILD_ID `svaVErX3Gf1U7AmCQmsF7`) adds the review fix below.
Both measured the same bytes as B (507.4, 509.8 and 586.4 KB) with LCP of
1,228 to 1,256 ms, and both passed every baseline budget (`confirm/`).

## Aspirational `budgets.json` (separate targets)

These are targets for the redesign, not regressions. Six breaches remain for
B (seven for A): first-load JS on all three routes (380 or 330 KB targets),
total transfer on Inbox and Profile (600 KB), and Profile API requests (8 > 5).
Listings LCP (2,500 ms) moved from breach to pass.

## Behaviour checked in the browser (A and B, each block)

The phone deep link `?selected=` renders the review in the server HTML.
Desktop `/inbox` auto-selects a review and `j` moves to the next. Phone Back
returns to the list with focus on the row. The Listings HTML includes the
health pills (B only, as intended). The Profile "Review changes" sheet opens,
lists the edit, closes with Escape and returns focus to its button. In
recovery checks with blocked chunk downloads, the Inbox showed "This review
could not be shown." with Back, and Try again loaded the pane. In the
Profile, the sheet's code was already in memory from another chunk, so its
failure path is covered by `tests/components/lazy-review-surfaces.test.tsx`
instead.

## Project gates on the final head

Frozen install, typecheck, lint, `check:design`, `check:contrast` and the
webpack build passed. Unit and component tests: 8,120 passed, 1,413 skipped.
Integration (private cluster): 1,412 of 1,412 passed. Playwright e2e,
including the touch-390 and accessibility specs: 751 of 751 passed. Agentic
e2e (`e2e run`, `--no-cache`, live model calls): desktop Inbox publish,
Inbox two-person approval and the Profile leave guard passed, 5 of 5 tests
with 30 model calls. Mobile, the new phone review and Listings journey passed,
3 of 3 with 9 model calls, and mobile navigation passed. The desktop Inbox
journeys had expected "Reply published", but since `c76d6e64` a reply that
Google holds for moderation toasts "Reply sent". That expectation was out of
date on `main` too, and it was updated here.

An independent review of `20808e7d` approved it with one should-fix. After a
failed download of the pane's code, choosing a different review failed
straight away, because the lazy component was only replaced by "Try again".
`08df800a` replaces it as soon as the load fails. A component test for this
fails before the fix and passes after it. A browser probe that blocks the
chunk, then recovers both through Try again and through Back plus another
review, also passed (`behaviour/recovery-final.json`). The same reviewer
approved `08df800a`. On that build, unit and component tests (8,121 passed)
and the full Playwright suite (751 of 751) passed again.

## Limits

- Local lab on a shared host with a synthetic tenant (two listings, a few
  reviews). This says nothing about production field INP or LCP.
- The interaction probe is one bounded tap. On `/listings` it measures the
  order menu, because this fixture draws no second health chip.
- Desktop and the remaining routes were not remeasured here.
