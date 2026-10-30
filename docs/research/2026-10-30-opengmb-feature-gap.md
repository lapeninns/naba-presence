# OpenGMB feature gap

Written 2026-10-30. Research only: no code changed.

Source reviewed: [synectus/OpenGMB](https://github.com/synectus/OpenGMB), a shallow
clone of `main` taken on 2026-10-30. I read the README, LICENSE, TRADEMARKS, the
Drizzle baseline migration, and `packages/core/src` (Google client, health checks,
guardrails, reviews, posts, profile, geo-grid, citations, competitors, review
requests). On the NabaPresence side I read `app/` routes, `lib/server` Google calls,
`docs/google-provider-support.md`, `docs/specs/2026-09-19-listings.md`,
`lib/domain/verification.ts` and the reply policy settings.

## Licence

- **Code: MIT** (© 2026 Synectus Private Limited). Copying or adapting code is
  allowed. Keep the copyright and permission notice in any copied file or in a
  `THIRD_PARTY_NOTICES` entry. No copyleft obligation.
- **Name and logo: trademarked.** Don't use "OpenGMB" in product names, UI or
  domains. Plain-text "based on OpenGMB" in notices is allowed.
- Practical advice: copy small **pure** modules where they fit (the health-check
  list, the guardrail rule list, the review-request wording check, the DST-safe
  post recurrence). Reimplement anything that touches data or Google. OpenGMB uses
  Drizzle on plain Postgres with its own tenancy, executor and audit log. Those
  don't map onto NabaPresence's Supabase RLS (`withTenant`), approval and
  publish-attempt model, so copying them would cost more than rewriting.

## What OpenGMB is

A self-hosted (Docker Compose) Next.js 16 + Postgres + worker monorepo for SEO
agencies. Every action is registered once and exposed in the web app, a REST API,
an MCP server (about 250 tools) and Zapier. Its Google surface matches
NabaPresence's: Business Information, Account Management, v4 reviews, local posts
and media, Performance, Notifications (Pub/Sub), Verifications and Place Actions.
It uses **only `business.manage`** (plus `userinfo.email` for sign-in), so none of
its GBP features need a new sensitive scope. It adds paid third-party data:
DataForSEO for rank grids and competitor profiles, Anthropic for AI drafts, and the
Places API as a labelled "not Maps rank" sanity check.

Data model: about 95 tables. Beyond what NabaPresence already stores, it has
`grid_configs/runs/points`, `competitor_profiles`, `citation_entries`,
`review_topics`, `review_notes`, `review_links`/`review_link_clicks`,
`review_request_campaigns/recipients/optouts`, `location_pages`,
`location_auto_revert`, `healthcheck_skips`, `post_templates`/`post_images`,
`api_tokens`, `webhook_subscriptions`, `mcp_proposals` and `ai_visibility_*`.

## Where NabaPresence already matches or exceeds it

These need no work: review inbox with assignee filter; AI drafts with
deterministic and semantic verification (`lib/domain/verification.ts`: contact
data, promotions, commitments, rating-change asks, wrong location, language);
role-based and four-eyes reply approval; rating-only reply templates; low-rating
alerts and digests; scheduled and recurring posts; bulk listing edits with
approval; Google-suggested updates and "changed on Google" detection;
Performance metrics and monthly search keywords; Pub/Sub notifications; shared
reports; menus; photos, including customer media reads; place-action (booking)
links; verification; people/admin access; lodging. NabaPresence's provider
catalogue and retired-endpoint guard are more rigorous than OpenGMB's.

## Ranked features worth building

The ranking puts value for an 11-venue pub group against cost. Effort: S ≈ 1–3 days,
M ≈ 1–2 weeks, L ≈ 3+ weeks, including tests.

### 1. Listing completeness score with fix links

- **OpenGMB:** a per-location health score from 24 checks (description length,
  quality and keyword coverage; primary and extra categories; competitor category
  gaps; regular and special hours; phone; website plus UTM; services; photo count,
  recent photo, logo, cover; recent post; unreplied reviews; average rating; new
  reviews; verification; place-action link; attributes; duplicate listing). Each
  check has an importance level, a plain-language finding and an in-app fix link.
  Checks can be skipped per location.
- **NabaPresence:** **partial.** `listingHealth()` covers sync state (linked,
  verified, unpublished, conflict). It doesn't measure whether the profile is
  complete or fresh.
- **Value:** high. A board sorted by "Bell has no post in 30 days and no special
  hours for Christmas" helps a multi-venue operator more than anything else here,
  and all the data is already cached.
- **Effort:** M. Derive it from stored snapshots (`gbp_resource_snapshot`,
  `gbp_local_post`, `gbp_media_item`, `review`, `place_action_link`,
  `performance_search_keyword_monthly`). Add a skip table and a column on
  `/listings`. Leave out the competitor-category check unless #6 is built.
- **API / scopes:** none new. Uses existing reads: `locations.get`, `attributes`,
  v4 `media`/`localPosts`, `placeActionLinks`, `getVoiceOfMerchantState`.
  `business.manage`.
- **Licence:** MIT. The check list and thresholds in `healthcheck/evaluate.ts`
  can be adapted with attribution. Rewrite the inputs against our tables.

### 2. Review requests: tracked links and QR codes per venue

- **OpenGMB:** per-location short links to Google's review form with click
  tracking, printable QR codes, public location pages, and email request
  campaigns with opt-outs. A wording check refuses review gating ("how was your
  visit?", star asks).
- **NabaPresence:** **partial.** `metadata.newReviewUri` is read in
  `lib/domain/profile-vocabulary.ts`, but there's no link, QR or tracking.
- **Value:** high. Table talkers, receipts and till screens are how pubs earn
  reviews. Per-venue click counts against new reviews give managers a figure they
  can act on.
- **Effort:** S for links, QR codes and click counts (one table plus one public
  redirect route). M or more for email campaigns. Skip campaigns: they need
  guest-email consent and a sending domain, which NabaPresence doesn't hold.
- **API / scopes:** none new. `newReviewUri` comes from `locations.get`
  (`readMask=metadata`). `business.manage`.
- **Licence:** MIT. `review-requests/pure.ts` (the anti-gating wording rules)
  is worth adapting.

### 3. Review topics and trends

- **OpenGMB:** classifies reviews into workspace-configured topics (AI) and
  shows each topic's share and trend by week, plus a "negative change" alert
  when a review drops to ≤3 stars on edit.
- **NabaPresence:** **no** topic analysis. Low-rating alerts exist. Check
  whether they fire when a 5★ review is edited down to ≤3★, which OpenGMB
  handles explicitly.
- **Value:** high for operations. Patterns like "service slow at the Railway on
  Sundays" or "food cold" across 11 venues are what area managers want from
  reviews, and nothing in the product surfaces them today.
- **Effort:** M. Classify on arrival using the existing AI credit path, store
  per-review topic labels, and add a Reports panel. Keep a fixed hospitality
  topic list (food, drink, service, wait, price, atmosphere, cleanliness,
  booking, Sunday roast, dogs, parking) before making topics configurable.
- **API / scopes:** none new. Reviews are already synced. `business.manage`.
- **Licence:** MIT. `reviews/topic-trends.ts` is pure arithmetic and can be
  adapted. Write the classifier prompt fresh.

### 4. Content rules for posts and profile edits, plus repetition checks on replies

- **OpenGMB:** one guardrail engine runs on replies, posts and profile edits.
  Rules either block or warn, and warnings must be acknowledged. Rules cover
  links, emails, phone numbers, offers, bad hours, banned words, Google length
  limits, and **duplicate or same-opening replies against the last 30
  published**. Rules re-run just before the Google call.
- **NabaPresence:** **partial.** Reply drafts already get strong deterministic
  and semantic checks. Nothing equivalent runs on post text or profile
  descriptions. There's no repetition check, and no org-level banned-word list.
- **Value:** medium. Eleven venues answering similar reviews drift into
  identical boilerplate, which looks robotic. Post checks catch phone numbers in
  the body, which Google rejects, and expired offers.
- **Effort:** S–M. Extend `lib/domain/verification.ts` with a repetition rule
  (compare against recent published replies for the same client) and add a
  post/description variant at the existing verify step.
- **API / scopes:** none. Local only.
- **Licence:** MIT. Copy the rule list from `guardrails/README.md`. The engine
  is small enough to reimplement in our shape.

### 5. Google-side edit watch with one-click revert

- **OpenGMB:** watches protected fields (name, hours, phone, website,
  categories, and so on). When Google or a third party changes them, it alerts,
  and with per-location switches it reverts automatically.
- **NabaPresence:** **partial.** `getGoogleUpdated`, `/listings/[id]/suggestions`
  and "Changed on Google" already detect the change. There's no one-click "put
  ours back" and no automatic revert.
- **Value:** medium-high. Google's and users' suggested edits to pub hours and
  phone numbers are a known pain, and silent wrong hours cost covers.
- **Effort:** M for an alert plus a one-click revert that goes through the
  normal change set and approval. Don't build automatic revert: it would
  bypass NabaPresence's approval model and can fight Google in a loop.
- **API / scopes:** `locations.getGoogleUpdated` and `locations.patch`
  (existing). `business.manage`.
- **Licence:** MIT. Ideas only. `profile/autoRevert.ts` depends on their
  executor.

### 6. Local rank grid ("pub near me" visibility)

- **OpenGMB:** geo-grid Maps rank per keyword around each location, with
  competitors, budget caps and schedules, using the customer's own DataForSEO
  account. It explicitly states that the Places API matched 0 of 81 points
  against real Maps rank, so Places isn't a substitute.
- **NabaPresence:** **no.**
- **Value:** medium. It's useful for a few contested venues and keywords
  ("pub", "Sunday roast", "restaurant near me"), but it's marketing analysis
  rather than daily operations, and it has a running cost.
- **Effort:** L, plus a DataForSEO bill (roughly cents per grid point; a 7×7
  grid × 3 keywords × 11 venues weekly runs to a few hundred pounds a year).
  A new third-party credential needs the secret handling in the user's rules.
- **API / scopes:** no GBP API. DataForSEO Maps SERP. Not Google OAuth, so
  there's no verification impact.
- **Licence:** MIT. The grid geometry and cost guard (`geogrid/math.ts`,
  `cost.ts`) are adaptable.

### 7. MCP server / API tokens

- **OpenGMB:** every action is an MCP tool and a REST endpoint, with
  read-only or read-write tokens. A human-in-the-loop token can draft and
  submit but not approve or publish. It also has outgoing signed webhooks.
- **NabaPresence:** **no.**
- **Value:** medium for this user, who works through Claude daily: "draft
  replies for this week's 1–2★ reviews across all venues" could land in the
  existing approval queue. It's low for venue staff.
- **Effort:** L. It needs a token model, scoping onto RLS, and a tool catalogue
  over existing routes. The safe first slice is read-only tools plus "create
  draft".
- **API / scopes:** none new on Google.
- **Licence:** MIT. Reimplement: it is tied to their action registry.

### Lower priority (noted, not recommended now)

| Feature                                                 | Has it               | Why lower                                                               |
| ------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------- |
| Review internal notes                                   | no (assignee exists) | S effort, small value; add with #3 if area managers ask                 |
| Competitor review benchmark                             | no                   | Needs DataForSEO; do only after #6                                      |
| Citation / NAP checker                                  | no                   | Pubs have few directory listings that matter; the venue sites are owned |
| Branded post images and post templates                  | no                   | Venue teams already have photography; S–M                               |
| AI visibility tracking                                  | no                   | Speculative; paid prompts per run                                       |
| Healthcare/legal rule packs, client portal, white-label | n/a                  | Agency/vertical features, not relevant                                  |

## Scope and verification impact

Nothing above needs a scope beyond `business.manage`, so none of it changes the
OAuth verification position. #6 and the competitor benchmark add a paid
non-Google vendor. #2's email campaigns would add guest PII and are excluded.
