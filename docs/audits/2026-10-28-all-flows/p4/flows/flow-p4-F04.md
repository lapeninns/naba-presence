# p4-F04 — Browse posts (list, filters, empty state, card, history)

Worktree `/tmp/naba-presence-p4` at `e4123d25`. Read-only mapping; nothing run. Paths are repo-relative.

## 1. Start / end

- **Start:** `/listings/{id}/posts` (area tab "Posts"). `app/(dashboard)/listings/[id]/posts/page.tsx:20-35` streams `postsTabPrefetch(id)` behind `StreamedTab` (`components/listings/streamed-tab.tsx:36-55`), then `AreaEditor area="posts"` loads `PostsTab` (`components/listings/area-frame.tsx:925-927`).
- **End:** the operator has seen the posts in one status view, knows each post's state and next step, and has optionally opened a row's History. Leaving the flow: "New post" opens the composer (**F05**); row buttons and the "More actions" menu are **F06** (`components/locations/posts-action-bar.tsx`); "Scheduled publications" and legacy schedules below the list are **F07** (`posts-tab.tsx:482-490`).
- The area header (shared, `area-frame.tsx`) holds the h1 "Posts", the status pill (`lib/listings/area-state.ts:185-224`), the model note "Each post is drafted, approved if your policy asks, then published." (`lib/listings/areas.ts:161`) and the "Checked with Google … Check Google now" line (`components/editors/google-freshness.tsx:53-106`, reported up from `posts-tab.tsx:324-329`).

## 2. Roles and gates

- **Read:** any member with access to the location. Server: `requireLocationAccess` in `listLocalPosts` (`lib/server/posts.ts:905`), via `GET /api/locations/[id]/posts` (`app/api/locations/[id]/posts/route.ts:19-27`).
- **Capabilities query fails:** the whole tab becomes the retry state (`components/locations/location-tab.tsx:185-191`). There is no `requires` gate on Posts, so every role reaches the list.
- **Look-only role** (`caps.canEdit === false`): banner "You can look, but not change these posts" + "Your role can view this location but not change it." (`posts-tab.tsx:316-318`, `lib/locations/gating.ts:54`). Billing read-only uses `BILLING_READ_ONLY_REASON` instead (`gating.ts:53`).
- **Posts paused** (`writesEnabled === false`): banner "Posts are paused" + "Publishing to Google is currently unavailable, so new posts cannot be composed. Publishing and deleting posts also wait until it’s back." (`posts-tab.tsx:311-317`, `gating.ts:116`).
- **Scheduling details** appear only with `caps.postScheduling` (`posts-tab.tsx:255-263, 405-407`).

## 3. Baseline steps

1. Document load: "Reading the posts from Google…" plus 3 skeleton rows (`gating.ts:137`, `components/ui/query-states.tsx:54-80`) while the server reads (and reconciles if stale: `posts.ts:876-896`).
2. The list renders, newest content first. The server orders by `sort_at desc nulls last, id` (`posts.ts:840`), and the client re-sorts the same way (`posts-tab.tsx:275-284`).
3. Filter chips "All · Drafts · Awaiting approval · On Google · Needs attention", each with its server count (`lib/locations/post-display.ts:76-83`, `posts-tab.tsx:357-378`). The "Needs attention" count turns red when above 0 (`:367-371`).
4. Picking a chip refetches that server view (`lib/queries/use-location-posts.ts:36-54`, `keepPreviousData`). The old rows stay visible, filtered on the client, with `aria-busy` on the list (`posts-tab.tsx:272-276, 400`), and the LoadMore footer is hidden (`:472`).
5. Each row (`components/locations/posts/post-card.tsx:62-157`) shows: a thumbnail (or an image glyph), the type tag ("Update/Event/Offer"), and an h3 headline. The headline is the event or offer title, or else the first line of an update, cut at 70 chars (`posts-tab.tsx:63-81`). Then come the status pill and "Changed {d Mon yyyy, HH:mm}" or "Date unavailable" (`:408-410`), the body (with the first line not repeated), and details joined by " · " (scheduled publication, event dates, repeat, "{CTA} button") (`:411-420`). Last are the problem note (`role="note"`), the actions (F06), and the "History" `<details>`.
6. "Load more posts" pages by keyset; the status line reads "Showing N of M posts" (`components/ui/load-more.tsx:66-87`).
7. Opening History shows a 4-stage `Lifecycle`: Drafted → Approved → Sent to Google → Live on Google (`posts-tab.tsx:83-135`, `components/ui/lifecycle.tsx:42-115`).

`PostPreview` (`posts/post-preview.tsx`) is **not** drawn on the list. It is used only in the composer (F05, `post-composer-sheet.tsx:1170`) and the publish confirmation (F06, `posts-action-bar.tsx:278-292`).

## 4. States (exact copy)

| State                                                           | Where                                       | Copy                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loading                                                         | `gating.ts:137`, `query-states.tsx:72-80`   | "Reading the posts from Google…" + SkeletonList(3), `role=status`                                                                                                                                                                                                                                                                  |
| Error                                                           | `components/locations/tab-states.tsx:76-90` | "We couldn’t load this section" / "{describeActionError} Nothing was changed." / button "Try again" + "Details for support"                                                                                                                                                                                                        |
| Not linked                                                      | `tab-states.tsx:52-65`                      | "This location isn’t linked to Google yet" / "Link it to Google Business Profile to manage its details, hours, photos and more here. Owners and admins link listings from Setup." / "Link it in Setup"                                                                                                                             |
| Google unreachable (list still answers)                         | `posts-tab.tsx:331-339`                     | warning "Some Google posts may be out of date" / "We couldn’t reach Google to refresh this list just now. Your drafts are safe." (no action)                                                                                                                                                                                       |
| Check now failed                                                | `google-freshness.tsx:100-105`              | "Google couldn’t be checked just now. Try again."                                                                                                                                                                                                                                                                                  |
| Empty (no posts)                                                | `posts-tab.tsx:341-354`                     | h3 "No posts yet" / "A post is a short update, event or offer that shows on the listing on Google for about a week. Nothing reaches Google until you publish it." (gated variant: "…The note above says why new posts can’t be written right now."). Action: the composer trigger "New post"; the header button is hidden (`:322`) |
| Empty view                                                      | `posts-tab.tsx:380-396`                     | h3 "No posts in this view" / "Nothing matches “{label}”." / "Show all posts"                                                                                                                                                                                                                                                       |
| Switching view                                                  | `posts-tab.tsx:272, 400, 472`               | no visible text; `aria-busy` on `<ul>`, footer hidden                                                                                                                                                                                                                                                                              |
| Load more                                                       | `load-more.tsx:66-87`                       | "Showing N of M posts" / "Showing all M posts" / "Load more posts" / "Loading…" / "We couldn’t load more posts. Try again."                                                                                                                                                                                                        |
| Draft                                                           | `post-display.ts:63`                        | pill "Draft" (outline). History: Approved = todo, meta "If your policy asks" (`posts-tab.tsx:111`)                                                                                                                                                                                                                                 |
| Awaiting approval                                               | `post-display.ts:64-65`                     | pill "Awaiting approval" (warn). History: Approved = current, meta "Waiting for an approver" (`:109`)                                                                                                                                                                                                                              |
| Scheduled (draft/awaiting/failed with a live one-time schedule) | `posts-tab.tsx:177-184, 412`                | pill unchanged (e.g. "Draft"); details: "Scheduled publication {active\|awaiting approval\|paused\|blocked}: 2026-10-20 at 09:00 (Europe/London, UTC+01:00)"                                                                                                                                                                       |
| Sent (`publishing`)                                             | `outcome.ts:55-63`                          | pill "Sent to Google" (info); Sent stage = current                                                                                                                                                                                                                                                                                 |
| Published, PROCESSING/unknown                                   | `outcome.ts:64-72`                          | pill "Waiting for Google" (info)                                                                                                                                                                                                                                                                                                   |
| Published LIVE                                                  | `outcome.ts:73-81`                          | pill "Live on Google" (ok); Live stage done (`posts-tab.tsx:132`); F06 adds "View on Google"                                                                                                                                                                                                                                       |
| Rejected                                                        | `posts-tab.tsx:138-144`, `outcome.ts:82-89` | pill "Rejected by Google"; note "Google rejected this post, so customers can’t see it." + support code; History meta "Rejected"                                                                                                                                                                                                    |
| Failed                                                          | `posts-tab.tsx:145-159`                     | pill "Failed"; note `describeErrorCode(code)` or "Google didn’t accept this post, so nothing is live. Edit it or publish it again."; History meta "Not accepted"                                                                                                                                                                   |
| Ambiguous                                                       | `posts-tab.tsx:160-161`                     | pill "Not confirmed" (warn); note "We couldn’t confirm whether Google has this post. Check Google before publishing again, so it isn’t posted twice." (drawn on the danger tint, `post-card.tsx:131`); meta "Not confirmed"                                                                                                        |

## 5. Protected rules (don't change)

- List authority and filters: `posts.ts:727-743` (`postFilterCondition`: `published` = published+publishing; `attention` = failed, ambiguous, or published+REJECTED), `:771-843` (ordering, cursor), `:859-905` (reconcile, access).
- Only Google's LIVE may say live: `lib/domain/post-outcome.ts:16-56`; the copy rule is in `lib/editors/outcome.ts:11-15`.
- Approval policy: `requiresPostApproval` `posts.ts:1362-1369`; parking `:1761-1785`; grants `request_approval`/`decide_approval` `:1660-1666`.
- Schedulable mirror of the server's `publishableSource`: `posts-tab.tsx:165-175` (kept in step with `lib/server/publication-schedules.ts`).
- Contracts: `lib/contracts/location-posts.ts:227-265, 316-345` (row, filters, counts, list response).

## 6. Audit status (15 Oct)

| ID                          | Audit said                                | Now                                                                                                                                                                                                                                                                                                                                   |
| --------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LST-24                      | Every update headed "Update"; "Lifecycle" | **Fixed.** Headline is the first line (`posts-tab.tsx:71-81`), type as a tag (`post-card.tsx:88-92`), disclosure "History" (`post-card.tsx:146`). Test `posts-tab.test.tsx:121-151`                                                                                                                                                   |
| DSK-14                      | Empty state points elsewhere              | **Fixed** for the empty state (`posts-tab.tsx:341-354`, header button hidden `:322`; test `:239-254`). Not done: the audit's second half (with posts, put "New post" in `ListingAreaHeader` beside Activity). It still sits in the EditorFrame head (`editor-frame.tsx:153-157`). Owner's call; shared `area-frame.tsx`               |
| LST-19                      | Raw IANA zone IDs                         | **Partly fixed.** Still raw on the post **row** too, not only in F07's files: `scheduleSummary` → `describeScheduleRule` prints "(Europe/London, UTC+01:00)" and an ISO date (`posts-tab.tsx:177-184`, `lib/domain/publication-schedule.ts:582,591`). The audit recorded only `post-schedules.tsx:331`, `schedule-post-sheet.tsx:351` |
| LST-25                      | Composer copy                             | Fixed; F05's flow                                                                                                                                                                                                                                                                                                                     |
| results.md:363 follow-up 17 | Raw failure code on card                  | **Fixed.** Words + "Details for support" (`posts-tab.tsx:145-159`; tests `:153-237`)                                                                                                                                                                                                                                                  |

## 7. Friction

1. **P2 — The scheduled line reads like a database row.** Example: "Scheduled publication active: 2026-10-20 at 09:00 (Europe/London, UTC+01:00)" (`posts-tab.tsx:177-184`), in caption type, joined to the other details with " · ". It has an ISO date, a raw zone, a status word cut into the sentence ("…blocked: …") and the word "publication". The pill still says "Draft", so a scheduled post looks like any draft at a glance. F07's own list already words the same rule as "Mon 20 Oct, 09:00 BST · Once" (`posts/schedule-dates.ts:89-104`), which gives one schedule two descriptions. Evidence: code and the asserted string in `post-schedules-ui.test.tsx:237`.
2. **P2 — "On Google" holds posts that aren't on Google.** The view includes `publishing` ("Sent to Google"), PROCESSING ("Waiting for Google") and published+REJECTED ("Rejected by Google"), so a rejected post appears under both "On Google" and "Needs attention" (`posts.ts:738-741`, `post-display.ts:81`). That conflicts with the house rule that nothing short of LIVE may claim Google holds it (`outcome.ts:11-15`). Related, out of flow and shared: the area header's "N published" (`lib/listings/area-state.ts:222`) counts the same set.
3. **P2 — History invents steps for posts made in Google.** Reconciled posts with no local draft (`googlePostName` set, `localEditedAt === null`) still show "Drafted ✓ Approved ✓" (`posts-tab.tsx:97-113`). An owner's direct publish also shows "Approved ✓", although no approval took place. The row carries no approval data (`location-posts.ts:227-251`), so only the Google-origin case can be proven on the client.
4. **P2 (Hypothesis, untested) — A failed view switch drops the whole tab.** If a chip's view fails to load, `useInfiniteQuery` has no cached data for that key, so `isError` is set and `LocationTab` replaces the list, chips included, with "We couldn’t load this section" (`location-tab.tsx:249-250`, `paged-list.ts:88`). "Try again" only retries the failing view, and there is no route back to "All" short of a reload.
5. **P3 — Switching views gives no visible feedback.** Rows that don't match vanish at once, and a view with no loaded matches draws an empty bordered box with no words until the fetch lands (`posts-tab.tsx:275-276, 398-401`). `aria-busy` announces nothing.
6. **P3 — The History disclosure is the same "History" ×N.** Its accessible name doesn't say which post it opens (`post-card.tsx:141-147`), and the "History" holds no times or names: it is a status track, so "History" overpromises a little.
7. **P3 — The "Not confirmed" note sits on the danger tint.** The pill is warn, so the same row speaks in two tones (`post-card.tsx:131`, `post-display.ts:45`).
8. **P3 (Hypothesis) — Two messages for one cause.** A failed "Check Google now" can show the header line "Google couldn’t be checked just now. Try again." and, after invalidation, the list alert "Some Google posts may be out of date" (`use-location-posts.ts:61-71`, `posts-tab.tsx:331-339`). The alert has no action of its own.

## 8. Proposed changes

**C1 — Say the schedule in words (F1).** Owned file `components/locations/posts-tab.tsx:177-184, 412`.

- Change: replace `scheduleSummary` with ``const badge = scheduleBadge(s); `Scheduled for ${scheduleWhen(s.rule, s.timezone, s.offsetMinutes).replace(/ · Once$/, "")}${badge.label === "Active" ? "" : ` · ${badge.label}`}` `` → "Scheduled for Mon 20 Oct, 09:00 BST" or "Scheduled for Mon 20 Oct, 09:00 BST · Awaiting approval".
- `scheduleWhen` is imported from `posts/schedule-dates.ts`, which F07 owns; import only, no edit. Coordinate the wording with F07.
- Optional: pass `status="Scheduled"`, `tone="info"` to `PostCard` when `post.status === "draft" && scheduled`, so the pill says it.
- Benefit: one name for one schedule across the row and the schedules list; fixes the row half of LST-19.
- Principle: Nielsen #2 (match the real world), #4 (consistency).

**C2 — Rename the "On Google" view "Sent to Google" (F2).** `lib/locations/post-display.ts:81` (**shared lib, flag**).

- Alternative without the shared edit: override the label in `posts-tab.tsx:374` (`option.value === "published" ? "Sent to Google" : option.label`).
- The server filter is unchanged.
- Benefit: the chip's word stays true for every post under it.
- Principle: Nielsen #1 (visibility of system status) and #2; the outcome copy rule.

**C3 — History tells the truth for posts made on Google (F3).** `posts-tab.tsx:83-135`.

- Change: when `post.googlePostName && post.localEditedAt === null`, make Drafted and Approved `state: "skipped"`, with Drafted `meta: "Made on Google"`. Use `=== null` so an older server (`undefined`) keeps today's track.
- Benefit: no invented steps.
- Principle: Nielsen #1; HIG "be accurate about state".
- No server change.

**C4 — Name each History disclosure (F6).** `components/locations/posts/post-card.tsx:146`.

- Change: `History<span className="sr-only"> of {title}</span>`.
- Benefit: a screen-reader list of controls tells the rows apart.
- Principle: WCAG 2.2 SC 2.4.6 Headings and Labels, 2.4.9 (AAA) Link Purpose.
- The visible text is unchanged, so tests using `getAllByText("History")` keep passing (`posts-tab.test.tsx:150`).

**C5 — Problem-note tone follows the status (F7).** `post-card.tsx:54, 128-135` and `posts-tab.tsx:434`.

- Change: add `problemTone?: "bad" | "warn"` to `PostCard` (`bg-warning-tint` for warn; the token exists at `app/globals.css:218`). `posts-tab` passes `"warn"` for `status === "ambiguous"`.
- Benefit: one tone per row; "not confirmed" no longer reads as "failed".
- Principle: Nielsen #4. WCAG 1.4.1 is already met by the words.

**C6 — Visible pending line on a view switch (F5).** `posts-tab.tsx:472-479`.

- Change: while `switching`, render `<p role="status" className="text-caption text-ink-muted">Loading {label.toLowerCase()}…</p>` in the LoadMore slot. When `switching && shown.length === 0`, render that line instead of the empty `<ul>`.
- Benefit: the wait is seen and heard.
- Principle: Nielsen #1; WCAG 2.2 SC 4.1.3 Status Messages.
- F4 (failed switch) needs `location-tab.tsx` (shared by every tab) or a posts-local wrapper. Recommend the coordinator decide; not proposed here.

## 9. Tests

**Existing assertions touched:**

- C1: `tests/components/post-schedules-ui.test.tsx:237` (`/Scheduled publication active: 2026-10-20 at 09:00 \(Europe\/London, UTC\+01:00\)/`) and `tests/e2e/operations-features.spec.ts:494` (`/Scheduled publication awaiting approval:/`). Both must move to the new wording.
- C2: no test names "On Google" for posts; `posts-tab.test.tsx:690-697` uses `/Drafts/` and `/Needs attention/` only.
- C3: `posts-tab.test.tsx:187-216` (rejected; "Rejected" meta) stays valid; check its fixture `post()` default for `localEditedAt`/`googlePostName`.
- C4: `posts-tab.test.tsx:150` (`getAllByText("History")`) is fine, because `getByText` matches the full text, and the sr-only span splits it. Verify the match.
- C6: `posts-tab.test.tsx:706-724` asserts `queryByText(/^Showing/)` is null while switching; add a `getByRole("status")` "Loading drafts…" check.

**New focused tests (`tests/components/posts-tab.test.tsx`):**

- (a) A scheduled draft reads "Scheduled for Mon 20 Oct, 09:00 BST" and no "Europe/London".
- (b) The published chip is named "Sent to Google".
- (c) A Google-origin LIVE post's history speaks "Drafted, skipped" / "Made on Google".
- (d) The History summary's name is "History of {title}" (`getByText` within `summary`, via `toHaveAccessibleName` on the summary element).
- (e) An ambiguous post's note has the warning class, not `bg-danger-tint`.

## 10. Screenshot states in the visual fixture (owner, `/listings/{loc}/posts`)

The fixture is `tests/visual/fixture-server.ts` → `tests/e2e/helpers/stub-bridge.ts`. It seeds **no posts**: the stub answers `GET …/localPosts` with `{ localPosts: [] }` (`stub-bridge.ts:410-413`) and has **no POST /localPosts handler**, so a publish fails; the audit saw this too (`results.md:414`). Scheduled publishing is off in the fixture (`results.md:421`).

| State                                                                           | Reachable? | How                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty "No posts yet" + New post                                                 | Yes        | Open the owner's linked listing's posts on a fresh seed                                                                                                                                                           |
| Draft row(s), History open                                                      | Yes        | New post → type "Quiz night\nFrom 8pm" → Save draft (local DB write only) → click "History"                                                                                                                       |
| Empty view                                                                      | Yes        | With only drafts, press "Awaiting approval" → "No posts in this view"                                                                                                                                             |
| Failed (note + support details)                                                 | Yes        | On a draft press Publish → confirm; the stub has no handler, so the outcome is failed or not confirmed. Record which pill appears                                                                                 |
| Awaiting approval                                                               | Likely     | The approval tenant has `require_two_person_approval = true` (`stub-bridge.ts:791-805`): an owner's Publish parks the post                                                                                        |
| Loading                                                                         | Hard       | Only the brief Suspense fallback; throttle the network in shoot.mjs if supported                                                                                                                                  |
| Live / Waiting / Rejected / Sent / Scheduled / Google-unreachable alert / error | No         | Covered by component tests with mocked `usePosts` (`posts-tab.test.tsx`). Live posts need the stateful stub in `tests/e2e/helpers/operations-backend.ts:62-78` (`state: "LIVE"`), which is not the visual harness |

Capture at 390 light, 390 dark and 1280 under `/tmp/naba-presence-visual.lock`.
