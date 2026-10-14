# R2-W0b — Billing state machine, AI credit lifecycle, retention / erasure / legal-hold integrity

Agent: claudeAgent (round 2 gap workstream). Read-only. Checkout at `d8759c74` plus the uncommitted inbox UI changes on `feat/inbox-mail-refinement` (none touch the files reviewed here).

## Scope

1. Billing: `lib/server/billing/*` (webhook, process-events, state, checkout, subscription-changes, stripe), `lib/domain/billing-lifecycle.ts`, `lib/domain/entitlements.ts`, `lib/server/entitlement-policy.ts`, `app/api/webhooks/stripe`, `app/api/billing/*`, migrations 0107/0110/0111/0112, `scripts/billing-catalog.mjs`.
2. AI credits: `lib/server/ai-credits.ts`, `ai-credit-adjustments.ts`, `ai-usage.ts`, `ai.ts`, `review-drafts.ts` (the reserve→provider→settle caller), the reaper (`jobs.ts:1095`, `0059_ai_credits.sql:59`).
3. Retention, privacy and legal holds: `lib/server/retention/{purge,cycle,inventory}.ts`, `lib/server/privacy/{fulfil,withdrawals}.ts`, `app/api/privacy/requests`, `app/api/legal-holds`, `0001_initial.sql` (legal_hold DDL).

Out of scope (owned elsewhere): the generic authz matrix and the AI-credit debit race (W6), and CI/test execution (W7). I ran no tests, builds or DB queries.

## Commands used

- `grep`/`sed`/`cat -n` over the files above; `grep -rn` for callers (`memberLimit`, `legal_hold`, `reviewer_display_name|review_text`, `release_stale_ai_reservations`, `TickFinding`).
- A throwaway parser (`/tmp/r2w0b/pii.py`, outside the repo, run with `python3 -I`) that walks `supabase/migrations/*.sql` in order. It collects columns from `create table` and `alter table … add column` whose names look personal (author/reviewer/email/name/phone/address/photo/body/text…), and applies drops and renames. Its output was compared with what `eraseReviews` and the purge steps touch. It is heuristic: jsonb columns (`raw_payload`, `metadata`, `reasons`, `provider_error_body`, `input`) were followed up by hand.

## Not covered

- Stripe behaviour was not exercised against a real or test account. Statements about Stripe semantics (schedule phase/price-interval rules, list consistency) are from API knowledge and are marked HYPOTHESIS where they matter.
- Postgres locking claims (READ COMMITTED snapshot and EvalPlanQual, how RI cascades see rows) are reasoned from PG semantics, not reproduced. They are marked PLAUSIBLE.
- Privacy **export** completeness, `withdrawals.ts` claim/lease internals beyond a skim, media storage purge (`purgeExpiredStagingAssets`), and the checked-in billing catalog JSON (by design no reviewed catalog file is committed) were not reviewed.

## Overall assessment

The billing design is solid. Receipts are idempotent on `unique (provider, external_event_id)` (0112:74). The processor **ignores the payload and re-fetches provider state under a `FOR UPDATE` on `organisation_billing`**, so duplicate and out-of-order events converge (process-events.ts:296-487). Credit grants are idempotent on `(organisation_id, kind, source_ref)` (0107:182), and every Stripe write carries a version- and fingerprint-scoped idempotency key. Credits are integers end to end (`credits integer check >= 0`, plan `ai_draft_credits_per_period` integer). No money amounts are stored locally apart from Stripe's integer `amount_paid`, which is read but not persisted.

The real gaps are in three places:

- legal-hold atomicity, and how far erasure reaches into derived text;
- entitlements the schema promises but nothing enforces (member limit);
- the edges of operating the system (no alert for a billing dead-letter, a draft route that can be killed after charging, a reaper that does a full-table scan every minute).

**Correction to W7:** W7 said `lib/server/billing/subscription-changes.ts` has zero test references. That is wrong. `tests/integration/routes/billing-checkout.test.ts:794-1143` covers plan change (downgrade refused at 409, downgrade scheduled without proration, re-pointing an existing schedule, clearing a change to a retired plan, refusal with no subscription) and cancel (flag and resume, release-before-cancel, resuming a portal `cancel_at`). What remains untested is listed under R2B-10.

---

## Findings

### R2B-01 — Legal holds are not atomic with the retention sweep or erasure; a concurrent sweep can redact a held review or delete the hold itself

- **Priority:** P2 · **Status:** PLAUSIBLE (PG semantics, not reproduced)
- **Location:** `app/api/legal-holds/route.ts:47-79`; `lib/server/retention/purge.ts:118-150` (boundedRows), `:437-460` (reviews redaction), `:484-488` (disconnectedReviews); `app/api/privacy/requests/route.ts:252-271`; `supabase/migrations/0001_initial.sql` legal_hold (`review_id … references review(id) on delete cascade`). No migration other than 0001 mentions `legal_hold`, so there is no trigger or guard in the database.
- **Evidence:** Every hold check is a `not exists (select 1 from legal_hold …)` subquery evaluated against the statement snapshot. The hold POST reads `review` without a lock and inserts `legal_hold`; its FK check takes only `FOR KEY SHARE` on the review row.
  - _Redaction (`reviews` step, an UPDATE of non-key columns):_ `FOR NO KEY UPDATE` does not conflict with `FOR KEY SHARE`. If the hold commits after the purge statement takes its snapshot, the review is still redacted.
  - _Disconnected purge (DELETE):_ the DELETE waits on the hold's KEY SHARE lock. The row was only locked, not updated, so once the hold commits the delete goes ahead without re-checking. The ON DELETE CASCADE RI action then runs with a fresh snapshot and **deletes the newly committed hold**. The owner got 201, `legal_hold.applied` is in the audit log, and neither the hold nor the review exists.
  - _Erasure PATCH:_ same pattern. The hold check (`route.ts:253`) is an unlocked select and `eraseReviews` is a non-key UPDATE.
- **Root cause:** Hold enforcement exists only as app-side predicates, re-implemented in at least five places (`notHeldReview`, the media/reviews/locationNotHeld predicates, the privacy PATCH). The database never re-checks with a current snapshot.
- **Recommendation:**
  - Add a `BEFORE UPDATE OF review_text, reviewer_display_name, reviewer_profile_photo_url, raw_payload OR DELETE ON review` trigger. It checks `legal_hold` for an active hold; queries inside the trigger run with a fresh snapshot in READ COMMITTED. Under `app.retention_run` it returns NULL (skip the row); otherwise it raises.
  - Change `legal_hold.review_id` to `ON DELETE RESTRICT`, so a delete fails instead of silently dropping holds.
  - In the hold POST, select the review `FOR NO KEY UPDATE`.
- **Complexity:** M (one migration, plus mapping the purge counts for skipped rows). **Regression risk:** Medium. The RESTRICT FK changes disconnected-location cascade order; `disconnectedReviews` already excludes held locations, so the impact is limited.
- **Tests:** an integration test with two connections: open the purge round transaction, insert and commit a hold from the second connection mid-statement (or with `pg_sleep` in a predicate), then assert the review text is kept and the hold row exists. Repeat for the erasure PATCH.

### R2B-02 — Erasure by display name is a blind, irreversible multi-match that also withdraws public replies on other people's reviews

- **Priority:** P2 · **Status:** CONFIRMED (code path); impact depends on the operator
- **Location:** `app/api/privacy/requests/route.ts:239-251`, `:271`; `lib/server/privacy/fulfil.ts:252-324`; `lib/contracts/privacy.ts:44` (`subjectReference` min 3 characters).
- **Evidence:** Matching uses `lower(coalesce(reviewer_display_name,'')) = lower(subjectReference)` across every review in the organisation, alongside the hash arms. Every match is erased in one transaction, and `withdrawReplies` then deletes the owner's live Google reply on each one. No preview or match count is shown before fulfil; `reviewsMatched` appears only in the audit afterwards, and nothing in `app/api/privacy` or the settings components previews matches. A request for a common name ("John", "Sarah K") erases every reviewer with that display name and takes down their public replies.
- **Root cause:** Display name is treated as an identifier.
- **Recommendation:** Do one of the following:
  - require a hash or review-id match for erasure, or
  - add a dry-run step (`GET …?preview`) that returns the matched reviews, and have PATCH take the confirmed `reviewIds` (cap the count, and refuse more than one display-name match without explicit confirmation).
- **Complexity:** M. **Regression risk:** Low.
- **Tests:** fulfil with two reviewers who share a display name, and assert that only the confirmed review is erased or withdrawn.

### R2B-03 — Erasure leaves model-written text quoting the reviewer in `verification_result.reasons`

- **Priority:** P2 · **Status:** CONFIRMED (not scrubbed, and free text); that a given row contains the name is PLAUSIBLE
- **Location:** `lib/server/privacy/fulfil.ts:135-226` (eraseReviews touches review_media_item, review, draft, review_reply, publish_attempt.intended_body only); `lib/server/ai.ts:347-356` (`message: claim` for `unsupported_claim`, ≤240 characters each, ≤10, written by the verify model from the reply and review); `lib/server/retention/inventory.ts:450-456` (verification_result is kept "with its draft").
- **Evidence:** The `fulfil.ts:124-134` comment lists every derived copy of the reviewer's name as draft, review_reply and publish_attempt. It misses `verification_result.reasons[].message`, the semantic verifier's claims, which routinely quote the reply ("Thanks John, glad you loved…"). They are kept for the life of the location and are readable through the review detail API.
- **Other places the migration scan found (handled or not applicable):** `publish_attempt.provider_error_body` (jsonb; whether Google echoes the body is a HYPOTHESIS); `privacy_request.subject_reference` and the `privacy.request.created` audit metadata, which hold the subject's name by design as the compliance record (`inventory.ts:508-517`, PENDING_UNDECIDED). Notification, ai_usage, bulk-child and attempt-event payloads: grep found no reviewer name or text written to them.
- **Recommendation:** In `eraseReviews`, also run `update verification_result set reasons = jsonb_path… or '[]'` for drafts of the erased reviews, keeping `code` and `severity` and replacing `message`. Null `publish_attempt.provider_error_body` for those replies too. Then add both to the comment list and to the inventory's "scrubbed by privacy erasure" wording.
- **Complexity:** S. **Regression risk:** Low. Replay (`review-drafts.ts:182`) parses reasons with `verificationReasonSchema`, so keep `message` a string.
- **Tests:** extend `tests/integration/routes/privacy-fulfilment.test.ts` with a verification row whose message contains the name, and assert it is scrubbed.

### R2B-04 — Plan `member_limit` is stored, versioned, shown in the API contract, and never enforced

- **Priority:** P2 · **Status:** CONFIRMED
- **Location:** `supabase/migrations/0107_billing_foundation.sql:56`; `lib/server/billing/state.ts:75-81,118-120`; `lib/domain/entitlements.ts:157,167`; `lib/contracts/billing.ts:32,47`; `scripts/billing-catalog.mjs:49,118`. **No reference** in invitations, members, `entitlement-policy.ts`, or any trigger. The plan-change downgrade check (`subscription-changes.ts:215-225`) counts locations only.
- **Evidence:** `grep -rn "memberLimit|member_limit" lib app supabase/migrations` returns only reads and contracts. The location limit has a DB trigger (0110/0111); members have nothing.
- **Root cause:** Half of the P07 entitlement work was implemented.
- **Recommendation:** Either enforce it (invitation create/accept and member insert, ideally a trigger mirroring `location_link_enforce_limit`, plus a downgrade check on member count), or have `billing-catalog.mjs` reject non-null `memberLimit` until enforcement exists.
- **Complexity:** M. **Regression risk:** Medium (invitation acceptance flows).
- **Tests:** an invitation acceptance over the limit returns 402; a downgrade below the member count returns 409.

### R2B-05 — The draft route can be killed after the credit is charged and before the draft is stored (`maxDuration` 60 vs two serial AI timeouts)

- **Priority:** P2 · **Status:** PLAUSIBLE (timing)
- **Location:** `app/api/reviews/[id]/drafts/route.ts:8` (`maxDuration = 60`); `lib/server/review-drafts.ts:347` (generate), `:370` (settle → charged), `:387` (semantic verify), `:411` (phase three writes the draft); `lib/server/env.ts:241` (`OPENAI_TIMEOUT_MS` default 30 000, max 55 000); `SEMANTIC_VERIFY_ENABLED` default true (env.ts:325).
- **Evidence:** Generation and verification run one after the other, each bounded only by `OPENAI_TIMEOUT_MS`. With defaults (30 s + 30 s), plus two DB transactions and the phase-one reads, a slow provider exceeds 60 s. Up to 110 s is reachable with the maximum. Vercel kills the function after the settle has committed (credit = 1) and before phase three inserts the draft. A retry with the same Idempotency-Key reaches `replayGeneration`: settled, `draftId` set, no draft row, and outside the settle grace, so the user gets `409 generation_not_repeatable` ("did not produce a reply") and has paid a credit. The verify reservation is left `reserved` and is reaped 10 minutes later with its token cost unknown.
- **Root cause:** The per-call timeout does not account for the whole request budget.
- **Recommendation:** Give the request a single deadline. Pass `AbortSignal.any([timeout, deadlineSignal])` and size verification to the time remaining, skipping it (draft left `pending`) when under about 10 s are left. Alternatively, settle the credit in the phase-three transaction that writes the draft, and release it if phase three never runs. Separately, add a CI assertion that `2 × OPENAI_TIMEOUT_MS + margin ≤ maxDuration`.
- **Complexity:** S–M. **Regression risk:** Low.
- **Tests:** a unit test with a fake provider that delays generation by 0.6× and verification by 0.6× the budget; assert that verification is skipped and the draft stored.

### R2B-06 — No operator alert when billing events dead-letter or reconciliation keeps failing; an unknown price leaves a converting pilot on full access

- **Priority:** P2 · **Status:** CONFIRMED (no alert path); the pilot scenario is PLAUSIBLE
- **Location:** `lib/server/billing/process-events.ts:642-673` (dead → `log.error` + a per-organisation `billing.event_dead` audit, errors swallowed), `:726-732` (reconcile failures returned in the JSON only); `app/api/billing/reconcile/route.ts` (no finding is raised); `lib/server/ops-liveness.ts:41,86` (only a liveness heartbeat for `billing-reconcile`). `TickFinding` is used only by retention and platform notifications.
- **Evidence:** If the catalog lacks the price a customer subscribed to (`billing_plan_unknown`, `:394-402`), or Stripe returns an unsupported shape, every event and every hourly reconcile fails for that organisation. Its record stays as it was. For a **pilot that just paid**, that means state `pilot` (full access, unlimited locations) and no trial or paid grant, so the customer sees "Confirming subscription". The cron stays "alive", so liveness is green.
- **Recommendation:** Add a `billingFailureFinding()` modelled on `retentionCycleFailureFinding` (`cycle.ts:480`). It fires on any `billing_event` in status `dead`, or on an organisation whose `provider_synced_at` is more than 3 h older than its latest receipt. Route it through `notifications/platform.ts`.
- **Complexity:** S. **Regression risk:** Low.
- **Tests:** seed a dead event and assert the health tick raises a finding.

### R2B-07 — Paying customers lose AI drafting at every renewal and through the whole grace window (credit period gap)

- **Priority:** P3 · **Status:** CONFIRMED (by reading)
- **Location:** `lib/domain/billing-lifecycle.ts:260-282` (paid grant only once `latest_invoice.status === 'paid'`; `past_due` grants nothing); `lib/server/ai-credits.ts:76-104` (`findPeriod` needs `starts_at <= now() < ends_at` for `paid_period`), `:364-370` (`ai_allowance_unknown`); `lib/domain/entitlements.ts:198-237` (`confirming_payment` and `payment_grace` both report `canUseAi: true`).
- **Evidence:** At a renewal boundary the old period's grant ends at `current_period_end`. Stripe keeps the renewal invoice as a draft for about an hour, and the new grant appears only after `invoice.paid` (or the hourly reconcile), so for at least an hour no `paid_period` covers `now()`. Drafting returns 402 `ai_allowance_unknown` while `/api/ai/credits` reports `canUseAi: true` with a null allowance. The same applies at trial end (the state is still `trialing` while the trial period has ended), for slow payment methods (days), and for all of the 7-day grace. The entitlements doc promises full access in grace, and the reducer comment says "no new allowance", so the two disagree.
- **Recommendation:** Decide the product rule, then do one of the following: grant the new period on `active` with an `open`/`draft` invoice, provisionally, with the same `sourceRef`; or have `currentCreditPeriod` fall back to the most recent ended paid period during `confirming_payment`/`payment_grace`; or make `deriveAccess.canUseAi` false in those modes so the UI is honest.
- **Complexity:** S. **Regression risk:** Low–Medium (credit accounting).
- **Tests:** a lifecycle test: active, new period with a draft invoice, reserve → expected outcome.

### R2B-08 — The AI ledger enforces billing read-only even when enforcement is switched off (inconsistent with routes and jobs)

- **Priority:** P3 · **Status:** CONFIRMED
- **Location:** `lib/server/ai-credits.ts:216-217` (`accessFromView` with no `enforcementApplies`), `:356-363`; compare `lib/server/entitlement-policy.ts:151-157,180-190`.
- **Evidence:** With `BILLING_ENFORCEMENT_ENABLED=false` (the default) or the per-organisation `enforcement_enabled=false`, routes and workers allow writes for a `canceled`/`read_only`/`past_due` organisation, but `reserveDraftCredit` still refuses AI with 402 `billing_read_only`. Ledger enforcement is therefore not covered by the rollout switches.
- **Recommendation:** Gate the `canUseAi` check on `enforcementApplies(view)`, or document AI as always enforced and say so in `entitlement-policy.ts`.
- **Complexity:** S. **Regression risk:** Low.

### R2B-09 — Billing syncs and plan changes hold the `organisation_billing` row lock across Stripe HTTP calls; the location-link trigger blocks behind them

- **Priority:** P3 · **Status:** CONFIRMED (lock and call sequence); contention impact PLAUSIBLE
- **Location:** `lib/server/billing/process-events.ts:310-327` (lock, then up to 3 calls × 8 s), `subscription-changes.ts:144-306` (lock, then up to 4 calls with the client's `timeout 10 s, maxNetworkRetries 1`, `stripe.ts:21,108-111`), `checkout.ts:275-309`; `0111_location_limit_hardening.sql:68` and `0110:96` (`location_link_enforce_limit` does `for update of b` on the same row); `lib/server/db.ts:41-42` (`statement_timeout` 30 s, `idle_in_transaction` 60 s).
- **Evidence:** While a sync or plan change is waiting on Stripe, any `location_link` insert or activation for that organisation blocks on the billing row. If it waits more than 30 s it fails with `statement_timeout`. A plan change in the worst case (about 4 × 20 s) exceeds both `idle_in_transaction_session_timeout` and `maxDuration`. That is safe for correctness, because it rolls back and the webhook converges, but the user sees an error after the change has been made at Stripe.
- **Recommendation:** Make the per-request Stripe options in `subscription-changes.ts` and `checkout.ts` match `SYNC_REQUEST_OPTIONS` (8 s, no retries). Consider an optimistic `version` check instead of holding `FOR UPDATE` across the HTTP calls: read the version, call Stripe, then `update … where version = $v`.
- **Complexity:** S (timeouts) / M (optimistic). **Regression risk:** Low / Medium.

### R2B-10 — Plan change: remaining gaps (price interval, upgrade semantics, untested branches)

- **Priority:** P3 · **Status:** HYPOTHESIS (Stripe interval behaviour) / CONFIRMED (missing tests)
- **Location:** `lib/server/billing/subscription-changes.ts:285-289` (phase two is always `duration: {interval:"month", interval_count:1}`); `scripts/billing-catalog.mjs` (no check of the Stripe price's recurring interval: `grep interval` finds nothing); `:215-225` (an upgrade is also deferred to the boundary, and `deriveAccess.newLinkLimit = min(current, pending)` means an upgrade adds no seats until then).
- **Evidence:** A yearly price in the catalog would produce a one-month phase on a yearly price. Stripe will either reject it or bill in a surprising way. Untested branches: changing plan while `trialing` (the `trial_end` phase param), an existing schedule whose current phase belongs to an earlier change, and Stripe updated but the DB rolled back followed by a retry under the same `v{version}` key.
- **Recommendation:** Have `billing-catalog.mjs --apply` fetch each price and assert `recurring.interval === 'month'`, or derive the phase duration from the price. Decide whether upgrades should take effect immediately (with proration) and document the rule in the billing UI. Add the three integration cases.
- **Complexity:** S–M. **Regression risk:** Low.

### R2B-11 — The stale-reservation reaper runs a cross-tenant UPDATE every minute with no usable index

- **Priority:** P3 · **Status:** CONFIRMED (index list); cost grows with table size
- **Location:** `supabase/migrations/0059_ai_credits.sql:59-73` (`where status = 'reserved' and created_at < now() - …`); indexes `ai_usage_period_idx (organisation_id, period_start, kind, status)`, `ai_usage_created_idx (organisation_id, created_at)` (0100:35), `ai_usage_credit_period_idx` (0107:212), all led by other columns. Called from `lib/server/jobs.ts:1095` on every `* * * * *` tick (`vercel.json:7-8`).
- **Evidence:** With 13 months of ai_usage kept (`purge.ts:284`) and two rows per AI draft, this becomes a sequential scan of the whole table once a minute.
- **Recommendation:** `create index concurrently ai_usage_reserved_idx on ai_usage (created_at) where status = 'reserved'`.
- **Complexity:** S. **Regression risk:** Very low.

### R2B-12 — A retention round checks the deadline only between rounds; one slow round can run past `maxDuration` and roll back

- **Priority:** P3 · **Status:** PLAUSIBLE (large tenants only)
- **Location:** `lib/server/retention/purge.ts:928-1012` (each round runs about 30 steps × up to `RETENTION_BATCH_ROWS`=500 in **one** tenant transaction; `Date.now() >= deadline` is checked after the round); `purge.ts:1092-1100` (45 s budget) vs `app/api/cron/retention/route.ts:8` (`maxDuration` 60); `db.ts:41` (30 s per statement).
- **Evidence:** A round that starts at 40 s and contains, say, a `disconnectedReviews` delete of 500 reviews (the bound applies to the rows selected, not to the cascade into drafts, replies, attempts, events and holds, as the comment at `:476-483` admits) can exceed 20 s. The function is killed, the round rolls back, and the next fire repeats it. `RETENTION_ORG_MAX_ATTEMPTS`/`MAX_RESUMES` eventually mark the organisation failed. The first organisation of each fire always has a fresh budget, which limits the damage.
- **Recommendation:** Check the deadline between steps inside the round (return `behind` early), and cap cascading deletes with a smaller batch (for example 50 reviews) for `disconnectedReviews`.
- **Complexity:** S. **Regression risk:** Low (round audits already handle partial rounds).

### R2B-13 — Derived copies outlive the raw-content retention window (reviewer name in drafts, replies and verification)

- **Priority:** P3 · **Status:** CONFIRMED (documented decision; flag for legal review)
- **Location:** `lib/server/retention/purge.ts:437-460` (only `review` columns are nulled at `raw_content_expires_at`); `inventory.ts:440-456` (draft, verification_result: kept with location; draft is "scrubbed by privacy erasure" only).
- **Evidence:** When raw content expires, `review.reviewer_display_name` and `review_text` are nulled. `draft.body` (rating-only templates greet the reviewer by name, `fulfil.ts:127-130`), unsent AI drafts that quote the review, and the verifier's quoted claims stay for the life of the location. The retention promise ("raw content expires") holds only for the source row.
- **Recommendation:** Product/legal decision. Either extend the `reviews` step to redact unpublished drafts and verification messages for expired reviews, or state the exception in the privacy notice. Also note: 21 inventory datasets are still `PENDING_UNDECIDED`, including `invitation` (third-party email kept for the life of the organisation) and `privacy_request`.
- **Complexity:** S–M. **Regression risk:** Low.

### R2B-14 — Smaller notes (P3, CONFIRMED unless stated)

- **Duplicate subscriptions:** a second running Stripe subscription (dashboard, API) is followed silently. `chooseSubscription` takes the newest running one (`billing-lifecycle.ts:302-311`) and the older one keeps charging with no detection. Recommend a reconcile warning or finding when more than one is running.
- **Re-applied holds:** a re-applied legal hold keeps the original `created_at` and overwrites `approved_by` (`legal-holds/route.ts:67-72`), so the history of re-application lives only in the audit log. Holds cover reviews only; a hold cannot preserve an audit trail, privacy request or location-level data on its own.
- **Verify spend:** `/api/drafts/[id]/verify` (`entitlement: "ai"`) has no abuse rate limit. Each call costs tokens, bounded only by the per-organisation `AI_MONTHLY_TOKEN_BACKSTOP` (default 20 M tokens per period), and there is no fleet-wide spend ceiling. That is cheap on the default nano model but scales with `OPENAI_MODEL_VERIFY`.
- **Lost pilot adjustments:** pilot conversion closes the pilot month (`process-events.ts:426-441`), so operator adjustments attached to it end early, unannounced.
- **Processor:** good. `settle` errors after a committed sync make the event retry and re-sync, which is idempotent. Events held for an unknown customer stop after 7 days (0113), and the reconcile covers the rest.

---

## Top 5

1. **R2B-01 (P2):** Legal holds can be silently defeated, or deleted by cascade, when a hold races the retention sweep or erasure. Add a DB trigger and an `ON DELETE RESTRICT` FK.
2. **R2B-02 (P2):** Erasure by display name erases every same-named reviewer and withdraws their public replies, with no preview.
3. **R2B-03 (P2):** Erasure misses `verification_result.reasons[].message`, model text that quotes the reply and review.
4. **R2B-05 (P2):** Draft generation plus verification can outlast `maxDuration` 60 after the credit is charged, so the user pays and gets `generation_not_repeatable`.
5. **R2B-04 / R2B-06 (P2):** `member_limit` is never enforced, and billing dead-letters and reconcile failures have no alert (a pilot with an unknown price stays on full access, unnoticed).

## Cross-layer leads

- **W6 (security):** R2B-01 is a concurrency integrity issue in the authz-exempt compliance routes (`POST legal-holds`, `PATCH privacy/requests`). W6's AI-debit race work should note that the reaper releases (and so makes free) any call whose function was killed (R2B-05); the backstop does not see those tokens (`ai-credits.ts:246-276` counts in-flight budget only while `reserved`).
- **W4 (database):** missing partial index (R2B-11). `legal_hold` has no index led by `review_id` (only `unique (organisation_id, review_id)`), and `notHeldReview` casts `h.review_id::text`, which defeats any index. The table is tiny today. Also a FK cascade policy review: `legal_hold → review ON DELETE CASCADE`.
- **W8 (jobs/scale):** retention round deadline granularity (R2B-12); the billing reconcile walk is serial at up to about 24 s per organisation in the worst case, so a full pass takes about `organisations × sync latency / 30 s` fires.
- **W3 (backend/outbound):** per-call Stripe timeouts differ by path (8 s/no retry in the processor, 10 s/1 retry elsewhere: R2B-09). The OpenAI timeout is per call rather than per request (R2B-05).
- **W7 (tests):** correct the "subscription-changes untested" claim (covered at `tests/integration/routes/billing-checkout.test.ts:794-1143`). Real gaps: plan change while trialing, rollback-then-retry, hold-vs-sweep concurrency, erasure of verification reasons, and the R2B-05 timeout budget.
- **Product/legal:** R2B-07 (AI during grace and renewal), R2B-10 (deferred upgrades), R2B-13 and the 21 `PENDING_UNDECIDED` retention datasets.
