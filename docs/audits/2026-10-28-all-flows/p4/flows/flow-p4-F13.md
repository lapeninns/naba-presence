# p4-F13: Compose a bulk change across listings

Route `/listings/bulk?ids=<uuid,…>`. Worktree `/tmp/naba-presence-p4` at `e4123d25`. Read-only code map, made 2026-10-28. Nothing was run except one `node -e` call to print zod's default messages.

Scope: in this flow, "submit" means **Preview**. `POST /api/listings/bulk/preview` reads every listing from Google and saves a _previewed_ operation. Nothing is written to Google. The user then lands on the operation page, where approve, start, cancel and retry happen (that is p4-F14).

## 1. Start, end and entry points

- **Start:** the board's selection bar, "Prepare bulk change". It links to `/listings/bulk?ids=${[...selected].join(",")}` (`components/listings/listings-board.tsx:1294-1299`).
  - The bar only shows when `canSelect && selected.size > 0` (`:1270`).
  - `canSelect = canManage && bulkEnabled`, and `canManage` means owner or admin (`:616-617`).
  - The board caps the selection at `BULK_MAX_TARGETS` (50) (`:627`, `:886-895`, `:915`).
  - When the cap is hit, the bar says "(the most one change can cover)" (`:1280-1282`).
- **Other ways in:**
  - A pasted or bookmarked URL.
  - Breadcrumb or back: both pages are labelled "Listings › Bulk change" (`lib/ui/breadcrumb-trail.ts:70-74`).
  - The inbox's review batches link to `/listings/bulk/{operationId}` (`components/inbox/bulk-action-bar.tsx:468`, `template-reply-dialog.tsx:557`). That is p4-F14, not compose.
  - No nav item, no list page. `GET /api/listings/bulk` (`app/api/listings/bulk/route.ts:7`) has no UI caller.
- **End (success):** `onSuccess: (op) => router.push(`/listings/bulk/${op.id}`)` (`components/bulk/bulk-compose.tsx:689-691`).
- **End (abandon):** "Back to listings" goes to `/listings` (`bulk-compose.tsx:717-722`). This **drops the selection**: board state starts empty with `useState(() => new Set())` (`listings-board.tsx:620-622`).

## 2. Roles and gates

| Gate                          | Where                                                                                | Behaviour                                                                                                                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role (page)                   | `app/(dashboard)/listings/bulk/page.tsx:14`                                          | Not owner or admin → `<AccessDeniedPage area="Bulk changes" />`. This check runs **before** the feature check.                                                                                                                                           |
| Feature `bulk_actions` (page) | `page.tsx:15-16`, `lib/server/bulk-listings.ts:97-101`                               | Off → `notFound()`. The e2e notes it renders "This page doesn’t exist" under HTTP 200 (`tests/e2e/operations-features.spec.ts:549-554`).                                                                                                                 |
| Feature default               | `lib/server/org-features.ts:26-37`                                                   | No row means off (`row?.enabled ?? false`).                                                                                                                                                                                                              |
| Feature (API)                 | `bulk-listings.ts:84-95`, `:158`                                                     | 404 `feature_disabled`, "Bulk changes are not available for this workspace."                                                                                                                                                                             |
| Role (API preview)            | `bulk-listings.ts:153-154`                                                           | Only viewers are refused (403, "Viewers cannot prepare bulk changes."). **The UI is stricter than the server**: members are blocked by the page, not by the API.                                                                                         |
| Per-listing permission        | `bulk-listings.ts:161-167`, `:173-176`, `:124-128`                                   | Every target needs `request_approval`. If any is missing → 404 `bulk_targets_unavailable`, "One or more selected listings are not available to you. Refresh the selection." Listings without publish rights are kept as skipped (`publish_not_allowed`). |
| Rate limit                    | `app/api/listings/bulk/preview/route.ts:13-17`, `lib/server/abuse-limits.ts:189-193` | `bulk_request`: 30 per user and 120 per organisation per 10 minutes → 429 `bulk_rate_limited`, retryable.                                                                                                                                                |
| Billing                       | `lib/server/route.ts` (step 4b)                                                      | A read-only billing organisation gets 402 `billing_read_only` on preview (`tests/route-entitlements.test.ts:252`).                                                                                                                                       |
| Approval                      | not in this flow                                                                     | Two-person approval is captured at preview (`require_two_person_approval`, `bulk-listings.ts:331-340`) and applied in p4-F14. MFA step-up is on approve, execute and retry only, not preview (`tests/mfa-step-up-contract.test.ts:85-87`).               |

## 3. Baseline steps (owner, 2 listings, one special-hours closure)

1. On `/listings`, tick the row checkbox for each listing ("Select … for a bulk change"). That is 2 taps.
2. Tap "Prepare bulk change". 1 tap.
3. The page opens with "What to change" already set to **Special hours**, with one row: Date (empty), Set to "Closed".
4. Pick a date in the date input. 1 to 3 taps on the native picker.
5. Tap "Preview this change" in the docked bar. 1 tap. The button shows "Reading each listing…" until navigation.
6. The operation page opens: "Waiting for approval." (the hand-off to p4-F14).

That is about 5 to 7 taps. Any other kind of change adds a Select tap and its option (`bulk-compose.tsx:738-763`).

A multi-change batch adds "Add to the batch" for each change (`:1688-1698`), plus optional reordering with the up and down buttons (`:1725-1752`).

## 4. States (file:line, exact copy)

**Initial**

- PageHeader "Bulk change". Description: "Reviewed changes across {n} selected listing(s). Nothing is sent until the preview is approved and started." (`bulk-compose.tsx:713-716`).
- "Selected listings" is a `<details>` disclosure. It starts open when there are 3 or fewer listings (`:1852-1854`). While the directory loads, each name shows as "Listing" (`:1876`).
- **On first paint the change card already shows a problem.** The date is empty, so `parsed` fails, and `problem` falls through to zod's raw default, **"Invalid ISO date"** (`:648`, shown at `:1683-1687`). The other kinds have the same problem when picked:
  - Attributes: **"Invalid string: must match pattern /^attributes\/[A-Za-z0-9\_.:-]+$/"**. The default row is `attributes/` (`:376-378`).
  - Service hours: **"Too small: expected string to have >=1 characters"**.
  - Action link with an empty URI: "Links must use http or https.". This one is a custom message (`lib/domain/bulk-merge.ts:161`).
  - I checked the zod 4.6 defaults with `node -e`. There is no custom error map (`grep z.config|setErrorMap` finds nothing).

**No selection** (`ids` empty, or every id fails the regex at `:307-314`)

- TargetList shows a card saying "None" (`:1846-1852`).
- The full form still renders.
- Problem: "Select listings on the Listings board first." (`:629`).
- The Preview button is disabled. The action bar says "Nothing to preview yet" (`:1796`).
- There is no link to the board except the header's "Back to listings".

**Validation** (live, while editing; no submit step)

- Time field errors:
  - "Use a 24-hour time such as 09:30." (`:240`).
  - "Use a 24-hour time such as 17:30, or 24:00 for midnight." (`:253`).
  - "Opening and closing times must differ." (`:259`).
  - "Open all day can’t be sent in a bulk change. Set it on each listing’s hours." (`:258`).
  - "Close after it opens. A special date can’t run past midnight in a bulk change; set late closing on each listing." (`:277`).
- Notes on closing time: "Closes {Day} at HH:MM (overnight)." and "Closes at midnight, end of {Day}." (`:281-296`).
- Problem line (muted `text-ink-muted`, `role="status"`, `:1683-1687`), in order (`:627-648`):
  - "Tick at least one weekday to change."
  - "Check the times marked above."
  - "Upload a photo or choose one already uploaded."
  - "Check the primary category above." (field error "Name one primary category.", `:463-466`)
  - "Choose the listing whose menus to copy."
  - "That listing’s menus couldn’t be read." / "Reading that listing’s menus…"
  - "Write the post."
  - Otherwise the first zod issue, or "Check the change."
- Batch problems (danger, `role="status"`, `:660-667`, `:1772-1776`):
  - "One bulk change covers at most 50 listings; this selection has {n}. Go back and select fewer."
  - "A batch holds at most 500 listing changes; {n} listings × {m} changes is {p}."
  - Cross-change refinements, for example "Change 2 overlaps change 1; give each day, date, type, attribute or link type once, and change the menus once." (`bulk-merge.ts:267`).
- The count line is always shown: "{n} listings × {m} changes = {p} of at most 500. At most 50 listings." (`:1764-1766`).
- Unadded-edit warning: "The change being edited above is not in this batch, so it is not previewed. Add it to the batch to include it." (`:1767-1771`).
- Empty list: "Nothing added yet: the preview covers the change above on its own. Add changes to send several to each listing, in list order." (`:1758-1761`).
- Both buttons use plain `disabled`, with no `disabledReason`:
  - "Add to the batch" (`:1691`).
  - Preview (`:1802`).
  - So neither can take focus, and neither explains why it is disabled.

**Preview loading**

- `pending={preview.isPending}`, `pendingLabel="Reading each listing…"` (`:1803-1804`). The bar status says "Preparing the preview…" (`:1791-1792`).
- The server reads 5 listings at a time (`bulk-listings.ts:51`, `:222-249`). The route has `maxDuration = 60` (`preview/route.ts:6`).
- There is no per-listing progress, which is honest because the server returns one response.
- The form fields stay editable while pending. `batch` was captured when `mutate` was called (`:689-690`), so later edits silently aren't in the preview.

**Preview errors**

- `onError` shows the `ApiClientError` message, or "The preview could not be prepared. Try again." (`:692-697`).
- It is drawn as a `FormError` (role=alert) inside the batch card (`:1777`), not in the docked bar. The bar status still says "{p} listing changes to preview".
- `failure` is only cleared when Preview is pressed again (`:1806`). It stays stale while the user edits.
- Codes the user can meet here:
  - `bulk_targets_unavailable`: says "Refresh the selection", but there is no refresh action, and going back loses the selection.
  - `feature_disabled`.
  - `forbidden`.
  - `bulk_rate_limited`: `details.retryAfter` is not shown.
  - `billing_read_only`.
  - zod 400s.
- Per-listing conflicts aren't errors at this stage. They become **skipped children with reasons** (`bulk-listings.ts:177-189`, `:226-249`), shown on the operation page (p4-F14).

**Submitting / success**

- `router.push` runs from `onSuccess` (`:691`).
- When the promise resolves, `isPending` turns false. **The Preview button can be pressed again before navigation commits.**

**Success → operation page**

- `app/(dashboard)/listings/bulk/[operationId]/page.tsx` with `bulk-operation-view.tsx`: "Waiting for approval.", a "{m}:{ss} left" countdown, then expiry after 15 minutes (`BULK_PREVIEW_TTL_MS`, `lib/domain/bulk-merge.ts:39`).

## 5. Protected rules (do not weaken)

- **Preview, then approve, then start.** Compose only calls `previewBulkChange` (`lib/api/bulk-listings.ts:14`), which only inserts a `previewed` row and children (`bulk-listings.ts:336-357`).
  - There is no write path to Google from this screen.
  - The e2e checks that no PATCH happens before approve (`operations-features.spec.ts:591-593`).
- **Server authority and frozen targets:**
  - The ids come from the URL and are never trimmed. More than 50 is refused, not cut (`bulk-compose.tsx:305-314`, `:660-662`; unit test at `tests/components/bulk-compose.test.tsx:319`).
  - The server re-checks visibility and permission (`bulk-listings.ts:161-176`).
  - It freezes the connection and credential generation for each child (`:190-215`).
  - It hashes the plan into `preview_hash` (`:302-329`).
  - Approve requires `expectedPreviewHash` to match (`:528`, `:554`).
- **Idempotency key:** `apiFetch` sends `Idempotency-Key` on every mutation (`lib/api/client.ts:312-318`).
  - It uses `intentId ?? idempotencyKey ?? mintIntentId()` (`:122`).
  - `previewBulkChange` passes neither, so **every press mints a fresh key**.
  - The route parses it into `ctx.intentId` (`lib/server/route.ts:113-120`, `:466-501`). It only files receipts for a `runGbpWrite`, and preview has none. So the key does not deduplicate previews.
  - A duplicate preview makes a second `previewed` operation, which expires unapproved after 15 minutes and is audited as `bulk_listing.previewed` (`bulk-listings.ts:359-374`).
  - This is harmless to Google but noisy. Duplicate _writes_ are guarded downstream in p4-F14 (hash check, child state machine).
- **Double-submit guards:**
  - Button `pending` blocks activation while keeping focus (`components/ui/button.tsx:147-154`, `:232`).
  - Preview is disabled when `!batch.length || batchProblem` (`bulk-compose.tsx:1802`).
  - Gap: the button is live again between `onSuccess` and the route change (§4).
- **Limits:** `BULK_MAX_TARGETS` 50, `BULK_MAX_ITEMS` 500, `BULK_MAX_CHANGES` 50 (`lib/domain/bulk-merge.ts:49-50`). Checked again on the server through `bulkPreviewRequestSchema` and `bulkChangeListSchema` (`preview/route.ts:11`, `bulk-listings.ts:155`).
- **Owner/admin only in the UI** (`page.tsx:14`, `listings-board.tsx:616`). The feature ships dark.
- **Progress truthfulness:** the pending copy says what is happening ("Reading each listing…"). Don't add an invented per-listing progress count. The server returns once.

## 6. Audit status

- 15 Oct UX audit: **not covered.** `docs/audits/2026-10-15-ux-flows/findings.md:747` says "Bulk edit (`/listings/bulk`, `/listings/bulk/[operationId]`): the `bulk_actions` feature is off for the seeded organisation."
  - No findings, plan items or results rows exist for compose. The `results.md` bulk hits are all inbox or settings.
- 14 Oct full-stack audit: only performance. The 56 KB Google Lodging discovery JSON ships in a chunk used by both bulk pages (`docs/audits/2026-10-14-full-stack-audit/PERFORMANCE_OPTIMISATION.md:156`).

## 7. Friction

| #   | Pri | Friction                                                                                                                                                                                                                                                                                                                                   | Evidence                                                                            |
| --- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| F1  | P1  | The page opens with an error-like line, **"Invalid ISO date"**, before the user has done anything. Picking Attributes or Service hours shows a raw regex or a "Too small: expected string…" message. That is developer copy on an owner-only page.                                                                                         | `bulk-compose.tsx:318`, `:322-324`, `:376-378`, `:648`; zod defaults checked        |
| F2  | P1  | The disabled "Add to the batch" and Preview buttons can't take focus and give no reason. The reason is a muted `role="status"` line inside the change card, often off-screen on a phone while the docked bar is visible. The bar only says "Nothing to preview yet". Hypothesis: users tap the dead primary button and don't find out why. | `:1683-1691`, `:1784-1817`; `Button.disabledReason` exists (`button.tsx:155-161`)   |
| F3  | P2  | An empty or invalid `ids` still renders the whole eleven-kind form above "None". The only way out is the header link.                                                                                                                                                                                                                      | `:629`, `:1846-1852`                                                                |
| F4  | P2  | Preview failure: the copy is the bare server message in the batch card, not the docked bar, and it stays after edits. `bulk_targets_unavailable` says "Refresh the selection", but leaving the page drops the selection. The 429 doesn't say when to try again.                                                                            | `:692-697`, `:1777`, `:1806`; `bulk-listings.ts:124-128`; `abuse-limits.ts:411-419` |
| F5  | P2  | The button is live again between preview success and navigation, so a double tap can create a second preview operation. It is orphaned, expires in 15 minutes, but is audited. Hypothesis (timing): `isPending` drops before `router.push` commits.                                                                                        | `:689-691`, `:1803`; `client.ts:315` (fresh key each press)                         |
| F6  | P2  | The two-tier batch model (the editor is the batch until something is added, then only the list counts) needs three explanatory strings and a warning. The Preview label changes between "this change", "the 1 change in the list" and "these N changes". Hypothesis: people add the change and then edit the editor, expecting both.       | `:649-655`, `:668-676`, `:1758-1771`, `:1810-1814`                                  |
| F7  | P3  | "Back to listings" drops the selection (board state isn't in the URL), so "Go back and select fewer" means starting again.                                                                                                                                                                                                                 | `:717-722`; `listings-board.tsx:620-622`                                            |
| F8  | P3  | The form stays editable during "Reading each listing…" (up to 60 seconds). Edits made then aren't in the preview.                                                                                                                                                                                                                          | `:689-690`; `preview/route.ts:6`                                                    |
| F9  | P3  | Attributes, categories and lodging ask for raw Google IDs (`attributes/…`, `gcid:…`, a lodging path datalist). This is expert-only, but a picker needs data the compose screen doesn't load. Out of scope for a copy pass.                                                                                                                 | `:1059-1141`, `:1261-1311`, `:1313-1408`                                            |

## 8. Proposed changes (all in `components/bulk/bulk-compose.tsx`, this area's own file, unless flagged)

**C1. Human first-run validation copy (F1).**

- Problem: zod defaults show on load.
- Change: in the `problem` chain (`:627-648`), insert these before the `parsed.success` fallback:
  - `operation === "special_hours" && special.some((r) => !r.date)` → `"Choose a date for each row."`
  - `operation === "attributes" && attributes.some((r) => !/^attributes\/.+/.test(r.name.trim()))` → `"Type each Google attribute ID, such as attributes/has_wifi."`
  - `operation === "more_hours" && !hoursTypeId.trim()` → `"Choose a service."`
  - Also show the special-hours line _muted, not alarming_ on first view: it is an instruction, not an error. Keep `role="status"`.
- Don't touch `lib/domain/bulk-merge.ts` (shared, used by server messages).
- Benefit: no jargon on first paint.
- Principles: Nielsen #9 (help users recognise errors) and #2 (match the real world); WCAG 2.2 SC 3.3.1 Error Identification and 3.3.3 Error Suggestion.

**C2. Say why the buttons are disabled, where the thumb is (F2).**

- Problem: dead, unfocusable primary.
- Change:
  - Preview `Button` (`:1801-1816`): replace `disabled={…}` with `disabledReason={!batch.length ? (problem ?? "Nothing to preview yet") : (batchProblem ?? undefined)}`.
  - Bar `status` (`:1789-1798`): show `problem` when `!batch.length && problem` instead of "Nothing to preview yet".
  - Same for "Add to the batch" (`:1691`): `disabledReason={canAdd ? undefined : (problem ?? batchProblem ?? (changes.length >= BULK_MAX_CHANGES ? "A batch holds at most 50 changes." : undefined))}`.
- Benefit: keyboard and screen-reader users reach the reason; touch users see it in the bar.
- Principles: Nielsen #1 (visibility of system status); HIG (explain why a control is unavailable); WCAG 2.2 SC 3.3.2 and 4.1.2.
- Uses the existing shared `Button` API. No shared edit.

**C3. Dedicated no-selection state (F3).**

- Change: at the top of `BulkCompose`'s return (`:711`), when `ids.length === 0`, render `PageHeader` plus `<Empty variant="empty" framed title="Choose listings first" description="Tick the listings to change on the Listings board, then choose Prepare bulk change." action={<Link href="/listings" className={buttonVariants()}>Choose listings</Link>} />` (`components/ui/empty.tsx`, shared but used, not edited). Skip the form and the ActionBar.
- Benefit: one clear next step.
- Principles: Nielsen #5 (error prevention) and #6 (recognition over recall); HIG empty states.

**C4. Hold the pending state through navigation (F5). Protected-strengthening.**

- Change:
  - Add `const [leaving, setLeaving] = useState(false)`.
  - `onSuccess: (op) => { setLeaving(true); router.push(…) }` (`:691`).
  - Preview `pending={preview.isPending || leaving}` (`:1803`) and the status copy `preview.isPending || leaving ? "Preparing the preview…"` (`:1791`).
  - Optionally wrap the change and batch sections in `<fieldset disabled={preview.isPending || leaving}>` (F8). No server dedupe proposed (out of scope).
- Benefit: no orphan previews from a double tap. Principles: Nielsen #5; HIG (prevent duplicate actions).

**C5. Actionable preview failures (F4).**

- Change, in `onError` (`:692-697`), switch on `error.code`:
  - `bulk_targets_unavailable` → "One or more selected listings are no longer available to you. Choose the listings again." plus a "Choose listings" link to `/listings`.
  - `bulk_rate_limited` → "Too many previews in the last few minutes. Try again in {Math.ceil(details.retryAfter/60)} minutes." Read `details` only if `ApiClientError` exposes it; check `lib/api/client.ts` before relying on it.
  - Everything else → the current message.
- Clear `failure` whenever the batch changes. Use an effect keyed on `JSON.stringify({ ids, batch })`, or clear it in the edit setters.
- While `failure` is set, also mirror a short "Preview couldn’t be prepared" in the ActionBar `status`.
- Principles: Nielsen #9; WCAG 2.2 SC 3.3.3; SC 4.1.3 Status Messages (the FormError is already an alert, so the bar copy is visual only; don't add a second live region).

**C6. Clarify the batch model with copy only (F6).**

- Change the copy, not the model:
  - Empty-list text (`:1758-1761`) → "Preview sends the change above on its own. To send more than one change to each listing, add each one to the batch."
  - Unadded warning (`:1767-1771`) → "The change above isn’t in the batch yet. Add it, or it won’t be previewed."
  - Preview label (`:1813`) → `"Preview the batch (1 change)"`.
  - Keep `"Preview this change"` and `"Preview these N changes"`.
- Benefit: one mental model, "the batch".
- Principles: Nielsen #4 (consistency) and #6.

**Not proposed in this area (flagged):**

- F7 needs `components/listings/listings-board.tsx` to seed `selected` from `?ids=`, plus a Back link that carries `?ids=`. That file belongs to the listings board area, not to `components/bulk/*`. **Cross-area.** Raise it with the board's owner.
- F9: Google ID pickers need data loading. That's a product change, not this pass.
- No migrations, dependencies or flags.

## 9. Tests

The copy I would change is asserted in these places:

- `tests/components/bulk-compose.test.tsx`:
  - `:140`, `:187`, `:218`, `:246`, `:332`, `:367` assert "Preview this change". C6 keeps that label.
  - `:295` asserts **"Preview the 1 change in the list"**. Update it for C6.
  - `:292` asserts `/The change being edited above is not in this batch/`. Update it for C6.
  - `:271` and `:315` assert "Preview these 2 changes". Kept.
  - `:215` "Check the times marked above.", `:243` "Tick at least one weekday to change.", `:344` "Upload a photo…" and `:329` "covers at most 50 listings…" are all kept.
  - The buttons at `:218`, `:246`, `:332`, `:335` are probably asserted with `toBeDisabled()`. Check whether `disabledReason` still satisfies `toBeDisabled` (Button sets `disabled` through `blocked`, `button.tsx:232`; verify it renders the `disabled` or `aria-disabled` the matcher accepts). If it doesn't, change those to `toHaveAttribute("aria-disabled","true")`.
- `tests/e2e/operations-features.spec.ts`:
  - `:551-557` (feature off → "This page doesn’t exist", no "Preview this change").
  - `:560-617` (select → "Prepare bulk change" → fill Date → "Preview this change" → "Waiting for approval.").
  - `:621-698` (keyboard: "Add to the batch" ×2, list label "Changes in this batch, in the order they are sent", `/2 listings × 2 changes = 4 of at most 500/`, "Preview these 2 changes").
  - C1 to C6 keep all of these strings.
- `tests/components/listings-board.test.tsx:509-532`: the "Prepare bulk change" href. Unaffected.
- Server and contract tests (`tests/integration/routes/bulk-listings.test.ts`, `bulk-merge.test.ts`, `route-*.test.ts`) are unaffected: no server copy changes.

Focused tests to add in `tests/components/bulk-compose.test.tsx`:

1. On first render, "Invalid ISO date" is absent and "Choose a date for each row." is present (C1).
2. The Preview button is focusable and its accessible description is the problem text (C2).
3. With no `ids`, the page shows "Choose listings first" and a link to `/listings`, with no "What to change" combobox (C3).
4. After the preview resolves, the button stays `aria-busy` until unmount. Mock `router.push` as a never-resolving no-op and assert a second click doesn't call `previewBulkChange` again (C4).
5. A `bulk_targets_unavailable` error shows the "Choose listings" link, and editing a field clears the failure (C5).

Checks to run: `pnpm typecheck`, `pnpm lint`, `pnpm exec vitest run tests/components/bulk-compose.test.tsx`, and the journey e2e for operations-features. Check `package.json` for script names.

## 10. Screenshot states

- **The visual fixture can't reach the compose form.** `tests/visual/nm-capture.mjs:113-114`, `:132` and `mobile-audit-lib.mjs:40` capture `/listings/bulk`, `/listings/bulk/<zero uuid>` and `viewer:/listings/bulk`.
- The journey tenants are seeded by `tests/e2e/helpers/stub-bridge` through `tests/visual/fixture-server.ts`. They have no `organisation_feature` row, so the feature is off (`org-features.ts:37`):
  - The owner gets the not-found page ("This page doesn’t exist").
  - `viewer:/listings/bulk` gets **AccessDenied "Bulk changes"**, because the role check runs before the feature check (`page.tsx:14-16`).
  - Those two are the only bulk states screenshots can show today.
- **The e2e specs enable bulk per test, in an isolated tenant.** `f.enableFeature("bulk_actions")` inserts into `organisation_feature` for that fixture's organisation (`tests/e2e/helpers/operations-backend.ts:152-155`, used at `operations-features.spec.ts:564`, `:625`).
- Those specs already `capture(...)`:
  - `bulk-selection`, `bulk-compose`, `bulk-preview` (`:579`, `:584`, `:595`).
  - `bulk-confirmed`.
  - `bulk-compose-list`, `bulk-preview-countdown`, `bulk-preview-expired`, `bulk-receipt` (`:643-698`).
  - Use those artefacts for before and after. Don't turn the flag on in the shared visual or dev database.
- States that need new captures in those specs (same isolated pattern):
  - The first-run problem line (C1).
  - The disabled-reason bar (C2).
  - No-ids (C3). This works even with the feature off for the URL, but the feature must be on to get past `notFound()`.
  - A preview error (C5, from a stubbed 404 or 429).
  - Pending (C4).
