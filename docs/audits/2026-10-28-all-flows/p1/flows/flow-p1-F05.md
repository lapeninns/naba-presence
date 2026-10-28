# p1-F05: Two-step verification at sign-in (`/sign-in/verify`)

Analysis of worktree `/tmp/naba-presence-p1` (branch `ux/flows-presence-p1`). Read-only: no servers, tests or git were run.

## 1. Flow ID, name, start and end

- **ID / name:** p1-F05, the code step of signing in for a person with a verified TOTP factor.
- **Gate:** `isMfaEnabled()` reads **`MFA_ENABLED`** (`lib/server/mfa.ts:52-54`, `lib/server/env.ts:218`, `featureFlag(false)`, so it is off by default). Only the strings `"true"` and `"false"` are accepted, and any other value throws at env parse (`lib/server/env.ts:5-10`). With the flag off, the page server-redirects to `/sign-in` (`app/(auth)/sign-in/verify/page.tsx:23`) and every `/api/auth/mfa/**` route answers 404 `mfa_disabled` (`lib/server/mfa.ts:56-60`).
  - **For the coordinator:** the Playwright `webServer.env` does not set `MFA_ENABLED` (`playwright.config.ts:74-104`), so the e2e server has MFA **off** and this page cannot be captured there as-is. The 15 Oct audit hit the same gap (`findings.md:1353`). Capturing needs a separate server started with `MFA_ENABLED=true`, plus `page.route` stubs for the two MFA API calls (section 3). Supabase is not needed because the stubs answer for it. Don't turn the flag on for the shared e2e server: with MFA on, every owner/admin sensitive action in other specs gets 403 `mfa_step_up_required` (`lib/server/mfa.ts:150-178`).
- **Entry points:**
  - Password sign-in: `components/auth/sign-in-form.tsx:201-204` sends `/sign-in/verify?next=…`.
  - Reset completion: `components/auth/reset-password-form.tsx:118`, with no `next`.
  - Emailed link: `app/auth/confirm/route.ts:105`, with no `next`.
  - Invitation sign-in: completes through `inviteTokenHash` in the ticket (`lib/server/mfa.ts:245`).
- **Exits:**
  - Success: a hard navigation to the sanitised `next`, or `/inbox` (`mfa-verify-form.tsx:112`).
  - "Use a different account": DELETE the ticket, then `/sign-in` (`:148-154`).
  - Expired: "Sign in again", which goes to `/sign-in` (`:170`).
  - Already signed in: the server redirects to `next ?? /inbox` (`page.tsx:24`).
- **Boundaries:** sign-in (F01, owned by another flow) hands over. The dashboard step-up prompt (`components/auth/mfa-step-up-prompt.tsx`, owned by another team) shares `focusFirstCodeBox`, `OtpField`, `AuthErrorAlert`, `authErrorMessage`, `lib/api/mfa.ts` and the `"Checking…"` label swap (`mfa-step-up-prompt.tsx:14-42,150,270`). `focus-code-box.ts` is also used by `components/settings/two-step-verification-card.tsx:14,274`. Nothing below changes any of those shared files.

## 2. Steps today

1. **Server render.** The page sanitises `next`, applies the flag gate and the session redirect, then renders `AuthCard`:
   - eyebrow "Two-step verification"
   - title "Enter your code"
   - description "Open your authenticator app and enter the 6-digit code it shows for NabaPresence."

   The aside uses the default `product` variant (`page.tsx:22-32`). The ticket cookie is `path=/api/auth/mfa` (`lib/server/mfa.ts:400-410`), so the page itself cannot tell whether a ticket exists.
2. **Mount.**
   - The client calls `GET /api/auth/mfa/factors` (`mfa-verify-form.tsx:58-81`, `lib/api/mfa.ts:18-22`).
   - At the same time, the first code box takes focus straight away, before the factors arrive (`:144-146`).
   - Until the factors arrive, "Verify and sign in" is disabled and nothing says why (`:228`).
3. **Factors arrive.**
   - Two factors: a fieldset "Which app are you using?" appears **above** the code field, with "Authenticator app (name)" and "Backup authenticator (name)". The first is preselected (`:186-204`).
   - One factor: no picker.
4. **Code entry.**
   - `OtpField` shows 6 boxes with `inputMode="numeric"` and `autoComplete="one-time-code"`. Paste and autofill spread across the boxes, and spaces are dropped (`components/ui/otp-field.tsx:85,108-109`; `lib/contracts/auth.ts:105-108`).
   - There is no auto-submit, on purpose, because attempts are limited (`mfa-verify-form.tsx:207-210`).
   - The hint reads "From your authenticator app. Codes refresh every 30 seconds."
5. **Submit.**
   - The client checks the code with zod. If it is not 6 digits, the field error says "Enter the 6-digit code from your authenticator app." and no request is sent (`:99-103`).
   - Otherwise it sends `POST /api/auth/mfa/verify` with `{code, factorId}` (`:108-111`).
   - While pending, the label swaps to "Checking…" and the button is disabled with no `aria-busy` (`:223-231`).
6. **Server outcomes** (`app/api/auth/mfa/verify/route.ts`):
   - **200 `{verified:true,purpose:"sign_in"}`:** `hardNavigate(next ?? "/inbox")`, and the transition never resolves (`:112-114`).
   - **400 `mfa_code_invalid` with `details.attemptsRemaining`** (`route.ts:93-106`):
     - The field error says "That code did not match. N attempts left." (or "1 attempt left").
     - The code is cleared and focus goes back to box 1 (`form :123-135`).
     - The fifth wrong code discards the ticket and answers 401 instead (`route.ts:98-102`).
   - **401 `mfa_ticket_invalid`:** the cookie is gone, time ran out, attempts ran out, or the ticket was already spent. The form shows the expired state (`:116-121`, `:156-176`).
   - **Anything else** (429 `auth_rate_limited`, 503 `mfa_assurance_unconfirmed`, 400 `mfa_factor_unknown`, 500, network): `setMessage(authErrorMessage(error,"mfa"))`, which shows an alert above the form. The code is kept and focus is not moved (`:137`, `:185`).
7. **Expired state.**
   - It shows an alert "Your sign-in has expired." with the text "For your security the code step ends after five minutes or five wrong codes. Sign in again to continue.", and one button, "Sign in again", which goes to `/sign-in` (`:156-176`).
   - The header still reads "Enter your code / Open your authenticator app…".
8. **"Use a different account":** `DELETE /api/auth/mfa/verify` (any failure is ignored), then `/sign-in` (`:148-154`, `route.ts:164-173`).
9. **Recovery codes:** there are none. The only fallback is a second, "backup" authenticator. A lost device can only be fixed by an operator (`pnpm ops:mfa-recover`, `docs/architecture.md:184-189`). Nothing on the screen says this.

## 3. States inventory

The capture server needs `MFA_ENABLED=true`, an anonymous context and no session cookie. The page fetches the two endpoints below with client-side `fetch`, so `page.route` can stub them. For the factors response, `expiresAt` must be a string or the schema parse fails (`lib/contracts/auth.ts:132-135`).

| State | How reached | What the user sees | Notes |
| --- | --- | --- | --- |
| Flag off | No `MFA_ENABLED=true` | 307 to `/sign-in` | This is the e2e default today. |
| Loading factors | `GET **/api/auth/mfa/factors`: never fulfil | Header and code boxes; box 1 focused; primary disabled; nothing explains why | Phone: the keyboard opens at once. |
| Ready, one app | `GET factors` → 200 `{"factors":[{"id":"factor-1","friendlyName":"Phone"}],"expiresAt":"2026-10-28T10:05:00.000Z"}` | Code field, "Verify and sign in", "Use a different account" | Main state. |
| Ready, two apps | 200 `{"factors":[{"id":"factor-1","friendlyName":"Phone"},{"id":"factor-2","friendlyName":"Tablet"}],"expiresAt":"2026-10-28T10:05:00.000Z"}` | Radio fieldset above the code field | The field shifts down after focus has landed. |
| Client validation | Ready, then type 3 digits and press Verify | Field error "Enter the 6-digit code from your authenticator app." | No request is sent. |
| Pending verify | `POST **/api/auth/mfa/verify`: never fulfil | Primary "Checking…" (disabled), secondary disabled | No spinner and no `aria-busy`. |
| Wrong code | POST → 400 `{"error":"mfa_code_invalid","message":"That code is not valid.","fieldErrors":{"code":"That code is not valid."},"details":{"attemptsRemaining":4}}` | "That code did not match. 4 attempts left."; boxes empty; box 1 focused | Use `attemptsRemaining:1` for the singular form. |
| Wrong code, no count | Same 400 without `details` | "That code did not match. Try the code your app shows now." | |
| Expired on load | `GET factors` → 401 `{"error":"mfa_ticket_invalid","message":"Your sign-in has expired. Sign in again."}` | Header "Enter your code" over the alert "Your sign-in has expired." + "Sign in again" | The form flashes first. |
| Expired on submit / 5th wrong code | POST → same 401 body | Same as above | Focus drops to `<body>`. |
| Factors load failed | `GET factors` → 500 `{"error":"internal_error","message":"Internal error"}` (or `route.abort()`) | Alert "Something went wrong. Try again in a moment."; primary disabled for good | Dead end (F2). |
| Rate limited | POST → 429 `{"error":"auth_rate_limited","message":"Too many attempts. Try again later.","retryable":true,"details":{"retryAfter":600}}`, header `retry-after: 600` | Alert "Too many attempts. Wait a while, then try again." above the filled code | Focus is not moved (F4, F5). |
| Assurance 503 | POST → 503 `{"error":"mfa_assurance_unconfirmed","message":"Two-step verification is temporarily unavailable."}` | Alert "We could not confirm your code. This is a problem on our side. Try again shortly." | |
| Factor unknown | POST → 400 `{"error":"mfa_factor_unknown","message":"Choose one of your authenticator apps."}` | Alert "Choose one of your authenticator apps." | Edge case. |
| Success | POST → 200 `{"verified":true,"purpose":"sign_in"}` | "Checking…" stays until navigation to `next`/`/inbox` | Stub or catch the destination: with no real session, `/inbox` bounces to `/sign-in`. |
| Use a different account | `DELETE **/api/auth/mfa/verify` → 204 (empty body) | Primary label turns "Checking…" (F3), then `/sign-in` | |

## 4. Protected rules (must not change)

- Flag gate and the server-side signed-in redirect (`page.tsx:23-24`); `next` sanitised on the server (`page.tsx:22`); same-origin `hardNavigate` (`lib/client/hard-navigate.ts:16-35`).
- The ticket is an httpOnly cookie limited to `/api/auth/mfa`, 5 minutes and 5 attempts (`lib/server/mfa.ts:42-44,400-410`). Exactly one consume (`route.ts:120`). Discard on the last wrong code (`route.ts:98-102`).
- Abuse budgets `mfa_verify` (IP 30, token 10, user 20 per 15 min), `mfa_verify_account` (15 per 15 min) and `_daily` (100 per day) (`lib/server/abuse-limits.ts:123-145`; taken at `route.ts:58-73`).
- Fail closed on non-aal2 (`route.ts:112-118`). Factor choice is checked on the server, and the server defaults to the first factor (`route.ts:175-193`).
- No auto-submit; one request per press (`mfa-verify-form.tsx:83-94,207-210`; unit test `tests/components/mfa-verify-form.test.tsx:128`).
- `one-time-code` autofill and the numeric pad on every box (`otp-field.tsx:85,108`; test `:110`).
- Success only after the server confirms (`mfa-verify-form.tsx:108-112`).

## 5. Prior audit status (15 Oct)

- No 15 Oct finding covers `/sign-in/verify`: it was listed as "Needs owner setup: MFA is off in visual-app" (`findings.md:1353`), so it has **never been captured or audited visually**.
- **SET-23** (surface-aware auth copy): fixed. The `mfa` surface exists (`lib/api/auth-errors.ts:19,29`), so outages read "Two-step verification is temporarily unavailable." (`results.md:283`).
- **SET-18 / D9** (password rules): fixed, but does not touch this screen.
- **SET-17 / D8, CLR-11/12:** not this flow.
- **D10** (help/support channel) is still **undecided** (`results.md:287,310`). It blocks any "lost your authenticator?" contact line (section 8).

## 6. Friction found

| # | Observation | Evidence | Sev | E/H |
| --- | --- | --- | --- | --- |
| F1 | When the ticket expires, the header still says "Enter your code / Open your authenticator app…" above "Your sign-in has expired." On a direct visit with no ticket, the code form (with the phone keyboard) shows first and then switches. | `page.tsx:26-30`; `mfa-verify-form.tsx:144-146,156-176` | P2 | Evidence |
| F2 | If the factors load fails with anything other than `mfa_ticket_invalid` (500, offline), the alert says "Try again in a moment" but the primary stays disabled for good (`factors === null`) and nothing on the page retries. The only way on is "Use a different account" or a reload. | `mfa-verify-form.tsx:76,228` | P2 | Evidence |
| F3 | "Use a different account" uses the same transition as verify, so the **primary** button changes to "Checking…" while the person is leaving. That is wrong feedback for the action they took. | `:55,148-154,230` | P2 | Evidence |
| F4 | A server error with no field to blame (429, 503, generic, factor unknown) shows an alert, but focus is not moved to it. After a click on the button, the button is disabled while pending, so focus falls to `<body>`. `sign-in-form.tsx:145-153,320` and `forgot-password-form.tsx:66-77,189` both focus the alert in this case. | `mfa-verify-form.tsx:137,185,228` | P2 | Evidence; the body fallback is browser focus-fixup behaviour (Hypothesis for Safari) |
| F5 | The 429 copy "Wait a while, then try again." misleads here. The `mfa_verify` windows are 15 minutes and the ticket lives 5, so by the time the limit lifts the ticket is almost always gone, and "trying again" lands on Expired. `details.retryAfter` is sent but not used. | `abuse-limits.ts:123-145,410-420`; `mfa.ts:43`; `auth-errors.ts:58-61` | P2 | Evidence |
| F6 | When the expired state replaces the form, the code box unmounts and focus drops to `<body>`. Nothing takes focus. | `mfa-verify-form.tsx:156-176` | P2 | Evidence (WCAG 2.4.3) |
| F7 | "Sign in again" drops `next`, although `/sign-in` accepts and shows it. Someone who came from a deep link lands on `/inbox` after starting again. | `:170`; `app/(auth)/sign-in/page.tsx:22,35`; `sign-in-form.tsx:469-475` | P2 | Evidence |
| F8 | For two-app users, the wrong-code text never mentions the app picker. The most likely cause after a mismatch is a code from the other app, and each miss spends one of 5 attempts. | `:127-132,186-204` | P3 | Evidence; the cause is a Hypothesis |
| F9 | The picker is announced twice: the fieldset legend "Which app are you using?" and then the RadioGroup `aria-label="Authenticator app"`, whose first option is also "Authenticator app". | `:187-198` | P3 | Evidence |
| F10 | Focus lands on box 1 before the factors arrive. For two-app users the picker then pushes the field down under the caret. On an expired visit the phone keyboard opens and then closes. | `:144-146,186` | P3 | Hypothesis (depends on latency) |
| F11 | The pending primary has no `aria-busy`. The sign-in button has it. | `:223-231` vs `sign-in-form.tsx:453-458` | P3 | Evidence |
| F12 | There is no help for a lost or new phone. Recovery is operator-only, and the screen is silent about it. | `docs/architecture.md:184-189` | P3 | Evidence; blocked on D10 |

These are fine and should be left alone:
- The no-auto-submit rule and its comment.
- Paste, autofill and space handling.
- 44px boxes that shrink to fit 320px: 6×48 + 5×6 = 318px against 288px of content, and `min-w-0 shrink` handles it.
- The attempts-left wording.
- Clearing the code and refocusing box 1 on a wrong code.
- One primary and one secondary button.
- The `WRAPPING_BLOCK_BUTTON` reflow.
- The 503 copy.

## 7. Proposed changes (all in `components/auth/mfa-verify-form.tsx`, plus a 2-line change to `page.tsx`)

**C1. The expired state owns the whole card, and focus moves to it.** Fixes F1 and F6.
- **Where:**
  - `page.tsx` keeps its gate and redirects and renders only `<MfaVerifyForm nextPath={nextPath} />`.
  - The form renders `AuthCard` itself. There is precedent: `sign-in-panel.tsx` and `invitation-view.tsx` already render `AuthCard` client-side, and `auth-card.tsx` has no server-only imports.
- **Normal state:** unchanged props, so eyebrow, title and description are identical.
- **Expired state:**
  - eyebrow "Two-step verification"
  - title **"Your sign-in has expired"**
  - description **"For your security, the code step ends after five minutes or five wrong codes. Sign in again to continue."**
  - body: only the "Sign in again" action. Drop the duplicate `AuthErrorAlert` (the h1 carries the message).
- **Focus:** pass `titleRef` to `AuthCard` and, in `useEffect(() => { if (expired) titleRef.current?.focus() }, [expired])`, focus the h1. It is already `tabIndex={-1}` (`auth-card.tsx:251-254`).
- **Benefit:** the heading matches the state, and screen-reader and keyboard users are told what happened and where they are.
- **Principles:** Nielsen #1 (visibility of system status); HIG (hierarchy); WCAG 2.4.3, 2.4.6, 1.3.1.
- **Risk:** none. Copy and structure only; the 401 handling is unchanged.
- **Shared?** No. `AuthCard` is used as-is through its existing `titleRef` prop.
- **Minimal fallback** if lifting the card is unwanted: keep the structure and focus the "Sign in again" control on entry (F6 only).

**C2. "Sign in again" keeps `next` and becomes a real link.** Fixes F7.
- **Change:** replace the `Button onClick={() => hardNavigate("/sign-in")}` at `:166-173` with `<Link href={nextPath ? \`/sign-in?next=${encodeURIComponent(nextPath)}\` : "/sign-in"} className={buttonVariants({ size: "lg", block: true })}>Sign in again</Link>`. Use the same template as `sign-in-form.tsx:203`.
- **Why a link:** it is navigation, it works before hydration, and there is no session to discard.
- **Principles:** HIG (preserved context); Nielsen #3; WCAG 4.1.2 (correct role).
- **Risk:** none. `next` is already sanitised on the server and is sanitised again by `/sign-in`.
- Leave "Use a different account" going to plain `/sign-in`: a different person should not inherit the deep link.

**C3. Separate pending states for leaving and verifying.** Fixes F3 and F11.
- **Change:**
  - Add `const [leaving, startLeaving] = useTransition()` and use it in `startOver`.
  - Primary: `disabled={pending || leaving || factors === null}`, `aria-busy={pending || undefined}`, label `{pending ? "Checking…" : "Verify and sign in"}`. The label stays unchanged while leaving.
  - Secondary: `disabled={pending || leaving}`, `aria-busy={leaving || undefined}`, label `{leaving ? "Signing out…" : "Use a different account"}`.
  - Keep the label-swap pattern rather than `Button pending`, because the auth area uses label swaps throughout (`sign-in-form.tsx:460-466`, `mfa-step-up-prompt.tsx:270`).
- **Principles:** Nielsen #1 (accurate feedback); WCAG 4.1.3.
- **Risk:** none. Requests are unchanged.

**C4. Focus the alert on server errors (same idiom as sign-in).** Fixes F4.
- **Change:**
  - Wrap `:185` in `<div ref={alertRef} tabIndex={-1} className="outline-none">…</div>`.
  - Add `useEffect(() => { if (message) alertRef.current?.focus() }, [message])`.
  - The `mfa_code_invalid` path keeps focusing box 1 because it sets `codeError`, not `message`.
- **Principles:** WCAG 2.4.3 and 3.3.1; Nielsen #9 (recognise and recover from errors).
- **Risk:** none.

**C5. Honest rate-limit copy on this screen.** Fixes F5.
- **Change:** in the catch block, before `setMessage(authErrorMessage(…))`, handle the rate-limit case:

  ```
  if (error instanceof ApiClientError && error.code === "auth_rate_limited") {
    const seconds = retryAfter(error)   // same Reflect.get pattern as attemptsRemaining(), key "retryAfter"
    setMessage({
      title: "Too many attempts.",
      description: seconds === null
        ? "For your security, codes are paused for a while. Wait a few minutes, then sign in again."
        : `For your security, codes are paused. Wait ${seconds <= 60 ? "a minute" : `${Math.ceil(seconds / 60)} minutes`}, then sign in again.`,
    })
    return
  }
  ```

- **Scope:** keep it local to the verify form. Don't edit `auth-errors.ts` `auth_rate_limited`, because sign-in, reset and the step-up prompt share it.
- **Principles:** Nielsen #9; HIG (honest feedback).
- **Risk:** none.
  - The limit and the request are unchanged, and the server still decides.
  - `retryAfter` is the person's own budget, already sent in the header, after a correct password, so it gives no enumeration signal.

**C6. A factors-load failure gets a retry.** Fixes F2.
- **Change:**
  - Add `const [loadKey, setLoadKey] = useState(0)` and make the effect at `:58-81` depend on `[loadKey]`. Reset `setMessage(null)` at the start of the effect.
  - In the `.catch` non-ticket branch, keep `setMessage(…)` and also `setLoadFailed(true)`.
  - When `loadFailed`, render under the alert a `<Button type="button" variant="secondary" size="lg" block onClick={() => { setLoadFailed(false); setLoadKey((k) => k + 1) }}>Try again</Button>` and hide nothing else.
- **Principles:** Nielsen #3 and #9 (no dead ends).
- **Risk:** none. It is a repeat GET, the factors route takes no abuse budget (`factors/route.ts:17-28`), and it reveals nothing.
- **Rejected alternative:** enabling submit with no factors (the server would default to the primary app, `route.ts:190-192`). A backup-app user could spend an attempt without seeing the picker.

**C7. Wrong-code hint for two apps, and one name for the picker.** Fixes F8 and F9.
- **Wrong-code text:** at `:127-132`, when `factors && factors.length > 1`, use `` `That code did not match. Check that the selected app is the one showing this code. ${remaining} ${remaining === 1 ? "attempt" : "attempts"} left.` ``, and keep today's text for one app.
- **Picker name:**
  - Give the legend `id={legendId}` (from `useId`).
  - Replace `aria-label="Authenticator app"` on `RadioGroup` with `aria-labelledby={legendId}`.
  - Drop the `<fieldset>` wrapper for a `<div>` so the group is named once.
- **Principles:** Nielsen #9; WCAG 1.3.1 and 2.5.3.
- **Risk:** none.

**C8 (optional). Focus box 1 once the factors are known.** Fixes F10.
- **Change:** `useEffect(() => { if (!expired && factors) focusFirstCodeBox(codeRef.current) }, [expired, factors])`.
- **Benefit:** typing is still possible right away; it only avoids the keyboard flash and the picker jump.
- **Principle:** WCAG 3.2.1/3.2.2 spirit (no unexpected shift).
- **Risk:** none. The unit test `:110-126` already waits for the factors before checking focus.

## 8. Explicitly not proposed

- **"Lost your authenticator app?" help line (F12):** blocked on **D10**, which has no support channel. The only public address is the privacy email (`results.md:310`). For when D10 lands, suggested copy: "Lost access to your authenticator app? Contact {channel} and we'll help you get back in." Owner decision.
- **Auto-submit on the sixth digit:** deliberately off because attempts are limited.
- **Recovery codes:** no backend exists; that would be a product and security change.
- **Client-side countdown or auto-expiry from `expiresAt`:** it would replace the form while someone is typing, and the server already answers. Not worth the surprise.
- **Clearing the field error as the person types:** it would hide the attempts-left count they need.
- **Switching to `Button pending` with a spinner:** consistency with the rest of the auth area matters more. That would be a cross-flow decision (sign-in F01, step-up).
- **Any change** to `focus-code-box.ts`, `otp-field.tsx`, `auth-errors.ts`, `AuthErrorAlert` or the step-up prompt and host (shared, or owned by others).

## 9. Tests

- **Unit, existing:** `tests/components/mfa-verify-form.test.tsx` covers:
  - success with `next` (`:34`)
  - attempts left (`:55`)
  - malformed code (`:81`)
  - expired (`:97`): uses `findByText("Your sign-in has expired.")`, so update it for C1's title without the period, or match a regex
  - autofill and numeric pad (`:110`)
  - one attempt per press (`:128`)
- **Server and integration, existing:** `tests/integration/routes/mfa.test.ts`, `tests/server/mfa-route-guards.test.ts`, `tests/server/abuse-limit-wiring.test.ts`, `tests/route-auth-surface.test.ts`, `tests/server/auth-confirm-route.test.ts`. These cover the protected behaviour and need no change.
- **E2E:** none. `auth.spec.ts`, `accessibility.spec.ts` and `touch-critical.spec.ts` never reach `/sign-in/verify` because MFA is off in `playwright.config.ts`.
- **Unit tests to add:**
  1. Expired after submit: the h1 reads "Your sign-in has expired" and has focus; the "Sign in again" link `href` is `/sign-in?next=%2Finbox%3Fqueue%3Dneeds_reply`.
  2. "Use a different account": the primary label stays "Verify and sign in", the secondary reads "Signing out…", and `cancelMfa` is called once.
  3. 429 with `details.retryAfter: 600`: the alert reads "…Wait 10 minutes, then sign in again." and has focus.
  4. Factors 500, then "Try again": `pendingFactors` is called twice and the primary is enabled after the second call resolves.
  5. Two apps and a wrong code: the text mentions the selected app; the radiogroup's accessible name is "Which app are you using?".
- **Optional e2e/a11y**, only on a dedicated `MFA_ENABLED=true` server with the section 3 stubs: axe on Ready (two apps) and Expired at 390 and 1280; touch-critical targets on the code boxes and both buttons.
