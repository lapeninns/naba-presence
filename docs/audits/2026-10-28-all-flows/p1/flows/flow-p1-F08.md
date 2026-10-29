# p1-F08 · Accept a team invitation (`/invite/[token]`)

Read-only analysis of worktree `/tmp/naba-presence-p1` at `e4123d25` (branch `ux/flows-presence-p1`). Paths are repo-relative.

## 1. Flow ID, name, start and end

- **ID / name:** p1-F08, accepting a team invitation.
- **Start:** the invitation email link `/invite/{token}`. Two other ways in:
  - `/invite/{token}?mode=sign-in`, after "Sign out and continue" (`components/auth/invitation-actions.tsx:54`).
  - `/sign-in?invite={token}` (`app/(auth)/sign-in/page.tsx:17,31,34`). That one belongs to F01 and is only a boundary here.
- **Server page:** `app/(auth)/invite/[token]/page.tsx:14-27`.
  - Reads `?mode`. Only `sign-in` is honoured; anything else means create-account.
  - Reads the session (`getSession`) and passes `viewer {displayName,email}`, or `null`.
  - Renders `InvitationView` inside `QueryProvider`.
- **Success destinations:**
  - Signed in with the matching address: `POST` accept, then `hardNavigate("/inbox")` (`invitation-actions.tsx:31-35`).
  - Signed out, signing in: `/inbox`, or `/sign-in/verify` when MFA is needed (`sign-in-form.tsx:201-205`).
  - Signed out, creating an account: `/inbox` when the server signs them in, otherwise the in-place "Check your email" stage (`sign-in-form.tsx:243-248`). The emailed link carries `inviteToken` through `/auth/confirm` to `/confirm-email` and then `/inbox` (`app/api/auth/password/register/route.ts:27-29`, `app/auth/confirm/route.ts:61-63,104-107`). That is F0x (confirm email).
- **Boundaries:**
  - F01 sign-in (the embedded `SignInForm`).
  - Forgot password, from the "Forgot password?" link (`sign-in-form.tsx:427-435`).
  - Confirm email.
  - The Team or Settings flow that creates and resends invitations (`app/api/invitations/route.ts`, `[token]/resend`). Out of scope here.

## 2. Steps today

1. The server page renders. The client then fetches **GET `/api/invitations/{encodeURIComponent(token)}`** once, with `retry: false` (`invitation-view.tsx:145-149`, `lib/api/auth.ts:117-125`).
   - While it waits, a skeleton card shows: h1 "Checking your invitation", the invite aside, and an `aria-busy` block (`invitation-view.tsx:151-168`).
2. The lookup answers (`app/api/invitations/[token]/route.ts:20-75`). Rate limit: `invitation_lookup`, 60 per 15 min per IP, 429 `auth_rate_limited` (`lib/server/abuse-limits.ts:100-103`).
   - 404 `invitation_not_found` (`:44-46`).
   - 410 `invitation_expired`. Expiry is checked first (`:52-58`).
   - 409 `invitation_already_used` (`:59-65`).
   - 200 `{organisationName,email,role,expiresAt}`, built field by field (`:66-73`).
3. **Error branches** (`invitation-view.tsx:170-202`):
   - 409: an info Alert "You have already accepted this invitation.", then the full-width "Go to sign in" link (`:178-187`).
   - 404 or 410: a destructive `AuthErrorAlert` with the copy from `lib/api/auth-errors.ts:84-91`, then "Go to sign in" (`:188-195`).
   - Anything else (5xx, 429, a dropped network, a schema failure): the GENERIC alert "Something went wrong. / Try again in a moment." (`auth-errors.ts:37-40`), or "Too many attempts." for a 429. A "Try again" button calls `query.refetch()` (`:196-198`). The refetch puts the query back to `pending` because there is no data yet (`@tanstack/query-core/build/modern/query.js:411-419`), so the skeleton returns and the button unmounts.
4. **Live invitation, signed out** (`:206-231`):
   - Title "Join {org}". The description depends on `initialMode` (`:212-215`).
   - An `InvitationDetails` card with Organisation, Sent to, Role (plus a one-line summary) and Link expires (`:66-127`).
   - `SignInForm` with `inviteToken` and `invitedEmail`:
     - Email is prefilled and `readOnly`, with the hint "The address this invitation was sent to." (`sign-in-form.tsx:398-411`).
     - A segmented Sign in / Create account control (`:330-349`).
     - Create account: Your name and Password with requirements, one field (D9).
     - Sign in: Password, "Forgot password?" and the resend disclosure.
   - Submit calls **POST `/api/auth/password/login`** `{email,password,inviteToken}` or **POST `/api/auth/password/register`** `{displayName,email,password,inviteToken}`. Errors render inline, with focus moved to the first bad field or to the alert (`:151-155,211-217,249-255`).
5. **Live invitation, signed in** (`invitation-view.tsx:233-256`):
   - No `aside` prop, so the **product** panel shows rather than the invite panel.
   - The details card adds a "Signed in as" row (`:98-100`).
   - **Matching address**, compared trimmed and case-insensitively (`invitation-actions.tsx:24-25`):
     - The description says "Accepting adds {org} to the account you are already signed in with.", then a paragraph "You are signed in as X, the address this invitation was sent to." (`:63-66`), then "Accept invitation".
     - Accepting sends **POST `/api/invitations/{token}`**. The response is `{accepted:true, organisationId}`, plus a new session cookie (`route.ts:85-110`).
     - On success: `hardNavigate("/inbox")`.
     - On error: an inline `AuthErrorAlert` (`:36-38,62`), for example `invitation_expired`, `invitation_already_used`, `invitation_changed`, `invitation_email_mismatch`, `member_limit_reached`, `invitation_scope_empty`, `support_session_forbidden` (`auth-errors.ts:84-116`).
   - **Different address:**
     - The description says "This invitation belongs to a different account.", then a paragraph "You are signed in as X, but this invitation is for Y." (`:83-85`).
     - The **only** action is "Sign out and continue". It sends **DELETE `/api/session`**, then always navigates to `/invite/{token}?mode=sign-in`, even when the sign-out failed (`:42-57`).
6. **Pending treatment:** every button here uses `disabled={pending}` and swaps its label ("Accepting…", "Signing out…", "Signing in…", "Creating account…") (`invitation-actions.tsx:73-75,92-94`, `sign-in-form.tsx:453-467`). None uses `Button`'s own `pending`/`pendingLabel`, which draws a spinner, sets `aria-busy` and keeps focus (`components/ui/button.tsx:148-154,271-273`; 114 callers elsewhere use it).

## 3. States inventory

Every lookup is a browser `fetch`, so it can be stubbed. A good pattern:

```ts
page.route(/\/api\/invitations\/[^/?]+(\?.*)?$/, handler)
```

Branch on `route.request().method()` (`GET` for the lookup, `POST` for accept). Error bodies take the shape `{"error":"<code>","message":"…"}` (`lib/api/client.ts:354-373`).

The e2e server runs with `PASSWORD_AUTH_ENABLED=false` (`playwright.config.ts` webServer env), so stub login and register too.

Signed-in states need a real cookie, because `getSession` runs on the server:

```ts
applyCookie(page, baseURL, (await readJourneyState()).cookie)
```

The pattern is in `tests/e2e/settings.spec.ts:26-41`. Read that owner's address from `page.request.get('/api/session')`, under `session.email`, and put it in the stubbed lookup's `email` to get the matching case.

Live body used below (L):

```json
{"organisationName":"Lapen Inns","email":"invited@example.test","role":"member","expiresAt":"2099-10-22T14:05:00.000Z"}
```

| State | How reached | What the user sees | Notes |
|---|---|---|---|
| S1 Loading | GET held: handler `await new Promise(r=>setTimeout(r,15000))` before fulfilling | h1 "Checking your invitation", 4 skeleton blocks, invite aside at ≥1024px | `invitation-view.tsx:151-168` |
| S2 Lookup 500 | GET → 500 `{"error":"internal_error","message":"x"}` | "Accept invitation", alert "Something went wrong. Try again in a moment.", button "Try again" | `:196-198` |
| S2b Network | GET → `route.abort("failed")` | Same as S2 (a non-ApiClientError is GENERIC) | `auth-errors.ts:175-183` |
| S2c Rate limited | GET → 429 `{"error":"auth_rate_limited","message":"x"}` | "Too many attempts. Wait a while, then try again." and "Try again" | Retrying straight away just hits the limit again |
| S2d Retry in flight | From S2, stub the 2nd GET with a delay, click "Try again" | Back to the skeleton; focus falls to `<body>` | F9 |
| S3 Not found | GET → 404 `{"error":"invitation_not_found","message":"Invitation not found."}` | "We could not find that invitation. / Check the link, or ask for a new invitation.", "Go to sign in" | No details (D8) |
| S4 Expired | GET → 410 `{"error":"invitation_expired","message":"This invitation is invalid or expired."}` | "That invitation has expired. / Ask an organisation owner or admin…", "Go to sign in" | Covered by `auth.spec.ts:121` |
| S5 Already used | GET → 409 `{"error":"invitation_already_used","message":"x"}` | Info alert "You have already accepted this invitation." (no description), "Go to sign in" | F5 |
| S3–5 signed in | The same, with the journey cookie applied | The same screens; "Go to sign in" redirects to /inbox | `sign-in/page.tsx:24`; F4 |
| S6 Signed out, create | GET → 200 L, no cookie, `/invite/tok` | "Join Lapen Inns", "Set a password and…", 4 rows, toggle on Create account, Your name, locked email, Password | `auth.spec.ts:141`, `accessibility.spec.ts:538` |
| S6b Toggled to Sign in | From S6, click "Sign in" | Form becomes sign-in; **description still "Set a password…"** | F1 |
| S7 Signed out, `?mode=sign-in` | GET → 200 L, `/invite/tok?mode=sign-in` | "Sign in with the invited address…", Sign in pressed | Toggling to create keeps the stale copy |
| S7b Sign-in error | S7 plus POST `/api/auth/password/login` → 401 `{"error":"invalid_credentials","message":"x"}` | Alert "That email or password is incorrect." gets focus | In F01's form |
| S7c Sign-in success | Login → 200 `{"authenticated":true,"mfaRequired":false}` | Navigates to /inbox (the stubbed login sets no cookie, so it bounces to sign-in) | Only capture the press |
| S6c Create → confirm sent | S6 plus POST `/api/auth/password/register` → 202 `{"authenticated":false,"confirmationRequired":true}` | "Check your email" stage under the unchanged "Join…" header and rows | Description still "Set a password…" (hypothesis: stale) |
| S6d Create field errors | S6, submit empty | Inline field errors, focus on Your name | Client-side zod |
| S8 Signed in, match | Cookie plus GET → 200 L with `email` = the owner's address | Product aside, "Accepting adds…", 5 rows including Signed in as, paragraph repeating the address, "Accept invitation" | F6, F7 |
| S8b Accept pending | S8 plus a delayed POST stub | Disabled "Accepting…", no spinner, focus dropped | F2 |
| S8c Accept error | S8 plus POST → 410 `{"error":"invitation_expired","message":"x"}` (also try 409 `invitation_already_used`, 409 `invitation_changed`, 403 `member_limit_reached`) | Destructive alert above the paragraph; "Accept invitation" active again | F8 |
| S8d Accept success | S8 plus POST → 200 `{"accepted":true,"organisationId":"00000000-0000-0000-0000-000000000000"}` | Navigates to /inbox; the button is enabled again during the unload | F2. Without the real cookie swap, inbox shows the existing org |
| S9 Signed in, mismatch | Cookie plus GET → 200 L (`invited@example.test`) | "This invitation belongs to a different account.", "You are signed in as X, but…", one button "Sign out and continue" | F3 |
| S9b Sign out | S9 plus DELETE `/api/session` → 204 | Navigates to `?mode=sign-in`. Use a stub, or the journey session is destroyed | Never unstubbed |
| S9c Sign-out failure | DELETE → 500 | Navigates back, still signed in, the same S9 screen with no explanation | Not proposed (§8) |

## 4. Protected rules

- **The token only goes to the API.**
  - Path-encoded GET and POST (`lib/api/auth.ts:110-125`).
  - The register and login bodies (`sign-in-form.tsx:184,222-227`).
  - The resend body (`lib/api/auth.ts:62-70`).
  - The confirmation URL (`register/route.ts:27-29`).
  - The client never logs or renders it. The hard navigation back to `/invite/{token}` is same-origin (`invitation-actions.tsx:54`, `lib/client/hard-navigate.ts`).
- **A finished invitation reveals nothing.** 404, 410 and 409 carry no organisation, address, role or expiry. Expiry is checked before "accepted" (`route.ts:47-65`). The UI never names the organisation on a dead end (`invitation-view.tsx:171-173`).
- **The live lookup is built field by field** (`route.ts:66-73`). Role and expiry are shown for a live invitation only (D8, done, #176).
- **Lookup and accept are rate-limited** (`route.ts:23,88-91`, `abuse-limits.ts:100-107`).
- **The invited address is locked** on the form (`sign-in-form.tsx:404`). The server enforces `invitation_email_mismatch` (`lib/server/registration.ts:51-53`, `provisioning.ts:362-364`).
- **Accepting with an existing session** keeps the same assurance level and retires the old session in its own tenant (`route.ts:92-104`). Hard navigation follows, so no state from the old organisation survives (`invitation-actions.tsx:32-35`).
- **No account enumeration:**
  - "If {email} can be used for a new account…" (`sign-in-form.tsx:272-283`).
  - The resend disclosure is always present (`:479-501`, D3).
- **Server authority:** nothing reads as success until the POST resolves (`invitation-actions.tsx:30-35`).
- **Single password field** (D9, done, #206).

## 5. Prior audit status (15 Oct)

| ID | Touches F08? | Status, verified in code |
|---|---|---|
| SET-17 role not shown | Yes | **Fixed.** `route.ts:66-73` returns role and expiry for a live invitation only; Role and Link expires rows at `invitation-view.tsx:87-97`; `tests/components/invitation.test.tsx:57,96`, `auth.spec.ts:141` |
| SET-18 confirm password, composition rules | Yes (create mode) | **Fixed.** One `PasswordField` (`sign-in-form.tsx:442-450`), length-only rules |
| SET-23 errors ignore the surface | Yes | **Fixed.** `authErrorMessage(…, "invitation")` (`invitation-view.tsx:192`, `invitation-actions.tsx:37`), `UNAVAILABLE_TITLE.invitation` (`auth-errors.ts:28`) |
| CLR-11 / CLR-12 | No (share flows) | Fixed, not relevant |

## 6. Friction found

| # | Observation | Evidence | Sev | E/H |
|---|---|---|---|---|
| F1 | The signed-out description follows `initialMode`, not the live mode. After toggling, the header says "Set a password…" over a Sign in form, or "Sign in with the invited address…" over Create account. The mismatch branch sends people to `?mode=sign-in`, and many invitees have no account, so they toggle. | `invitation-view.tsx:212-215`; the form is uncontrolled at `:224-228` although `SignInForm` supports `mode`/`onModeChange` (`sign-in-form.tsx:102-103,129,157-162`) | P2 | E |
| F2 | Accept and Sign-out use `disabled` plus a label swap. Focus drops to `<body>` mid-action and there is no spinner, which is inconsistent with `Button pending` used by 114 callers. After a successful accept the transition resolves while the page unloads, so "Accept invitation" is live again. A second tap POSTs again and can flash "This invitation has already been accepted. Sign in to continue." `SignInForm` closes this exact gap with a never-resolving await. | `invitation-actions.tsx:29-39,43-56,73-75,92-94`; `sign-in-form.tsx:206-210`; `button.tsx:148-154,232,271-273` | P2 | E (flash: H) |
| F3 | The wrong-account screen offers one action, "Sign out and continue". There is no visible way to keep the current account (for example, opened from the wrong browser profile). The only other exit is the logo, which goes to /sign-in and then redirects to /inbox. | `invitation-actions.tsx:81-97`; `auth-card.tsx:231-239`; `sign-in/page.tsx:24` | P2 | E |
| F4 | Dead ends always say "Go to sign in" to `/sign-in`, even for a signed-in visitor, who is silently redirected to /inbox. The label does not match the outcome. | `invitation-view.tsx:33-42,184,194`; `sign-in/page.tsx:24` | P3 | E |
| F5 | The 409 copy is hard-coded as "You have already accepted this invitation.", with no description. It asserts who accepted to anyone holding the link (it may have been forwarded), and it diverges from the shared, neutral "This invitation has already been accepted. / Sign in to continue." | `invitation-view.tsx:178-186` vs `auth-errors.ts:92-95` | P3 | E |
| F6 | The signed-in loaded state drops `aside="invite"`, so at ≥1024px the panel switches from the invite copy (while loading) to the product copy. No commit gives a reason. | `invitation-view.tsx:153-154` vs `:234`; `auth-card.tsx:85-107,206` | P3 | E |
| F7 | On the matching screen the same fact is stated three times: the description, the "Signed in as" row and the paragraph "You are signed in as X, the address this invitation was sent to." This pushes the primary button down on phones. | `invitation-view.tsx:237-239,98-100`; `invitation-actions.tsx:63-66` | P3 | E |
| F8 | When accept fails for a terminal reason (expired, already used, not found), the page keeps the details and a live "Accept invitation" that can never work. `invitation_changed` says "Reload the page" with no control for it. | `invitation-actions.tsx:36-38,59-79`; `auth-errors.ts:96-99` | P3 | E |
| F9 | "Try again" unmounts into the skeleton, because status goes back to `pending`. Keyboard and screen-reader focus falls to `<body>`, and on a second failure nothing is focused or re-announced apart from the alert role. | `invitation-view.tsx:151-168,196`; `query.js:411-419` | P3 | E |
| F10 | At 390×844 in create mode, the header, 4 rows (Role has 2 lines), the toggle, 3 fields and the requirements probably push "Create account" well below the fold. | layout `invitation-view.tsx:206-229` | P3 | H (capture S6 at 390) |
| F11 | "Forgot password?" from an invitation goes to `/forgot-password` with no route back. After the reset the invitee lands in /inbox with the invitation still pending and must reopen the email. | `sign-in-form.tsx:427-435` | P3 | H |
| F12 | After "Check your email" (S6c), the card header still says "Set a password and you will be able to…". | `invitation-view.tsx:212-215`, `sign-in-form.tsx:259-310` | P3 | H |

Fine as is, leave alone:
- The skeleton shape and title.
- The no-details dead ends (D8).
- `retry: false`.
- The locked email and its hint.
- Role summary wording.
- `[overflow-wrap:anywhere]` on values (320px-safe).
- The guaranteed exit on sign-out failure.
- Error focus handling inside `SignInForm`.
- The neutral confirm-sent copy.

## 7. Proposed changes (smallest coherent set, in priority order)

**C1. The description follows the live mode (fixes F1).**
- **Files:** `components/auth/invitation-view.tsx`.
- **What to change:**
  1. After `useQuery` (around line 149), before any early return, add `const [mode, setMode] = useState<SignInMode>(initialMode)` and import `useState`.
  2. At `:213`, use `mode === "sign-in"` instead of `initialMode === "sign-in"`.
  3. At `:224-228`, pass `mode={mode} onModeChange={setMode}`. Drop `initialMode` there; it is ignored once the form is controlled (`sign-in-form.tsx:129`).
- **Copy:** unchanged, both strings verbatim.
- **Benefit:** the header matches the form. Nielsen #1 (visibility of system status) and #4 (consistency); HIG clarity.
- **Risk:** none. Client state only, no request change, and `?mode` still sets the start.
- **Shared?** No. `SignInForm`'s controlled API already exists; `SignInPanel` uses it.

**C2. Pending treatment and no re-enable on success (fixes F2).**
- **Files:** `components/auth/invitation-actions.tsx`.
- **What to change:**
  1. Accept, `:67-76`: replace `disabled={pending}` and the ternary label with `pending={pending} pendingLabel="Accepting…"`, children "Accept invitation".
  2. Sign out, `:86-95`: `pending={pending} pendingLabel="Signing out…"`, children "Sign out and continue".
  3. In `handleAccept`, after `hardNavigate("/inbox")`, add `await new Promise<void>(() => {})`, with the same comment as `sign-in-form.tsx:206-209`.
  4. Rewrite `handleSignOut` as: `try { await authApi.signOut() } catch { /* existing comment */ }` then `hardNavigate(...)`, then `await new Promise<void>(() => {})`. This keeps the guaranteed exit.
- **Benefit:** focus stays on the control, a spinner shows, `aria-busy` is set, and nothing can be submitted twice. WCAG 2.4.3 (Focus Order), 4.1.3 (Status Messages); HIG feedback.
- **Risk:** none. Same calls in the same order, and the navigation still happens on every path.
- **Shared?** No (`Button` is used as is). The same swap would suit `SignInForm`; leave that to F01 so the change is made once.

**C3. A way out on the wrong-account screen (fixes F3).**
- **Files:** `invitation-actions.tsx`.
- **What to change:** under the primary button at `:96`, add:

```tsx
<Link href="/inbox" className={cn(buttonVariants({ variant: "ghost", size: "lg", block: true }), WRAPPING_BLOCK_BUTTON)}>Go to Inbox instead</Link>
```

- **Copy:** "Go to Inbox instead".
- **Benefit:** user control and freedom (Nielsen #3). Exactly one primary action remains.
- **Risk:** none. Ordinary navigation within the existing session; no token, no new request.
- **Shared?** No.

**C4. Dead-end exits follow the session, with neutral 409 copy (fixes F4, F5).**
- **Files:** `invitation-view.tsx`.
- **What to change:**
  1. `GoToSignInLink({ signedIn }: { signedIn: boolean })`: `href={signedIn ? "/inbox" : "/sign-in"}`, label `{signedIn ? "Go to Inbox" : "Go to sign in"}`.
  2. Pass `signedIn={viewer !== null}` at `:184` and `:194`.
  3. Replace `:181-183` with:

```tsx
<AlertTitle>This invitation has already been accepted.</AlertTitle>
{viewer === null ? <AlertDescription>Sign in to continue.</AlertDescription> : null}
```

  4. Import `AlertDescription`.
- **Benefit:** labels match outcomes (WCAG 2.4.4 Link Purpose; Nielsen #2, match with the real world). The 409 copy no longer claims who accepted.
- **Risk:** none. Still no organisation or details, and `viewer` comes from the server session, not the invitation.
- **Shared?** No. Uses the same words as `auth-errors.ts:93-94`.

**C5. Invite panel when signed in, and no repeated identity line (fixes F6, F7).**
- **What to change:**
  1. `invitation-view.tsx:234`: add `aside="invite"`.
  2. `invitation-actions.tsx:63-66`: delete the matching-case paragraph. The description and the "Signed in as" row already say it.
  3. Keep the mismatch paragraph at `:83-85`. It names both addresses next to the action, and a unit test asserts it.
- **Benefit:** a consistent panel and a shorter path to the primary on a phone. HIG hierarchy; Nielsen #8 (aesthetic and minimalist design).
- **Risk:** none (presentational). The unit test at `invitation.test.tsx:216` does not assert the paragraph.

**C6. Focus after a lookup retry (fixes F9).**
- **Files:** `invitation-view.tsx`.
- **What to change:**
  1. Add `const titleRef = useRef<HTMLHeadingElement>(null)` and `const retried = useRef(false)` before the returns.
  2. The "Try again" `onClick` becomes `retried.current = true; void query.refetch()`.
  3. Add `useEffect(() => { if (retried.current && !query.isPending) titleRef.current?.focus() }, [query.isPending])`.
  4. Pass `titleRef` to every non-pending `AuthCard` (the prop exists at `auth-card.tsx:207,251-253`; the h1 already has `tabIndex={-1}`).
- **Benefit:** WCAG 2.4.3 (Focus Order); the outcome of a retry is announced.
- **Risk:** none.

**C7 (optional). Terminal accept errors show the current state (fixes F8).**
- **What to change:** in `handleAccept`'s catch, when `caught instanceof ApiClientError` and `["invitation_expired","invitation_already_used","invitation_not_found"].includes(caught.code)`, call `queryClient.invalidateQueries({ queryKey: queryKeys.invitation(token) })` (`useQueryClient`). The lookup then answers 410, 409 or 404 and the view switches to the matching dead end, so no live "Accept" is left.
- **Benefit:** Nielsen #9 (help users recognise and recover from errors).
- **Risk:** low. One extra GET under the existing per-IP budget. `invitation_changed` is deliberately left out (§8).

## 8. Explicitly not proposed

- **An inviter name or avatar, or the location list.** The lookup does not return them, and adding them is a contract and D8-scope change that needs an owner decision.
- **Telling the visitor whether the invited address already has an account** (to choose the mode automatically). Account enumeration; protected.
- **Carrying the invitation through forgot-password (F11).** It would need a `next` or invite parameter through the reset flow, which is a protected flow in F0x. Raise it with the owner.
- **Changing sign-out failure handling (S9c).** The guaranteed-exit reload is deliberate (`invitation-actions.tsx:46-50`). Its only cost is a repeat of the same screen.
- **Rewording `invitation_changed`, or a connection-specific message for network failures.** `auth-errors.ts` is shared by every auth surface, so this belongs in a cross-flow copy pass.
- **Changing the confirm-sent header copy (F12) or reordering for the phone fold (F10).** Wait for the S6/S6c captures before touching either. Moving the details below the form would hide the role before commitment (the reason SET-17 was fixed).
- **Pending treatment inside `SignInForm`.** Same issue as F2, but the F01 flow owns that form.

## 9. Tests

**Existing coverage:**
- `tests/components/invitation.test.tsx`: signed-out create (`:41`), role and expiry (`:57,82`), signed-in rows (`:96`), 409 (`:112`), 410 (`:131`), 404 vs 500 (`:149`), mismatch sign-out (`:169`), `?mode=sign-in` (`:196`), accept success (`:216`), accept failure (`:238`).
- `tests/e2e/auth.spec.ts:121` (expired), `:141` (live role and expiry), `:196-215` (console sweep for `/invite/some-token`), plus axe across auth pages in light and dark.
- `tests/e2e/accessibility.spec.ts:538` (invitation axe for each viewport and theme).
- Nothing in `touch-critical.spec.ts`.

**Updates and additions (unit, cheap):**
1. C1: render signed-out, click "Switch to sign in", expect "Sign in with the invited address…", and back again.
2. C2: accept success. After `assign` is called, the button is still `aria-busy` with "Accepting…" and `acceptSpy` was called once even after a second click. Pending keeps focus (`document.activeElement` is the button).
3. C3: mismatch shows a link "Go to Inbox instead" with `href="/inbox"`.
4. C4: change `:119-121` to "This invitation has already been accepted." and add a signed-in 409 case expecting the link "Go to Inbox" to `/inbox`.
5. C6: after a 500, "Try again" then a 2nd 500 leaves focus on the h1.
6. C7: accept rejects 410, so the lookup is called again and "Accept invitation" is gone.

**E2E (coordinator):** an axe plus 390px touch pass on S8 and S9 with the journey cookie and the stubs in §3. Signed-in invite states have no e2e coverage today.
