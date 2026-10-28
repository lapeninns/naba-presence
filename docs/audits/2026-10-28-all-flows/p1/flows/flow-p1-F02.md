# p1-F02 · Create an account

Analysed on worktree `/tmp/naba-presence-p1` (`ux/flows-presence-p1`, head `e4123d25`). Read-only. Nothing was run.

## 1. Flow ID, name, start and end

- **ID / name:** p1-F02, create an account (self-registration by a new owner).
- **Start:** `/sign-in?mode=create-account` (`app/(auth)/sign-in/page.tsx:27-29`). You can also get here from `/sign-in` by pressing the "Create account" segment (`components/auth/sign-in-form.tsx:330-349`). No in-app link points at `?mode=create-account`: grep finds only the page itself, the invite page and tests. So the URL is an external or marketing entry. **Hypothesis:** links from the venue or marketing sites.
- **Already signed in:** the server redirects to `next ?? /inbox` (`sign-in/page.tsx:23-24`).
- **End (success):** there are two branches.
  - (a) The "Check your email" stage, in the same component (`sign-in-form.tsx:259-310`). The emailed link goes to `/auth/confirm`, which redirects (GET) to the `/confirm-email` interstitial. Its "Confirm and sign in" button POSTs back, which signs the person in and redirects to `/inbox` (`app/auth/confirm/route.ts:47-64,93-106`; `app/(auth)/confirm-email/page.tsx:50`).
  - (b) Authenticated immediately (auto-confirm provider): `window.location.assign(nextPath ?? "/inbox")` (`sign-in-form.tsx:243-245`).
- **Exits:** "Back to sign in" (`:296-307`) goes to F01, sign-in mode, in place. The legal links go to `/privacy` and `/terms` (`auth-card.tsx:275-297`).
- **Boundaries:**
  - F01 (sign-in) shares `SignInForm` and `SignInPanel`, and the mode toggle.
  - F08 (invite create-account) renders the same `SignInForm` with `inviteToken` and `invitedEmail` (`components/auth/invitation-view.tsx:224-228`). It shares the confirm-sent stage, the resend button and the pending button. The workspace choice is never shown with a token (`sign-in-form.tsx:136`).
  - Confirm-email (`/confirm-email`) is a separate flow.

## 2. Steps today

1. **Load.** The server page reads `REGISTRATION_MODE` and `REGISTRATION_WORKSPACE_CHOICE_ENABLED` (`sign-in/page.tsx:30-33`). There are no client API calls on load. The zod schemas load lazily on the first focus inside the form (`sign-in-form.tsx:98,315`).
2. **Panel copy** (`sign-in-panel.tsx:10-21,48-59`): eyebrow "New account", h1 "Create your NabaPresence account". The description is "Set it up for your own business or for an agency, then connect Google." with the choice on, or "Set it up for your business, then connect Google." with it off. The footer reads "Access is by invitation or a new account." (`:66-72`).
3. **Mode toggle.** A `SegmentedControl semantics="toggle"` with `aria-pressed` items "Sign in" and "Create account" (accessible names "Switch to …") (`sign-in-form.tsx:330-349`). Switching clears the field errors and the banner but keeps the typed values (`:157-162`). The URL is not updated.
4. **Workspace choice** (flag on, no token): "What are you setting up?", with a `RadioGroup` of `ChoiceCard`s "My business" (default) and "An agency". The group is disabled while pending (`:351-378`).
5. **Fields:**
   - "Your name" (`autoComplete=name`) (`:380-391`).
   - "Email address" (`type=email`, `autoComplete=username`), with the hint "You'll sign in with this address." (`:393-416`).
   - "Password", a single `new-password` field with a show/hide toggle and the live checklist "Between 15 and 128 characters" (`:442-450`; `password-requirements.tsx:13-23`). Caps Lock is hinted (`password-field.tsx:58-60,95-101`).
6. **Submit "Create account"** (`:453-467`): `disabled={pending}`, `aria-busy`, and the label swaps to "Creating account…". There is no spinner.
7. **Client validation** with `registerSchema` (`lib/domain/auth.ts:50-61`). Messages are reworded by `friendlyFieldErrors` (`sign-in-form.tsx:60-78`):
   - name: "Enter your name, at least 2 characters." or "Use no more than 120 characters."
   - email: "Enter your email address." or "Enter an email address like name@example.co.uk."
   - password: "Enter your password." when empty; otherwise the schema's "Use at least 15 characters." or "Use no more than 128 characters."

   Focus moves to the first invalid field (`:229-237`).
8. **POST `/api/auth/password/register`** (`lib/api/auth.ts:30-42`). The route checks, in order:
   - the abuse budget (`register`: 20 per IP per hour, 5 per email per hour; `lib/server/abuse-limits.ts:70-74`);
   - invitation or open registration (`app/api/auth/password/register/route.ts:20`, `lib/server/registration.ts:8-16`);
   - the breached-password check (`route.ts:23`);
   - the provider sign-up (`route.ts:30-42`).

   It answers 200 `{authenticated:true}` or 202 `{authenticated:false, confirmationRequired:true}` (`route.ts:47-66`).
9. **Error.** `fieldErrorsFrom` maps `details[].path`. The banner is `authErrorMessage(error, "create-account")` (`sign-in-form.tsx:249-255`). Focus goes to the first field with an error, or else to the banner (`:151-155`).
10. **Confirm-sent stage** (`:259-310`):
    - A Mail glyph, then the h2 "Check your email".
    - Neutral copy: "If **{email}** can be used for a new account, a confirmation link is on its way. Open it, then sign in."
    - A help box: "Not there after a few minutes? Check spam or promotions, then send a fresh link. Already have an account? Sign in instead.", with the full-width secondary button "Resend confirmation email".
    - A ghost "Back to sign in" button.

    The panel's h1, eyebrow, description and footer stay as they were for the form.
11. **Resend** (`resend-confirmation-button.tsx:50-84`): POST `/api/auth/password/resend`, which always answers 202 `{accepted:true}` (`app/api/auth/password/resend/route.ts:25-29`). On success the button is replaced by `role=status` "Confirmation email sent." On failure the button returns, with a `role=alert` line showing the **title only**.

## 3. States inventory

The coordinator stubs with `page.route("**/api/auth/password/register", …)`. In the e2e and visual harness `PASSWORD_AUTH_ENABLED=false` and `REGISTRATION_WORKSPACE_CHOICE_ENABLED=true` (`playwright.config.ts:80,98`; `tests/visual/nm-serve.mjs:155,165`). So an unstubbed submit returns 503 `password_auth_disabled`. Valid inputs: name `Sam Patel`, email `sam@example.test`, password `correct-horse-battery` (21 characters).

| State | How reached | What the user sees | Notes |
| --- | --- | --- | --- |
| S1 Initial, choice on | GET `/sign-in?mode=create-account` (no client API calls) | Toggle (Create account pressed), "What are you setting up?" with My business checked, three fields, "Create account" | Harness default |
| S1b Initial, choice off | Server env `REGISTRATION_WORKSPACE_CHOICE_ENABLED=false` (not stubbable) | No choice; description "Set it up for your business, then connect Google." | Needs a second server config; skip unless one exists |
| S2 Registration closed | Server env `REGISTRATION_MODE=invite_only`, GET `/sign-in?mode=create-account` | The **sign-in** form with no toggle. Footer: "NabaPresence is available by invitation during the pilot." | `sign-in-panel.tsx:43-45`, `sign-in/page.tsx:30-32`; covered by `tests/integration/routes/pilot-admission.test.ts:175` |
| S3 Client validation, empty | Press Create account with everything empty | Three field errors; focus on "Your name" | No request is sent |
| S3b Short password | Valid name and email, password `tooshort` | "Use at least 15 characters." under the checklist; focus on Password | |
| S4 Pending | Stub register with a handler that awaits ~15 s before fulfilling | Button "Creating account…", disabled; inputs (not the choice) stay editable | Capture the focus position too (expected: `body`, see F2) |
| S5 Confirm-sent | Register → `202` `{"authenticated":false,"confirmationRequired":true}` | Mail glyph, h2 "Check your email", neutral copy, Resend, Back to sign in, under the unchanged h1 "Create your NabaPresence account" | Also the **email-taken** state: identical by design |
| S5b Resend sent | S5, then resend → `202` `{"accepted":true}` | "Confirmation email sent." (`role=status`) | |
| S5c Resend limited | S5, then resend → `429` `{"error":"auth_rate_limited","message":"Too many attempts. Try again later.","retryable":true,"details":{"retryAfter":1800}}` | "Too many attempts." only (no "wait") | `resend-confirmation-button.tsx:72` |
| S6 Breached password | Register → `400` `{"error":"invalid_request","message":"The request did not pass validation.","fieldErrors":{"password":"This password has appeared in a known data breach, so it is easy to guess. Choose a different one."},"details":[{"code":"password_breached","path":["password"],"message":"This password has appeared in a known data breach, so it is easy to guess. Choose a different one."}]}` | Banner "Check the highlighted fields."; error on the password field; focus on Password | Body shape from `lib/server/breached-password.ts:171-185` and `lib/server/http.ts:25-45` |
| S7 Weak password (server) | Register → `400` with the same shape, message `"Use at least 15 characters."`, `details[0].code:"custom"` | As S6 | Only reachable when client and server disagree |
| S8 Rate limited | Register → `429` `{"error":"auth_rate_limited","message":"Too many attempts. Try again later.","retryable":true,"details":{"retryAfter":1800}}` | Banner "Too many attempts. / Wait a while, then try again."; focus on the banner | `auth-errors.ts:58-61` |
| S9 Registration closed (server) | Register → `403` `{"error":"registration_closed","message":"NabaPresence is available by invitation during the pilot."}` | Banner "Access is by invitation during the pilot. / Open your invitation link…" | `auth-errors.ts:43-47` |
| S10 Unavailable | Unstubbed in the harness, or `503` `{"error":"password_auth_disabled","message":"Email and password sign-in is temporarily unavailable."}` | "Account creation is temporarily unavailable. / This is a problem on our side. Try again shortly." | Surface-aware (`auth-errors.ts:23-35`) |
| S11 Unknown error | `500` `{"error":"internal_error","message":"The request could not be completed."}` or `route.abort()` | "Something went wrong. / Try again in a moment." | `auth-errors.ts:37-40` |
| S12 Authenticated immediately | Register → `200` `{"authenticated":true}`; also stub `**/inbox` as a document, or assert the URL | Button stays "Creating account…" until navigation to `/inbox` (or `next`) | `sign-in-form.tsx:243-245` |
| S13 With `next` | `/sign-in?mode=create-account&next=%2Fsettings` | "After signing in you'll go back to `/settings`." under the button | Untrue for the confirm path (F6) |
| S14 Back to sign in | S5, then press "Back to sign in" | Sign-in mode; email and password still filled; focus on `body` | |

## 4. Protected rules (do not change)

- **Email-taken neutrality.**
  - The provider's 400/422 becomes "confirmation required" (`lib/server/password-auth.ts:310-313`).
  - An enrolled identity reads as "confirmation required" (`register/route.ts:58-66`).
  - The confirm-sent copy is conditional ("If … can be used for a new account"; `sign-in-form.tsx:272-283`). Any rewording must keep the conditional.
- **Breached-password check:** before the provider, depends only on the password, fails open after 2.5 s (`breached-password.ts:36,163-185`; `register/route.ts:21-23`). It is a 400 `invalid_request` field error, not a new code.
- **Password policy:** 15–128 code points, no composition rules (`lib/domain/auth.ts:17-40`); the checklist mirrors it (`password-requirements.tsx:8-23`). D9 was done in #206. No "confirm password" field (`sign-in-form.tsx:439-441`).
- **Abuse budget:** register 20 per IP and 5 per email per hour (`abuse-limits.ts:70-74`); a 429 carries `details.retryAfter` and the `retry-after` header (`http.ts:79-89`, `abuse-limits.ts:410-419`).
- **Admission:** open versus invite-only; an invitation is rechecked server-side (`registration.ts:8-57`). The workspace mode is ignored unless the flag is on and there is no token (`register/route.ts:34-40`). D-13 (agency self-sign-up approval) is outstanding (`lib/server/env.ts:223-228`).
- **Server authority:** confirm-sent shows only after a 202; the authenticated branch never resolves its transition (`sign-in-form.tsx:243-248`). Double-submit guards: `pending` and `validating` (`:166-177`).
- **Resend:** always a 202 (`resend/route.ts:25-29`). It stays always available on sign-in, not gated on an error (D3, `sign-in-form.tsx:479-501`).
- **`next`:** sanitised server-side (`sign-in/page.tsx:22`). The confirmation link does not carry it (`register/route.ts:24-29`, `auth/confirm/route.ts:104-106`).

## 5. Prior audit status (15 Oct)

- **SET-18 (confirm field and composition rules): fixed.** Verified one `PasswordField` (`sign-in-form.tsx:442-450`), a single length rule (`password-requirements.tsx:14-22`), the schema (`auth.ts:27-40`) and the breach check (`register/route.ts:23`).
- **SET-23 (surface-aware errors, "agency"): fixed.** The `"create-account"` surface (`sign-in-form.tsx:252`, `auth-errors.ts:23-35`). `invitation_already_used` now reads "Sign in to continue." (`:92-95`).
- **Comparison row** (`findings.md:1031`: "+2 fields and composition rules"): now 2 taps and 3 fields (plus the optional choice). Resolved.
- **SET-17, CLR-11, CLR-12:** not this flow (invite and share).

## 6. Friction found

| # | Observation | Evidence | Sev | E/H |
| --- | --- | --- | --- | --- |
| F1 | The stage change to "Check your email" is not announced and does not move focus. The form, including the focused submit, unmounts, so keyboard and screen-reader users are left on `body` with no cue the account step finished. Forgot-password's sent stage at least uses `role="status"`. | `sign-in-form.tsx:247,259-284` (no ref, no `tabIndex`, no live region) versus `forgot-password-form.tsx:123-129` | P2 (WCAG 4.1.3, 2.4.3) | Evidence |
| F2 | The submit uses native `disabled` with a label swap, not `Button`'s `pending` and `pendingLabel`. Native disabled drops focus from the pressed button mid-request. `Button` documents `pending` as keeping focus and adding a spinner. | `sign-in-form.tsx:453-467`; `components/ui/button.tsx:147-154,238-249` | P3 | Evidence (code). Hypothesis (Chrome blur-on-disable observed elsewhere; capture S4 `document.activeElement`) |
| F3 | Confirm-sent shows the **live** `email` state, and Resend uses it too. Inputs stay editable while pending (only the RadioGroup is disabled), so an edit made during the up-to-2.5 s or longer request changes the address shown and resent to. Forgot-password snapshots `sentTo` instead. | `sign-in-form.tsx:279,291,363,398-405`; `forgot-password-form.tsx:107` | P3 | Evidence (edge case) |
| F4 | "Open it, then sign in." is inaccurate. The link's "Confirm and sign in" signs you in and lands on `/inbox`; there is no separate sign-in step. | `sign-in-form.tsx:281-282`; `confirm-email/page.tsx:29,50`; `auth/confirm/route.ts:93-106` | P3 (Nielsen 2) | Evidence |
| F5 | "Confirmation email sent." asserts a send. The resend route answers 202 for any address, and every other neutral surface hedges ("If … can be used…", "Another link is on its way … if it has an account"). The failure line shows only the title, so a 429 reads "Too many attempts." with no instruction. | `resend-confirmation-button.tsx:35-41,71-73,80-84`; `forgot-password-form.tsx:142-145` | P2 (consistency, Nielsen 4 and 9) | Evidence |
| F6 | The `next` note ("After signing in you'll go back to /x") also shows in create-account mode. The confirmation path always lands on `/inbox`, so it is untrue for the normal branch. | `sign-in-form.tsx:469-477`; `register/route.ts:24-29`; `auth/confirm/route.ts:104-106` | P3 | Evidence |
| F7 | Rate-limit copy "Wait a while, then try again." is vague, although the 429 carries `details.retryAfter` (also in the header). | `auth-errors.ts:58-61`; `abuse-limits.ts:416-419`; `lib/api/client.ts:181` | P3 (Nielsen 9) | Evidence |
| F8 | On confirm-sent, the page keeps the form's frame: h1 "Create your NabaPresence account", "Set it up for your business, then connect Google." and the footer "Access is by invitation or a new account.". So the page heading says the step that is done, and the instructions sit under it. The heading order (h1 then h2) is valid. The glyph is a copy of `AuthCard`'s `mark`. | `sign-in-panel.tsx:61-72`; `sign-in-form.tsx:261-270`; `auth-card.tsx:212-213,242-249` | P3 (HIG hierarchy) | Evidence |
| F9 | With registration closed, `?mode=create-account` silently renders "Welcome back / Sign in". The only explanation is the footer, below the form, likely below the fold at 390 px. | `sign-in-panel.tsx:43-45,68-70` | P3 | Evidence (code). Hypothesis (fold, external links) |
| F10 | An empty password in create mode says "Enter your password.", which reads like sign-in. Nothing is wrong beyond the wording. | `sign-in-form.tsx:76` | P3 | Evidence |
| F11 | "Back to sign in" unmounts its own button, so focus lands on `body`. | `sign-in-form.tsx:301-304` | P3 (2.4.3) | Evidence |
| F12 | A provider 422 (for example a Supabase `weak_password` or leaked-password rule stricter than ours) is turned into "Check your email" with no email ever sent, so the user waits indefinitely. | `password-auth.ts:310-313` | P2 if the provider policy is stricter, else none | Hypothesis (depends on the hosted Auth config; the owner reported compatibility, `results.md:278`) |

Leave these alone; they are fine:
- the toggle semantics and label-in-name (2.5.3 passes: "Switch to sign in" contains "Sign in");
- the ChoiceCard targets and ring (`choice-card.tsx:41-60`);
- the password toggle target of 44 px on touch;
- `overflow-wrap:anywhere` on the email;
- the lazy schemas;
- the field-error focus and banner focus (`:151-155`);
- the breached-password message wording;
- the no-JS gap (this form needs JS by design; no no-JS post exists here to preserve).

## 7. Proposed changes (smallest coherent set)

**C1. Announce the confirm-sent stage and pin the submitted address (fixes F1, F3, F11).**
- **Files:** `components/auth/sign-in-form.tsx` only. Shared with F08 (invite create-account), which gets the same fix.
- **Code-level guidance:**
  - Add `const [sentTo, setSentTo] = useState<string | null>(null)` and `const sentHeadingRef = useRef<HTMLHeadingElement>(null)`.
  - At `:247` call `setSentTo(parsed.data.email)` before `setStage("confirm-sent")`.
  - Use `sentTo` at `:279` and `:291`.
  - On the h2 at `:269` add `ref={sentHeadingRef} tabIndex={-1}` and append `outline-none` to the classes.
  - Add `useEffect(() => { if (stage === "confirm-sent") sentHeadingRef.current?.focus() }, [stage])`. Focus alone is enough; adding a live region as well would double-announce.
  - For "Back to sign in", set a `returnFocusRef.current = true` before `setStage("form")`. In the same effect, when `stage === "form" && returnFocusRef.current`, reset it and call `focusField("email")`.
- **Benefit:** screen-reader users hear "Check your email, heading level 2", and keyboard users continue from there. The address shown is the one the server got (and lower-cased, as stored).
- **Principle:** WCAG 2.4.3, 4.1.3; HIG consistent feedback.
- **Protected risk:** none. Only client focus and display change; the neutral copy is unchanged.

**C2. Accurate confirm-sent sentence (F4).**
- **File:** `sign-in-form.tsx:281-282`.
- **Copy:** replace "Open it, then sign in." with **"Open it to confirm your address and sign in."**
- **Keep verbatim:** "If {email} can be used for a new account, a confirmation link is on its way."
- **Principle:** Nielsen 2 (match the real world).
- **Protected risk:** none. The conditional is kept, so there is no enumeration change.
- **Shared:** F08 shows the same line; it is true there too (the interstitial reads "Confirm and accept invitation").

**C3. Neutral resend success and a complete failure line (F5).**
- **File:** `components/auth/resend-confirmation-button.tsx`.
- **Code-level guidance:**
  - At `:38` the copy becomes **"Another link is on its way to {email} if it still needs confirming."**, with `[overflow-wrap:anywhere]` on the span.
  - At `:72` store the full message: `const m = authErrorMessage(error, "sign-in"); setFailure(m.description ? \`${m.title} ${m.description}\` : m.title)`.
- **Callers:** `sign-in-form.tsx:290` (F02/F08 confirm-sent), `:498` (F01 disclosure), `auth-error-alert.tsx:23` (F01 `email_not_verified`).
- **Tests:** update `tests/components/sign-in-form.test.tsx:123`.
- **Principle:** Nielsen 4 (one voice for neutral sends) and 9.
- **Protected risk:** none. The copy gets more neutral, not less.

**C4. Spinner pending treatment on the submit (F2).**
- **File:** `sign-in-form.tsx:453-467`.
- **Code-level guidance:** replace `disabled={pending} aria-busy=…` and the nested ternary with `pending={pending} pendingLabel={mode === "sign-in" ? "Signing in…" : "Creating account…"}`, and use children `{mode === "sign-in" ? "Sign in" : "Create account"}`. `Button` then keeps the button focusable, sets `aria-busy` and draws the spinner. The `handleSubmit` guard (`:170`) still blocks a resubmit by Enter.
- **Tests:** `tests/components/sign-in-form.test.tsx:169` asserts `toBeDisabled()`. Change it to `toHaveAttribute("aria-busy", "true")` plus the existing call-count check (base-ui renders `aria-disabled` when focusable).
- **Shared:** shared with F01 (same button). Forgot, reset and MFA use the same label-swap idiom; recommend that their flows adopt it in the same PR for consistency.
- **Principle:** HIG consistent feedback; WCAG 2.4.3.
- **Protected risk:** none. Server authority and the never-resolving authenticated branch are unchanged.

**C5. Hide the `next` note in create-account mode (F6).**
- **File:** `sign-in-form.tsx:469`.
- **Code-level guidance:** the condition becomes `mode === "sign-in" && nextPath && nextPath !== "/inbox"`.
- **Benefit:** no false promise. The immediate-auth branch still honours `next` silently.
- **Protected risk:** none. `next` handling itself is untouched.

**C6. Concrete wait time on rate limits (F7).**
- **File:** `lib/api/auth-errors.ts` `authErrorMessage` (`:175-183`).
- **Code-level guidance:** when `error.code === "auth_rate_limited"` and `(error.details as {retryAfter?: unknown})?.retryAfter` is a positive number, return `{ title: "Too many attempts.", description: m <= 1 ? "Try again in a minute." : \`Try again in about ${m} minutes.\` }`, with `m = Math.ceil(s / 60)`. Otherwise keep "Wait a while, then try again." (the provider's 429 has no details, `password-auth.ts:303-308`).
- **Callers:** every auth surface that maps errors (sign-in, forgot, reset, MFA, invitation actions, resend).
- **Tests:** a unit case in `tests/components/auth-api.test.tsx`.
- **Principle:** Nielsen 9.
- **Protected risk:** none. The same value is already public in the `retry-after` header, and the budgets are unchanged.

**C7. Optional, P3: the frame follows the stage (F8).**
- **Files:** `sign-in-form.tsx` and `sign-in-panel.tsx`.
- **Code-level guidance:** add `onStageChange?: (stage: "form" | "confirm-sent") => void` to `SignInForm`, called next to `setStage`. In `SignInPanel`, when it reports `"confirm-sent"`, drop the `description` and the `footer`. Keep the h1 so the page reads "Create your NabaPresence account › Check your email". The invite flow passes nothing and is unchanged.
- **Protected risk:** none.
- **Why this is optional:** a bigger rewrite (h1 becomes "Check your email" via `mark` and `titleRef`) needs a prop to suppress the form's h2 and moves the C1 focus target. Not worth it unless the coordinator wants it.

## 8. Explicitly not proposed

- **Any change to the email-taken, 422 or neutral behaviour, or to a provider-specific "weak password" message (F12).** It is protected (enumeration resistance and the provider contract). Owner action: confirm that the hosted Supabase password policy and leaked-password setting are no stricter than 15+ characters. Otherwise F12 is a silent dead end.
- **Explaining "registration closed" on `?mode=create-account` (F9)** with an info Alert ("Account creation is by invitation during the pilot."). It is cheap and leaks nothing (the footer already says it), but no in-app route links there. Do it only if an external link to `?mode=create-account` is known. Otherwise leave the footer.
- **Syncing the mode toggle to the URL** (`history.replaceState`). A reload after toggling returns to the URL's mode. The value is low, and it touches routing (AGENTS.md says to check the Next docs first).
- **Workspace choice copy** ("You can change this later in Settings"; `workspace-mode-card.tsx` allows owners to switch). The flag is off by default and D-13 (product approval of agency self-sign-up) is open.
- **Rewording F10 and the footer line "Access is by invitation or a new account."** The value is low. F10 could become "Choose a password of at least 15 characters." if the coordinator wants one more copy line.
- **Making the resend failure surface-aware** (it is hard-coded to `"sign-in"`, `resend-confirmation-button.tsx:72`): the outage title reads "Sign-in is temporarily unavailable." on confirm-sent. It is minor, and it would need a new prop on a shared component.
- **Live announcements on the password checklist:** they would be noisy per keystroke. Each row already names its state (`password-requirements.tsx:40`).
- **Passkeys or magic links:** these are new auth methods, so they are out of scope.

## 9. Tests

- **Existing unit tests:** `tests/components/sign-in-form.test.tsx`:
  - create-account mode `:205-378`: local validation, one field, 15+ characters, confirm-sent, workspace choice on, off and with an invite, the locked invite email;
  - mode toggle `:380-457`;
  - double-submit `:155`;
  - resend `:100-125`.
- **Also unit:** `tests/components/auth-api.test.tsx` (surface titles), `tests/components/invitation.test.tsx` (F08).
- **Server:** `tests/integration/routes/pilot-admission.test.ts:175`, plus the breached-password unit and telemetry tests.
- **Existing e2e:** `tests/e2e/auth.spec.ts`:
  - h1 for `?mode=create-account` (`:14-33`);
  - business or agency choice (`:50-63`);
  - axe across the auth pages in both themes (`:171`).

  Confirm-sent, breached and rate-limit states have **no** e2e or axe coverage.
- **Add (unit):**
  - (a) After a 202, the "Check your email" heading has focus, and the shown email equals the submitted one even if the field is edited while pending (C1).
  - (b) "Back to sign in" focuses "Email address" (C1).
  - (c) Resend success text is neutral, and a 429 failure includes "Try again in about 30 minutes." (C3, C6).
  - (d) The `next` note is absent in create mode (C5).
  - (e) The submit has `aria-busy` and keeps focus while pending (C4).
- **Add (e2e, `auth.spec.ts`):**
  - Stub register with a 202, then assert `page.getByRole("heading", { name: "Check your email" })` is focused, and run axe on the confirm-sent stage in light and dark.
  - Stub the breached 400 (S6 body), then assert the password field has `aria-invalid="true"`, focus and the breach text.
  - Touch: the Resend and Back to sign in targets of 44 px or more at 390 (`touch-critical.spec.ts`).
