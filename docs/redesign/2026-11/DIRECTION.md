# NabaPresence redesign 2026-11: visual direction

Status: **proposal for owner review** (phase B, worker `b-direction`, branch
`redesign-2026-11/b-direction`, cut from `redesign-2026-11/integration` =
`origin/main` 367719b3). Binding for later phases once merged into the
integration branch. Its companion is [`SYSTEM.md`](./SYSTEM.md), the
implementable specification. Concepts are in [`concepts/`](./concepts/).

This document **refines** the operator's-desk identity
(`docs/specs/2026-09-23-operators-desk-identity.md`) and the taste pilot
(`docs/specs/2026-10-29-taste-pilot-direction.md`). It does not restart them.
Section 8 lists which historical rules survive.

> **How the concepts were made.** Each concept is a static HTML/CSS mockup
> built from the real token values (`concepts/src/*.mjs` → `concepts/html/*.html`).
> The phase-B sandbox could not launch any browser engine (Chromium, Chrome,
> WebKit and Firefox all failed at Mach-port registration) and could not bind a
> local port. So the PNG/WebP files were rendered by satori + resvg (the copies
> bundled in `next/dist/compiled/@vercel/og`), not by Playwright. The HTML is
> the source of truth; `concepts/src/shoot.mjs` re-shoots it in Playwright
> wherever a browser can run. The current app could not be served for the same
> reason. The "current" references in `concepts/current/` are the latest
> fixture-tenant captures already on disk: the 2026-10-29 taste-pilot run
> (390 / 768 / 1440) and the `after-52b237ba` run. They are labelled with
> their source.

---

## 1. The direction: **Proof desk**

**One line:** *the operator's desk, where every change carries proof of where
it is.*

NabaPresence's job is not to look like a dashboard. Its job is to let someone
who answers for 30 Google listings say, without guessing, what is only saved
here, what waits for a person, what has left for Google, and what Google has
confirmed. The current app has the right ingredients: cool paper, an ink
ladder, one green accent, a charcoal bar for the action that reaches Google,
and words before colour. It also has a strong backend vocabulary
(`OPERATION_OUTCOMES` in `lib/contracts/mutation-operations.ts:35-44`). But it
says the same state in up to five words and five colours, and the "where is it"
answer is scattered across toasts, pills, timelines, activity drawers and a
separate *Review & publish* tab. (Section 6 and the mapping in §6.3 list 31
divergent places.)

Proof desk keeps the desk and adds one signature element: the change track
plus its status words.

### 1.1 Principles

1. **Proof before praise.** Nothing says *On Google* until Google confirms it
   by readback or by Google's own state. "Sent" is never drawn green.
   (Strengthens identity I29 and `lib/editors/outcome.ts:11-15`.)
2. **One vocabulary, one track.** Every change that can reach Google (a
   reply, an hours edit, a profile field, a post, a photo, a bulk child) uses
   the same 15 labels (§6). It also uses the same four-stop **change track**:
   *Saved here → Approved → Sent → On Google*. A step that does not apply says
   *Not needed* and is never silently ticked.
3. **Colour says who acts next.** Neutral means nobody needs to act. Amber
   means a person (an approver, the author, you). Blue means Google or our
   system is working. Green means confirmed on Google. Red means it broke.
   Status ink is reserved for this and is never decoration.
4. **Ink saves, green sends.** The green fill is spent on exactly one kind of
   button: an action that writes something to Google (*Publish*, *Approve and
   publish*, *Retry sending*). Reads such as *Check Google* are secondary
   buttons. Every other primary (*Save*,
   *Invite*, *Apply*, *Create client*) is an ink fill. This resolves the
   taste-pilot's primary-colour tension (§5) and makes the button colour
   itself answer "will this reach Google?".
5. **The dark bar dispatches.** One charcoal **dispatch bar** per screen
   carries the status of a Google-bound change and, when one is possible,
   its send action. Its primary is always `send`, or it has only secondaries
   such as *Withdraw* or *View on Google*. A local-only save bar is a surface
   bar (white, 1px line), never charcoal. (Identity I7, finishing taste
   fan-out 1B.)
6. **Scope is stated once.** Business, client or location is chosen in one
   place per size (§7.3) and echoed in every page header line. Page filters
   only narrow inside it. (Fixes audit RC-SCOPE.)
7. **States are drawn, chrome is ink.** The taste pilot's principles stand:
   disabled is drawn with roles and never with opacity, there is one focus
   halo, loading looks like the finished layout, empty is a sentence in a
   frame, and figures are type.
8. **Touch first, desk earned.** The mobile-first scale and the `desk`
   condition stand unchanged (`app/globals.css:91`, `:1098-1150`).

### 1.2 What it looks like

| Concept | Phone 390 | Tablet 834 | Desktop 1440 |
|---|---|---|---|
| 1. Inbox + review detail | `inbox-phone-list.webp`, `inbox-phone-detail.webp` (*Failed: retry*) | `inbox-tablet.webp` (*Blocked by checks*) | `inbox-desktop.webp` (*Waiting for your approval*, checks passed, AI draft) |
| 2. Listing editor (hours) + publish lifecycle | `listing-phone.webp` (*Awaiting approval*) | `listing-tablet.webp` (publish sheet, *Sent, waiting for Google*) | `listing-desktop.webp` (*Draft saved*, inline Changes panel) |
| 3. Data-heavy report | `report-phone.webp` | `report-tablet.webp` | `report-desktop.webp` (filters, KPI strip, chart with hover, table, pagination) |
| 4. Team / settings | `team-phone.webp` (invite sheet) | `team-tablet.webp` (Team in the two-pane settings), `settings-tablet.webp` (Reply policy, local save bar) | `team-desktop.webp` |
| Shell | `shell-phone-scope.webp`, `shell-phone-more.webp` | `shell-tablet.webp` (scope pill in top bar, notifications panel) | `shell-desktop.webp` (scope switcher open, design notes) |
| Vocabulary | — | — | `lifecycle-board.webp` (every label, pill, track and two dispatch bars) |

Every frame carries a "Concept · sample data" tag. Names, numbers and reviews
are invented sample data, not fixtures from any tenant.

---

## 2. What the current product gets right and wrong (grounding)

From the current captures (`concepts/current/`) and the five research reads
(token and gate reference, spec reconciliation, component and shell inventory,
lifecycle states, IA map):

**Keep (it works):**
- Calm cool paper, 1px lines and no shadows on cards (`app/globals.css:400-413,
  608-624`).
- Touch-first type with the `desk` step-down (`:642-666`, `:1098-1150`). It
  reads well at 390 and 1440.
- One destination registry feeding six surfaces
  (`lib/navigation/destinations.ts:88-187`).
- Status words always printed (`components/ui/status-pill.tsx:97-115`).
- The charcoal composer bar (`components/ui/action-bar.tsx:102`).
- Mail-style list rows (`components/ui/list-row.tsx`).
- The KPI strip (`components/ui/kpi-tile.tsx:310-358`).
- "Up, not history" back navigation (`lib/navigation/back-target.ts`).

**Fix (seen in the captures and the audits):**
- *Where is it?* has no single answer. A reply shows *Sent · waiting for
  Google's check* in the status line and *Reply published* in the timeline at
  the same time (`components/inbox/activity-timeline.tsx:29`). A bulk child
  says *Confirmed* with no confirmation
  (`components/bulk/bulk-operation-view.tsx:62,910`). The calendar says
  *Published* on `awaiting_confirmation` (`components/calendar/calendar-grid.tsx:42`).
  Full list in §6.3.
- `awaiting_approval` is drawn in five tones across surfaces (lifecycle
  report row 17), and "uncertain" has five words (row 18).
- Listing editors bury the publish step in a separate *Review & publish* tab
  that is the ninth of nine area tabs (`current/52b237ba-desktop-listings-loc-changes.webp`).
  The phone profile editor is one page about 14,900px tall
  (`after-52b237ba/mobile/listings-loc-profile.png`).
- Scope is shown three times (a top-bar switcher, a health chip *"1 client
  needs attention"* and a pinned client list), and set in three more places
  (Inbox filter, Reports client select, app-bar chip). See audit RC-SCOPE in
  `docs/audits/2026-10-15-ux-flows/findings.md`.
- Accent is spent on chrome: the tinted current-nav row with a 3px green bar
  and the green-tinted selected inbox row (`current/inbox-chromium-light-1440.webp`).
  A green *Publish* sits next to a green *Live on Google* pill, so green means
  both "action" and "done".
- Reports open with a 70–110px dead band and two disagreeing period facts
  (*1 Oct – 29 Oct* vs *As at 30 Oct*) (`current/reports-chromium-light-1440.webp`;
  taste audit 2C).

---

## 3. Alternatives considered

### A. "Quiet ink" (Notion-Mail monochrome): rejected
A near-black primary everywhere and no green except data. Chrome, actions and
status pills all neutral; the product looks like a mail client.
- *For:* it is the taste skill's default; it has the least chroma (the study
  median is about 3% coloured pixels); and it is a one-alias change
  (`--primary`).
- *Rejected because:* NabaPresence's core risk is a user believing something
  is on Google when it isn't. Removing the only colour that means "this goes
  to Google" removes the cue that matters most, and it would need a new
  non-colour device on every send button. The *ink saves, green sends* rule
  in the recommended direction gets the restraint (most primaries become ink)
  while keeping the cue.

### B. "Agency command centre" (dense multi-pane dashboard): rejected
A dark sidebar, a Home dashboard with tiles per client, a permanent
three-pane layout (clients | queue | detail), and compact density by default.
- *For:* agencies with 50+ listings, and it shows breadth at a glance.
- *Rejected because:*
  - It reintroduces a Home page that the work-first IA retired on evidence:
    the Inbox is the landing page (`next.config.ts:70-72`).
  - It makes the phone a second-class companion, which the mobile-first spec
    superseded.
  - It leans on tiles and tinted icons, which the taste pilot removed.
  - Three panes do not fit the 834px tablet (the content column is 762px
    after the rail).
  - What it is good at (breadth across clients) is covered more cheaply by the
    scope switcher's per-client health line and the proposed Outbox.

### Why Proof desk wins
- It changes the least where the product already works (tokens, type, shell
  geometry).
- It spends the redesign where users are actually confused: state, scope and
  the publish step.
- It gives the product one element no competitor's template has: the change
  track with honest words.

---

## 4. The seven questions

| Question | Where it is answered (all sizes) | Concept |
|---|---|---|
| **What needs my attention?** | Inbox is the landing page. Its queue tabs carry counts, and a non-zero *Failed* count is always shown with a red glyph (`components/inbox/queue-tabs.tsx:115-123`, kept). The nav row/tab badge shows the needs-reply count (neutral ink). **Outbox** (new, §7.1) shows failures across replies, listing changes, posts and bulk. The notifications panel groups *Failures*. The scope switcher's per-client line ("1 failed send", "1 needs attention") replaces the separate health chip. | `inbox-*`, `shell-*` |
| **Which business, client or location am I working on?** | One scope control per size. Desktop: *Working on* at the top of the sidebar. Tablet: a pill at the start of the top bar. Phone: the app-bar chip, which opens the *Working on* sheet. The control always shows the name plus health **words** ("9 listings · 1 needs attention"), so it never relies on the dot alone. On the phone chip, the words are in its accessible name and in the sheet. Report and list headers repeat the scope in their meta line ("Journey Hospitality · 4 Aug to 2 Nov"), and breadcrumbs carry it on desktop. Org-wide pages (Team, Settings, Notifications) show no scope control (kept `scoped:false` rule). | `shell-*`, `report-*` |
| **What can I do next?** | One primary per surface. When something can reach Google, it is the green button on the dispatch bar, whose status line says what is true now and what the button will do ("Approving publishes it to Google straight away"). A disabled primary always shows its reason in the bar ("Failed checks stop publishing"). | `inbox-desktop`, `inbox-tablet` |
| **What is saved locally?** | *Draft saved* (neutral, hard-drive glyph) on pills, track stop 1 *Saved here*, and the dispatch bar "2 changes saved here, not on Google". Edited fields carry an ink edge and "Was …". *Unsaved changes* (dashed circle) is reserved for edits that live only in the browser (`lib/editors/use-editor-draft.ts`, sessionStorage stash). | `listing-desktop`, `settings-tablet` |
| **What is awaiting approval?** | *Awaiting approval* (amber, user-check glyph) everywhere. For an approver who did **not** ask: *Waiting for your approval* with *Approve and publish* / *Send back*. For the requester: who can approve and *Withdraw*, never *Approve*. Two-person approval refuses self-approval (`lib/server/authz/approval-policy.ts`), and the concept shows Asha approving Sam's request. The Inbox *Approval* queue and the Outbox *Waiting for a person* group list them. | `inbox-desktop`, `listing-phone` |
| **What actually reached Google?** | Only *On Google* (green, badge-check), shown from `confirmed_applied`, reply `published`+`APPROVED`, post `LIVE`, or bulk `succeeded`+`confirmed`. *Sent, waiting for Google* (blue, hourglass) covers everything Google has accepted but not shown. The publish sheet explains the readback and when we check again. | `listing-tablet`, `lifecycle-board` |
| **What failed and how do I recover?** | *Failed: retry*, *Rejected by Google*, *Not confirmed: check Google* and *Blocked by checks* each have a recovery verb on the dispatch bar: *Retry sending* (unchanged approved text; after *Reconnect* when the cause was an expired login), *Edit and send again*, *Check Google* (a read, so a secondary button; it never re-sends blindly), *Edit reply*. A timeout is never shown as *Failed*: the backend classes it as `ambiguous` (`lib/server/google/transport.ts:452-455`, `lib/server/gbp-write.ts:644-651`), so it reads *Not confirmed: check Google*. Every failure says "Nothing changed on Google" when that is true, plus the attempt number and a support reference. Failures collect in Outbox and notifications. | `inbox-phone-detail`, `inbox-tablet`, `lifecycle-board` |

---

## 5. Decisions on the taste-pilot tensions

| Tension | Today (code) | Decision | Why |
|---|---|---|---|
| **Green filled primary** | `--primary: var(--np-accent)` (`app/globals.css:799`); the `default` button is green everywhere (`components/ui/button.tsx:82-83`), 161 uses in 94 files (taste audit) | **Change, scoped: ink saves, green sends.** The `default` variant becomes ink (`--primary: var(--np-ink)`, foreground `--np-ink-inverse`). A new `send` variant keeps the green fill for actions that write to Google. Green stays the focus ring, the brand mark, and the *On Google* status. | Green now means "this goes to Google" plus "it got there", one family of meaning. Most primaries become ink, which meets the taste default. Every send stays unmistakable. Mobile-first spec option B ("green only for Google") was deferred for its cost; a redesign is the moment to pay it. |
| **12px card radius** | `--np-radius-card: 12px`, panel 12, menu 14, modal 16, sheet 20, inset 28, control 8, tag 6 (`app/globals.css:592-604`) | **Change to the tight ladder:** tag 4, control/field 6, card/panel 8, menu/toast 10, modal 12, sheet 16, sheet-inset 24, pill 999. | 12/14/16 stack within 4px, so nesting has no rhythm. The tight ladder steps by 2px up to the modal, then widens for sheets. It suits a dense operations tool. It is one token block plus 5 literal radii (3 in `segmented-control.tsx`, plus `checkbox.tsx` and `chart.tsx`), see SYSTEM §0 and §7. |
| **Tinted nav row with a 3px bar** | Tint + accent ink + semibold + a 3px `bg-primary` bar (`components/app-shell/nav.tsx:51-58`); the More sheet and tab bar use different grammars | **Change: one "current place" grammar, neutral.** Current = `--np-fill` pill + ink + semibold label + a 2px heavier icon stroke, with no bar and no accent. The same grammar on the sidebar, rail, tab bar (pill behind the icon), More sheet, settings section list and scope menu. A selected list row uses the fill plus a 3px **ink** inset edge (already the inbox's grammar, `components/inbox/review-list.tsx:419-427`). | Frees green for "send/sent". The current place now reads the same in five surfaces. It reads in greyscale and forced colours, since the weight and the fill do not depend on hue. |
| **Sunken table header band** | `--np-table-header-bg: var(--np-surface-alt)` in 3 blocks (`app/globals.css:746, 958, 1089`); DiffView and ChartDataTable draw their own bands | **Change: no band.** Header on the surface, caption-size medium muted labels, a 1px `--np-line` rule below, sticky with the same surface. Group rows keep a quiet fill. | Taste found no band on 11 of 11 headed tables. ink-muted on surface measures 5.98:1 (taste audit), so contrast improves. "Sunken" stays reserved for wells and footers. |

---

## 6. Status vocabulary for the publishing lifecycle

### 6.1 Labels (exact, user-facing)

One label per state, used on pills, track stops, dispatch-bar status lines,
list rows, toasts (as titles) and notifications. Sentence case. A *state
label* never contains "published" or "live". The board is
`concepts/lifecycle-board.webp`.

| # | Key | Pill label | Long form (bar/toast title) | Tone (who acts next) | Glyph (lucide) | Track |
|---|---|---|---|---|---|---|
| 1 | `unsaved` | **Unsaved changes** | "N unsaved changes" | neutral | `circle-dashed` | — |
| 2 | `draft` | **Draft saved** | "Saved here, not on Google" / "N changes saved here, not on Google" | neutral | `hard-drive` | Saved here (current) |
| 3 | `blocked` | **Blocked by checks** | "Blocked: fix the reply to publish" | red | `octagon-x` | stop 2 failed |
| 0 | `needsReply` | **Needs reply** (queue label; rows in that queue carry no pill) | — | neutral | `message-circle` | — |
| 4 | `approval` | **Awaiting approval** | requester: "Awaiting approval · Priya or Sam can approve"; approver: "Waiting for your approval" | amber | `user-check` | Approved (current) |
| 5 | `changes` | **Sent back** | "Sent back by Priya: <note>" | amber | `undo-2` | Saved here (current) |
| 6 | `approved` | **Approved, ready to send** | "Approved by Priya. Publish when ready." | amber | `circle-check` | Sent (next) |
| 7 | `sending` | **Sending to Google** | "Sending to Google…" | blue | `send` | Sent (current) |
| 8 | `retrying` | **Will retry at HH:MM** | "Google is busy. We'll retry at HH:MM." | blue | `refresh-cw` | Sent (current) |
| 9 | `waiting` | **Sent, waiting for Google** | "Sent, waiting for Google to confirm" | blue | `hourglass` | Sent ✓, On Google (current) |
| 10 | `live` | **On Google** | "Confirmed on Google at HH:MM" | green | `badge-check` | all done |
| 11 | `uncertain` | **Not confirmed: check Google** | "We can't tell whether Google applied it" | amber | `circle-help` | Sent (current) |
| 12 | `rejected` | **Rejected by Google** | "Google refused it. Nothing changed on Google." | red | `ban` | Sent failed |
| 13 | `failed` | **Failed: retry** | "It didn't go through. Nothing changed on Google." | red | `triangle-alert` | Sent failed |
| 14 | `conflict` | **Changed on Google** | "Google changed this since you saved it" | amber | `git-compare` | — |
| 15 | `withdrawn` / `expired` / `replaced` | **Withdrawn** / **Expired, not sent** / **Replaced** | "Withdrawn. Nothing was sent to Google." | neutral | `circle-minus` | — |

**Track column:** the stop that is current, counting from 1: Saved here, Approved, Sent, On Google. "all done" means every stop is ticked, and only the reached *On Google* stop is green. Done stops are ink ticks, a failed stop shows the state's pill label in red, and a skipped approval says *Not needed* (SYSTEM §10). `needsReply` maps to `review.workflow_status = 'new'` (no draft yet; `lib/domain/workflow.ts:1-10`).

Queue and filter labels use the same words in plural. Inbox queues: *Needs
reply · Approval · Sending · Failed · Done · All* (the hidden `all` queue,
"All reviews", becomes visible as *All*; rename *Publishing* → *Sending*;
the query key `publishing` is unchanged, so `lib/contracts/review-values.ts:53-58`
deep links still work). Outbox groups: *Waiting for a person*, *With Google*,
*Failed*, *Confirmed today*.

Actions (buttons) use verbs and may say "publish": *Publish reply*, *Approve
and publish*, *Submit for approval*, *Send back*, *Withdraw*, *Review and
publish*, *Retry sending*, *Reconnect*, *Check Google* (read; secondary), *Edit and send again*. The pending
label for every send is *Sending…* (today *Publishing…*,
`lib/inbox/reply-state.ts:114-119`).

### 6.2 Mapping to the real backend states

| Key | Replies | Listing edits (profile, hours, menu, media) | Posts | Bulk child | Source |
|---|---|---|---|---|---|
| unsaved | composer dirty | `useEditorDraft` dirty; stash in sessionStorage `naba:draft:` | composer dirty | — | `lib/editors/use-editor-draft.ts:17-74`, `lib/api/draft-stash.ts:3` |
| draft | `review.workflow_status` `drafted` / `verified`; `review_reply.publish_status` `not_published` | outcome `saved_locally`; `profile_field_state.status` `core_dirty` (hours `unpublished`) | `gbp_local_post.status` `draft` | `previewed` (+ operation `previewed`) | `lib/domain/workflow.ts:1-10`; `supabase/migrations/0016_profile_management.sql:25-26`; `0015_local_posts.sql:17-22`; `0080` |
| blocked | newest draft `verification_status` / verdict `fail` (codes in `lib/domain/verification.ts:54-175`) | — | — | — | `lib/inbox/reply-state.ts:121-141` |
| approval | `workflow_status` + `publish_status` = `awaiting_approval` | `mutation_operation.state` `awaiting_approval` | `awaiting_approval` | operation `previewed` awaiting owner/admin | `lib/server/publishing/approval.ts:44-90`; `0094_listing_change_approval.sql:47-71`; `lib/server/authz/approval-policy.ts` |
| changes | `approval_decision.decision='rejected'` → `drafted` | `failed` + `error_code=approval_rejected` | `post_approval_decision` rejected | — | `lib/server/review-approval.ts:211-223`; `lib/server/listing-changes.ts:652-664` |
| approved | (approve publishes immediately) | approved, publish unlocked | approved | operation `approved` | `lib/server/listing-changes.ts`; `0080` |
| sending | `publish_requested`; attempt `started`/`accepted` | attempt `validating`/`publishing`; outcome `sent` while unsettled | `publishing` | `queued`/`running` | `0035_reply_state_machine.sql:29-41`; `0013:43-53`; `0016:62-74` |
| retrying | attempt `retryable` (+ `retryScheduledAt`, today never shown) | — | — | `queued` + `google_rate_limited` | `lib/server/publishing/attempt.ts:393-419` |
| waiting | `publish_status` `published` or `accepted` with `google_reply_state` `PENDING`/null | outcome `awaiting_confirmation` (`sent` once settled without readback) | `published` + `PROCESSING`; schedule occurrence from `awaiting_confirmation` | `succeeded` + `confirmation_state` `unrecorded` | `lib/server/publishing/settle.ts:94-118`; `lib/server/reviews.ts:536-542`; `lib/server/mutation-operations.ts:570-617`; `lib/domain/post-outcome.ts` |
| live | `published` + `APPROVED` | `confirmed_applied` (readback verified) | `published` + `LIVE` | `succeeded` + `confirmed` | `lib/contracts/mutation-operations.ts:15-33` ("the only state that may be called live") |
| uncertain | attempt `ambiguous` | outcome `uncertain` (attempt `ambiguous`, media `needs_resolution`) | `ambiguous` | `ambiguous` / `unresolved` | `lib/server/mutation-operations.ts:345,476-559` |
| rejected | `workflow_status` `rejected` / `google_reply_state` `REJECTED` | outcome `rejected` (Google 4xx) | `failed` + `REJECTED` + `google_post_rejected` | — | `lib/server/publishing/publish.ts:58-62`; `lib/server/mutation-operations.ts:579-595` |
| failed | `workflow_status` `failed`; attempt `failed` | outcome `failed` (incl. `google_readback_mismatch`, see §6.3 #22) | `failed` | `failed` | `settle.ts:140-148`; `lib/server/gbp-write.ts:1482-1489` |
| conflict | — | sync `google_dirty` / `conflict`; `*_snapshot_stale` codes | — | `conflict` | `lib/listings/health.ts:264-292`; `lib/errors/action-errors.ts:305-316` |
| withdrawn/expired/replaced | edit of a parked draft | `failed` + `approval_withdrawn` / `approval_superseded` / `approval_invalidated`; change set expiry | — | `cancelled` / `expired` / `skipped` | `lib/server/listing-changes.ts:452,502,656` |

`OUTCOME_PRESENTATION` (`lib/editors/outcome.ts:33-108`) stays the single
presentation map. It gains the keys that are not operation outcomes
(`unsaved`, `blocked`, `changes`, `approved`, `retrying`, `conflict`,
`withdrawn`) and loses its own label strings in favour of the table above.

### 6.3 Places that must change to honour the vocabulary

These come from the lifecycle research (31 rows, file:line in the research
notes). They are behaviour fixes for the implementation phases, not visual
choices:

1. The reply timeline says *Reply published* and the metadata *Published by*
   while Google is still `PENDING` (`components/inbox/activity-timeline.tsx:29`).
2. The approver's reject maps to *Sent back*, but the label is attached to
   Google's `rejected` (`lib/inbox/reply-state.ts:404-406`). Split the two.
3. The *Reply ready* toast fires even for a `fail` or `pending` verdict
   (`components/inbox/reply-composer.tsx:383-388`). Its title must follow the
   verdict.
4. Bulk *Confirmed* shows without confirmation (`bulk-operation-view.tsx:62,509,910`),
   including for *Submitted for approval*. Read `confirmationState`.
5. The calendar *Published* on `awaiting_confirmation` (`calendar-grid.tsx:42`;
   `0118:146`) must say *Sent, waiting for Google*.
6. Post *Check Google* says "live" whenever `status==="published"`
   (`posts-action-bar.tsx:104`).
7. The post filter "On Google" includes `publishing` (`lib/locations/post-display.ts:107`).
8. `awaiting_approval` uses five tones; it must use one (amber).
9. "Uncertain" has five words; it must use *Not confirmed: check Google*.
10. `publishOutcome` claims `confirmed_applied` when every step was a no-op
    (`lib/editors/use-publish-flow.ts:140-149`). It must say *Nothing to send.
    Already matches Google*.
11. A `retryable` attempt shows *Publishing reply* forever. Show *Will retry
    at HH:MM* from `retryScheduledAt` (this needs the API field; see the
    all-flows audit p5-F04).
12. The connection status `error` renders a raw token
    (`components/settings/connection-card.tsx:79-81`).
13. Raw field masks such as "To change regularHours"
    (`components/locations/listing-change-requests.tsx:123-125`). Use
    `activityMaskLabel`.
14. A readback mismatch after a 2xx settles as `failed`
    (`gbp-write.ts:1482-1489`). Google may be holding it for review, so
    present it as *Not confirmed: check Google* until a later readback
    decides. **Backend decision; confirm with the owner.**

---

## 7. Information architecture

### 7.1 Primary navigation per mode and role

The registry stays `lib/navigation/destinations.ts`. Changes: add **Outbox**,
rename the agency Reports description, and keep Team and Settings under
"Workspace".

| Position | Agency (owner/admin) | Agency (member) | Agency (viewer) | Business (owner/admin) | Business (member/viewer) |
|---|---|---|---|---|---|
| 1 | Inbox | Inbox | Inbox | Inbox | Inbox |
| 2 | Listings | Listings | Listings | Listings | Listings |
| 3 | Clients | Clients | Clients | Calendar* | Calendar* |
| 4 | Calendar* | Calendar* | Calendar* | Reports | Reports |
| 5 | Reports | Reports | Reports | **Outbox** | **Outbox** (member) |
| 6 | **Outbox** | **Outbox** | — | — | — |
| Workspace | Team, Settings | Settings | Settings | Team, Settings | Settings |

\* Calendar only with `post_scheduling` (kept rule).

Viewers never see Outbox: they cannot send, so it would always be empty for
them. Notifications stays in the top bar (bell) from md, and in More on
phones.

**Outbox (new, proposal):** a cross-scope list of everything that is not
simply *Draft saved* or *On Google* (more than a day old). Group 1, *Waiting
for a person*: approval, sent back, approved. Group 2, *With Google*:
sending, will retry, waiting, not confirmed. Group 3, *Failed*: rejected,
failed. Group 4, *Confirmed today*. Each row: the object (reply to X / hours
for Y / post Z / bulk change), its listing and client, the status pill, its
age and the recovery verb.
- **Dependency:** the server has these states in `review`,
  `mutation_operation`, `gbp_local_post` and `bulk_listing_child`, but no
  single read model. Phase C should decide between a union API (reuses
  existing reads, scoped by grants) and starting with replies + listing
  changes only.
- If the owner rejects Outbox, the fallback is a *Failures* filter in
  notifications plus the Inbox *Failed* queue (today's behaviour), with the
  same vocabulary. This is **Decision to confirm D2**.

### 7.2 Phone tab bar vs tablet rail vs desktop sidebar

| Width | Navigation | Header | Notes |
|---|---|---|---|
| < 48rem (phone) | **Tab bar**: 4 destinations + More (agency: Inbox, Listings, Clients, Reports; business: Inbox, Listings, Calendar or Notifications, Reports). The current tab shows an ink icon on a `--np-fill` pill. | **App bar** 52px: scope chip (top level) or "‹ Parent" back link (deep); search; bell | The More sheet holds Outbox, Calendar (agency), Notifications, Team, Settings, then the account block and theme. Only one bottom bar at a time (kept chrome contract, `app/globals.css:1215-1245`). |
| 48rem – 73.75rem (tablet, small laptop) | **Rail** 72px with labelled tiles | **Top bar** 56px: scope pill first, then back link, search icon (field from 64rem), bell | Account at the foot of the rail. |
| ≥ 73.75rem (`wide`) | **Sidebar** 240px: brand + org, *Working on* scope button, primary nav, Workspace group, account at the foot | **Top bar**: breadcrumbs, search field (⌘K), bell | Pinned clients under Clients are **removed**: the scope menu lists clients with health, and pinning duplicated it. |

### 7.3 Where scope lives

- **One control per size.** Sidebar *Working on* button (desktop), top-bar
  pill (tablet), app-bar chip (phone). All three open the same model
  (`components/app-shell/scope-sheet-model.tsx`): a menu (≤ 8 rows) or a
  searchable list on desk, and the *Working on* sheet on phone (rows with
  health words; a chevron pushes to a client's listings).
- **The health chip folds in.** `ContextHealthChip`'s words move to the scope
  control's sub-line (dot + "1 needs attention"). The separate chip is
  retired; the announcer for live changes stays.
- **No page-level scope controls.** The Reports *Client* select and the Inbox
  Filters *Client* field are removed. A page may offer a **listing** filter
  inside the scope ("All 9 listings"), which is a filter, not a scope
  (`?locationId` comma list semantics unchanged). Deep links `?clientId=` keep
  working: the address still wins (`lib/clients/scope.ts`).
- **Business mode:** the control reads the business name with "All locations"
  or one location. Never "client".

### 7.4 Back navigation and split views

- Keep "up, not history" (`lib/navigation/back-target.ts`). Phone: "‹ Parent"
  in the app bar. Tablet: a back link in the top bar. Desktop: breadcrumbs
  (fold to first … last above 3 crumbs, `lib/ui/breadcrumb-trail.ts:154-161`).
- **Inbox split:** list + detail from `lg` (64rem), whatever the height; the
  panes lock and scroll internally when the viewport is also at least 620px
  tall (kept, `components/inbox/inbox-view.tsx:1218`). Below that, the detail replaces the list with "‹ Inbox". List width
  stays `clamp(18.75rem, 40%, 30rem)` (`lib/inbox/layout.ts:11-13`).
- **Listing editor:** the publish step becomes part of each editor.
  - From `wide`, the **Changes panel** (340px) sits beside the form: what
    changed, the track, and recent sends from this listing.
  - Below `wide`, the same content opens as a sheet from the dispatch bar's
    *Review and publish* (right panel on tablet, full sheet on phone).
  - The *Review & publish* area route (`/listings/[id]/changes`) stays for
    deep links and multi-area publishing. In the tabs it is replaced by a
    count badge on each edited area.
- **Listing area tabs:** at most 6 visible (Overview, Business profile,
  Opening hours, Photos, Posts, Food menu) + *More* (`TabNav overflow="more"`,
  `components/ui/tabs.tsx:737-750`). On a phone the profile editor becomes a
  **section index**: a list of sections with "Edited" markers, each pushing
  to its own screen, instead of one 15,000px page.
- **Settings:** from md, a two-pane layout (section list 230px + content); on
  phone, the existing index → section push (`app/(dashboard)/settings/page.tsx`).
  Team stays its own route `/team` and destination, and also appears in the
  settings section list (it already does as `indexOnly`,
  `lib/settings/areas.ts:45-124`).
- **Quick look** on Clients and Listings rows from `lg` stays
  (`components/ui/quick-look-panel.tsx`).

---

## 8. Reconciling the historical specs

Precedence (newest wins): taste pilot 2026-10-29 → mobile-first 2026-10-13
(+ D1 sans) → mobile interaction infra → operator's-desk identity 2026-09-23
→ work-first IA → agency UX → visual identity (superseded).

| Rule | Source | Verdict here |
|---|---|---|
| Cool paper, 1px line cards, no gradients/blur/tints | identity I1–I2 | **Survives** |
| One green accent on action, focus, *current nav item and selected row* | identity I3 | **Revised:** green on send-actions, focus, brand and *On Google*; current place and selection are neutral (§5) |
| Serif titles and review text | identity I4 | **Retired** (D1 sans stands) |
| Mono for figures, counts, timestamps | identity I5 vs D1 | **Revised:** mono only for IDs, codes and reference numbers. Figures and counts are sans `tabular-nums`, so CountBadge and numeric table cells drop `font-mono`. |
| Status = word + tone, never colour alone | identity I6 | **Survives**, extended with a glyph per tone family |
| One dark action bar per screen | identity I7 | **Survives** as the *dispatch bar*; local saves use the surface bar |
| Controls 36 / 44 coarse | identity I9, I16 | **Retired** wording; touch-first 44 / desk 36 stands (mobile-first M11) |
| Rail 64px | identity I17 | **Retired**: 72px (mobile-first M12) |
| Dark charcoal near-white | identity I19 | **Retired**: charcoal stays dark in dark theme (D4) |
| Display role for empty-state titles | identity I21 | **Retired**: empty title = `title` role (taste P4) |
| Sheet drawer nav on phone | identity I22, agency A5 | **Retired**: tab bar |
| Current nav = tint + 3px bar | identity I23 | **Retired** (§5) |
| Google words gated on evidence | identity I29 | **Survives**, rewritten as §6 |
| Motion: one ease-out, 140/260/360ms, no springs, reduced motion collapse | identity I30–I33 | **Survives**; entrance keyframes are deleted (taste P7) |
| Drawn disabled, one focus halo, flat skeletons, empty sentence, KPI strip, 140ms feedback | taste T1–T7 | **Survives** (finish the fan-out) |
| Invalid + focus "accent halo over a red edge" | taste T2 | **Revised** to the code: rings in danger (`--np-focus-halo-danger`) |
| Touch first, desk earned; type scale; chrome sizes; safe areas; z layers; breakpoints sm/md/lg/wide/xl | mobile-first M2–M17 | **Survives** |
| Tabs per mode; More contents | mobile-first M19–M20 | **Revised**: Outbox joins (§7.1) |
| Four nav items; More disclosure; Today strip; client chips solid accent | work-first W1, W3, W4, W7 | **Retired** |
| Inbox is the landing page; fixed redirects | work-first W2, W6 | **Survives** |
| Up to 6 pinned clients with health dots | agency A3 | **Retired**: the scope menu carries health |
| Density toggle | agency A8 | **Retired**: compact is per-component under `desk` only |
| One `main`, h1→h2→h3, reasons as text, no internal vocabulary in copy | agency A9 | **Survives**. Provider error codes are shown only as a secondary "Error reference" line. |
| Four token layers; no literal below layer 1; contrast gate | visual-identity V1–V6 | **Survives** |

---

## 9. Decisions to confirm (owner)

| # | Decision taken by default | Options | Why this default |
|---|---|---|---|
| D1 | **Ink saves, green sends** (green fill only on Google-bound actions) | (a) as proposed; (b) keep green on every primary (pilot "Kept"); (c) near-black everywhere (Alternative A) | Makes the button colour answer "does this reach Google?" and removes green-on-chrome |
| D2 | **Add Outbox** as a primary destination (not for viewers) | (a) Outbox; (b) no new route: a *Failures* filter in notifications + the Inbox *Failed* queue | Questions 5–7 need one place across replies, listings, posts and bulk; needs a read-model decision in phase C |
| D3 | **Tight radius ladder** (card 8, control 6, tag 4, modal 12, sheet 16) | (a) tight; (b) keep 12; (c) soft (16/12/999) | Clear nesting rhythm; suits an operations tool |
| D4 | **Neutral current-place grammar** (fill + weight, no bar) | (a) neutral; (b) keep tint + 3px bar | Frees the accent; one grammar on five surfaces |
| D5 | **No table header band** | (a) flat; (b) keep the band | Taste evidence; better contrast |
| D6 | **"On Google"** replaces "Live on Google" as the confirmed label; titles "Confirmed on Google" | (a) "On Google"; (b) keep "Live on Google" (no test churn) | Pairs with "Sent to Google"; fits phone pills. About 49 test assertions pin the old words |
| D7 | Inbox queue **"Publishing" → "Sending"** (query key unchanged) | (a) rename; (b) keep | "Publishing" reads as done; the queue holds sends in flight |
| D8 | **Health chip folded into the scope control**; pinned clients removed | (a) fold; (b) keep both | One scope place; fixes RC-SCOPE |
| D9 | Profile editor on phone becomes a **section index** | (a) index + push; (b) keep one long page with sticky section tabs | 14,900px page today |
| D10 | Readback mismatch shown as **Not confirmed** rather than Failed | (a) not confirmed; (b) keep failed | Google may hold edits for review; "failed" may be false. Backend owner call |
| D11 | Figures and counts **sans tabular**, mono only for IDs and codes | (a) sans; (b) mono figures | D1 already says so; the code is mixed |
| D12 | **Back links in ink**, not accent green | (a) ink; (b) keep accent-ink | Back links are chrome; green is for sends |
| D13 | Inbox shows an **All** queue tab | (a) show *All*; (b) keep it hidden | Lets a phone user see every state in one list; the `all` key already exists |
| D14 | Charcoal bar allowed **without** a send primary when its subject is a Google-bound change (*Withdraw*, *View on Google*) | (a) as proposed; (b) charcoal only with a send primary | Keeps "where is it" in one place for requesters and after confirmation |
