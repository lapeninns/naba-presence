# p1-F07 — Choose a new password from the reset link

Worktree read: `/tmp/naba-presence-p1` (branch `ux/flows-presence-p1`). Analysis only; no repo files changed.

## 1. Flow ID, name, start and end

- **ID / name:** p1-F07, choose a new password from the emailed reset link.
- **Start:** `/reset-password?token_hash=…` opened from the recovery email (sent by p1 forgot-password flow, `app/api/auth/password/reset/request`). Also reachable bare (`/reset-password`) or with a truncated token.
- **Server page:** `app/(auth)/reset-password/page.tsx:7-24`. Renders `AuthCard` (aside `reset`, eyebrow "Account recovery", h1 "Choose a new password", description "Once it’s saved, you’re signed in here and signed out on every other device.", footer "Back to sign in") around `ResetPasswordForm`. No API call on load.
- **Exits:** success → full reload to `/inbox` (`components/auth/reset-password-form.tsx:118`); MFA-enrolled → `/sign-in/verify` (same line; boundary with the MFA verify flow, where the password is actually set: `app/api/auth/mfa/verify/route.ts:135-142`); dead/missing token → `/forgot-password` (boundary with p1 forgot-password); footer → `/sign-in`.

## 2. Steps today

1. Page reads `token_hash` from search params and passes it through (`page.tsx:12,21`).
2. Client checks token length 20–512 (`reset-password-form.tsx:52-58`, bounds `lib/domain/auth-limits.ts:5`). Outside it → missing-token panel "This link is missing or incomplete" + primary "Request another link" (`:142-165`).
3. Otherwise a form: hidden empty `username` field for password managers (`:196-202`), one `PasswordField` "New password" with show/hide toggle and caps-lock hint (`password-field.tsx:49-101`), live one-row checklist "Between 15 and 128 characters" as the field description (`password-requirements.tsx:13-23,30-63`), primary "Update password" (`reset-password-form.tsx:214-222`).
4. First focus inside the form lazy-loads zod (`:63,178`). Submit awaits it, then validates client-side with `passwordSchema` (`:101-110`, messages `lib/domain/auth.ts:31-39`: "Use at least 15 characters." / "Use no more than 128 characters."). Failure → field error (role=alert, no FormErrorScope) + focus to field.
5. Valid → `POST /api/auth/password/reset/complete` `{tokenHash,password}` (`lib/api/auth.ts:51-60`), button disabled, `aria-busy`, label swap "Updating…" (`:218-221`).
6. Server (`app/api/auth/password/reset/complete/route.ts`): rate limit `reset_complete` 20/IP and 5/token per 15 min (`lib/server/abuse-limits.ts:87-91`); breach check before the token is spent (`route.ts:22-25`, `lib/server/breached-password.ts:163-185`, fail-open after 2.5 s `:36`); verify token (`route.ts:26-29`, any provider error → 400 `invalid_email_link` `lib/server/password-auth.ts:348-355`); MFA-enrolled → password deferred into encrypted ticket (`route.ts:30-38,46`); else set password (`password-auth.ts:446-481`, 4xx → `password_reset_failed`, 5xx twice → 503 `password_reset_outcome_unknown`); session minted, all other sessions revoked (`lib/server/email-auth.ts:186-195`).
7. 200 → `hardNavigate` and a never-resolving promise keeps the button pending (`reset-password-form.tsx:118-123`).
8. Error: `invalid_email_link` / `password_reset_failed` → form replaced by a destructive alert with an inline "Request another link" (`:35-38,125-131,167-173`, copy `lib/api/auth-errors.ts:74-83`, link `components/auth/auth-error-alert.tsx:25-34`). Anything else → banner above the form, field error if `invalid_request` carries a `password` issue; focus to field, else to banner (`:77-81,133-137`). The typed password is kept.

## 3. States inventory

Token used in stubs: `recovery-token-hash-for-a11y` (28 chars, as `tests/e2e/accessibility.spec.ts:529`). Submit call: `POST **/api/auth/password/reset/complete`. Error JSON shape: `{error, message, fieldErrors?, details?}` (`lib/server/http.ts:36-44`, read by `lib/api/client.ts:370-381`). Type a valid password like `correct horse battery staple` before submitting.

| State | How reached | What the user sees | Notes |
| --- | --- | --- | --- |
| S1 Missing token | `/reset-password` | Neutral panel "This link is missing or incomplete" / "Open the newest reset email…" + primary "Request another link" | `:142-165`. No API call |
| S2 Truncated token | `/reset-password?token_hash=short` (<20 chars) or >512 | Same as S1 | `:52-58` |
| S3 Form, empty | `/reset-password?token_hash=recovery-token-hash-for-a11y` | Field, checklist row "Not yet met" (hollow circle), Update password | Desktop ≥lg also shows charcoal aside (`auth-card.tsx:69-84`) |
| S4 Checklist met | S3 + type 15+ chars | Row ticks, ink darkens; accessible name "Met: Between 15 and 128 characters" | Not a live region; read on focus via `aria-describedby` |
| S5 Client length error | S3 + type `short` + submit | Red field, "Use at least 15 characters." (role=alert), focus on field | No network call |
| S6 Stale error (bug) | S5 then type until 15+ chars, do not submit | Checklist says Met, field still red with "Use at least 15 characters." | Friction F3 |
| S7 Pending | Stub: `route` that waits ~10 s before fulfilling 200 | Button disabled, "Updating…", aria-busy | |
| S8 Success | `200 {"updated":true,"authenticated":true,"mfaRequired":false}` | Full reload to `/inbox`. Stub `**/inbox` (document) with a placeholder, or assert the request URL | No confirmation anywhere afterwards (F6) |
| S9 MFA handoff | `200 {"updated":false,"authenticated":false,"mfaRequired":true}` | Reload to `/sign-in/verify` "Enter your code" (generic sign-in copy) | Verify page redirects to `/sign-in` if MFA is off in env (`app/(auth)/sign-in/verify/page.tsx:23`) |
| S10 Expired/used link | `400 {"error":"invalid_email_link","message":"This email link is invalid or expired."}` | Form removed; destructive alert "That link is invalid or has expired." / "Request a fresh one and try again." + underlined link; focus on alert | h1/description "Choose a new password… Once it’s saved…" still above |
| S11 Password refused / spent | `400 {"error":"password_reset_failed","message":"The reset session is invalid or expired."}` | As S10, title "That reset link is no longer valid." | |
| S12 Breached password | `400 {"error":"invalid_request","message":"The request did not pass validation.","fieldErrors":{"password":"This password has appeared in a known data breach, so it is easy to guess. Choose a different one."},"details":[{"code":"password_breached","path":["password"],"message":"This password has appeared in a known data breach, so it is easy to guess. Choose a different one."}]}` | Banner "Check the highlighted fields." (role=alert) + field error (role=alert), focus on field, password kept | Two alerts + focus (F4). Error stays while typing a new one (F3) |
| S13 Rate limited | `429 {"error":"auth_rate_limited","message":"Too many attempts. Try again later.","details":{"retryAfter":900}}` | Banner "Too many attempts." / "Wait a while, then try again.", focus on banner, form kept | |
| S14 Provider down | `503 {"error":"auth_provider_unavailable","message":"x"}` | Banner "Password reset is temporarily unavailable." / "This is a problem on our side. Try again shortly." | Surface-aware (SET-23 fix) |
| S15 Outcome unknown | `503 {"error":"password_reset_outcome_unknown","message":"We could not confirm whether your new password was saved. Try signing in with the new password before requesting another reset link."}` | Generic "Something went wrong." / "Try again in a moment.", form kept | F1: the advice is dropped; a retry hits S10 |
| S16 Network failure | `route.abort("failed")` | Generic "Something went wrong." / "Try again in a moment." | F2: `network_error` unmapped |
| S17 Retry after S15/S16 | S15 or S16, then stub S10 on the second call | "That link is invalid or has expired" although the password may already be live | F1/F2 |
| S18 Stale banner on resubmit | S13, then clear field, type `short`, submit | "Too many attempts" banner stays above the new length error | F5 |

Capture at 390 light, 390 dark, 1280 (aside visible).

## 4. Protected rules

- Breach check before the token is spent, so a refused password leaves the link usable (`route.ts:22-25`); fail-open (`breached-password.ts:32-36,163-170`); only a 5-hex prefix leaves the server (`:10-14,89-95`).
- Abuse budget 20/IP, 5/token per 15 min (`abuse-limits.ts:87-91`).
- MFA: an enrolled person's password is set only after their code; nothing changes without it (`route.ts:30-38`, `mfa/verify/route.ts:135-142`).
- Other sessions are revoked and this one kept (`email-auth.ts:186-195`).
- No account lookup or address display on this page (enumeration) (`reset-password-form.tsx:188-195`).
- Server authority: navigate only after 200, and keep the button pending until the reload (`:118-123`).
- Dead-token tear-down for terminal codes only (`:30-38`); token-length guard mirrors the schema (`:45-58`, `lib/domain/auth.ts:67-73`).
- Same-origin hard navigation (`lib/client/hard-navigate.ts`).
- Rule list mirrors `passwordSchema`, length only (`password-requirements.tsx:8-12`, D9/F7).

## 5. Prior audit status (15 Oct)

- **SET-18** (confirm field, composition rules): fixed. One field (`reset-password-form.tsx:204-212`), length-only rule (`password-requirements.tsx:13-23`), 15–128 code points + breach check (F7, #206/#233). Verified in code.
- **SET-23** (surface-blind error copy): fixed. Reset shows "Password reset is temporarily unavailable." (`auth-errors.ts:23-35,164-173`).
- SET-17, CLR-11, CLR-12: not this flow.
- Not raised in Oct and still open: the `password_reset_outcome_unknown` and `network_error` copy, the stale field error, and the double alert on breach (below).

## 6. Friction found

| # | Observation | Evidence | Sev | E/H |
| --- | --- | --- | --- | --- |
| F1 | The server's specific 503 `password_reset_outcome_unknown` ("try signing in with the new password before requesting another link") has no `BY_CODE` entry, so the user sees "Something went wrong. Try again in a moment." and keeps the form. Retrying spends the already-used token and gets "That link is invalid or has expired". That sends them for a new link when their new password may already be live, which is the exact trap the server code was written to avoid. | `password-auth.ts:461-481`; `auth-errors.ts:37-40,164-183` (no entry); `reset-password-form.tsx:133-135` | P1 | Evidence (token single-use per comment `password-auth.ts:461-465`) |
| F2 | A dropped connection (`network_error`, status 0) shows the same generic copy. The request may have reached the server: public routes take no idempotency intent (`route.ts:466-472`), so a retry can hit S10 with the same misleading advice. | `client.ts:333-350`; `auth-errors.ts:179-183` | P2 | Evidence; "may have landed" is inherent to fetch |
| F3 | Field errors never clear on input. After "Use at least 15 characters." the checklist ticks to Met while the red error still says the opposite (S6). After a breach error, the "appeared in a known data breach" message stays under a brand-new password until resubmit. | `reset-password-form.tsx:67,107,208` (`onValueChange={setPassword}` only) | P2 | Evidence |
| F4 | Breach rejection fires two `role="alert"` regions (banner "Check the highlighted fields." + `FieldError`) and moves focus to the field, so a screen reader hears it 2–3 times. The banner adds nothing with a single field. A client-side length error shows no banner, so the two password errors look different. | `:133-137,182-186`; `field.tsx` FieldError `mode = scope ? "off" : "alert"`; `alert.tsx` destructive → alert | P2 | Evidence |
| F5 | `message` is not cleared when a new submit starts, so an old banner (rate limit, outage) stays above a new client error or during "Updating…" (S18). Sign-in clears its banner only on a mode switch (`sign-in-form.tsx:157-162`), so this is the shared auth habit, but here it is more visible. | `reset-password-form.tsx:85-111` | P3 | Evidence |
| F6 | No server-confirmed success acknowledgement. The person lands on `/inbox` with nothing saying the password changed or that other devices were signed out. The promise is only in the pre-submit description (`page.tsx:18`). | `:118`; grep: no "password updated" copy in app/components | P2 | Evidence |
| F7 | MFA handoff loses context. `/sign-in/verify` says only "Enter your code". It doesn't say the new password is saved after the code, or that the old one still works if they stop. The page description ("Once it’s saved, you’re signed in here…") is also not true for this group until the code is entered. | `sign-in/verify/page.tsx:26-31`; `route.ts:30-38` | P2 | Evidence |
| F8 | The dead-token state (S10/S11) differs from the missing-token state (S1). It shows a destructive alert with only an underlined inline link and no primary action, while S1 has a block primary button for the same recovery. Users get two treatments for one dead end, and the weaker one appears exactly when the user's effort was just lost. | `:142-165` vs `:167-173`; `auth-error-alert.tsx:25-34` | P2 | Evidence |
| F9 | The desktop aside footnote says "request another from the sign-in page", an indirect route (sign-in → Forgot password?) when `/forgot-password` exists. | `auth-card.tsx:82-83` | P3 | Evidence |
| F10 | The checklist does not announce as it flips to Met. It is described on focus. | `password-requirements.tsx:32-61` | — | Fine: one rule, enforced on submit; leave |

Fine as is, leave alone: label-swap pending ("Updating…" + disabled + aria-busy) matches every auth form (`forgot-password-form.tsx:156,217`, `mfa-verify-form.tsx:230`), and auth has no shared SubmitButton; password retained after errors; double-submit guard (`:83-95,123`); 44px toggle (`password-field.tsx:62-72`); hidden username field; 320px wrapping CTA (`wrapping-button.ts`); surface-aware outage copy.

## 7. Proposed changes

All changes are area-local: `components/auth/reset-password-form.tsx`, `lib/api/auth-errors.ts`, `components/auth/auth-card.tsx`, `app/(auth)/sign-in/verify/page.tsx`. No shared primitive changes.

**C1 — Say what the server knows when the outcome is unknown (F1, F2, S15–S17).** P1.
- `lib/api/auth-errors.ts` `BY_CODE` add (only the reset route raises this code):
  `password_reset_outcome_unknown: { title: "We couldn’t confirm your new password was saved.", description: "Try signing in with the new password. If that doesn’t work, request another link.", action: "request-reset-link" }`.
- `reset-password-form.tsx:35-38`: add `"password_reset_outcome_unknown"` to `DEAD_TOKEN_CODES`, because the token was verified (spent) before the 503 (`route.ts:26-37`).
- Network drop: add `const uncertain = useRef(false)`. In the catch (`:124`), if `error instanceof ApiClientError && error.code === "network_error"`, set `uncertain.current = true` and `setMessage({ title: "We couldn’t reach NabaPresence.", description: "Check your connection and try again." })`, then return (form kept). In the dead-token branch (`:125-131`), if `uncertain.current`, use `{ ...authErrorMessage(error, "reset-password"), description: "If you pressed Update password before, your new password may already be saved. Try signing in with it, or request another link." }`.
- Benefit: no false "your link expired, start over" after a password may already be set, and a route to sign in. Principles: Nielsen 9 (help recover), 1 (system status); WCAG 3.3.3 Error Suggestion.
- Risk: none. Same requests and same codes; copy and client presentation only; enumeration unaffected (post-token).

**C2 — Make the dead-token state match the missing-token state (F8).** P2.
- `:167-173`: render `<div className="flex flex-col gap-5">` holding the focused alert wrapper (keep `ref={alertRef} tabIndex={-1}`) with `<AuthErrorAlert message={{ ...message, action: undefined }} />`, then the same block `Link` as `:154-162` ("Request another link", `buttonVariants({ size: "lg", block: true })` + `WRAPPING_BLOCK_BUTTON`). Extract that link to a local `RequestAnotherLink` component used by both branches.
- Benefit: one obvious primary action, consistent recovery. HIG consistency; Nielsen 4; WCAG 2.5.8 target (block 44px vs inline link).
- Risk: none. The alert is still role=alert and focused; the unit test at `tests/components/password-reset.test.tsx:114-129` still finds the link by name.

**C3 — Clear stale password feedback as the person types (F3, F5).** P2.
- Replace `onValueChange={setPassword}` (`:208`) with a handler: `setPassword(next); if (fieldErrors.password) { setFieldErrors({}); setMessage(null) }`. Clear both together. Clearing only `fieldErrors` while `message` stays would trigger the effect at `:77-81` and steal focus to the banner mid-typing. A message that accompanies a field error is only ever the `invalid_request` banner, and C4 removes that banner anyway.
- In `handleSubmit` (`:87`, after the guard): `setMessage(null)`, so an old banner never sits above a new attempt. When the error comes back, re-setting `message` re-announces it.
- Benefit: the checklist and error never contradict each other. Nielsen 1 and 5; WCAG 3.3.1 (the error stays accurate).
- Risk: none. Client state only.

**C4 — One announcement for a field-attributed server error (F4).** P2.
- `:133-137`: compute `errors` and `target` first. If `target` is found, `setMessage(null)` and focus the field. Otherwise `setMessage(authErrorMessage(error, "reset-password"))`. The breach error then looks and sounds like the client length error: field error + focus, no "Check the highlighted fields." banner.
- Principle: WCAG 4.1.3 and 3.3.1; Nielsen 4. Risk: none. `fieldErrorsFrom` is unchanged and the server copy is shown verbatim.

**C5 — Keep context through the MFA handoff (F7).** P2, cross-flow with MFA verify; coordinate with that brief.
- `reset-password-form.tsx:118`: `hardNavigate(result.mfaRequired ? "/sign-in/verify?from=reset" : "/inbox")`.
- `sign-in/verify/page.tsx`: read `from` beside `next` (`:20-22`). When `from === "reset"`, use description "Enter the code from your authenticator app to finish. Your new password is saved only after this step; until then your old one still works." Presentation only: the param grants nothing, and `next` sanitising is unchanged.
- Risk: low. A hand-typed `?from=reset` changes copy only. This copy is accurate per `route.ts:30-38`.

**C6 — Footnote copy (F9).** P3. `auth-card.tsx:82-83` → "If this link has expired, request another from Forgot password." (Desktop aside only.)

Smallest coherent set if time is short: C1 + C3 + C4 (all in one file plus one `BY_CODE` entry).

## 8. Explicitly not proposed

- **Success acknowledgement on `/inbox` (F6).** It needs an arrival notice in the app shell or inbox (other teams, no existing pattern). Owner/platform decision. Suggested copy if adopted: "Password updated. You’ve been signed out on your other devices." It must be driven by a server-confirmed 200, not a URL alone.
- Mapping `network_error` globally in `BY_CODE`: it would change every auth surface. Leave it to the other p1 flow briefs; C1 is reset-local.
- Live-announcing checklist changes (noisy, one rule), a strength meter or composition rules (D9/F7 decided length-only), a confirm field (SET-18/D9 done).
- Showing the account email on the page (enumeration).
- A Retry-After countdown for 429 (shared copy; budget unchanged).
- `autoFocus` on the field (keyboard hides the heading on phones; unproven gain).
- Changing the server's `password_reset_failed` semantics or splitting it from a provider password refusal (protected route).
- Swapping label-swap pending for a spinner (consistent today).

## 9. Tests

- Existing: `tests/components/password-reset.test.tsx:78-215` (missing/truncated/over-long token, success → /inbox, dead token, non-terminal 429 keeps form, short password blocked, single field, in-flight dedupe); `tests/components/auth-kit.test.tsx:71-215` (PasswordField, requirements); `tests/e2e/auth.spec.ts:21,38,113-119,197` (heading, missing-token CTA, console sweep light/dark); `tests/e2e/accessibility.spec.ts:528-535` (axe on the form at each viewport/theme); server: `tests/server/breached-password-routes.test.ts`, `tests/integration/routes/password-auth.test.ts`, `tests/server/abuse-limit-wiring.test.ts`. `touch-critical.spec.ts` does not cover this page (grep). Consider adding S3 there.
- Stale name: `password-reset.test.tsx:180` "letters-only password of 12 or more characters" now tests the 15 rule. Rename it to "…of 15 or more".
- Add (unit, `password-reset.test.tsx`):
  1. 503 `password_reset_outcome_unknown` → alert "We couldn’t confirm your new password was saved.", form removed, "Request another link" button.
  2. `ApiClientError(0,"network_error")` → "We couldn’t reach NabaPresence." with the form kept. A second submit rejected with `invalid_email_link` shows the "may already be saved" description.
  3. Breach `invalid_request` → exactly one `role=alert` in the form (the field error), no "Check the highlighted fields.", focus on input.
  4. After a length error, typing to 15 chars removes the error text and `aria-invalid`, and focus stays in the input.
  5. Dead token renders a link styled as a block button (name "Request another link") and the alert is focused.
- Add (e2e, `auth.spec.ts`): stub S10 and S12 via `page.route("**/api/auth/password/reset/complete")` and assert the visible copy and focus. Stub S9 and assert the URL `/sign-in/verify?from=reset` (C5).
