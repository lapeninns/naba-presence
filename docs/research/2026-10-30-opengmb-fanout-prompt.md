# OpenGMB gap: fan-out execution prompts

Written 2026-10-30. Builds the top five features from
[2026-10-30-opengmb-feature-gap.md](2026-10-30-opengmb-feature-gap.md) in parallel,
and runs two design-only tracks for the larger items.

How to use it in t3code:

1. Open **one coordinator thread** (Claude Opus, strongest account) and paste
   **Prompt 0**. It creates the worktrees and brief files, then stops.
2. Open **one thread per stream** in its own worktree and paste the **shared
   rules** followed by **that stream's brief**. Suggested accounts:

   | Thread | Stream                               | Account / model                  |
   | ------ | ------------------------------------ | -------------------------------- |
   | S1     | Listing completeness score           | Claude Opus (design-heavy)       |
   | S2     | Review links and QR codes            | Codex or a second Claude account |
   | S3     | Review topics and trends             | Claude Opus                      |
   | S4     | Content checks and repetition        | Codex or Claude Sonnet           |
   | S5     | Google-change revert                 | Claude Opus                      |
   | D6     | Rank-grid design doc (no code)       | any cheaper account              |
   | D7     | MCP / API-token design doc (no code) | any cheaper account              |

3. When the streams report done, paste **Prompt 9** into the coordinator
   thread to integrate. One branch and one PR come out of it.

Every stream runs in its own worktree on its own branch, owns a fixed set of
files, and has its own migration range, so no two threads edit the same file.

---

## Prompt 0: coordinator setup

```text
You are the coordinator for a parallel build in NabaPresence
(~/LapenInns Project/platform/naba-presence; quote the path, it has a space).
Read AGENTS.md, ~/.claude/CLAUDE.md, docs/research/2026-10-30-opengmb-feature-gap.md
and docs/research/2026-10-30-opengmb-fanout-prompt.md (this file) first.

Set up only. Don't implement any feature.

1. `git fetch origin` (check the remote owner is lapeninns; `gh auth switch --user lapeninns`
   if needed). Record BASE = the origin/main SHA.
2. Create the folder ~/LapenInns Project/platform/naba-presence-opengmb-fanout/ with
   README.md, briefs/, reports/ and context/. Copy the "Shared rules" section and each
   stream brief from this file into briefs/<id>.md verbatim, filling in BASE.
   Copy the feature-gap doc into context/. Copy the pure OpenGMB reference files
   listed in each brief from a fresh shallow clone of github.com/synectus/OpenGMB
   into context/opengmb/ (read-only reference; MIT, keep its LICENSE alongside).
3. Create one worktree per code stream from BASE, inside the fan-out folder:
     s1-completeness  -> branch feat/opengmb-s1-completeness
     s2-review-links  -> branch feat/opengmb-s2-review-links
     s3-review-topics -> branch feat/opengmb-s3-review-topics
     s4-content-checks -> branch feat/opengmb-s4-content-checks
     s5-google-revert -> branch feat/opengmb-s5-google-revert
   D6 and D7 need no worktree; they write only to reports/.
4. In each worktree run `pnpm install --frozen-lockfile` (Node 24). Don't run builds.
5. Write README.md: the table of streams, worktree paths, branches, migration ranges,
   ports and the report file each must keep. Copy watch.sh from
   ../naba-presence-fanout/ with its base SHA changed to BASE.
6. Reply with the table and the exact text to paste into each thread
   (shared rules + brief path). Then stop and wait.

Never push, open PRs, deploy, run hosted migrations, or read .env*/secrets.
```

---

## Shared rules (paste at the top of every stream thread)

```text
You are one stream in a parallel build of NabaPresence features adopted from
OpenGMB. Other threads are editing other worktrees at the same time.

WHERE
- Work ONLY in your worktree: ~/LapenInns Project/platform/naba-presence-opengmb-fanout/<your-dir>
  on your branch. Never touch the main checkout, other worktrees or other branches.
  Never stash, reset, rebase or switch branches.
- Read first: AGENTS.md, ~/.claude/CLAUDE.md, your brief, context/2026-10-30-opengmb-feature-gap.md,
  and any spec the brief names. AGENTS.md wins over anything here about Next.js.

FILE OWNERSHIP
- Edit only the files your brief says you own, plus new files under the names it
  gives. If you need to change a file you don't own, don't edit it. Add a narrow
  seam (an exported function or prop) in your own files and leave a
  `// INTEGRATION(<stream>): <what the integrator must wire>` comment. List it in your report.
- Shared hotspots: append-only edits, one contiguous block, marked with your stream id:
  lib/server/schema-manifest.ts (REQUIRED_MIGRATIONS), lib/contracts/notifications.ts,
  and any test that lists migrations. Never reorder or reformat existing lines.

DATABASE
- New migrations go in supabase/migrations/ numbered inside YOUR range only
  (gaps are fine; the integrator renumbers). Each migration inserts its own
  schema_migration row like the existing ones and is appended to REQUIRED_MIGRATIONS.
- RLS and tenancy: every new table carries organisation_id, has RLS policies
  matching neighbouring tables, and is reached through withTenant. Add the runtime
  role grants the way recent migrations do. Run `node scripts/ci/migration-policy.mjs origin/main`.
- Integration and e2e tests use a throwaway Postgres only:
  NABA_PG_DIR=~/Library/Caches/naba-verify/opengmb-<stream>-<n> (not /tmp: macOS
  cleans it at 03:35). Never use port 54322 or the dev DB. Stop every cluster you start.
- Playwright: PLAYWRIGHT_PORT / PLAYWRIGHT_GOOGLE_STUB_PORT = 32<nn> / 33<nn>
  where nn is your stream number (S1 3201/3301 … S5 3205/3305).

GOOGLE AND SAFETY
- Only the existing business.manage scope. No new OAuth scope, no new Google API family.
- Use the existing transport in lib/server/google (quota, retired-endpoint guard).
  Any Google write goes through the existing change-set / approval / publish-attempt
  path with readback. Never call Google from the dev org, never publish to a real
  profile, never deploy, never push, never read or print .env*, tokens or keys.
- No new dependencies unless your brief allows one. Never upgrade dependencies.
  If you need one, stop that slice and ask the coordinator.

LICENCE
- OpenGMB is MIT. You may adapt the pure reference files in context/opengmb/.
  Any file containing adapted code starts with a comment naming the source path and
  "Adapted from OpenGMB (MIT, © 2026 Synectus Private Limited)", and you add one line
  per source file to your report's "Third-party notices" section. Don't use the
  OpenGMB name in UI copy or identifiers. Don't copy their DB, executor or audit code.

HOW TO WORK: fan out with subagents (if your tool has none, do the same steps in order)
1. Discovery, in parallel, read-only subagents (3–4 at once):
   a. Data: which tables and server functions already hold what you need; quote file:line.
   b. UI: the routes and components you'll extend; how neighbouring screens load data
      (TanStack Query, prefetch, HydrationBoundary), design tokens, copy style.
   c. Tests: the nearest unit, component, integration and e2e tests to copy patterns from.
   d. (if relevant) Google: existing reads/writes, fixtures and the e2e Google stub.
   Merge their findings into a short plan in your report before writing code.
2. Build in slices (each one small enough to review in one sitting):
   domain logic (pure, unit-tested) → migration + server/API → UI → e2e.
   For each slice, in parallel: one implementer (you), one test-writer subagent
   working from the slice's contract, not your code.
3. After each slice, run two independent read-only reviewer subagents, given the diff
   and the brief but not your reasoning:
   - correctness and tenancy/authorization (RLS, role checks, member vs owner scope,
     no cross-org leaks, no Google call from read paths that must be DB-only);
   - product and UX (copy matches the app's voice, mobile 390px, empty and error
     states, accessibility).
   Fix confirmed findings, then re-run the checks.
4. Checks for every slice, with real output in your report:
   pnpm typecheck && pnpm lint && pnpm format:check && pnpm test
   plus, when SQL or server code changed: pnpm test:integration on a fresh cluster,
   and pnpm build. Run pnpm check:design --ratchet when UI changed.
   Run the relevant e2e spec(s) before declaring the stream done.
5. Commit each slice: Conventional Commits, scope = your area, e.g.
   feat(listings): completeness checks domain. Use your own model's Co-Authored-By
   trailer, or none if you are not Claude. Leave a clean tree after each commit.

REPORTING
- Keep reports/<stream>.md current as you go: plan, slices done with commit SHAs,
  migrations (number, table, purpose), check output, INTEGRATION seams, decisions
  you made, open questions, third-party notices, follow-ups. If you are blocked on a
  product decision, write it under "Blocked" and carry on with the next slice.
- Done = all slices committed, all checks green, report complete. Then stop.
```

---

## S1: listing completeness score

```text
Stream S1 · dir s1-completeness · branch feat/opengmb-s1-completeness · migrations 0300–0309

Goal: each listing gets a completeness score from deterministic checks, each with a
plain finding and an in-app fix link. It shows on the /listings board and the listing
overview, built only from data NabaPresence already stores. It must be DB-only and
never call Google, like listingHealth().

Read: docs/specs/2026-09-19-listings.md, lib/listings/health.ts, lib/listings/areas.ts,
components/listings/listings-board.tsx, listing-overview.tsx, health-strip.tsx,
app/api/listings/summary/route.ts, app/api/locations/[id]/summary (if present).
Reference: context/opengmb/healthcheck/evaluate.ts, similarity.ts, config/healthcheck.ts.

Checks (drop any whose data we don't store; say which in the report):
necessary: primary category, regular hours, phone, website, verification, description present.
important: special hours set for the next upcoming UK bank holiday or Christmas period
  (within 45 days), post in the last 30 days, photo in the last 90 days, cover and logo
  photos, unreplied reviews older than 7 days, booking place-action link present,
  services or menu present (menu counts for food venues).
nice: description length and quality (not stuffed, not the same as a sibling venue's),
  additional categories, attributes filled, website UTM tagging, average rating trend.
Scoring: weighted by importance; "unknown" when the source snapshot is missing or stale,
and unknown never counts as a fail. Per-location "skip this check" with a reason, stored
in a new table (owner/admin only, audited).

You own: lib/listings/completeness*.ts, lib/server/listing-completeness*.ts,
components/listings/completeness-*.tsx, components/listings/listings-board.tsx,
components/listings/listing-overview.tsx, app/api/listings/summary/route.ts (extend the
response additively), new route app/api/locations/[id]/completeness-skips/route.ts, tests.
Don't edit lib/listings/health.ts (sync state stays separate) or lib/listings/areas.ts (S2 owns it).

UI: a Completeness column on the board (score, then sortable "most to fix" order) and a
card on the overview listing failing checks in importance order, each with its fix link
to the right /listings/[id]/<area>. Members see it read-only.
Tests: unit tests per check, including unknown/stale; integration for the summary route
(member vs owner, cross-org isolation); one e2e on the board and overview.
```

## S2: review links and QR codes

```text
Stream S2 · dir s2-review-links · branch feat/opengmb-s2-review-links · migrations 0310–0319

Goal: each venue gets a short, tracked link to its Google "write a review" form and a
printable QR code. Count clicks per venue, and show clicks next to new reviews over the
same period. No email campaigns and no guest data: don't build them.

Read: lib/domain/profile-vocabulary.ts (metadata.newReviewUri), proxy.ts (public route
allowlist), lib/listings/areas.ts, area-nav.ts, app/(dashboard)/listings/[id]/*.
Reference: context/opengmb/review-requests/pure.ts, review-links/*.

Build:
- Table review_link (organisation_id, location_id, code, target_uri, created_by,
  disabled_at) and review_link_click (link_id, clicked_at, coarse source: qr|link;
  no IP, no user agent stored). Codes are random and unguessable, unique, and can be
  rotated (old code then 404s or shows a neutral page).
- Public redirect route app/r/[code]/route.ts: look up the code, record the click, and
  302 to the stored newReviewUri. If the link is unknown or disabled, show a plain page
  with no venue data. Allow it in proxy.ts without a session. Rate-limit with the
  existing abuse_rate_bucket helpers.
- The target is newReviewUri from the stored location snapshot. If it is missing,
  show "Google hasn't given a review link yet" and offer a refresh through the
  existing Business Information read. Never build the URL by hand.
- A new listing area "Review link" (/listings/[id]/review-link): the link, copy
  button, QR preview, PNG and SVG download, rotate, disable, and a 30/90-day chart of
  clicks against new reviews.
- Anti-gating: any user-editable caption text printed with the QR is checked by a pure
  rule adapted from review-requests/pure.ts (no asking for stars, ratings, "how was
  your visit", or incentives).
QR generation: a small QR library is needed. Don't add it yourself. Write the decision
under "Blocked" (proposed package, version, size, licence), build everything else
behind a QrImage component with a stub, and let the coordinator ask the user.

You own: proxy.ts (allowlist line only), lib/listings/areas.ts, lib/listings/area-nav.ts,
app/r/**, app/(dashboard)/listings/[id]/review-link/**, app/api/locations/[id]/review-link*/**,
lib/server/review-links*.ts, lib/domain/review-link*.ts, components/listings/review-link-*.tsx, tests.
Tests: code generation and rotation, redirect (known, unknown, disabled, rate-limited),
tenancy, anti-gating rule, the area page (e2e), and no session needed for /r/*.
```

## S3: review topics and trends

```text
Stream S3 · dir s3-review-topics · branch feat/opengmb-s3-review-topics · migrations 0320–0329

Goal: classify every review with text into a fixed hospitality topic list, with sentiment
per topic. Show topic share and weekly trend per venue and across the group in Reports,
filter the inbox by topic, and alert when a topic turns sharply negative at one venue.

Topics (v1, fixed): food quality, drinks, service, wait time, price/value, atmosphere,
cleanliness, booking, Sunday roast, events/live sport, dogs/family, accessibility,
parking. Sentiment per topic: positive | neutral | negative.

Read: lib/server/ai.ts, lib/server/ai-usage.ts (credit reservation), docs/workers-ai.md,
docs/openai.md, how reviews are ingested (sync and Pub/Sub paths), app/(dashboard)/reports,
lib/reporting/*, lib/inbox/filter-labels.ts, url-state.ts.
Reference: context/opengmb/reviews/topic-trends.ts, topics.ts, negative-alert.ts.

Build:
- Table review_topic (organisation_id, review_id, topic, sentiment, model, classified_at,
  review_update_time). Reclassify when the review text changes.
- A classifier job on the existing job runner: batch unclassified reviews, reserve and
  settle AI credits the existing way, use the configured provider (respect the AI
  kill switch and business-mode credit rules), and store the result. Don't send
  reviewer names. A backfill limited per org per run.
- Reports: a "What guests talk about" panel with topic share, negative share and an
  8-week sparkline per venue, plus a group view with CSV export via lib/reporting/csv.ts.
- Inbox: a Topic filter chip.
- Alerts: a notification when a venue's negative share for a topic in the last 14
  days is well above its own 90-day baseline (a minimum count, so one review doesn't fire).
- Also check whether the low_rating_review notification fires when an existing review
  is edited from 4–5★ down to ≤3★. If it doesn't, fix it (OpenGMB's negative-alert.ts
  shows the rule) with a test.

You own: lib/server/review-topics*.ts, lib/domain/review-topics*.ts, the classifier
job registration, components/reports/review-topics-*.tsx, app/(dashboard)/reports/page.tsx,
lib/inbox/filter-labels.ts, lib/inbox/url-state.ts, the low-rating notification code
path, tests. Notification kinds: append-only in lib/contracts/notifications.ts plus
your own migration.
Tests: the pure trend math, classifier parsing (malformed model output is rejected,
not stored), credit reservation and refund, the edit-down alert, the reports panel
(component), and inbox filtering (e2e). The AI provider is stubbed; no live AI calls in tests.
```

## S4: content checks and reply repetition

```text
Stream S4 · dir s4-content-checks · branch feat/opengmb-s4-content-checks · migrations 0330–0339 (likely none)

Goal: (1) stop near-duplicate replies across a client's venues; (2) apply content checks
to post text and profile descriptions, not only replies; (3) an org-level banned-phrase
list.

Read: lib/domain/verification.ts and its tests (tests/verification.test.ts), lib/server/drafts.ts,
app/api/drafts/[id]/verify/route.ts, the post compose and publish path (lib/server/posts.ts,
post-content.ts), the profile description editor, components/settings/policy-form.tsx.
Reference: context/opengmb/guardrails/README.md, packs/universal.ts, packs/post.ts,
packs/profile.ts, text.ts.

Build:
- Reply repetition: warn when a draft's opening sentence matches a recent published reply
  for the same client, and fail when the whole reply is a near-duplicate (normalised
  similarity over the last 30 published replies for the client). Keep it pure, with the
  comparison set loaded by the server. Rating-only template replies are exempt, since
  repetition there is by design.
- Post and description checks: phone numbers and URLs in the body (Google rejects or
  penalises them; the CTA button is the place for links), Google length limits,
  ALL-CAPS and excessive punctuation, expired dates in offer posts, banned phrases.
  Run them on save and again just before publish. Fail blocks; warn needs explicit
  acknowledgement, the same pattern replies use.
- Banned phrases: an owner/admin-editable list in Reply policy settings (stored with
  existing org settings if possible; a migration only if needed), applied to replies,
  posts and descriptions.

You own: lib/domain/verification.ts, lib/domain/content-checks*.ts, the post/description
verify call sites (add a call, don't restructure), components/settings/policy-form.tsx,
relevant API contract additions, tests.
Tests: table-driven unit tests for every rule, including false-positive cases (a
pub's name containing a number, "open 24/7", prices like £12.50); integration for
publish-time re-check; one e2e showing a blocked post and an acknowledged warning.
```

## S5: Google-side change watch with one-click revert

```text
Stream S5 · dir s5-google-revert · branch feat/opengmb-s5-google-revert · migrations 0340–0349

Goal: when a protected field (name, phone, website, regular hours, special hours,
primary category, description) changes on Google and differs from our last published
value, alert the right people. Show "Ours vs Google's" with one action, "Put ours back",
which creates a normal change set through the existing approval and publish path.
No automatic revert.

Read: docs/specs/2026-09-19-listings.md §4–5, app/(dashboard)/listings/[id]/suggestions,
changes, lib/server getGoogleUpdated usage, gbp_change_set and profile_field_state,
lib/server/publishing/*, the business-information observation added in migration 0148.
Reference (ideas only): context/opengmb/profile/watch.ts, autoRevert.ts.

Build:
- Detection from the existing observation and sync data (no new polling cadence
  unless needed; reuse Pub/Sub GOOGLE_UPDATE where it already arrives).
- Per-listing settings: which fields are protected (default: all listed above) and who
  is alerted. Stored with an audit entry.
- Suggestions page: a clear diff and the "Put ours back" action building a change set
  bound to the observed Google baseline hash. If Google changes again before approval,
  the approval goes stale (existing rule) and the operator re-reviews.
- Also "Accept Google's" for when Google is right: update our baseline without writing.
- Notification kind "listing.google_changed" (append-only contract edit + migration),
  deduplicated per field and value.

You own: app/(dashboard)/listings/[id]/suggestions/**, components for suggestions and
diffs, lib/server/google-change-watch*.ts, lib/domain/google-change-watch*.ts,
the protected-fields settings route, tests. Don't edit listing-overview.tsx (S1
owns it). Expose a <GoogleChangesBadge> and leave an INTEGRATION comment.
Tests: detection (midnight-hours normalisation, provider ordering of special hours,
omitted defaults are not changes), a stale baseline invalidates approval, member cannot
revert, the revert goes through approval when policy requires it, and e2e with the
Google stub (no real Google).
```

---

## D6: rank-grid design (no code)

```text
Design-only track D6. Don't change any repository. Write
~/LapenInns Project/platform/naba-presence-opengmb-fanout/reports/D6-rank-grid.md.

Question: should NabaPresence add local Maps rank tracking for the 11 Lapen venues, and how?
Use parallel research subagents for: (a) OpenGMB's geogrid module (context/opengmb/geogrid/*,
including its finding that Places API Text Search matched 0/81 points against Maps rank);
(b) DataForSEO Maps SERP pricing and API shape today (cite pages, with dates);
(c) alternatives (Local Falcon API, BrightLocal, SerpApi) on price, terms and accuracy;
(d) how it would fit NabaPresence (job runner, credential storage like other provider
secrets, tenancy, Reports).
Deliver: recommendation (build / buy / skip), monthly cost for 11 venues × 3 keywords ×
7×7 grid weekly and fortnightly, data model sketch, slices with effort, risks (cost runaway,
ToS, accuracy). Mark every price with source and date. No account sign-ups, no API keys.
```

## D7: MCP server and API tokens design (no code)

```text
Design-only track D7. Don't change any repository. Write
~/LapenInns Project/platform/naba-presence-opengmb-fanout/reports/D7-mcp-tokens.md.

Question: what is the smallest safe MCP server for NabaPresence that lets the owner say
"draft replies for this week's 1–2★ reviews at every venue and put them in the approval queue"?
Use parallel subagents for: (a) OpenGMB's token model and MCP catalogue
(packages/core/src/apiTokens.ts, mcpCatalog.ts, mcpProposals.ts, apps/mcp); (b) NabaPresence's
auth, session, RLS/withTenant, roles, approval policy and AI credit paths; (c) current MCP spec
(Streamable HTTP, auth guidance) and how Next.js 16 route handlers on Vercel would host it.
Deliver: token model (scopes: read, draft; never approve or publish in v1), tool list
for v1 (read reviews, read listings and summary, read reports, create reply draft,
request approval), threat model (token theft, prompt injection from review text,
cross-org), audit, rate limits, data model sketch, slices with effort.
```

---

## Prompt 9: coordinator integration

```text
Integrate the OpenGMB fan-out. Read every reports/*.md first and list each stream's
status, Blocked items and INTEGRATION seams. Ask me in one message about every Blocked
decision (e.g. S2's QR dependency) before continuing.

Then:
1. In a new worktree from the latest origin/main: branch feat/opengmb-gap-features.
2. Merge the stream branches in this order: S4, S1, S2, S3, S5 (smallest blast radius
   first). Use full refs refs/heads/feat/opengmb-s*. After each merge run
   pnpm typecheck && pnpm test, and fix conflicts in the merge commit.
3. Renumber migrations into the next free sequential numbers after the highest on
   origin/main, keeping stream order. Update REQUIRED_MIGRATIONS and any test that
   names them. Run node scripts/ci/migration-policy.mjs origin/main.
4. Wire every INTEGRATION seam (e.g. S5's badge on listing-overview, S3 and S5
   notification kinds), then remove the comments.
5. Run two independent reviewer subagents on the whole diff against origin/main
   (correctness/tenancy and UX consistency across the five features). Fix confirmed
   findings.
6. Run the full gate: pnpm verify:release (it starts its own throwaway Postgres).
   Report real output.
7. Add THIRD_PARTY_NOTICES entries from the stream reports, and a short
   docs/specs/2026-10-30-opengmb-gap-features.md describing what shipped.
8. Stop and ask me before pushing. On my yes: push to origin (lapeninns), open ONE PR,
   run `lci run <profile> --pr N --post --comment` once on the final head, and report.
Never deploy, never run hosted migrations, never publish to a real Google profile.
```
