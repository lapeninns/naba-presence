# p3-F10 — See who manages the Google listing and invite someone

Code read at `/tmp/naba-presence-p3` (`ux/flows-presence-p3`, head `e4123d25`). Read-only analysis. The danger zone and lifecycle are excluded because another flow owns them. They are mentioned only where this flow's layout touches them.

## 1. Flow

- **ID / name:** p3-F10, see who manages the Google listing and invite someone (also covers changing a role, removing someone, and accepting or declining an invitation sent to the connected login).
- **Goal:** an owner or admin can see who has access to this listing on Google and add a person at the right role and scope. Nothing reaches Google until a review has been approved and sent.
- **Start:** `/listings/[id]/people` (`app/(dashboard)/listings/[id]/people/page.tsx:20-35`, `StreamedTab` → `AreaEditor area="people"`) → `AccessTab` (`components/locations/administration/administration-tab.tsx:391`).
- **End (success):** the invitation sheet shows the recorded outcome. Google lists the invitee with "Invitation pending" (`access-outcome.tsx:13-16`; `admins-table.tsx:75-76`) after the roster is read again (`access-workspace.tsx:49-52`).
- **End (other):** the sheet is closed with "Back to access" or "Close for now" (`invite-sheet.tsx:151-155`). The review stays under "Saved access work" for a second approver (`access-workspace.tsx:95-112`).
- **Roles:** owner and admin (`canEditCanonical`). Members and viewers get `AdministrationDenied` (`administration-tab.tsx:222-230`). Every API route is `roles: ["owner","admin"]`, and approve and execute also need `mfa: "step_up"` (`app/api/locations/[id]/administration-access-reviews/[reviewId]/route.ts:12`, `…/execute/route.ts:12-17`).

## 2. Code map

| Piece                                         | Where                                                                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Route, prefetch                               | `people/page.tsx:20-35`; `lib/server/prefetch.ts:987-997` (`peopleTabPrefetch`, owners and admins only)                                                      |
| Shell: denied, loading, error, gate           | `administration-tab.tsx:185-258` (`AdministrationShell`, `LocationTab requires="canEditCanonical"`); `components/locations/location-tab.tsx:185-213,249-252` |
| Sub-resource error and retry                  | `administration-tab.tsx:51-94` (`Sub`), `:109-145` (`AdministrationReadError` → `SectionLoadError`), `:147-169` (refresh error)                              |
| Roster                                        | `administration-tab.tsx:415-475`; `admins.tsx:62-98` (`AdminsSection`), `:115-178` (role select), `:185-217` (Remove); `admins-table.tsx:35-88`              |
| Invitations to the login                      | `invitations.tsx:29-56` (list and empty), `:60-145` (row, Review accept/decline)                                                                             |
| Invite trigger                                | `invitations.tsx:149-161` (`CreateAdminDialog`, "Invite someone")                                                                                            |
| Invite sheet (form → review → outcome)        | `invite-sheet.tsx:62-457` (`ReviewedWriteSheet`)                                                                                                             |
| Access workspace, panel, saved work           | `access-workspace.tsx:37-114`; `access-review.tsx:107-236`; `access-outcome.tsx:30-121`                                                                      |
| Controller (preview, approve, execute, check) | `use-administration-access.ts:12-93`                                                                                                                         |
| Context / gate                                | `context.tsx:32-54` (`writeBlocked = disabled \|\| publishReason`)                                                                                           |
| Denied page                                   | `administration-denied.tsx:31-92`                                                                                                                            |
| API client                                    | `lib/api/google-administration-access.ts:6-26` → `app/api/locations/[id]/administration{,-access-reviews,-access-workflows}`                                 |

**Tests:**

- e2e `tests/e2e/administration-access-backend.spec.ts`: `:208` "invites at the exact {location,account} scope and restores the pending invitation outcome", `:213` role change, `:218` removal with typed name, `:241` "reviews and independently confirms invitation {accept,decline}", `:283` "fits the people panels and the invitation sheet" (layout widths).
- e2e `administration-access-recovery.spec.ts`: `:108`, `:139`, `:144`, `:176` (second-manager approval), `:239`.
- e2e `listings.spec.ts:300` "console role walk: People/Verification hidden for member/viewer…" (the GET never fires for a non-manager).
- e2e `gbp-management-tabs.spec.ts` "Access tab humanises admin roles…".
- Component: `tests/components/access-tab.test.tsx` (`:217` ordering, `:323-441` roster truthfulness), `administration-sections.test.tsx:160-378`, `administration-access-workflow.test.tsx:61-230`.

## 3. Steps today

1. **Open the People tab.** While capabilities load, a `TabLoading` labelled "people with access" shows (`location-tab.tsx:197`).
   - **Denied (member or viewer):** "Only owners and admins can see who has access", with "Back to listing" and "Copy an access request" (`administration-denied.tsx:15-19,52-75`).
   - **Errors:** a capabilities or resource error shows `TabError` with retry (`location-tab.tsx:185-190,249-250`).
2. **Read the roster.** The page shows:
   - The heading "People with access on Google", with the summary `"{n} people · {m} invitations · Read from Google at {time}"` (`administration-tab.tsx:312-372`) and an "Invite someone" button in the header actions (`:425`).
   - Location admins, as rows with an avatar, the email, the role in words, and a "Has access" or "Invitation pending" pill (`admins-table.tsx:53-82`).
   - Row controls: a role select and Remove. Primary-owner and last-owner rows show a lock reason instead (`admins.tsx:47-59,83-91`).
   - Then "Account admins" (`:437-460`), "Pending invitations" ("{m} waiting", `:462-475`), "Primary owner rules" (`:479-488`), a Team note (`:489-500`), the **Danger zone** (`:502`), and **only then "Saved access work"** (`access-workspace.tsx:95`).
   - **Partial failure:** a per-section `SectionLoadError` with "Retry {x}" and "Check Google connections" (`administration-tab.tsx:121-143`). Counts show as "unavailable", never as 0 (`:338-352`).
   - **Empty:** "No account-level admins." (`:379`), "No pending invitations." (`invitations.tsx:36-41`), "Google listed no one here." (`admins-table.tsx:45`).
3. **Tap "Invite someone".** The sheet opens with the title "Invite someone" and the description "Google emails them an invitation. They get access once they accept it on Google. Reviewing sends nothing yet." (`invite-sheet.tsx:209`).
   - The form has Email address, Role (Manager by default; Owner or Manager), and Scope ("This location" or "The whole Google account") (`:384-443`).
   - No text says what either role or scope allows.
4. **Type the email (input and validation).** The error "Enter a valid email address." appears from the **first keystroke** of a not-yet-valid address (`invite-sheet.tsx:115-119`). It renders as `role="alert"`, because the form has no `FormErrorScope` (`components/ui/field.tsx:373`).
   - "Review invitation" stays disabled, with no reason given, until the address parses (`:137-142,294`).
   - Escape or a scrim tap with a typed address asks before discarding (`:156-163,449-454`).
5. **Review invitation (in progress).** The button reads "Reviewing…" (`:296`), then the toast "Invitation ready to approve" (`:132`). The same sheet becomes "Review invitation" with steps, a `SummaryList` (Listing, Action, Google target, Scope, Invitee, Proposed role, Observed by Google, Google reference) and the expiry (`:330-338`; `access-review.tsx:44-105`).
   - Footer: Back to access / Check saved access outcome / Approve access request (`invite-sheet.tsx:246-281`).
   - **Two-person policy:** "A different authorised owner or admin must approve this request. They can open it under Saved access work." (`:346-348`).
6. **Approve, then consent, then "Send approved access request"** (`:262-270,352-361`). The send status reads "Tick the box to send this exact request." until the box is ticked, then "Ready to send once to Google." (`:176-182`). While sending: "Sending… you can close this when it finishes." (`:311-316`). The sheet can't be dismissed in flight (`:159`).
7. **Outcome (confirmed by the server).** "Saved invitation outcome" shows `OutcomeSummary` with the effect "Google lists the invitation. They get access once they accept it." (`access-outcome.tsx:14-15`).
   - "Unresolved" blocks further writes (`:100-106`). "Refresh unavailable" shows an alert (`:107-111`). "Rejected" shows advice (`:113-117`).
   - The roster hides itself behind `StaleRosterPlaceholder` until Google's list after the change arrives (`access-workspace.tsx:120-131`). Then the invitee shows "Invitation pending", but "Pending invitations" still says "0 waiting" and the summary says "0 invitations".
8. **Role change and Remove** (same model, page panel). Picking a different role saves a review straight away (`admins.tsx:154-158`, toast "Administrator role review saved"). Remove saves a review, and the send step asks for the typed listing name (`access-review.tsx:141-156,197-205`).

## 4. Protected rules for this flow

- Owner/admin only, enforced on the server (route `roles`, plus `mfa: "step_up"` on approve, execute and refresh). On the client, the GET is never fired for others (`administration-tab.tsx:176-184,222-238`; `lib/server/prefetch.ts:991`).
- Preview saves a review and **sends nothing**. Send needs approval, a separate consent, and an unexpired, non-stale review (`invite-sheet.tsx:169-175,262-270`; `use-administration-access.ts:43-71`). A second approver is required when policy says so (`requiresSecondApprover`, `canApprove`).
- A removal needs the exact typed listing name at send (`access-review.tsx:141-144`).
- The primary owner and the last owner can't be changed or removed (`admins.tsx:47-59,149,201`).
- One Google write at a time: `busy` / `unresolved` gate every control and the lifecycle (`access-workspace.tsx:53,71`; `invitations.tsx:114-120,154`).
- Never claimed before the server confirms: the outcome comes from the attempt's `confirmationState` and `postcondition` (`access-outcome.tsx:11-28`). The roster read before a confirmed change is hidden, never shown as current (`access-workspace.tsx:48-51`; `admins.tsx:73-76`). Failed reads say "unavailable", never 0 (`administration-tab.tsx:307-372`).

## 5. Prior audit status

| ID                                                                                                                                                                          | Status                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LST-26 (invite jumps sheet → panel; jargon toast)                                                                                                                           | **Fixed.** One `ReviewedWriteSheet` (`invite-sheet.tsx:192`), toast "Invitation ready to approve" (`:132`), trigger "Invite someone" (`invitations.tsx:158`).                                                                                                                                                                                         |
| LST-08 (people uses its own write model)                                                                                                                                    | **Fixed** for people (`ReviewedWriteSheet`, results.md row LST-08).                                                                                                                                                                                                                                                                                   |
| LST-14 (fetch after hydration)                                                                                                                                              | **Fixed** (`StreamedTab`, `people/page.tsx:27-33`). The mobile People LCP (1,644 ms against a 1,500 ms budget) and first-load JS (567 KB against 520 KB) are still over budget: follow-up 29. Performance, out of scope here.                                                                                                                         |
| LST-30 ("Check" verb on the area card for People)                                                                                                                           | Overview-card copy (`components/listings/area-cards.tsx`), owned by the overview flow, not here.                                                                                                                                                                                                                                                      |
| Release gate G4/G5: `administration-access-backend.spec.ts:37` axe `color-contrast` 2.44 (`#6a7176` on `#a2bda7`) and 2.69 (`#6a7176` on `#b1c4b5`) in the invitation sheet | **Test-side workaround only.** `f90208a1` (F4, #216) diagnosed it as "axe sampled the sheet's footer button mid-transition between its primary and secondary variants" and made the audit wait for transitions (`tests/e2e/helpers/administration-capture.ts`, `settled()`). The product still animates one button between variants. See friction #2. |
| Phase-2 note "Email addresses break mid-word … in the invitation row"                                                                                                       | Ambiguous: most likely Team's invitation row (p6). `admins-table.tsx:63` uses `wrap-anywhere` on purpose, so two similar addresses are never cut to the same text. No change proposed.                                                                                                                                                                |

## 6. Friction

| #   | Problem                                                                                                                                                                                                                                                                                                                                                                                                | Evidence                                                                                                                                                                                                                                                    | Sev | Heuristic / WCAG                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------------------------------------------------------------------------------------- |
| 1   | "Pending invitations" lists only invitations **to the connected login** (accept/decline), but it sits beside "Invite someone". After inviting, the invitee appears under People with access as "Invitation pending", while the section says "0 waiting" and the summary "0 invitations". The row's "waiting for a reply on Google" reads as someone else's reply, but it is the operator's own answer. | `administration-tab.tsx:346-352` (`… invitations`), `:387` (`{n} waiting`), `:469` ("Pending invitations"); `invitations.tsx:39-40` ("Invitations for this Google account appear here…"), `:105` ("· waiting for a reply on Google"); `admins-table.tsx:76` | P2  | Nielsen: match with the real world, visibility of status                              |
| 2   | Moving through the invitation sheet's steps re-uses the same footer `<Button>` DOM node with a different variant (form "Review invitation" default → review "Check saved access outcome" secondary; review "Send…" default → outcome "Refresh…" secondary). It eases over 140 ms through low-contrast frames, which is the root of the intermittent axe failure.                                       | `invite-sheet.tsx:219-302` (three unkeyed fragments in one `footer`); `components/ui/button.tsx:35` (`transition-[background-color,…,color] duration-(--np-duration-fast)`); results.md "Release gate (G4 and G5)"; `f90208a1` message                      | P2  | WCAG 1.4.3 (transient), HIG consistent feedback; release-gate stability               |
| 3   | The Role and Scope pickers give no consequence. "Owner" and "The whole Google account" are one tap away, with nothing saying what they grant. Over-granting is easy (the Team invite sheet fixed the same problem in SET-03).                                                                                                                                                                          | `invite-sheet.tsx:395-443` (labels only); `ADMIN_SCOPE_LABELS` `:41-44`                                                                                                                                                                                     | P2  | Nielsen: error prevention; HIG clarity                                                |
| 4   | The email error fires on the first character and is `role="alert"`, so a screen reader is interrupted while the person is still typing. A disabled "Review invitation" gives no reason, and Enter on an invalid address does nothing visible.                                                                                                                                                          | `invite-sheet.tsx:115-119,137-142,376-379`; `components/ui/field.tsx:373` (no scope → `alert`)                                                                                                                                                              | P3  | WCAG 3.3.1/4.1.3 (premature, assertive), Nielsen: error prevention, user control      |
| 5   | "Saved access work" (where a second approver opens a pending invitation, as the sheet tells them) renders **after the Danger zone**, so the approver scrolls past "Delete this location" and "Transfer" to reach it. That contradicts `SavedWorkList`'s own rule, "one place: after the thing it belongs to".                                                                                          | `access-workspace.tsx:93-112` (children, then `SavedWorkList`); `administration-tab.tsx:502` (`DangerZone` last child); `components/reviewed-write/saved-work-list.tsx:24-25`; `invite-sheet.tsx:347`                                                       | P2  | HIG hierarchy / preserved context; Nielsen: recognition over recall                   |
| 6   | **Hypothesis:** "Remove" on an "Invitation pending" row reads as removing access, but it actually withdraws the invitation (operation label "Remove administrator").                                                                                                                                                                                                                                   | `admins.tsx:203-215`; `access-review.tsx:26`                                                                                                                                                                                                                | P3  | Nielsen: match. Not proposed (the label is per operation and shared with the review). |

## 7. Proposed changes

**C1 — Name the two kinds of invitation (#1).** Copy only. Ids, `aria-labelledby` and the `Sub` title ("Invitations") stay unchanged, so the error and retry copy and the e2e locators still work.

- `administration-tab.tsx:469`: title "Pending invitations" → **"Invitations to answer"**.
- `:387` `InvitationsSummary`: `` `${n} waiting` `` → `` `${n} waiting for the connected Google login` ``.
- `:348-352` `PeopleSummary`: `plural(m, "invitation", "invitations")` → `` `${plural(m, "invitation", "invitations")} to answer` ``. Add a pending-invitee note to the people part when the count is above 0: `` `${plural(n,"person","people")}, ${k} not yet accepted` ``, where `k` = location + account admin rows with `pendingInvitation === true`, read from the existing `state` data. The failure strings stay byte-identical.
- `invitations.tsx:39-40`: empty title "No pending invitations." → **"No invitations to answer."**; description → **"Invitations Google sends to the connected login appear here. People you invite are listed above, marked Invitation pending."**
- `invitations.tsx:105`: "· waiting for a reply on Google" → **"· waiting for your answer"**.
- **Files:** `administration-tab.tsx`, `invitations.tsx` (area-local).
- **Benefit:** after inviting, the person sees their invitee where the page says they will be, and "0" no longer contradicts it.
- **Risk:** none. Text only; the "unavailable, never 0" logic is untouched.
- **Tests:** update `tests/components/access-tab.test.tsx:397,414,441` (regex `0 invitations to answer ·`) and `administration-sections.test.tsx:245,268,270,276`. Add an assertion that a roster containing one `pendingInvitation: true` admin renders "2 people, 1 not yet accepted".

**C2 — One set of footer buttons per sheet step (#2, release-gate contrast).**

- `invite-sheet.tsx:219-302`: wrap each footer branch in a keyed fragment: `<Fragment key="outcome">…`, `<Fragment key="review">…`, `<Fragment key="form">…` (import `Fragment` from `react`). React then mounts fresh buttons per step instead of animating one node from primary to secondary. Approve → Send stays inside `key="review"`, which is the same variant, so nothing changes there.
- Focus is already re-claimed by the title on each step (`useClaimFocus`, `:106-109`), so the remount loses nothing.
- Keep the e2e `settled()` wait; it is harmless and guards other transitions.
- **Files:** `invite-sheet.tsx` only. The shared `components/ui/button.tsx` and `components/reviewed-write/sheet.tsx` are not touched.
- **Benefit:** no 140 ms half-green frame for users, and the root cause of the intermittent axe `color-contrast` is removed.
- **Risk:** none. Same handlers, disabled states and pending flags.
- **Test:** in `administration-sections.test.tsx` (invite flow), keep a reference to the "Review invitation" footer button, submit a valid address, find "Check saved access outcome", and `expect(oldButton.isConnected).toBe(false)`.
- **Follow-up (out of scope):** the same pattern may exist in other `ReviewedWriteSheet` footers (booking `place-action-approval-sheet.tsx`). Check them in their own flows.

**C3 — Say what the role and scope grant (#3).** Add a `FieldDescription` (already exported from `components/ui/field.tsx`, used at `contact-section.tsx:102`) that changes with the selection. It is wired through `aria-describedby` by `Field`.

- **Role** (`invite-sheet.tsx:395-418`):
  - MANAGER: **"Edits the listing and replies to reviews. Can't manage people or remove the listing."**
  - OWNER: **"Everything a manager can do, plus managing people and removing the listing."**
- **Scope** (`:419-443`):
  - location: **"Only this listing."**
  - account: **"Every listing in this Google account."**
- Keep it as a `ROLE_HINTS` record next to `ADMIN_SCOPE_LABELS` (`:41`).
- **Files:** `invite-sheet.tsx` (area-local; `field.tsx` is used, not edited).
- **Benefit:** fewer over-granted owners and account-wide invites, and the decision is made at the point of choice.
- **Risk:** none. Values and schema are unchanged (`createAdminSchema`).
- **Test:** in `administration-sections.test.tsx:328`, assert that the Role combobox has an accessible description containing "Can't manage people", and that it changes after choosing Owner.

**C4 — Validate the email on blur or submit, not per keystroke (#4).**

- `invite-sheet.tsx:115-119`: add `const [emailTouched, setEmailTouched] = useState(false)`. Show `emailError` only when `emailTouched && email.trim() && !parsed.success`.
- `onBlur={() => setEmailTouched(true)}` on the `Input` (`:386-392`).
- In `onSubmit` (`:376-379`), call `setEmailTouched(true)` before the `cannotSubmit` check, so Enter on a bad address now shows the error.
- Reset `emailTouched` in `close()` and in the create `onSuccess` (`:134,144-147`).
- The button's disabled rule is unchanged.
- **Files:** `invite-sheet.tsx`.
- **Benefit:** no assertive alert mid-typing, and Enter gives visible feedback.
- **Risk:** none. The submit gate is identical, and an invalid address is still never previewed.
- **Tests:** in `administration-sections.test.tsx:279`, after typing "not-an-email", `await userEvent.tab()` before expecting the error, and add `expect(screen.queryByText("Enter a valid email address.")).toBeNull()` before the blur. In `:308`, after `not-an-email{Enter}`, expect the error text.

**C5 — Put "Saved access work" with the access roster, before the explainers and the Danger zone (#5).**

- `access-workspace.tsx:37`: add an optional prop `after?: ReactNode`. Render it after `SavedWorkList`, inside a second `<AdministrationProvider … publishReason={publishReason}>` with exactly the composed values used at `:93`, so the Danger zone keeps the busy, unresolved and roster gates (**must not change**).
- `administration-tab.tsx:477-502`: move the "Primary owner rules" `Alert`, the Team note and `<DangerZone />` from `children` into `after={…}`.
- **New order:** roster → Account admins → Invitations to answer → Saved access work → Primary owner rules → Team note → Danger zone → Saved lifecycle work. The danger zone's own content is unchanged; only Saved access work moves above it.
- Standalone uses of the workspace (`administration-access-workflow.test.tsx:48`, `administration-sections.test.tsx:42`) pass no `after`, so they behave as before.
- **Files:** `access-workspace.tsx`, `administration-tab.tsx` (area-local). **Coordinate with the lifecycle/danger-zone flow:** its JSX moves but is not edited.
- **Benefit:** the second approver reaches the pending invitation without passing destructive controls, and saved work sits after the thing it belongs to.
- **Risk:** the gating context, which the second provider preserves. Lifecycle saved work is unchanged.
- **Test:** `access-tab.test.tsx:217`. Rename it to "…saved access work after the roster and before the explainers; saved lifecycle work after the danger zone". Assert `before(roster, savedAccess); before(savedAccess, rules); before(rules, danger); before(danger, savedLifecycle)`. Add a test that the Danger zone buttons are disabled while an access review is unresolved (from `after`).

**Follow-ups (out of scope):** People LCP and first-load JS budgets (follow-up 29). Per-operation copy "Withdraw invitation" for pending rows (#6) needs a label decision across the review and outcome. The footer-variant check on other `ReviewedWriteSheet` callers.

## 8. Screenshots to capture

1. `/listings/{loc}/people`, owner, 390 and 1280, no interaction. Shows the roster, "Invitations to answer" copy, and Saved access work above the Danger zone (C1, C5). The fixture needs Google admin data. If the visual fixture has none, use the e2e `captureVerificationSection` outputs `location-admins` / `account-admins` from `administration-access-backend.spec.ts:208`.
2. `/listings/{loc}/people`, member, 390, no interaction. The denied state; baseline only, unchanged.
3. Invite sheet form, owner, 390. **Interaction needed** (tap "Invite someone"; choose Owner). Role and scope hints (C3). Reuse the e2e capture `invitation-empty` / `invitation-filled`.
4. Invite sheet with "not-an" typed, then blurred, owner, 390. **Interaction needed.** The before shows the error mid-typing; the after shows no error until blur (C4).

## 9. Files touched

components/locations/administration/administration-tab.tsx
components/locations/administration/invitations.tsx
components/locations/administration/invite-sheet.tsx
components/locations/administration/access-workspace.tsx
tests/components/access-tab.test.tsx
tests/components/administration-sections.test.tsx

(No SHARED files. `components/ui/field.tsx` `FieldDescription` and `components/ui/button.tsx` are used, not edited.)
