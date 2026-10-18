# AMA-46 local browser and visual QA — 18 October 2026 UTC

Baseline: `12ccd4fca84d3c1806197fbb0357605a91ad652b`.
Implementation/test candidate C1: `6b4f47d68bf689dfa05586da5dbc3cbfa473a1f9`.

C1's required project browser checks passed: G4 touch22/22, G4 accessibility64/64, G5 Inbox/operations/approval notifications47/47. These133 cases passed on their first execution, with one attempt each, no failed/flaky/skipped cases. Counts are reconciled against independent collection and every raw result, not only terminal totals. The G5 notification case uses real reviews in two clients, starts with the other client remembered, verifies addressed-recipient visibility, both review destinations/queues and unchanged notification read/open state at375/768/1280.

The final standalone e2e run3 passed4/4 cases: `D2 notification review actions in light` and `D2 notification review actions in dark`, each at mobile390×844 and desktop1280×800. It made four actual configured `chatgpt('gpt-6-luna')` calls. Each case checks both decorative glyphs are present and visually rendered, the row labels/link destinations, a real model judgment, and each notification's one-click destination with the correct review text in the semantic Selected review region. Replay was off, retries0, workers1, trace/video off. Source/reports for earlier attempts remain separate:

- Agentic run1:4 failed journeys,0 model calls. The scratch assertion treated intentionally aria-hidden decorative SVGs as semantic-visible controls.
- Agentic run2:4 successful model judgments/calls,4 failed journeys. A scratch CSS selector required an explicit role attribute, while the app uses a labelled section with implicit region semantics. Its URL checks had passed and failure screenshots show the correct review.
- Agentic run3:4 passed journeys,4 successful model calls. It uses the documented semantic Selected review locator.
- Actual model calls across all three runs:8. Earlier failures have not been deleted or reclassified as passing journeys.

Agentic request guards recorded zero unsafe and zero off-origin attempts in each run. The exact synthetic Journey thumbnail was fulfilled locally four times in run2 and four times in run3, without external network access. `guard-counts.jsonl` contains counter-only original records; agentic-summary.json identifies line ranges and the source hash. These guards cover the standalone journeys; the project regression suites separately exercise authorized synthetic fixture/stub writes.

G6 retained five before and five after screenshots:320light,390light,1280light,320dark,390dark, all at844px height. Every capture returnedHTTP200 without console/page errors or horizontal overflow. Images show the old Bell/Open listing and the new ClipboardCheck/Undo2/Open review. Synthetic location labels and same-time incident ordering differ between runs; compare named rows and layout rather than pixel identity or ordering.

G7 scoped audit is a different five-combo matrix:320light,390light,390dark,1280light,1280dark, using the runner's width-derived heights. Each side has exactly five unique `/notifications` loads, allHTTP200. Both before/after have zero axe, focus-obscured, horizontal-overflow, load/console/page errors, clipped text, effective44px failures and WCAG target-size failures. This is focused Notifications coverage, not a rerun of all36routes/180loads.

The actual old fixture flow took four clicks for Approval requested (Open listing→Inbox→Approval queue→Select review) and three for Reply sent back (Open listing→Inbox→Select review), at both390 and1280. The final direct link takes one click per notification, verified by eight successful link transitions across the four final agentic cases. Setup `app.open`, model judgments and screenshots are not counted as user-flow clicks.

Route JS is a static build-manifest union upper bound, not exact served transfer or latency:

| Measure | Baseline bytes | C1 bytes | Delta |
| --- | ---: | ---: | ---: |
| Notifications route raw |1266512|1267470|+958|
| Notifications route gzip |421453|421724|+271|
| Notifications page chunk raw |45786|46258|+472|
| Notifications page chunk gzip |15884|16039|+155|
| Shared dashboard shell gzip |384068|384045|-23|

Both builds pass the explicitly documented baseline bounds70KB/chunk,400KB/shared,560KB/route (exit0, no breach). Both fail the separate aspirational50/250/400 bounds (exit1):42 breaches each, comprising3chunks, the shared shell and38routes. No new violation class was introduced; target failures remain failures, without a waiver. KB=1024bytes. The script enforces no ceilings when those flags are omitted; raw unbounded measurements are retained separately.

The baseline preparation also retains three unsuccessful orchestration attempts: illegal direct workflow seed, count-bearing Inbox locator, and omitted Approval queue action. Only the necessary scratch fixture/locator was repaired each time. The successful unchanged baseline build was reused with hash/BUILD_ID/mtime proof; screenshots/audit/bundles were not repeated for the later flow-only corrections. Full attempt history and original report hashes are in attempt-history.json and agentic-summary.json.

Exact C1 build provenance includes BUILD_ID`T4Ofu8u8keLa-fmZnJACI`, standalone-server and build-log hashes/mtime, Node24.18.0/pnpm10.34.5/PG17.11, and source hashes. Each active visual/agentic server's PID/cwd was tied to that build. The Journey fixture bridge, synthetic tenant and loopback Google stub were used on owned disposablePG. No actual env files, shared54322/naba_visual, hostedDB, production account, real email or provider was used. No independent served-revision endpoint is claimed; local revision proof is checkout/build/process provenance.

Final cleanup independently confirmed no remaining standalone processes for either checkout, no listeners on owned app/stub/PG ports, PG state removed, canonical lock removed, owned ignored state links removed and C1 tracked state clean. Raw browser reports, logs, fixture session data and DB exports stay outside this selected bundle. No further app/test/build/gate execution is planned by this lane. Root owns subsequent C2 documentation, final local gates/full integration, review and merge.
