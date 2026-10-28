# p1-F06 — Request a password reset link

Read from the worktree `/tmp/naba-presence-p1` @ `e4123d25`. All paths are relative to it. This pass only read code. It ran nothing.

## 1. Flow ID, name, start and end

- **ID:** p1-F06. **Route:** `/forgot-password` (`app/(auth)/forgot-password/page.tsx:7-18`). It is static: the page makes no API call on load. The zod chunk loads on first focus inside the form (`components/auth/forgot-password-form.tsx:40,184`).
- **Ways in:**
  - "Forgot password?" on sign-in. It saves the typed email in `sessionStorage["naba:reset-email"]` (`components/auth/sign-in-form.tsx:427-434`, `lib/api/reset-email.ts:9-16`).
  - "Request another link" in `AuthErrorAlert` (`components/auth/auth-error-alert.tsx:25-33`).
  - The reset page's missing-token CTA (`components/auth/reset-password-form.tsx:155`).
  - Typing the URL directly.
- **Ways out:**
  - The footer link "Back to sign in" (`page.tsx:14`).
  - The brand mark or aside wordmark, which go to `/sign-in` (`components/auth/auth-card.tsx:121,231`).
  - The emailed link → `/auth/confirm?flow=recovery` (`app/api/auth/password/reset/request/route.ts:20-21`) → `/reset-password`. That is flow F07 and is out of scope.
- **Boundary:** F06 ends at "If an account exists…, a reset link is on its way." The email round trip and the new-password form belong to F07.

## 2. Steps today

1. **Page renders.** AuthCard with eyebrow "Account recovery", h1 "Reset your password" and the description "We’ll email you a link to choose a new password. Your Google connections are not affected." (`page.tsx:9-15`). From `lg`, the "recovery" aside is also shown (`auth-card.tsx:53-68,114-119`).
2. **Prefill.** The field shows the address saved by sign-in. It is read after hydration through `useSyncExternalStore`; the server snapshot is `""` (`forgot-password-form.tsx:54-60`). If storage is blocked, the field starts empty (`reset-email.ts:13-14,22-23`).
3. **Client validation.** Submit runs `resetRequestSchema` (`lib/domain/auth.ts:11-15,63-65`, which is `trim → z.email() → lowercase`). An empty or invalid value sets a field error and focuses `[name=email]` (`form:95-103`). The message is zod's default, "Invalid email address". There is no full stop and no separate empty-field message (checked with zod 4.6.7).
4. **Pending.** The button reads "Sending…" and gets `disabled` + `aria-busy` (`form:210-218`). A double press is guarded by `pending || validating.current` (`form:83`).
5. **Request.** `POST /api/auth/password/reset/request` with `{email}` (`lib/api/auth.ts:44-49`).
   - The route is public, same-origin and rate-limited (`route.ts:13-17`). The budget is `reset_request`: 20 per IP per hour and **3 per email per hour** (`lib/server/abuse-limits.ts:82-86`).
   - On success it returns **202** `{accepted:true, message}` (`route.ts:23-30`).
   - Provider errors are swallowed, except a GoTrue 429, which becomes `auth_rate_limited` (`lib/server/password-auth.ts:372-399`).
   - If password auth is off, it returns 503 `password_auth_disabled` (`password-auth.ts:87-93`).
6. **Success.** The form is replaced by a tinted panel. It has a `role="status"` paragraph, "If an account exists for {email}, a reset link is on its way." (`form:120-129`), a secondary "Send another link" button, and a ghost "Use a different email" button (`form:131-176`). The saved address is cleared (`form:110`).
7. **Send again.** This re-POSTs the same normalised address.
   - On success, a polite caption reads "Another link is on its way to {email} if it has an account." (`form:139-147,158-160`).
   - On failure, the caption shows only the error *title*, in muted ink (`form:148-151`).
   - There is no cooldown.
8. **Use a different email.** This clears `sentTo`, the note and the message (`form:169-173`), and the form comes back.
9. **Errors on the form.** `AuthErrorAlert` appears inside a wrapper with `tabIndex=-1`. Focus moves to it when no field is at fault (`form:73-77,188-192`). Server `invalid_request` field errors focus the email field instead (`form:112-115`).

## 3. States inventory

The only network call is `POST **/api/auth/password/reset/request` (JSON body `{"email":"…"}`). Stub it with `page.route`. Nothing to stub on load.

| State | How reached | What the user sees | Notes |
|---|---|---|---|
| S1 Initial, empty | `goto /forgot-password` | Empty field, "The address you sign in with.", "Send reset link" | Capture at 390, 320 and ≥1024 (aside), light and dark |
| S2 Prefilled | `addInitScript(() => sessionStorage.setItem("naba:reset-email","sam@example.test"))`, or type on `/sign-in` then click "Forgot password?" | Field filled after hydration | |
| S3 Empty submit | Click submit with an empty field | Field error "Invalid email address"; field focused | No request is sent |
| S4 Malformed | Type `sam@` and submit | The same error | No request is sent |
| S5 Pending | Route handler that never fulfils, or waits 5 s | "Sending…", disabled | The focused submit becomes natively disabled (see F4) |
| S6 Success | `fulfill({status:202, contentType:"application/json", body:'{"accepted":true,"message":"If an account exists for that email, a reset link has been sent."}'})` | Neutral status panel plus two buttons | The 15 Oct audit never captured this state (`findings.md:1356`) |
| S7 Resend OK | S6, then click "Send another link" (also 202) | Polite caption under the button | A second resend shows the same text, so nothing changes (F5) |
| S8 Resend 429 | Counter stub: first call 202, later calls `status:429, headers:{"retry-after":"3540"}, body:'{"error":"auth_rate_limited","message":"Too many attempts. Try again later.","retryable":true,"details":{"retryAfter":3540}}'` | Muted caption "Too many attempts." | Says nothing about when to retry; not styled as an error |
| S9 Form 429 | The same 429 body on the first submit | Destructive alert "Too many attempts." / "Wait a while, then try again.", focused | |
| S10 Auth disabled | `status:503, body:'{"error":"password_auth_disabled","message":"Email and password sign-in is temporarily unavailable."}'` | "Password reset is temporarily unavailable." / "This is a problem on our side. Try again shortly." | SET-23 is fixed |
| S11 Provider unavailable | 503 with `"error":"auth_provider_unavailable"` | The same as S10 | |
| S12 Server error | `status:500, body:'{"error":"internal_error","message":"The request could not be completed."}'` | "Something went wrong." / "Try again in a moment." | |
| S13 Offline | `route.abort("internetdisconnected")` | The same generic copy as S12 | `apiFetch` raises `network_error` (`lib/api/client.ts:341-347`), but `auth-errors` has no entry for it (F3) |
| S14 Server field error | `status:400, body:'{"error":"invalid_request","message":"The request did not pass validation.","details":[{"code":"invalid_format","path":["email"],"message":"Invalid email address"}]}'` | Alert "Check the highlighted fields." plus a field error; email focused | Only reachable by stubbing, because the client runs the same schema |
| S15 Different email | S6, then "Use a different email" | The form again. A **prefilled** address comes back empty; a typed one is kept | F2 |

## 4. Protected rules

- **Neutral copy, no enumeration.** The success and resend copy never confirm an account (`form:128,143-147`). The route returns 202 for every address (`route.ts:23-30`), and provider errors other than 429 are swallowed (`password-auth.ts:373-397`).
- **Rate limits.** `reset_request` allows 20 per IP and 3 per email per hour (`abuse-limits.ts:82-86`). The 429 carries `details.retryAfter` and a `Retry-After` header (`abuse-limits.ts:410-419`, `lib/server/http.ts:79-88`). The 429 passthrough stays exactly as it is (`password-auth.ts:389-396`).
- **Origin and body shape.** `origin:"same"` and `resetRequestSchema` (`route.ts:14-16`).
- **The email is not put in the URL.** It goes through `sessionStorage` and is cleared after a send (`reset-email.ts:1-6`, `form:110`).
- **Server authority.** Success is only shown after the 2xx resolves (`form:108-109`).
- **Surface-aware outage titles.** (`lib/api/auth-errors.ts:23-35,164-173`).

## 5. Prior audit status

- **SET-23 (fixed, verified).** `authErrorMessage(error,"forgot-password")` is used at `form:114,150`. `UNAVAILABLE_TITLE["forgot-password"]` = "Password reset is temporarily unavailable." (`auth-errors.ts:26`), and `password_auth_disabled` is a surface-aware code (`:32-35`).
- **SET-18.** Does not apply: there is no password field here.
- **Flow 01a in the 15 Oct audit** (`findings.md:1032`). Only error states were captured; the success state was never seen. This pass should capture S6–S8 and S15 for the first time.

## 6. Friction found

| # | Observation | Evidence | Sev | E/H |
|---|---|---|---|---|
| F1 | **Focus is lost on stage change.** On success, the focused submit button unmounts, so focus falls to `<body>`. The `role="status"` paragraph is mounted already holding its text, and many screen readers don't announce a live region that arrives that way. "Use a different email" also unmounts itself, and nothing gets focus. Compare sign-in, which focuses its alert. (WCAG 2.4.3, 4.1.3) | `form:120-129,163-176`; no focus effect for `sentTo` | P2 | Evidence (code); whether it is announced is a hypothesis, check with VoiceOver |
| F2 | **"Use a different email" loses the address.** After a successful send, `clearResetEmail()` runs (`:110`), and `useSyncExternalStore` re-reads the snapshot on the next render, so `handedOver` becomes `""` (`:55-60`). An untouched prefilled address therefore disappears, while one the user typed (`typed`) is kept. That makes fixing a one-letter typo harder only on the prefilled path. | `form:54-60,110,169-173` | P2 | Evidence (code); confirm in S15 |
| F3 | **Offline gets the generic "Something went wrong."** `apiFetch` already raises `network_error` with "We couldn’t reach NabaPresence. Check your connection and try again." (`client.ts:341-347`), but `BY_CODE` has no entry for it, so it falls back to GENERIC. A phone user on a train is told it is our fault and to "try again in a moment". | `auth-errors.ts:37-40,42-162,180` | P2 | Evidence |
| F4 | **Resend failures are under-reported.** Only `.title` is shown ("Too many attempts.", "Something went wrong."). The description is dropped, so there is no guidance on when to retry. The text is muted and polite, not error-styled. `ResendConfirmationButton` handles this case with `text-danger-ink role="alert"`. | `form:148-151,158-160`; cf. `resend-confirmation-button.tsx:80-84` | P2 | Evidence |
| F5 | **No cooldown on "Send another link."** Two taps spend the whole 3-per-hour email budget (`abuse-limits.ts:85`), and the next tap returns 429. It is also likely that GoTrue's minimum interval between emails per user (60 s by default) returns 429 for a *real* account on a quick resend. That shows "Too many attempts." on the first retry, and it is the residual enumeration channel already flagged in `password-auth.ts:380-388`. Repeating an identical success note also changes nothing, either visually or for screen readers. | `form:131-160` | P2 | Budget: evidence. GoTrue interval: hypothesis (depends on the deployed setting) |
| F6 | **The success panel is weaker than its sibling.** Sign-in's "Check your email" stage has an h2, guidance ("Not there after a few minutes? Check spam or promotions…") and a clear next step (`sign-in-form.tsx:259-308`). This panel has one sentence and no help on what to do if nothing arrives. It also doesn't say that only the newest link works; the F07 page already tells users to "Open the newest reset email" (`reset-password-form.tsx:146-147`). | `form:120-162` | P2 | Evidence |
| F7 | **The pending treatment drops focus.** It uses a native `disabled` plus a label swap. Under the HTML focus-fixup rule, a focused button that becomes disabled loses focus. The shared `Button` has `pending`/`pendingLabel`, which keeps focus (`focusableWhenDisabled`) and adds a spinner (`components/ui/button.tsx:147-154,271-274`); 114 call sites use it elsewhere. No auth form uses it, so this is a consistency gap across the whole auth area. | `form:137-138,156,214-217` | P3 | Hypothesis (browser-dependent) |
| F8 | **Validation copy is terse and the same for every case.** An empty field and a malformed address both show "Invalid email address", with no full stop. The rest of the app says "Enter a valid email address." (`lib/settings/forms/invitation.ts:14`, `lib/locations/forms/administration.ts:5`). | `lib/domain/auth.ts:11-15` | P3 | Evidence |
| F9 | **A stale alert stays up during a retry.** An earlier server error stays visible while the next request is pending, because `setMessage(null)` is never called on submit. Sign-in clears it (`sign-in-form.tsx:160`). | `form:105-106` | P3 | Evidence |
| F10 | **The 429 copy ignores `retryAfter`.** "Wait a while" is vague when the server knows the wait (about an hour on the per-email bucket). | `auth-errors.ts:58-61`; `abuse-limits.ts:418` | P3 | Evidence |

**Fine, leave alone:**
- The page heading, description and footer link.
- The aside copy. "Google login" matches the app's vocabulary, and the card description repeats the main point for phones, where the aside is hidden.
- `overflow-wrap:anywhere` on the email and `WRAPPING_BLOCK_BUTTON` on long labels, which cover 320 px reflow.
- `inputMode`, `autoComplete`, `autoCapitalize` and `spellCheck`.
- The double-submit guard and the neutral copy.
- Action hierarchy on success: no filled primary is correct, because the next step is in the inbox.

## 7. Proposed changes

All changes are in `components/auth/forgot-password-form.tsx` unless stated otherwise. None of them changes a route, a request or response shape, a rate limit, or the neutral copy.

**C1 — Success becomes a "Check your email" stage with focus and guidance (F1, F6).**
- **What changes.** Replace `form:120-162` with the sign-in confirm-sent anatomy (`sign-in-form.tsx:261-284`):
  - The `Mail` mark (`aria-hidden`).
  - `<h2 ref={sentHeadingRef} tabIndex={-1} className="text-section font-semibold text-ink outline-none">Check your email</h2>`.
  - A body paragraph that keeps `role="status"` (existing tests and the fallback announcement rely on it): "If **{sentTo}** has an account, a reset link is on its way. Open it to choose a new password." The bold span keeps `[overflow-wrap:anywhere]`.
  - In the `bg-surface-alt` box, before the resend button: "Not there after a few minutes? Check spam or promotions, then send another link. Only the newest link works."
- **Focus.** Add `useEffect(() => { if (sentTo) sentHeadingRef.current?.focus() }, [sentTo])`.
- **Benefit and risk.** The same pattern as the sibling flow, an announced stage change and a next step when the email is slow. Nielsen #1/#4/#9; HIG consistent feedback; WCAG 2.4.3, 4.1.3. The copy stays neutral ("if … has an account"), so there is no risk to enumeration resistance. Not a shared file.

**C2 — "Use a different email" keeps the address and returns focus (F2, F1).**
- **What changes.** In the success branch at `:108-110`, call `setEmail(email)` before `clearResetEmail()`. This stores the raw value as `typed`, so the field no longer depends on the cleared storage.
- **Focus.** In the "Use a different email" handler, set `returnToForm.current = true`. Add an effect on `sentTo === null && returnToForm.current` that runs `focusField("email")`, selects the field's text and resets the flag.
- **Benefit and risk.** A typo can be fixed with one edit (HIG, preserved context; WCAG 2.4.3). It only changes client state, so there is no risk.

**C3 — Map `network_error` in `lib/api/auth-errors.ts` (F3).**
- **What changes.** Add to `BY_CODE`: `network_error: { title: "We couldn’t reach NabaPresence.", description: "Check your connection and try again." }`. The wording matches `client.ts:344` and `components/locations/administration/lifecycle-workspace.tsx:25`.
- **Benefit.** It names the right cause (Nielsen #9).
- **Callers.** All auth surfaces gain it: sign-in, reset, invitation, MFA and resend. This is an area-local file. The code is only produced client-side, so there is no server impact. No risk.

**C4 — Resend feedback that always changes, plus a cooldown (F4, F5).**
- **Failures.** Render the full message: `{title} {description}` in `text-caption text-danger-ink` with `role="alert"`, as in `resend-confirmation-button.tsx:80-84`. Successes stay polite.
- **Make each result announce.** Call `setResendNote("")` at the start of each resend, so an identical success is still a text change.
- **Cooldown.** After each successful send (the first and every resend), set `cooldown=true` and `setTimeout(() => setCooldown(false), 60_000)`, cleaned up on unmount. While cooling down, pass `disabledReason="You can send another link in a minute."` to the "Send another link" `Button`. That keeps it focusable and describes why it is unavailable, and the same words show in the caption. There is no ticking countdown, which would be noisy in a live region.
- **Benefit.** It avoids spending the budget by accident and avoids a confusing first-retry 429. Nielsen #5 (error prevention); WCAG 3.3.1.
- **Risk.** It is stricter than the server and leaves the server untouched. If anything, it narrows the UI side of the enumeration channel noted in `password-auth.ts:380-388`.

**C5 — Use the shared `Button` pending state (F7).**
- **What changes.** Replace `disabled={pending} aria-busy={…}` and the label ternary at `:137-138,156` and `:214-217` with `pending={pending} pendingLabel="Sending…"`.
- **Benefit.** It keeps focus and shows the house spinner (WCAG 2.4.3).
- **Test impact.** `tests/components/password-reset.test.tsx:72` uses `toBeDisabled()`. Change it to `toHaveAttribute("aria-disabled","true")`, as `invitations-panel.test.tsx:93` does.
- **Scope note for the coordinator.** The other auth forms (sign-in, reset, MFA, invitation actions) use the same label swap. Either do all of them together or leave all of them; don't split the area.

**C6 — Clear a stale alert on submit (F9).** Add `setMessage(null)` next to `setFieldErrors({})` at `:105`, as sign-in does. No risk.

**C7 (optional, shared domain) — Clearer email validation (F8).**
- **What changes.** In `lib/domain/auth.ts:11-15`, use `z.string().trim().min(1, { error: "Enter your email address." }).pipe(z.email({ error: "Enter a valid email address." }))`.
- **Callers.** `loginSchema`, `registerSchema`, `resetRequestSchema` and the resend schema, used by both the server routes and the client forms. Only message text changes, not shapes. No test asserts the old text (grep finds none).
- **Coordination.** Coordinate with the sign-in (F01) flow owner.

## 8. Explicitly not proposed

- **Showing whether the account exists, or "email sent" wording.** That would break enumeration resistance.
- **A countdown from `retryAfter` in the 429 copy (F10).** It is possible from existing data, but it would add logic to the shared mapper. The GoTrue 429 path has no `retryAfter` either, so there would be two different wordings. Keep "Wait a while" unless the coordinator wants it, and in that case only for `details.retryAfter ≥ 60`.
- **Changing the abuse budget, or branching on the GoTrue error code.** That is protected server work, already listed as a follow-up in `password-auth.ts:386-388`.
- **Putting the email in the query string for prefill.** It is protected (`reset-email.ts:1-6`).
- **A filled primary on the success stage, a "resend" auto-timer, or copy on how long the link lasts.** The expiry is a provider setting this repo can't confirm.
- **Rewording the aside.** It is fine.

## 9. Tests

- **Existing.**
  - `tests/components/password-reset.test.tsx:25-76`: prefill, neutral success, 429 alert, single request in flight.
  - `tests/components/sign-in-form.test.tsx:476`: saves the email on "Forgot password?".
  - `tests/e2e/auth.spec.ts:20,38,196`: one h1 and main, no "client" vocabulary, clean console in light and dark.
  - `tests/e2e/accessibility.spec.ts:518-526`: axe on the initial state only.
  - `tests/integration/routes/auth-additions.test.ts:170-200`: 429 passthrough and the 202 swallow.
  - `touch-critical.spec.ts` does not cover this page.
- **Worth adding (unit).**
  - After a 202, the "Check your email" heading has focus.
  - "Use a different email" restores the prefilled address and focuses the field.
  - `network_error` shows "We couldn’t reach NabaPresence."
  - A resend 429 shows title and description in `role="alert"`.
  - "Send another link" has `aria-disabled` with the reason for 60 s (fake timers), then works again.
  - A second identical resend note is announced (empty, then the text).
- **Worth adding (e2e).** Extend the "password recovery" a11y test with a 202 stub so axe covers the success stage at 390 and 320 px in both themes.
