# p4-F03 — Delete a photo (/listings/[id]/photos)

Worktree `/tmp/naba-presence-p4` (`e4123d25`), read 28 Oct 2026. All paths are relative to the repo. This is a read-only mapping: nothing was run, rendered or tested. Untested behaviour is marked **Hypothesis**.

## 1. Start and end

- **Start:** the gallery at `/listings/{id}/photos` (`app/(dashboard)/listings/[id]/photos/page.tsx:25-44` → `PhotosTab` → `PhotosLibrary` → `PhotosGrid`). There are two entry points into one shared dialog:
  - **A, tile:** the bin icon under a business tile. Its accessible name is "Delete {Category} {photo}" and its tooltip says "Delete from Google" (`components/locations/photos/media-card.tsx:203-219`). It sets `deleteTarget` (`photos-grid.tsx:109`).
  - **B, lightbox:** **Delete from Google** (`danger-outline`) in `PhotoPreview` (`photo-preview.tsx:212-221`). The grid **closes the lightbox first** (`setPreviewId(null)`), then opens the dialog (`photos-grid.tsx:133-136`).
- **The dialog:** `DeletePhotoDialog`, an `AlertDialog` that is open while `item !== null` (`delete-photo-dialog.tsx:70-123`). It owns the mutation.
- **End (success):** the server confirms, the dialog closes (`onSuccess: onClose`, `:62`), a toast appears and the library is re-read from Google (`invalidate: onDeleted` → `refreshFromGoogle`, `photos-library.tsx:71-90,141`). The tile goes away when that refetch lands.
- **End (other):** "Keep the photo" closes with no change. A two-person-mode park closes with an info toast (`:63`). An error leaves the dialog open.

## 2. Roles and gates

- **Client lock:** `writeReason` = `publishReason` (`photos-tab.tsx:66-73`; `lib/locations/gating.ts:83-102`). It disables the bin (`media-card.tsx:211`) and the lightbox Delete (`photo-preview.tsx:215`), and the frame shows the banner "You can look, but not change these photos" (`photos-library.tsx:98-103`).
- **Customer photos:** they have no delete control at all. The tile shows "Shared by a customer" (`media-card.tsx:146-147`). The lightbox note says "Customer photos can’t be moved, deleted or used as your logo. If one breaks Google’s rules, report it on Google Maps." (`photo-preview.tsx:83-84`).
- **Server (protected):** `DELETE app/api/locations/[id]/media/[mediaId]/route.ts:34-47` with `mfa: "step_up"`, through `submitListingChange("media_delete")` (`lib/server/listing-change-registry.ts:175-191`). That leads to `removeMedia` (`lib/server/media.ts:1529-1566`), then `mutableMediaItem` (`:565-583`), then `linkedForWrite` and `requireMediaWrite`: the pause switch plus `requirePublishGrant` → `publish_not_allowed` (`:518-536`). Next, `storedMerchantMedia` returns 404 `media_not_found` or 409 `customer_media_read_only` (`:546-562`). The hash is checked twice, against the DB (`:578-580`) and live against Google (`requireFreshGoogleMedia`, `:586-604`), and either can answer 409 `media_stale`. The body must carry `confirmation: "delete_google_media"` (`lib/contracts/location-media.ts:110-113`; set by the client at `lib/api/location-media.ts:122-128`). The gate chain is pinned in `tests/route-authorization-contract.test.ts:113-120`.
- **Step-up MFA:** a 403 `mfa_step_up_required` raises the shell prompt. The delete is **not replayed**, so the person taps Delete again (`components/auth/mfa-step-up-prompt.tsx:48-58`).
- **Two-person mode:** the write can come back as 202 `listing_change_awaiting_approval`, handled as parked (`use-resource-mutation.ts:171-181`). The toast says "Sent for approval. Another publisher needs to approve this change before it goes to Google." (`lib/errors/action-errors.ts:52-53`).

## 3. Baseline steps (tap count)

- **A, from a tile (2 taps):** bin (1) → the dialog opens with focus on the first tabbable, "Keep the photo" (Base UI default; it is first in source order) → **Delete from Google** (2) → the button shows a spinner and "Deleting from Google…" → the dialog closes and the toast appears.
- **B, from the lightbox (3 taps):** tile (1) → **Delete from Google** in the lightbox (2) → the lightbox disappears and the alert opens → **Delete from Google** (3).
- **Step-up MFA adds about 3 actions:** enter the password and code, Verify, then press Delete again. The alert stays open behind the prompt (**Hypothesis**: the stacking is untested).
- **Phone:** the alert is a bottom card with the buttons stacked full width, and the danger answer is last, nearest the thumb (`components/ui/alert-dialog.tsx:35-42,102-107`). It never closes on an outside press.

## 4. States

| State                                               | Where                                                                  | Exact copy / behaviour                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Confirm                                             | `delete-photo-dialog.tsx:77-120`                                       | Title "Delete this photo from Google?". Body "This removes it from the Google Business Profile straight away, so customers stop seeing it on Search and Maps. NabaPresence shows Google’s library, so there is no way to remove it here only. It can’t be undone." A 4:3 thumbnail (`alt=""`) beside "{Category} {photo}" / "Added {date}". Buttons: ghost "Keep the photo", danger "Delete from Google".                |
| In progress                                         | `:113-117`, `:72-74`; `components/ui/button.tsx:272-274`               | The danger button shows a spinner and "Deleting from Google…", with `aria-busy` and focus kept. Esc and Close are swallowed while pending (`!remove.isPending`), but **"Keep the photo" still looks enabled and does nothing**.                                                                                                                                                                                          |
| Error (failed / rejected / stale / permission)      | `use-resource-mutation.ts:163-195`                                     | The dialog **stays open** and the button is active again. The only feedback is a toast from `describeActionError`, for example "This item changed on Google since you loaded it. Refresh and try again." (`action-errors.ts:336-337`), "You do not have permission to publish to Google for this location." (`:93-94`), or "Customer photos cannot be changed here." (`:345`). Nothing inside the dialog says it failed. |
| Uncertain (timeout, 5xx, `media_needs_resolution`…) | `action-errors.ts:710-721,784-801`; `use-resource-mutation.ts:184-188` | Same UI as an error. Pressing Delete again **reuses the intent id**, so the server answers from its receipt and does not delete twice. The UI never says this.                                                                                                                                                                                                                                                           |
| Retry                                               | `:117`                                                                 | Same button, same label. No "Try again" wording.                                                                                                                                                                                                                                                                                                                                                                         |
| Success, confirmed                                  | `:52-61`; `lib/editors/outcome.ts:146-162`                             | Success toast "Photo deleted from Google", with **no description**, because a custom title suppresses the default one.                                                                                                                                                                                                                                                                                                   |
| Success, sent but not confirmed                     | same                                                                   | Info toast "Delete sent to Google", with no description and no next step.                                                                                                                                                                                                                                                                                                                                                |
| Parked (two-person mode)                            | `:63`; `use-resource-mutation.ts:171-181`                              | The dialog closes. Info toast "Sent for approval. Another publisher needs…". `onDeleted` is not called (`tests/components/listing-change-requests.test.tsx:219-259`).                                                                                                                                                                                                                                                    |
| After success, before the refetch                   | `use-resource-mutation.ts:103-105,151-153`                             | `isPending` clears before the refetch lands, so the deleted tile **stays visible** under the "deleted" toast until Google's first page comes back (**Hypothesis** on how long that lasts with the real network).                                                                                                                                                                                                         |
| Focus return after cancel                           | Base UI default (no `finalFocus` at `:76`)                             | A: back to the bin. B: the lightbox's Delete button is gone (`PhotoPreview` returns null, `photo-preview.tsx:65`), so focus probably falls to the tile or `body` (**Hypothesis**). The lightbox is not reopened, so the operator loses their place.                                                                                                                                                                      |
| Focus return after delete                           | same                                                                   | A: focus goes back to the bin at close time, then that card unmounts when the refetch lands, so **focus drops to `body`** (**Hypothesis**, code-inferred). B: same, or worse.                                                                                                                                                                                                                                            |
| Undo                                                | `:81-82`                                                               | None, and none is possible. Google's `DELETE` (`lib/server/google/media.ts:144-154`) is irreversible, and the library only mirrors Google's thumbnails (`media-card.tsx:110-117`), so no copy is kept to restore from. **Do not propose Undo.**                                                                                                                                                                          |

## 5. Protected rules (do not change)

- The route gates, `mfa: "step_up"` and the body schema with the literal `confirmation: "delete_google_media"` (`route.ts:34-47`; `location-media.ts:110-113`; `lib/api/location-media.ts:125`).
- The optimistic-concurrency hash `expectedGoogleHash`, checked against the DB and Google (`media.ts:578-580,586-604`). The client must send the hash of the item the person saw.
- Publish-grant, pause and customer-media read-only (`media.ts:518-562`).
- The audit write `media.deleted` with `googleMediaName` (`media.ts:1559-1564`, run in the settle transaction by `runGbpWrite`, `lib/server/gbp-write.ts:900`).
- Recovery readback: a delete counts as landed only on a Google 404 (`media.ts:1672-1686`).
- Server authority: the toast and close only come in `onSuccess`, after the server answers. The "sent" wording comes from `answerOutcome` (`outcome.ts:116-124`). No optimistic removal before the server answers.
- Intent reuse on an uncertain retry (`use-resource-mutation.ts:136-145,184-188`).
- Two-person park handling (`use-resource-mutation.ts:171-181`).
- No Undo for a Google delete (see §4).

## 6. Audit status (15 Oct, `docs/audits/2026-10-15-ux-flows/`)

- **No finding covers photo delete.** A grep of `findings.md` and `results.md` for photo or media plus delete, focus or lightbox finds none. The audit only exercised upload (`findings.md:440,745`; LST-15 **fixed**, `results.md:223`).
- **Related, fixed:** SET-13 sheet chrome (`results.md:273`). The alert follows the one recipe: no ×, ghost cancel, danger primary. The `select.tsx` `title` is now required, so "Move to category" is titled (`media-card.tsx:172`).
- **Related, remaining:** 20 effective hit areas below 44 px, Listings 3 of them, not itemised (`results.md:648,655`). The bin is `icon-sm`, which adds a 44 px touch hit area (`button.tsx:28`), so it is probably not one of them (**Hypothesis**).
- **Related, remaining:** DSK-22's broken-image fallback was fixed only for review photos (`results.md:303`). The tile, lightbox and dialog thumbnails have no `onError` (`delete-photo-dialog.tsx:89-94`).

## 7. Friction

1. **P1: focus is lost after a delete.** The trigger unmounts once the refetch lands, and the dialog has no `finalFocus` (`delete-photo-dialog.tsx:76`, unlike `components/ui/quick-look-panel.tsx:158-165` or `components/settings/members-table.tsx:669`). A keyboard or screen-reader user is put back at the top of the page after every delete. WCAG 2.4.3 Focus Order. **Hypothesis** until checked in a browser.
2. **P2: errors exist only as a transient toast.** The dialog stays open with no in-dialog explanation, so the person sees the same question again. `RemoveMemberDialog` already shows an inline `Alert` (`member-dialogs.tsx:286-291`).
   - For `media_stale` the advice is "Refresh and try again", but Refresh is behind the modal, and `deleteTarget` is a **snapshot object** (`photos-grid.tsx:53`) that keeps the old hash even after a refresh. Recovery means Keep → Refresh → find the photo → bin → Delete, which is 5 or more taps.
   - For an uncertain outcome nothing says that a retry is safe.
3. **P2: Cancel from the lightbox loses the place.** Path B closes the lightbox before asking (`photos-grid.tsx:133-136`), so "Keep the photo" drops the operator onto the grid, not back on the photo they were inspecting or its "3 of 12" position.
4. **P3: the success toasts don't carry the outcome's meaning.** "Delete sent to Google" gives no explanation or next step, and "Photo deleted from Google" doesn't warn that Maps may lag (`outcome.ts:73-80` has that sentence, but the custom title drops it, `:157-160`). Meanwhile the tile is still visible (§4), so "deleted" can look untrue (**Hypothesis**).
5. **P3: the dialog copy is long and generic.** The body is 4 sentences and about 45 words. The title doesn't name the photo, which is only in body text that isn't part of the accessible description. "Keep the photo" looks clickable but is inert while pending. "Straight away" is wrong when two-person mode parks the delete. The client cannot know that mode up front, so leave that wording, but flag it.

## 8. Proposed changes (all flow-owned; no shared files)

**C1. Return focus to a stable neighbour after a delete (fixes 1).**

- **Change:** in `photos-grid.tsx`, give each `MediaCard` a `data-media-id` on its `<li>`. When `deleteTarget` is set, compute `neighbourId` (the next item in `items`, else the previous one). In `delete-photo-dialog.tsx`, add a `deletedRef` set in `onSuccess`, and pass `finalFocus` to `AlertDialogContent` (it spreads props to the Base UI Popup, `alert-dialog.tsx:59-67`): if deleted, return the neighbour tile's preview `button` (`[data-media-id=…] > button`); else the grid's "Add photos" button; else `true`. On cancel, return `true` (the default trigger).
- **Benefit:** focus stays in the gallery, on the photo next to the one deleted.
- **Principle:** WCAG 2.2 SC 2.4.3 Focus Order; Nielsen #3 user control.
- **Shared:** none (prop already supported).

**C2. Show the error and its recovery inside the dialog (fixes 2 and the inert Keep).**

- **Change:** in `delete-photo-dialog.tsx`, add `onError: (error, message) => setError({ message, unconfirmed: isUnconfirmedFailure(error), stale: error instanceof ApiClientError && error.code === "media_stale" })`. Clear it on open and close. Render `<Alert variant="destructive" live={false}>`; `live={false}` avoids a second announcement, because the toast already announces.
  - Failed: title "The photo wasn’t deleted" with the message.
  - Uncertain: title "We couldn’t confirm the delete", "Google may already have removed it. Trying again is safe: it won’t delete twice." Label the primary "Try again".
  - Stale: add a secondary "Refresh from Google" that calls `onDeleted()`, the existing refresh.
  - In `photos-grid.tsx`, store `deleteTargetId` and resolve the item from `items`, as with `previewId` at `:52-54`, so a refreshed hash is used. Keep the snapshot only as a fallback for an item not on the refreshed first page, where the error stays.
  - Pass `disabled={remove.isPending}` to the "Keep the photo" `Button`.
- **Benefit:** the error is visible where the person is looking. Stale recovery drops from 5 or more taps to 2 (Refresh, then Delete), and the person re-confirms against the photo they now see.
- **Principle:** Nielsen #9 recover from errors and #1 visibility; WCAG 2.2 SC 3.3.1 Error Identification and 3.3.3 Error Suggestion.
- **Shared:** none (`Alert` and `isUnconfirmedFailure` are imported, not changed).

**C3. Keep the lightbox under the confirmation (fixes 3).**

- **Change:** in `photos-grid.tsx:133-136`, stop calling `setPreviewId(null)` in `onDelete`. Nest the alert over the lightbox, which Base UI supports. In `DeletePhotoDialog`'s success path, call a new `onDeletedClose` prop that also clears `previewId`, so C1's focus target applies. Cancel returns focus to the lightbox's Delete button by default.
- **Benefit:** Cancel puts the operator back where they were, on the same photo and the same "n of N".
- **Principle:** Apple HIG, alerts return to the context that raised them; Nielsen #3.
- **Shared:** none. **Hypothesis:** check nested-dialog focus trapping and the scrim on a phone.

**C4. Put the outcome's meaning in the success toast (fixes 4).**

- **Change:** in `delete-photo-dialog.tsx:52-61`, add `description` to the returned message.
  - Confirmed: "Customers may still see it on Maps for a few minutes."
  - Otherwise: "Google hasn’t confirmed it yet. Refresh in a moment to check."
- **Benefit:** the toast says what the state means and what to do, without claiming more than the server confirmed.
- **Principle:** Nielsen #1 visibility of system status.
- **Shared:** none (`successToastFields` already passes `description`).

**C5. Name the photo and tighten the body (fixes 5).**

- **Change:** in `delete-photo-dialog.tsx:77-83`:
  - Title: `Delete this ${categoryLabel.toLowerCase()} ${mediaKind} from Google?`, for example "Delete this interior photo from Google?".
  - Body: "Customers stop seeing it on Search and Maps straight away. NabaPresence shows Google’s own library, so it can’t be removed here only, and it can’t be undone."
  - Keep the thumbnail block.
- **Benefit:** the person recognises which photo will go without scanning, and reads one sentence less. The irreversibility and Google-only meaning stay.
- **Principle:** Nielsen #6 recognition rather than recall; HIG alerts, keep messages short; WCAG 2.2 SC 2.4.6 Headings and Labels.
- **Shared:** none.

Not proposed:

- **Typed confirmation** (`components/ui/typed-confirmation.tsx`): this is a single, previewed item, and it would add friction with no gain.
- **Undo, or a delayed-send undo window:** irreversible on Google, and it would contradict "no success before the server confirms".
- **Optimistic tile removal:** a server-authority risk. Revisit only for `confirmed_applied`.

## 9. Tests

**Existing assertions on copy that would change:**

- `tests/components/listing-change-requests.test.tsx:250-258` finds the button "Delete from Google". It is unchanged by C1–C5 unless the uncertain-state "Try again" label is shown, and it expects `onClose` on park and no `role=alert`. C2's `Alert` must not render on park, and `live={false}` keeps the no-alert assertion true.
- `tests/components/photos-tab.test.tsx:507-512` checks the bin name "Delete Interior photo". It is unchanged.
- `tests/components/posts-action-bar.test.tsx:327` matches `/^Delete from Google/` on posts, a different flow, and is unaffected.
- `app/design-system/page.tsx:683,1395` shows sample buttons only.
- No test asserts the dialog title, the body, "Keep the photo", "Deleting from Google…" or either success toast.

**Focused test ideas** (Vitest plus RTL in `tests/components/photos-tab.test.tsx`, with `deleteMediaItem` spied):

1. The bin opens the dialog with the named title (C5). "Keep the photo" closes it, sends no request, and focus returns to the bin.
2. On success with `status: "succeeded"`: the toast reads "Photo deleted from Google" with the C4 description, `onDeleted` is called once, and after the item is removed from `items` focus is on the neighbour's "Preview … photo" button (C1).
3. A rejection with `ApiClientError(409, "media_stale")` keeps the dialog open and shows "The photo wasn’t deleted" plus "Refresh from Google". Clicking Refresh, then Delete, sends the **new** `expectedGoogleHash` (C2).
4. A rejection with `TypeError` (uncertain) shows "We couldn’t confirm the delete". A second press sends the **same** `intentId` (protects `use-resource-mutation.ts:184-188`).
5. While pending, "Keep the photo" is disabled and Esc does not close the dialog.
6. From the lightbox: Delete then Keep leaves the lightbox open on the same "n of N" (C3).
7. A customer photo has no Delete in the tile or the lightbox (a regression guard).
8. In two-person mode the existing park test still passes, with no inline `Alert`.

**E2E:** none exists for delete. A Playwright check needs media in the stub (§10).

## 10. Screenshot states reachable in the visual fixture

- **Fixture today:** the Google stub answers `GET …/media` and `…/media/customers` with `{ mediaItems: [] }` (`tests/e2e/helpers/stub-bridge.ts:402-409`). No `DELETE …/media/…` handler exists, and the only `DELETE` stub is for admins (`:728-731`). As owner at `/listings/{loc}/photos`, only **"No photos yet"** renders (`photos-library.tsx:171-181`). **No delete state is reachable as-is.**
- **To reach them**, a test-only stub change in `tests/e2e/helpers/stub-bridge.ts`, which is not a protected file:
  - Seed one or two merchant `mediaItems` with `name`, `mediaFormat: "PHOTO"`, `locationAssociation.category: "INTERIOR"`, `googleUrl`, a local `thumbnailUrl` and `createTime`. Add one customer item.
  - Add `stub.respond({ method: "DELETE", pathIncludes: "/media/" }, () => ({ status: 200, json: {} }))`, and make the following `GET` omit the deleted item so the readback 404s.
- **The states and how to reach them:**
  1. Grid with a business and a customer tile: load the page.
  2. Confirm dialog, desktop centred and phone bottom card: click "Delete Interior photo".
  3. In progress: delay the DELETE stub by about 2 s, then capture "Deleting from Google…".
  4. Error: make the DELETE stub answer 400 `FAILED_PRECONDITION`, which shows the toast now and C2's inline alert later.
  5. Stale: change the item's hash between load and click by mutating the stub's GET body, which gives 409 `media_stale`.
  6. Success toast, then the grid without the tile, with focus visible on the neighbour (C1).
  7. Lightbox path: open the tile, then Delete (C3 state).
  8. Read-only: use the viewer cookie, which shows the disabled bin and the "You can look, but not change these photos" banner.
- **Step-up MFA** fires if the fixture owner's proof has lapsed. Capture the alert under the prompt, or pre-verify.
- **Two-person park** needs an org with `approval_required` (`lib/server/capabilities.ts:68-72`).
