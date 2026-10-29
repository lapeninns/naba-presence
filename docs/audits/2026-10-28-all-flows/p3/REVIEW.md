# Independent review: p3 Listings core (`ux/flows-presence-p3`)

Reviewed in `/tmp/naba-presence-p3`, `origin/ux/all-flows-presence...HEAD` (head `0d3a4852`).
I reviewed each commit except `10316667` (prettier only): c51888cc board, 32f2551b overview,
1d76b8b3 profile, db5bb217 hours, b63c4ce7 menu, 23312a3d people, 62552502 booking,
c446412a e2e copy, 0d3a4852 service-area link.

Checks run (read-only):

- `pnpm exec tsc --noEmit` exited 0 with no output.
- `pnpm exec eslint --max-warnings 0 <every changed .ts/.tsx>` exited 0.
- `pnpm exec vitest run` on the 26 changed or related test files: 26 files and 442 tests passed.
- Not run: Playwright/e2e and dev servers (not allowed by the brief).

No P0 found. Nothing invalid reaches a preview/publish request, and the review → approve →
consented-send chain, idempotency, locks and server checks are unchanged.

## Findings

### P1

**P1-1 "Keep Google’s hours" can silently overwrite edits made while Google is being read**
`components/locations/hours-tab.tsx:462-466` (button at `:560`, editor stays enabled at `:606`)

- The `isDirty` guard ("Save or discard your edits first") is only checked when the page renders.
  After the click, `keepGoogle()` waits on `refresh.mutateAsync()`, a live Google read that can take
  seconds. Then it calls `setDraft(structuredClone(fresh.google))` without a condition.
- `HoursEditor` is only disabled by `disabled`, not by `keepingGoogle`. A day sheet or special day
  edited during that wait is replaced without a word. The toast then says "Google’s hours are in your
  draft".
- Scenario: the draft is clean and the status is `google_dirty`. The user clicks Keep Google’s hours,
  opens Monday and changes 17:00 → 18:00. The read resolves, the Monday edit is gone and nothing
  says so. This breaks rule 6 (no silent loss of unsaved input).
- Fix (any one of these):
  - Snapshot the draft at the click and apply it as `setDraft(cur => cur === snapshot ? clone(fresh.google) : cur)`.
    If the draft changed, show "Your edits were kept; Google’s hours were not applied".
  - Or disable `HoursEditor` (and Discard) while `keepingGoogle`.
  - Or re-check a `dirtyRef` after the await.

### P2

**P2-1 A scoped lifecycle preview failure no longer flags an already-open review the server will refuse**
`components/locations/administration/use-lifecycle.ts:141` (callers `danger-zone.tsx:184,197`)

- `run(..., { scoped: true })` rethrows before `setBlock(blockFor(code))` for every
  `safePreflightCodes` code. That is right for request-specific refusals (`destination_*`,
  `deletion_eligibility_unproven`).
- It is wrong for refusals that apply to the whole connection or source account:
  `google_target_changed`, `google_connection_changed`, `google_reconnect_required`,
  `source_access_unknown`, `source_membership_unproven`, `source_ownership_required`,
  `publish_not_allowed`, `google_writes_paused`. These apply equally to the open review.
- Scenario: a deletion review R1 is open and approvable. The owner opens Transfer and gets
  `google_target_changed` (the credentials or binding changed). The dialog explains the problem,
  but R1 still shows enabled Approve/Send. The server refuses on approve/send (`assertLifecycleCurrent`),
  so nothing unsafe is sent. Still, the UI offers an action the server will refuse as if it would
  work (rule 3). Before this branch, R1 was marked blocked.
- Fix:
  - In scoped mode, still call `setBlock(blockFor(code))` (without `setError`) when a review is open
    and the code is not request-specific.
  - Or split `safePreflightCodes` into `requestScopedCodes` (destination_* and the deletion
    eligibility codes) and the rest, and only skip the block for the first set.

**P2-2 New "Remove from NabaPresence" button in the ended alert leads to a page that can only disconnect the whole Google login**
`components/locations/administration/administration-tab.tsx:302`

- After a confirmed deletion or transfer, the destructive alert now offers an outline button
  "Remove from NabaPresence" → `/settings/connections`.
- That page has no per-listing unlink (I searched: no unlink UI or API client exists). Its only
  destructive action is "Disconnect {email}?", which unlinks every listing on that login
  (`components/settings/connection-card.tsx:280-305`).
- The danger-zone row already says "Unlink this app location under Connections". That copy existed
  before, but the branch promotes it to a primary action that names a per-listing outcome.
- Scenario: an owner clicks it expecting to remove this one listing, then disconnects the login
  and loses publishing for every sibling listing.
- Fix: relabel to "Check Google connections", matching the existing link at `:138`. Or drop the
  button until a per-listing unlink exists, and say plainly that removing the listing means
  disconnecting the login.

### P3

**P3-1 "Show N matches" (and "Clear filters") drops focus to `<body>`**
`components/listings/listings-board.tsx:937-941, 1294`

- Both buttons sit in the "No listings match" Empty, which unmounts once the filters change.
- Unlike "Clear selection" and "Check again", there is no focus return, so a keyboard or screen
  reader user ends up on `<body>` (rule 7).
- The count itself is correct: `rows.filter(matchesSearch)` ignores health and client, and
  `showAllMatches` clears exactly those two and keeps `q`. So the board then shows exactly
  `searchMatches` rows.
- Fix: after the state change, in `requestAnimationFrame`, focus the search input, else `#main`.

**P3-2 Keep Google’s hours: the toast claims a change that may not have happened, and an empty fresh read empties the draft**
`components/locations/hours-tab.tsx:466-471`

- The note's action only appears when `hours.google` is non-empty, but the fresh read is not
  checked. If Google removed the hours in the meantime, the draft becomes an empty schedule.
- If Google reverted to match the saved schedule, the draft does not change. Either way the toast
  still says "Google’s hours are in your draft … Save here".
- Fix:
  - If `isEmptySchedule(fresh.google)`, keep the draft and show the google-empty note.
  - If `fresh.status !== "google_dirty"`, say "Google now matches the saved hours".

**P3-3 Hours footer for a clean Google-side change reads "Changed on Google · saved here"**
`components/locations/hours-tab.tsx:496-504` with `components/editors/editor-footer.tsx:184`

- When the draft is clean and the status is `google_dirty`: `changeCount` is now `undefined`, so
  the headline is "Changed on Google". Then `where` falls to `onSave && isDirty` → "saved here".
- The difference is Google’s, not something saved here. The `isDirty`/`changeCount` change is
  otherwise right:
  - edits that already match Google now offer Save here instead of a Review that would send nothing;
  - drift that is already saved here still offers Review.
- Fix: pass a `where` override (or `localEdits` / `savedHere` flags) so `google_dirty` with no
  local edits shows no suffix.

**P3-4 The same Google-check failure is announced twice**
`components/listings/area-frame.tsx:310` (new) and `:702` (existing)

- `GoogleFreshnessFailure` renders `role="status"`. It is now drawn in the AreaInfo popover as
  well as the header line, so one failed "Check Google now" is two polite announcements.
- Fix: render it in the popover only while the popover is open, and hide the header copy then.
  Or give one of the two copies no live role.

**P3-5 The "Additional address details" summary link always goes to the language field**
`components/locations/profile/profile-editor.tsx:951`

- `fieldErrorsFromPayload` reports `addressDetails` for `languageCode`, `organization`,
  `recipients` and `sortingCode`. The summary now always focuses `profile-address-language`, so a
  bad organisation or recipient sends the user to the wrong control.
- Fix: carry the failing sub-path (`issue.path[1]`) into the issue and map it to that control's id.

**P3-6 (pre-existing, not a regression) The booking editor is offered to a member with a publish grant, but the server refuses**
`components/locations/booking-tab.tsx:157-162` and `lib/server/place-action-review-state.ts:19`

- `bookingViewOnly` is only true when `!canEditCanonical && writeReason`. A member with
  `canPublish` gets `booking: available` from `buildResources`, but the place-action server requires
  owner/admin and returns `publish_not_allowed`.
- The branch's comment ("A member who can publish keeps the full editor, as the capabilities say")
  documents this mismatch rather than causing it. No role loses a working path through this branch.
- Fix (separate PR): make `buildResources` mark `booking` `blocked`/`publish_not_allowed` for
  non-managerial roles, or treat `!canEditCanonical` alone as view-only for booking.

## Verified OK (protected rules checked)

1. **Contracts, actions and payloads (rule 1).**
   - No changes under `lib/contracts/*`, `lib/server/*`, `app/api/*`, migrations, `package.json`
     or the lockfile (`git diff --stat`). `lib/editors/gate.ts` only gains copy.
   - Query keys and invalidations are unchanged.
   - `use-place-action-review.ts` is reformatted plus `bookingLinkMessage()` for display. The
     `preflight` list, claim/unsafe refs, `send` guard and stale handling are identical.
2. **Profile Review stays enabled on invalid fields; nothing invalid is ever sent (rules 1, 2).**
   - `review()` returns early when `check()` sees `issues.blocking`. `blocking` is true if any of
     these is non-empty: the summary list, `listingIssues`, `unplacedListingIssue`, `attributeErrors`.
   - Every `PayloadFieldKey` is listed: 9 directly and 4 through `MIRRORED_PAYLOAD_FIELDS`.
   - `prepareReview` still calls `businessInformationPayloadSchema.parse` and
     `googleAttributeWriteSchema.parse`, so a stale closure would throw before any request.
   - Component tests assert `previews(fetcher)).toHaveLength(0)` for both cases.
   - Two-person gating and the `reviewFingerprint` stale check (`publishDisabledReason`) are
     unchanged apart from copy.
   - The e2e edits only flip `toBeDisabled` → `toBeEnabled`. No send assertion was removed.
3. **Hours (rules 2, 4, 5).**
   - Keep Google’s hours only fills the draft, and only from a clean draft. Saving still goes
     through the revision-checked `saveHours`.
   - Publish still runs save → re-read → stale check → `publishHours` with an `intentId`, hashes
     and `confirmOverwriteGoogleChanges`.
   - The footer's `isDirty={rows.length>0}` cannot hide Save here or Discard: `canDiscard={isDirty}`,
     and `canSave` keys on local edits.
   - "Close on {next day}" is an explicit button, never applied automatically.
4. **Booking read view (rule 3).** `bookingViewOnly` requires `writeReason`. In the base branch
   `disabled = writeReason !== null` already greyed out the add form and row actions for exactly
   those users, so no permitted role loses a working control. Owners and admins held back only by
   a pause keep the disabled form and the banner.
5. **Lifecycle bare account ID → `accounts/…` (rules 1, 6).**
   - `destinationAccountName` only adds the prefix to a match of `^[A-Za-z0-9_-]+$`. The result is
     still checked against `googleAccountNameSchema` before `preview`, and the payload shape is
     unchanged.
   - The new `NOTHING_SAVED` copy is accurate for the listed codes: `requireEligibility` runs before
     `saveGbpChangeSet` in `previewLifecycle`.
   - The typed-name and consent gates on the approved review (`LifecycleReview`) are untouched.
   - `sendPaused` keeps the same conditions as the old `!canPublish || accessBlocked` (it now also
     disables while capabilities load).
6. **People page order and Danger zone gates (rule 3).**
   - `after` is wrapped in the same `AdministrationProvider` with the same composed `publishReason`
     (access busy, unresolved or roster stale) and `section.disabled`. So `writeBlocked` and
     `blocked` for Transfer and Request deletion behave exactly as before.
   - It stays inside the access `Context.Provider` and the outer `LifecycleWorkspace`.
   - `#lifecycle-saved-work` exists whenever `ended` can be set (both need `visible`).
7. **Menu (rule 6).**
   - `noMenu = sections===0 && !isDirty` keeps the editor, Undo and footer after the last section
     goes, and the description warns that publishing would leave Google with no menu.
   - The remove dialog is keyed, so it survives the switch to the "Build your first menu" view and
     focus returns to "Undo removal".
   - An empty dirty draft was already reviewable in the base branch, so no new publish path.
8. **Board.** "Show N matches" counts and resets correctly (see P3-1 for focus).
   - The quick look uses `areaState` (the overview's words).
   - "Not checked" is suppressed when the summaries failed.
   - The cap-disabled row checkbox is described by the bar's count.
   - `AddListingsLink clientId` is only set for a client the session can see.
   - Bulk selection and preview logic are untouched.
9. **Overview.**
   - Reconnect Google is still owner/admin only (`canManage` = `canManageConsoles`).
   - The phone `ReviewPublishLink` uses the same `canReviewChanges(caps)` gate.
   - Area cards show "View" only for `canEditCanonical === false` (owners and admins under a pause
     keep "Review").
   - The failed-publish alert is `live={false}`, and the new alerts default to polite.
10. **Accessibility (rule 7).**
    - Visible "Opens", "Closes" and "Closing day" labels are contained in the existing accessible
      names.
    - The description counter is no longer live on every keystroke; only crossing the limit is a
      polite status.
    - The attribute errors are tied with `aria-describedby` and `aria-invalid`.
    - Removing a period focuses the previous one; the split and add buttons focus the new period.
    - Clear selection and Check again return focus.
    - No assertive regions on load were added.
