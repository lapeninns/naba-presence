# p4-F02: Add photos (pick, review, upload, unresolved creates)

Route `/listings/[id]/photos`. Worktree `/tmp/naba-presence-p4` (branch `ux/flows-presence-p4`), read 28 Oct 2026. All paths are repo-relative. "dialog" means `components/locations/photos/add-photo-dialog.tsx`.

## 1. Start and end

- **Start:** the photos tab (`app/(dashboard)/listings/[id]/photos/page.tsx:25-44` → `PhotosTab` `components/locations/photos-tab.tsx:37-77` → `PhotosLibrary` `components/locations/photos/photos-library.tsx:44-158`). The trigger is the toolbar's trailing primary, "Add photos" (`photos-library.tsx:117-122`, rendered in `photos-toolbar.tsx:119-131`). The dialog is lazy-loaded the first time it opens (`photos-library.tsx:28-34`, `:146-155`).
- **End (happy path):** every file card reads "Live on Google" or "Sent to Google", the toast says "N photos sent to Google", the library re-reads from Google (`onAdded` → `refreshFromGoogle`, `photos-library.tsx:71-90`), and the user closes the dialog with ×.
- **End (recovery):** a create that Google never confirmed shows up as a warning Alert above the toolbar (`UnresolvedCreates`, `photos-library.tsx:105-110`). The user records "It is on Google" or "It is not on Google".

## 2. Roles and gates (cite code)

- **Tab visibility:** every role can open it. `LocationTab` gets no `requires` (`photos-tab.tsx:60-65`), so a viewer sees the gallery read-only.
- **Client write gate:** `publishReason = resourceDisabledReason(caps, "photos", writesEnabled)` (`lib/locations/gating.ts:83-102`, `:171-181`). A reason disables "Add photos" (`photos-library.tsx:64,118`) and the EditorFrame shows "You can look, but not change these photos" (`:102`). The test copy for a member is "You do not have permission to publish this location to Google." (`tests/components/photos-tab.test.tsx:285-306`). Inside the dialog, `writeReason` disables the pickers and the URL field (`dialog:160,304`) and `GateNote` prints it (`:572`).
- **Server, POST `/api/locations/[id]/media`** (`app/api/locations/[id]/media/route.ts:36-105`):
  - `mfa: "step_up"` (`:38`). Owners and admins need a two-step code from the last 15 minutes (`lib/server/route.ts:78-83`). The upload XHR does **not** raise the step-up prompt that `apiFetch` raises (`lib/api/client.ts:253-283` versus `lib/api/location-media.ts:65-111`).
  - The 75 MB cap answers 413 before parsing (`route.ts:53-63`).
  - Two-person approval refuses uploads with 409 `listing_change_upload_unsupported` (`route.ts:66`, `lib/server/listing-changes.ts:967-986`). A URL import parks for approval instead (`route.ts:91-100`).
  - The kill switch (`GBP_MEDIA_ENABLED`, 503 `media_paused`) and the publish grant (403 `publish_not_allowed`) apply (`lib/server/media.ts:518-524`).
  - File rules (`media.ts:1156-1184`): JPEG or PNG only, 415 (`:74-75`); 10 KB or more, 422; 75 MB or less, 413.
- **Server, POST `…/media/resolutions/[attemptId]`** (`route.ts:16-29` in that folder): publish grant only, no MFA step-up (`media.ts:1406-1427`). Resolve buttons render only when `canResolve = media.canPublish` (`photos-library.tsx:108`, `unresolved-creates.tsx:65`).

## 3. Baseline steps (labels as in code)

1. Tap **"Add photos"** (`photos-library.tsx:120`). Dialog "Add photos" / "Photos go to Google when you tap Upload." (`dialog:334-336`). **1 tap.**
2. Optional: **"Google photo category"** select, default "Additional" (`dialog:151-155,341-364`). **+2 taps.**
3. Tap **"Choose from library"** (`dialog:426-433`), or **"Take photo"** on touch only (`:418-425`), or drop files on a desk (`:435-437`). OS picker. **1 tap, plus the OS picker.**
4. Review the cards in "Files to upload" (`dialog:456-530`): thumbnail, size, pill, reason, "Remove {name}". The footer reads "{done} sent · {ready} ready · {cannot} can’t upload" (`:574-578`).
5. Tap **"Upload N photos"** (`dialog:579-589`). Files are sent one at a time, each with its own `Idempotency-Key` (`:240-273`). **1 tap.**
6. Read the toast (`dialog:278-294`), then close with × (no footer close). **1 tap.**

- Total: **4 taps plus the OS picker** (the audit counted 3 because it left out the close). URL path: steps 1, then type the link, then **"Add from URL"** (`dialog:548-566`); the dialog closes itself when that succeeds (`:192-199`).
- Recovery: **"It is on Google"** or **"It is not on Google"** on the page Alert (`unresolved-creates.tsx:66-93`). **1 tap.**

## 4. States (file:line, exact copy)

- **Initial:** title "Add photos"; description "Photos go to Google when you tap Upload."; field note "Every photo in this upload goes into this category." (`dialog:362`); hint "JPEG or PNG only (not HEIC), from 10 KB up to 75 MB each." (`:438-441`); "or drop photos here" (fine pointers only, `:435`); URL card "Or import one photo from a link" / "Google fetches it, so the link must be public." (`:540-543`); primary disabled, reading "Upload photos" (`:583,588`).
- **Input validation** (client `checkFile`, `dialog:78-88`; pill "Can’t upload", `:105`):
  - HEIC: "HEIC photos aren’t supported. Choose a JPEG or PNG, or set the camera to save JPEG (on an iPhone: Settings › Camera › Formats › Most Compatible)."
  - Other type: "This file type isn’t supported ({type}). Choose a JPEG or PNG."
  - Too large: "Too large at {size}. Uploads can be up to 75 MB."
  - Too small: "Too small at {size}. Google needs photos of at least 10 KB."
  - The `accept` attribute is `image/jpeg,image/png` (`:389,403`).
  - Dirty-close prompt: "Discard these photos?" / "The photos you chose haven’t been uploaded. Nothing has been sent to Google." / "Discard photos" (`:312-318`). It fires only while ready files or a typed URL exist.
- **Ready:** pill "Ready" (`:106`); primary "Upload 1 photo" or "Upload N photos" (`:586-588`); sr-only status "{done} sent, {ready} ready, {cannot} can’t upload." (`:446-452`).
- **In progress, per file:**
  - Pill "Uploading {n}%" (`:480-482`).
  - `Progress` bar labelled "Upload progress for {name}" (`:504-509`).
  - Primary reads "Uploading…" while pending (`:581-582`).
  - Pickers and the category are disabled (`:304`). Remove buttons are hidden (`:463-468`).
  - The dialog **silently refuses to close** (`:319-323`).
  - Live text: "Uploading. {done} sent, {ready} still to send, {cannot} can’t upload."
- **Error, per file:**
  - Pill "Failed" (`:115`) or "Not confirmed" (`:114`).
  - The reason in danger ink, plus the raw code in mono (`:510-525`). Copy comes from `describeActionError` (`lib/errors/action-errors.ts:334-362`), for example "The upload to Google did not finish, so nothing was added. Try again." (`media_upload_interrupted`) and "Google did not confirm whether this was added. Check the listing on Google, then mark it as added or not added before trying again." (`media_needs_resolution`).
  - Network failure: "We couldn’t reach NabaPresence. Check your connection and try again." (`:559`).
  - MFA step-up due: falls back to "You do not have permission to do that." (`:570`).
- **Retry:** **none in the dialog.** `uploadAll` only sends `status === "ready"` (`dialog:202,240`). Failed and unconfirmed cards offer only "Remove". Picking the file again mints a new intent (`:224`).
- **Partial success:** the toast is `error` if anything failed, else `warning` if anything is unconfirmed (`:293`). It reads "{n} photos sent to Google" with "{f} failed. {u} not confirmed. The reason is beside each one." (`:279-292`). Unconfirmed files are **not counted** in the footer or the live text (`:449-450,576`).
- **All unconfirmed:** toast title "No photos were uploaded" (`:282`), with "1 not confirmed". `onAdded` does not run (`:275`), so the page's unresolved Alert only appears after a manual "Refresh from Google".
- **Success:** pill "Live on Google" (`describeOutcome("confirmed_applied")`, `lib/editors/outcome.ts:73-75`) or "Sent to Google" (`:55-57`); toast "N photos sent to Google" (`success`). The library refreshes (`dialog:275`). The primary goes back to a disabled "Upload photos", and focus falls off it because it is disabled rather than pending (`components/ui/button.tsx:147-160`).
- **URL import:** pending label "Adding…" (`dialog:562`). Toast "Photo added on Google" or "Photo sent to Google" (`:182-191`). Errors appear only as a toast (`lib/queries/use-resource-mutation.ts:60-76`).
- **Unresolved creates** (page level, `unresolved-creates.tsx:56-94`):
  - Title "Google did not confirm an upload".
  - Body "{The photo “x.jpg” (Food and drink)} was sent {relative time}, but Google did not say whether it was added and it is not among the listing’s photos yet. Check the listing on Google, then record what you find. Adding it again is blocked until then."
  - Buttons "It is on Google" and "It is not on Google". Toasts "Marked as added on Google" and "Marked as not added. You can add it again." (`:43-46`).
  - While a request is pending, every alert's buttons are disabled and none shows a spinner (`:70,83`).

## 5. Protected rules derived from code

1. **Idempotency key per file intent:** a UUID is minted when the file is picked (`dialog:224`) and sent as `Idempotency-Key` (`lib/api/location-media.ts:74-78`, `lib/contracts/wire-codes.ts:31`). The server accepts only a 36-char UUID (`route.ts:41-42`). An unconfirmed result **keeps** the intent and a definite failure re-mints it (`dialog:264-268`). The server key is org, location, op, `new`, content SHA-256 and `intent:` (`media.ts:655-664`). The same intent with different content gets 409 `intent_conflict` (`:614-615`). A replay answers from the receipt and throws unless the write applied (`lib/server/gbp-write.ts:1326-1350`).
2. **Duplicate-create guard:** an advisory lock on (location, content) is taken, then `requireNoUnresolvedCreate` runs (`media.ts:447-463`, `:794-829`). It answers 409 `media_create_in_progress` within a 120 s grace (`:762`), or 409 `media_needs_resolution`.
3. **Checkpoints:** `data_ref_obtained` → `bytes_uploaded` → `create_sent` (`media.ts:1228-1240`). Any failure before `create_sent` is a plain 502 `media_upload_interrupted` (`:959-967`). An uncertain create is reconciled against the live list, otherwise it goes to `needs_resolution` (`:975-1045`).
4. **Resolution is a person's verdict:** only creates still in the unresolved predicate can be resolved (`media.ts:1428-1439`). The audit entry is `media.create_resolved` (`:1457-1470`). An "abandoned" resolution racing a success is refused with 409 `media_resolution_conflict` (`:464-475`).
5. **Audit** `media.uploaded` / `media.created` (`media.ts:1081-1086`); MFA step-up (`route.ts:38`); the approval refusal (`:66`).
6. **Server authority on the client:** "Live on Google" appears only when `answerOutcome(result) === "confirmed_applied"`, otherwise "Sent to Google" (`dialog:255-257`). Failures are never shown as success. An unconfirmed result is never shown as "Failed" (`:112-114`).
7. **No close mid-upload** (`dialog:319-323`): the results must stay on screen.
8. Unchanged: the route handlers, `lib/server/media.ts`, `lib/api/location-media.ts`, the error codes, the 10 KB and 75 MB limits.

## 6. 15 Oct audit status

| ID                                     | Finding                                                                                             | Status now                                                | Evidence                                                                                                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LST-15 (P2)                            | The sheet contradicts itself: "Add media" title, "Review file upload" step                          | **Fixed**                                                 | Title and description at `dialog:334-336`; one primary at `:579-589`; FileCard rows at `:470`; test `photos-tab.test.tsx:355-366` asserts there is no "Review file upload" button |
| Tap count (findings.md:440)            | 4 plus picker, versus 1                                                                             | **Improved** to 3 plus picker plus close (results.md:413) | Steps 1, 3, 5 above                                                                                                                                                               |
| SHT (findings.md:1146)                 | Category select sheet has no title                                                                  | **Fixed**                                                 | `SelectContent title="Google photo category"` at `dialog:353`                                                                                                                     |
| Coverage gap (findings.md:745)         | No image fixture, so progress, failure, the review list and the post-upload grid were never audited | **Still open**                                            | The stub has no media POST handlers (see §10)                                                                                                                                     |
| LST-12 / cross-model (findings.md:512) | Photos "go straight away", unlike the other editors                                                 | Owner decision; out of scope                              | `photos-library.tsx:92-96`                                                                                                                                                        |

## 7. Friction

1. **P1. There is no retry, and a re-pick can create a duplicate.** Failed and unconfirmed cards only offer "Remove" (`dialog:463-468`). `uploadAll` sends only `ready` files (`:202,240`). The intent kept for "a retry" (`:66,264-266`) is never reused. A user who removes a card and picks the file again gets a new UUID (`:224`). After a `network_error` whose first upload actually landed, the server's guard does not block it, because the earlier attempt is `succeeded` and not unresolved (`media.ts:794-812`). That gives a **second copy on Google**.
2. **P1. MFA step-up reads as a permission denial.** The XHR bypasses `apiFetch`'s step-up event (`lib/api/client.ts:253-283`), so every file shows "You do not have permission to do that. mfa_step_up_required" (`action-errors.ts:570`), and the loop keeps sending the rest. Only applies when `MFA_ENABLED`.
3. **P2. When every upload is unconfirmed, the toast says "No photos were uploaded".** That contradicts "Not confirmed" (`dialog:280-282`). The library is not refreshed (`:275`), so the page's "It is on Google" and "It is not on Google" stay hidden until a manual refresh.
4. **P2. The summaries drop unconfirmed files.** "0 sent · 0 ready · 0 can’t upload" can sit above a "Not confirmed" card (`dialog:446-452,574-578`). Zero segments are always printed.
5. **P2. Refusals that apply to every file are repeated on every file.** `listing_change_upload_unsupported`, `media_paused`, `publish_not_allowed` and the MFA codes repeat per card and keep sending (`dialog:240-273`). In two-person mode the user only learns about the URL alternative after picking and uploading.
6. **P2. No end state.** After the run the primary is a disabled "Upload photos". Focus drops off it because a disabled button is not focusable (`button.tsx:147-160`), which fails WCAG 2.4.3. The only exit is ×.
7. **P3. Tapping × during an upload does nothing and says nothing** (`dialog:319-323`).
8. **P3. Unresolved Alert:** no spinner on the tapped verdict, and one shared `isPending` disables every alert (`unresolved-creates.tsx:70,83`). A viewer who cannot publish is told to "record what you find" but has no buttons (`:62,65`).
9. **P3. The URL import error appears only as a toast,** not next to the field (`dialog:169-200`). Hypothesis: on a phone the toast lands over the dialog footer.
10. **P3. Duplicate rendering.** The dialog re-implements FileCard's `onRemove`, `refusal` and `progress` (`dialog:486-525` versus `components/ui/file-card.tsx:51-58`). This is not user-facing; noted for a later tidy.

## 8. Proposed changes (presentation, copy, a11y, local state; all in this flow's own files)

**C1. Per-file "Try again" that reuses the protected intent** (fixes 1). `add-photo-dialog.tsx` only.

- **Change:**
  - In the `trailing` region, for `status === "failed" || (status === "unconfirmed" && entry.code !== "media_needs_resolution")`, render `<Button variant="ghost" size="sm" onClick={() => patch(entry.key, { status: "ready", error: undefined, code: undefined, progress: 0 })}>Try again</Button>` before the ×, with `aria-label={\`Try ${entry.file.name} again\`}`.
  - Do not touch `intent`. Unconfirmed entries keep theirs, so the server replays the receipt (`gbp-write.ts:1326-1350`). Failed entries were already re-minted at `:267`.
  - For `media_needs_resolution`, add the line "Close this and record what Google shows on the Photos page." under the reason.
  - Change the remove label for an unconfirmed card: "Remove {name}" → "Remove {name} from this list". Removing it does not undo anything.
- **Benefit:** one-tap recovery, and the duplicate path in friction 1 closes.
- **Principles:** Nielsen #9 (help users recover from errors); HIG "Feedback"; WCAG 3.3.1.

**C2. Refresh after any write that may have landed, and say "not confirmed" honestly** (fixes 3 and 4). `add-photo-dialog.tsx`.

- **Refresh:** `:275` `if (succeeded > 0) onAdded()` → `if (succeeded + unconfirmed > 0) onAdded()`. This is a read only (`photos-library.tsx:71-90`).
- **Toast title:** `:280-282`
  - old: `succeeded > 0 ? … : "No photos were uploaded"`
  - new: `succeeded > 0 ? … : unconfirmed > 0 ? \`Google hasn’t confirmed ${unconfirmed === 1 ? "this photo" : \`${unconfirmed} photos\`}\` : "No photos were uploaded"`
- **Counts:** add `const unsure = entries.filter((e) => e.status === "unconfirmed").length`.
- **Summary:** build it from the non-zero parts: `[done && \`${done} sent\`, ready.length && \`${ready.length} ready\`, unsure && \`${unsure} not confirmed\`, cannot && \`${cannot} can’t upload\`].filter(Boolean)`. Join with " · " in the footer (`:576`) and ", " in the live text (`:449-450`).
- **Benefit:** no claim that contradicts the pill, and the page Alert appears as soon as the dialog closes.
- **Principles:** Nielsen #1 (visibility of system status); WCAG 4.1.3 Status Messages.

**C3. Stop the run on a refusal that applies to every file, and say it once** (fixes 2 and 5). `add-photo-dialog.tsx`.

- **Loop:** in `uploadAll`'s catch (`:259-272`), when `isMfaStepUpError(error)` (exported from `lib/api/client.ts:267`) or the code is in `["listing_change_upload_unsupported", "media_paused", "publish_not_allowed"]`:
  - record the error on that entry;
  - put the entry back to `ready`, keeping its intent (the server refused before claiming anything);
  - `break` the loop;
  - for MFA, `window.dispatchEvent(new CustomEvent(MFA_STEP_UP_EVENT, { detail: { code: error.code } }))`, the existing exported event (`client.ts:260`) handled by `components/app-shell/app-shell.tsx`'s host.
- **Banner:** render one `<Alert variant="warning">` above the list (`components/ui/alert`, used as is, not edited). Copy:
  - MFA: "Confirm it’s you with your two-step code, then tap Upload again. Nothing was sent to Google."
  - Approval: "Uploads can’t be sent for approval yet. Nothing was sent to Google. Import the photo from a public link below instead."
  - Paused or permission: the `describeActionError` copy.
- **Benefit:** one explanation and a next step instead of N identical errors and N wasted requests. The gates are untouched.
- **Principles:** Nielsen #9; HIG "Alerts"; WCAG 3.3.3 Error Suggestion.
- **Flag:** reads the shared `lib/api/client.ts` exports, with no edit to it.

**C4. A clear end state that keeps focus** (fixes 6 and 7). `add-photo-dialog.tsx`.

- **Close helper:** add `function close() { revoke(entries); setEntries([]); setUrl(""); onOpenChange(false) }` and reuse it from the `onOpenChange` cleanup (`:324-329`).
- **Footer primary** (`:579-589`): keep one `<Button>` node so focus survives.
  - When `!uploading && entries.length > 0 && ready.length === 0`: `variant="secondary"`, `onClick={close}`, label "Done".
  - Otherwise: the current Upload button.
- **While uploading:** add `<span className="text-caption text-ink-muted">Keep this open until the uploads finish.</span>` in the footer, in place of the count line.
- **Benefit:** the completion is explicit and the dismissal rule is visible.
- **Principles:** HIG "Modality" (a clear way to finish); WCAG 2.4.3 Focus Order; Nielsen #1.

**C5. Unresolved Alert: pending on the tapped verdict, and a next step for non-publishers** (fixes 8). `unresolved-creates.tsx` only.

- **Pending:** `const busy = (r) => resolve.isPending && resolve.variables?.attemptId === create.attemptId && resolve.variables?.resolution === r`. On each button, `pending={busy("adopted")}` / `pending={busy("abandoned")}` with `pendingLabel="Saving…"`. Keep `disabled={resolve.isPending}` on the sibling.
- **Non-publishers:** when `!canResolve`, replace the sentence "Check the listing on Google, then record what you find." with "Someone who can publish to Google needs to check the listing and record what they find."
- **Principles:** Nielsen #1 and #2; WCAG 4.1.2 (`aria-busy` comes from Button `pending`).

**C6. URL import error next to the field** (fixes 9, Hypothesis-led). `add-photo-dialog.tsx`.

- **Change:** pass `onError: (_e, message) => setUrlError(message)` to `addUrl` (`:169`, the documented hook option at `use-resource-mutation.ts:75-76`). Render `<p id={urlErrorId} className="text-caption text-danger-ink">{urlError}</p>` under the input, set `aria-invalid` and `aria-describedby`, and clear it on change.
- **Principles:** WCAG 3.3.1 Error Identification; Nielsen #9.

No shared-file edits: `components/ui`, `lib/` and `components/editors` stay as they are. C3 imports from `lib/api/client.ts` without changing it.

## 9. Tests

- **Existing coverage:** `tests/components/photos-tab.test.tsx`:
  - unresolved Alert and "It is not on Google": `:156-191`, still passes after C5;
  - dialog copy and "Upload photos" disabled: `:193-238`;
  - the writes-paused gate: `:285-306`;
  - thumbnails, summary and remove: `:327-377`. **C2 breaks `:363`** "0 sent, 1 ready, 1 can’t upload." → "1 ready, 1 can’t upload.";
  - HEIC and the discard prompt: `:379-404`.
- **Other coverage:** `tests/e2e/listings.spec.ts:230-251` (heading, "Choose from library", accept, disabled "Upload photos"; unchanged). Server: `tests/integration/routes/media-checkpoints.test.ts:166,282,445,563` (same-intent replay and the unresolved block; unaffected). `uploadMediaFile` is **not mocked** in the component test (`:32-44`), so no upload outcome is covered client-side.
- **Add**, in `photos-tab.test.tsx`, mocking `uploadMediaFile`:
  - (a) a rejection with `new ApiClientError(0, "network_error", …)` shows "Not confirmed" and "Try again". Tapping it calls `uploadMediaFile` again with the **same** `{ intentId }`. A `failed` file retries with a different `intentId`.
  - (b) all-unconfirmed: toast "Google hasn’t confirmed this photo", and `fetchMedia` is called (refresh).
  - (c) a 403 `mfa_step_up_required` on file 1 dispatches `naba:mfa-step-up`, leaves file 2 un-sent, and shows the single Alert.
  - (d) after success the primary reads "Done" and keeps focus.
  - (e) the pending verdict: "Saving…" on the tapped button only.

## 10. Screenshot states in the visual fixture (owner, `/listings/{loc}/photos`)

The fixture uses `tests/e2e/helpers/stub-bridge.ts` (`tests/visual/fixture-server.ts:24`). Media GETs return `{ mediaItems: [] }` (`stub-bridge.ts:402-409`). There are **no media POST handlers**, so `startUpload` falls to the stub default **404 `NOT_FOUND`** (`tests/integration/helpers/google-stub.ts:165-189`). `GBP_MEDIA_ENABLED: "true"` (`playwright.config.ts:82`, `tests/visual/nm-serve.mjs:157`).

| State                                                           | How to reach it                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty library                                                   | Load the page: "No photos yet" (`photos-library.tsx:176-180`)                                                                                                                                                                                                                      |
| Dialog initial                                                  | Click "Add photos"                                                                                                                                                                                                                                                                 |
| Category sheet                                                  | Click the "Google photo category" trigger                                                                                                                                                                                                                                          |
| Review list: ready plus refused                                 | `page.getByLabel("Direct file upload").setInputFiles([{name:"bar.jpg",mimeType:"image/jpeg",buffer:Buffer.alloc(20*1024)}, {name:"tiny.png",mimeType:"image/png",buffer:Buffer.alloc(100)}, {name:"IMG.HEIC",mimeType:"image/heic",buffer:Buffer.alloc(20*1024)}])`                |
| Discard prompt                                                  | Same as above, then press Escape                                                                                                                                                                                                                                                   |
| Uploading, then per-file Failed                                 | Click "Upload 1 photo". The stub's 404 comes back before `create_sent`, so the card reads "Failed" with Google's not-found copy and an error toast. Hypothesis: the exact copy depends on how `googleRequest` maps a 404. Progress is brief; throttle with `page.route` to hold it |
| Unconfirmed, needs resolution, Live on Google, unresolved Alert | **Not reachable** without new stub handlers or a seeded `gbp_media_mutation` row with `status='needs_resolution'`. Possible in a component story only                                                                                                                              |
| Writes paused                                                   | Not reachable as owner; use a member cookie (`state.cookie` variants, `listings.spec.ts:252+`)                                                                                                                                                                                     |
