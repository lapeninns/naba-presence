# F11 · Approval notifications open the review

AMA-46 gives `approval_requested` and `reply_sent_back` notifications distinct ClipboardCheck and Undo2 glyphs and an **Open review** action. Approval requests open the selected review in the Approval queue; send-backs open the selected review in Needs reply. Other notifications retain their listing action. Missing or malformed review metadata retains the listing action when a listing target exists, and otherwise offers no target link. Opening a review preserves notification read state and resolution permissions.

This evidence compares baseline `12ccd4fca84d3c1806197fbb0357605a91ad652b` with application candidate `6b4f47d68bf689dfa05586da5dbc3cbfa473a1f9`. The candidate was built with Node 24.18.0, pnpm 10.34.5 and webpack, and served against disposable local PostgreSQL 17.11 with a loopback Google stub. [Build provenance](candidate-build-provenance.json), [visual target proof](candidate-visual-target-proof.json), [agentic target proof](candidate-agentic-target-proof.json) and [execution commands](commands.json) bind the evidence to that code. The [frozen summary](summary.json) records the combined results.

## Verification against G1–G7

| Gate | Result at this evidence freeze |
| --- | --- |
| G1 · Typecheck, lint, unit | Recorded separately for the final PR head in [PR #240](https://github.com/lapeninns/naba-presence/pull/240). |
| G2 · Design ratchet | Final-head result recorded in PR #240. |
| G3 · Contrast | Final-head result recorded in PR #240. |
| G4 · Touch and accessibility | 22 touch cases and 64 accessibility cases passed. |
| G5 · Named browser regressions | 47 Inbox, operations and approval-notification cases passed. |
| G6 · Before/after screenshots | Five captures per revision; selected captures visually inspected, as detailed below. |
| G7 · Measured change | Click counts, focused mobile audit and build-manifest JS comparison recorded below. |

The **133 project browser cases passed with zero failed, flaky or skipped cases**, one attempt per case. The corrected approval regressions use real reviews and exercise actual navigation, recipient visibility, remembered client scope, Back navigation, read state and accessibility. [Per-case results](browser-tests.json) retain the coverage; this is a focused suite, not the entire application browser suite.

The final agentic run passed **4 of 4 cases**: 390 and 1280 widths, each in light and dark. Each case checked both glyphs and both review links, made a live visual judgment and opened both exact selected reviews with deterministic URL and review-text assertions. It used **4 live model calls**, no replay cache, no retries and one worker. There were **8 model calls across all attempts**. Two earlier agentic runs failed because the scratch harness treated decorative SVG accessibility as visibility, then used the wrong semantic-region locator. Those failed runs remain recorded; they are not product passes. Baseline fixture and measurement corrections are also retained in the [attempt history](attempt-history.json). See the [agentic results](agentic-summary.json).

## Measured journey

At both 390 and 1280, reaching an approval-request review took four clicks on the baseline: Open listing → Inbox → Approval queue → select review. A send-back took three: Open listing → Inbox → select review. Each candidate notification now reaches its exact review in **one click**. The final run verified eight such transitions across the four viewport/theme cases. Test setup, navigation resets and assertions are excluded from these user-action counts. [Flow comparison](flow-comparison.json).

## Visual and mobile audit

Before and after screenshots cover **320 light, 320 dark, 390 light, 390 dark and 1280 light**, with screenshot height 844. Browse the [before captures](before/screenshots/) and [after captures](after/screenshots/). Visual inspection covered before 390 light/320 dark and after 390 light/320 dark/1280 light: the individual glyphs, labels and read actions were clear, with no observed clipping or overlap. Fixture title markers and tied-row ordering differ between runs; these are visual comparisons, not pixel-identical snapshots.

The focused `/notifications` mobile audit used **320 light, 390 light/dark and 1280 light/dark**: five pages per revision. Both runs recorded zero load errors, horizontal overflow, clipped text, target-size failures, axe violations, obscured focus, chrome-budget breaches, landmark/heading/skip-link failures, console errors or page errors. Phone chrome peaked at 19%. The informational `textUnder14Phone` count was **48 before and 48 after**, with smallest text 12px; it was not a newly introduced violation. [Before audit](before/mobile-audit.md), [after audit](after/mobile-audit.md) and their [before](before/mobile-audit-totals.json)/[after](after/mobile-audit-totals.json) totals preserve that distinction.

## JavaScript measurement

The `/notifications` build-manifest union increased by **958 raw bytes / 271 gzip bytes**, with the same 55 chunks. The dashboard-shell union changed by +2 raw / −23 gzip bytes. This is a build-manifest upper bound because Next.js merges client manifests; it does not measure exact served transfer or navigation latency.

Both revisions **pass the current baseline ceilings** of 70KB per chunk, 400KB shared and 560KB per route. Both fail the tighter aspirational targets of 50/250/400KB, with **42 breaches before and 42 after and no new violation classes**. The aspirational targets remain unmet; the baseline pass is not a waiver. [JS comparison](route-js-comparison.json), [before report](before/route-js.md) and [after report](after/route-js.md).

## Scope and remaining gates

These results establish local behaviour on disposable fixtures only. There is no schema, backend, provider or deployment change in this slice, and no production, hosted-CI or release claim. [Cleanup](cleanup.json) records the app/stub/DB ports free, disposable PostgreSQL removed and the owned harness lock released.

The final merge validation executes the components of `pnpm verify:full` (typecheck, lint, unit, webpack build and the unfiltered integration suite on a fresh disposable database), plus design, design ratchet and contrast. Those results and independent reviews are recorded against the final documentation commit in [PR #240](https://github.com/lapeninns/naba-presence/pull/240); they are separate from these C1 browser artifacts. See the [evidence manifest](manifest.json) for retained artifact hashes.
