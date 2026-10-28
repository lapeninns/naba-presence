# p1-F03 — Resend a confirmation email

Worktree read: `/tmp/naba-presence-p1` @ `e4123d25`. All `path:line` refs are to that tree. Analysis only; nothing edited or run.

## 1. Flow, start and end

- **Component:** `components/auth/resend-confirmation-button.tsx` (one client component, two variants: `link` (default) and `button`).
- **Placements (3 call sites, all inside `SignInForm`/`AuthErrorAlert`):**
  - A. `/sign-in`, sign-in mode: "Didn't receive a confirmation email?" `<details>` disclosure, link variant, `email` = whatever is in the form's email field (`components/auth/sign-in-form.tsx:488-500`). Also on `/invite/[token]` in sign-in mode (`components/auth/invitation-view.tsx:224-228` renders `SignInForm` with `inviteToken` + read-only `invitedEmail`).
  - B. `email_not_verified` alert action, link variant, no `inviteToken` (`components/auth/auth-error-alert.tsx:22-24`, mounted by `sign-in-form.tsx:319-323` and `forgot-password-form.tsx:190`).
  - C. Confirm-sent stage after Create account (on `/sign-in?mode=create-account` and `/invite/[token]`), button variant with `inviteToken` (`sign-in-form.tsx:259-310`, button at `:290-294`).
  - No other invite placements: `invitation-actions.tsx:62` renders `AuthErrorAlert` without `email`, so the resend action never draws there (`auth-error-alert.tsx:22`).
- **API:** `resendConfirmation(email, inviteToken?)` → `POST /api/auth/password/resend` (`lib/api/auth.ts:62-70`) → route (`app/api/auth/password/resend/route.ts:13-31`) → `resendConfirmationEmail` (`lib/server/password-auth.ts:403-433`). Always `202 {"accepted":true}` unless validation (400), abuse limit (429), provider 429 (429) or config outage (503).
- **End:** inline result text in place of / under the control. No navigation. The emailed link goes to `/auth/confirm` → `/confirm-email` (flow F0x confirm-email, out of scope).
- **Boundaries:** sign-in submit (F01), create account (F02: owns the stage change into confirm-sent), forgot password (owns the sibling "Send another link" pattern this flow should match), invitation accept.

## 2. Steps today

1. Placement A: user on `/sign-in` opens the disclosure (`sign-in-form.tsx:488-496`; summary 44px touch / 24px desk at `:489`). Inside: one link-style button "Resend confirmation email" (`resend-confirmation-button.tsx:78`). No text says which address it will use.
2. Press. No client check of `email`: it posts whatever is in state, even `""` (`resend-confirmation-button.tsx:62-70`, `sign-in-form.tsx:498`).
3. Pending: native `disabled={pending}` + `aria-busy`, label swaps to "Sending…" (`:52-53`, `:78`). No spinner; this is not the shared `Button pending` pattern (`components/ui/button.tsx:147-154,272-274`), which keeps focus on the control.
4. Server: body `{ email, inviteToken? }` validated by `emailSchema` (trim + `z.email()`, `lib/domain/auth.ts:11-14`; `lib/contracts/auth.ts:41-44`). Invalid → `400 invalid_request` with `fieldErrors` (`lib/server/http.ts:126-132`), not counted against limits (`lib/server/route.ts:100-101`). Then limit `resend_confirmation`: 3/email/hour, 20/IP/hour → `429 auth_rate_limited` + `details.retryAfter` (`lib/server/abuse-limits.ts:77-81`). Handler builds `/auth/confirm?flow=signup[&inviteToken]` (`route.ts:19-25`), provider errors other than 429 are swallowed so the answer is identical for every address (`password-auth.ts:419-430`).
5. Success (any 202): the whole control is replaced by `<span role="status">Confirmation email sent.</span>` (`resend-confirmation-button.tsx:35-41`). Terminal for the component's lifetime.
6. Failure: `<span role="alert">` under the button with **only the title** of `authErrorMessage(error, "sign-in")` (`:72-73`, `:80-84`). Button re-enabled; the old message stays visible during a retry.
7. Placement C: after Create account returns 202 `confirmationRequired`, the form swaps to "Check your email" with neutral copy (`sign-in-form.tsx:269-283`), a tinted panel with the outlined full-width resend (`:285-295`), and ghost "Back to sign in" (`:296-307`).
8. Placement B: only drawn when `message.action === "resend-confirmation" && email` (`auth-error-alert.tsx:22`). The live server never returns `email_not_verified` from login any more (normalised to `invalid_credentials`, `password-auth.ts:205-211,240-241`); it can still arrive as `/sign-in?status=email_not_verified` from the confirm POST (`app/auth/confirm/route.ts:30-37`, `lib/server/provisioning.ts:39-44`). On that page `email` starts empty, so the alert shows no resend until the person types an address; then two resend controls exist (alert + disclosure), with independent states.

## 3. States inventory

Page loads make **no** client API call for `/sign-in` (server-rendered; needs no session cookie). `/invite/{token}` makes `GET /api/invitations/{token}` on load. Submit/press calls are below.

| State | How reached | What the user sees | Notes |
| --- | --- | --- | --- |
| A-closed | `GET /sign-in` | Disclosure summary "Didn't receive a confirmation email?" under the form | 44px touch target (`sign-in-form.tsx:489`) |
| A-open idle | click summary | Link "Resend confirmation email" | no hint that it uses the field above |
| A-empty | open disclosure, email field empty, press. Real server answers 400; stub `POST **/api/auth/password/resend` → `400 {"error":"invalid_request","message":"The request did not pass validation.","fieldErrors":{"email":"Invalid email address"}}` | Red caption "Check the highlighted fields." — nothing is highlighted, focus stays on the link | **main defect** |
| A-invalid | type `abc`, press; same 400 stub | same as A-empty | |
| A/C-pending | stub resend with a held route (`route.fulfill` after a delay / never) | "Sending…", control disabled, grey (link) | native `disabled` drops focus (Hypothesis, see #4) |
| A/C-success | stub `202 {"accepted":true}` | "Confirmation email sent." replaces the control | not neutral; focus lost |
| A-success then edit email | success, then change the email field | still "Confirmation email sent.", no way to send to the corrected address without reload | |
| rate-limited | stub `429 {"error":"auth_rate_limited","message":"Too many attempts. Try again later.","details":{"retryAfter":1800}}` (header `Retry-After: 1800`) | "Too many attempts." (no "what next") | |
| network failure | `route.abort("internetdisconnected")` | "Something went wrong." (title of GENERIC; "Try again in a moment." dropped) | client maps to `network_error` (`lib/api/client.ts:340-347`), not in `BY_CODE` |
| outage | stub `503 {"error":"password_auth_disabled","message":"…"}` | "Sign-in is temporarily unavailable." even in the create-account panel | surface hard-coded `"sign-in"` (`resend-confirmation-button.tsx:73`) |
| B alert | `GET /sign-in?status=email_not_verified` | Destructive alert "Confirm your email address to continue." + description; resend appears only after typing an email; disclosure resend also present | real tests stub login 403 `email_not_verified` (`tests/e2e/auth.spec.ts:79-102`), which prod never sends now |
| C idle | `/sign-in?mode=create-account`, fill name/email/15+ char password, stub `POST **/api/auth/password/register` → `202 {"authenticated":false,"confirmationRequired":true}` | "Check your email" panel, outlined "Resend confirmation email", ghost "Back to sign in" | focus after stage change: see #7 |
| C on invite | `/invite/{t}` with `GET **/api/invitations/{t}` → `200 {"organisationName":"Lapen Inns","email":"new@example.test","role":"member","expiresAt":"2026-11-04T12:00:00.000Z"}`, then register stub as above | same panel; resend body carries `inviteToken` | assert request body in the stub |

Viewports for captures: 390×844 and 320×640 (reflow), desk 1280×800, light and dark.

## 4. Protected rules

- Identical 202 for every address; provider non-429 failures swallowed (`lib/server/password-auth.ts:419-430`, comment "Never disclose whether the address belongs to an account").
- Provider 429 deliberately surfaced (`password-auth.ts:420-427`); app limits 3/email + 20/IP per hour, counted regardless of account existence (`lib/server/abuse-limits.ts:16-17,77-81`).
- Disclosure always present, never conditioned on an error (`sign-in-form.tsx:479-487`; test `tests/components/sign-in-form.test.tsx:147-154`).
- Confirm-sent copy neutral: "If {email} can be used for a new account…" (`sign-in-form.tsx:272-283`).
- `inviteToken` must travel with a resend, or `/auth/confirm` provisions the invitee as a new owner (`lib/contracts/auth.ts:36-44`; `route.ts:22-24`).
- Request/response shapes: `resendConfirmationSchema`, `{accepted:true}` 202 (`lib/contracts/auth.ts:41-44,73-75`). Same-origin, public auth (`route.ts:13-17`).
- Server authority: success text only after the 202 resolves (`resend-confirmation-button.tsx:67-71`). Keep.

## 5. Prior audit status (15 Oct)

No finding targets resend directly. Related:
- **SET-23** (auth copy ignores surface) fixed in `lib/api/auth-errors.ts:23-35,175-183` — but the resend button pins `"sign-in"` (`resend-confirmation-button.tsx:73`), so the create-account and invite panels still get "Sign-in is temporarily unavailable." Residual, small.
- **SET-17 / SET-18** (invite role; confirm password) fixed (`invitation-view.tsx:69-90`; one `PasswordField` at `sign-in-form.tsx:419,442`). Not affected.
- CLR-11/12 are share-page items, not this flow.

## 6. Friction found

| # | Observation | Evidence | Sev | E/H |
| --- | --- | --- | --- | --- |
| 1 | Empty or malformed email posts anyway; 400 `invalid_request` shows "Check the highlighted fields." with nothing highlighted and no focus move. The disclosure is opened most often *before* typing anything. | `resend-confirmation-button.tsx:62-73`; `auth-errors.ts:121-123`; `sign-in-form.tsx:498` passes raw state | P1 | Evidence |
| 2 | Success copy "Confirmation email sent." asserts a send that does not happen for unknown or already-confirmed addresses. Same for all addresses (no enumeration leak), but untrue and inconsistent with the neutral copy two lines above it (C) and with forgot-password ("Another link is on its way to X if it has an account.") | `resend-confirmation-button.tsx:35-41` vs `sign-in-form.tsx:276-283`, `forgot-password-form.tsx:145-147` | P2 | Evidence |
| 3 | Success unmounts the button the user just pressed: keyboard/SR focus falls to `<body>` (WCAG 2.4.3). The `role="status"` node is inserted already containing its text, which several screen readers do not announce (4.1.3). Forgot-password uses a pre-mounted `aria-live` span instead. | `resend-confirmation-button.tsx:35-41`; `forgot-password-form.tsx:155-157` | P2 | Evidence (unmount) / Hypothesis (announcement varies by SR) |
| 4 | Pending uses native `disabled`, which blurs the focused button in current Chrome/Firefox; the shared `Button pending` exists precisely to avoid this ("keeping the button focusable so focus is not thrown to the body mid-action"). | `resend-confirmation-button.tsx:52`; `components/ui/button.tsx:147-151,271-273` | P2 | Hypothesis (browser behaviour; verify with `document.activeElement` in Playwright) |
| 5 | "Sent" is terminal and not tied to the address: on `/sign-in`, correcting a typo in the email field after a send leaves "Confirmation email sent." and no button. | `resend-confirmation-button.tsx:31,35` (state not keyed by `email`) | P2 | Evidence |
| 6 | Failure shows only the title: 429 → "Too many attempts." (drops "Wait a while, then try again."); network → "Something went wrong." (drops "Try again in a moment."); `network_error` has no mapping. Old error stays on screen while a retry is pending; an identical repeat error is not re-announced. Outage title says "Sign-in" on the create-account/invite panel. | `resend-confirmation-button.tsx:72-73,80-84`; `auth-errors.ts:37-40,58-61`; `client.ts:340-347` | P2 | Evidence |
| 7 | Stage change to confirm-sent unmounts the focused submit; nothing receives focus or is announced, so a SR user hears nothing after "Creating account…". | `sign-in-form.tsx:247,259-310` (no ref/focus/live region) | P2 | Evidence (shared with F02) |
| 8 | Alert placement B omits `inviteToken`. Unreachable on today's routes (login never returns `email_not_verified`; `signInError` drops `invite`), but a latent hazard the contract comment warns about. Also produces a second resend control beside the disclosure. | `auth-error-alert.tsx:23`; `sign-in-form.tsx:321`; `lib/contracts/auth.ts:36-40` | P3 | Evidence (latent) |
| 9 | Disclosure gives no cue that the link uses the email field above. | `sign-in-form.tsx:497-499` | P3 | Hypothesis |
| — | Fine, leave alone: link-variant target 44px touch / 24px desk (`resend-confirmation-button.tsx:56`, `desk` = ≥48rem + fine pointer, `app/globals.css:85`) meets 2.5.8; double-press guarded by `disabled` during pending and by the terminal state; button variant wraps at 320px (`WRAPPING_BLOCK_BUTTON`); action hierarchy in C (one outlined primary + ghost back) is right; neutral C body copy. | | | |

## 7. Proposed changes (smallest coherent set; all area-local, no shared primitive edits)

**P-1. Rework `ResendConfirmationButton` into the forgot-password resend pattern** — fixes #2 #3 #4 #5 #6.
File: `components/auth/resend-confirmation-button.tsx` (only callers: `sign-in-form.tsx:290,498`, `auth-error-alert.tsx:23`).
- State: replace `state`/`failure` with `const [sentTo, setSentTo] = useState<string|null>(null)` and `const [note, setNote] = useState<{tone:"ok"|"error"; text:string}|null>(null)`; add `const busy = useRef(false)` guard (same idiom as `sign-in-form.tsx:166`).
- Never unmount the button (delete the early return at `:35-41`). Label: `sentTo === email.trim() ? "Send another link" : "Resend confirmation email"`; pending label "Sending…".
- Pending: `variant="button"` → render `<Button variant="secondary" size="lg" block pending={pending} pendingLabel="Sending…" className={cn(WRAPPING_BLOCK_BUTTON, className)}>` (shared `Button` used as-is; no change to it). `variant="link"` → keep the raw `<button>` but use `aria-disabled={pending || undefined}` instead of `disabled`, move the `disabled:` classes to `aria-disabled:`, and `if (pending || busy.current) return` at the top of `onClick`.
- On press: `setNote(null)` first (so a repeated message re-announces), then the transition.
- Success copy (verbatim): `` `A new confirmation link is on its way to ${email.trim()} if it still needs confirming.` `` with `setSentTo(email.trim())`.
- Error copy: `const m = authErrorMessage(error, surface); setNote({ tone: "error", text: [m.title, m.description].filter(Boolean).join(" ") })` → "Too many attempts. Wait a while, then try again." / "Something went wrong. Try again in a moment."
- Result region, always mounted directly after the button: `<span aria-live="polite" className={cn("text-caption [overflow-wrap:anywhere]", note?.tone === "error" ? "text-danger-ink" : "text-ink-muted")}>{note?.text}</span>` (mirrors `forgot-password-form.tsx:155-157`).
- New optional prop `surface?: AuthSurface` (default `"sign-in"`); `sign-in-form.tsx:290` passes `surface={inviteToken ? "invitation" : "create-account"}`.
- Benefit: truthful neutral copy, focus kept on the control throughout, reliable announcement, can resend to a corrected address, actionable error text. Principles: Nielsen #1/#9, HIG consistent feedback, WCAG 2.4.3, 4.1.3, 3.3.1.
- Risk: none to protected behaviour. Same request, same call conditions, success still only after the 202; copy stays neutral (stronger than today). Repeat sends remain bounded by the server's 3/email/hour limit, exactly as forgot-password's "Send another link" already is.

**P-2. Validate the address before sending, and route the error to the email field** — fixes #1.
Files: `resend-confirmation-button.tsx`, `sign-in-form.tsx`.
- New optional prop `onInvalidEmail?: (empty: boolean) => void`. In `onClick`, before the transition: `if (!email.trim() || !/^[^\s@]+@[^\s@]+$/.test(email.trim()))` → if `onInvalidEmail` call it, else `setNote({tone:"error", text: "Enter your email address above first."})`; return without a request. Also treat a server `invalid_request` the same way (belt and braces; server stays the authority).
- In `sign-in-form.tsx:498` pass `onInvalidEmail={(empty) => { setFieldErrors({ email: empty ? "Enter your email address." : "Enter an email address like name@example.co.uk." }); focusField("email") }}` — the exact strings already used by `friendlyFieldErrors` (`sign-in-form.tsx:71-75`). `message` is untouched, so the alert-focus effect (`:151-155`) does not fire.
- The light regex is only a pre-check to avoid a doomed request; it never decides success. Benefit: error tied to the field it concerns, focus moved there. WCAG 3.3.1, 3.3.3; Nielsen #9. Risk: none (no request sent for an obviously empty field; server rules unchanged, nothing about account existence revealed).

**P-3. Focus the "Check your email" heading on entering confirm-sent** — fixes #7. (Coordinate with F02, which owns the create-account submit.)
File: `sign-in-form.tsx:269`. Add `const sentHeadingRef = useRef<HTMLHeadingElement>(null)`, `useEffect(() => { if (stage === "confirm-sent") sentHeadingRef.current?.focus() }, [stage])`, and `<h2 ref={sentHeadingRef} tabIndex={-1} className="… outline-none">`. Benefit: SR users hear the new stage; keyboard users start at the top of it. WCAG 2.4.3, 4.1.3. Risk: none.

**P-4. Carry the invitation into the alert's resend** — fixes #8 (latent).
Files: `auth-error-alert.tsx` (add `inviteToken?: string` prop, pass to `ResendConfirmationButton` at `:23`), `sign-in-form.tsx:321` pass `inviteToken={inviteToken}`. Benefit: the contract's invariant holds on every path. Risk: none; adds the token only where `SignInForm` already has it.

**P-5 (optional, P3). One-line cue in the disclosure** — #9. `sign-in-form.tsx:497`, before the button: `<p className="text-caption text-ink-muted">We’ll use the email address above.</p>`. Skip if P-2 lands and the coordinator wants fewer pixels.

## 8. Explicitly not proposed

- Conditioning the disclosure on a failed sign-in, or opening it automatically after `invalid_credentials`: would create an enumeration channel (`sign-in-form.tsx:479-487`).
- Showing a countdown from `details.retryAfter`: email-keyed counts are account-agnostic so it would be safe, but provider 429s carry no `retryAfter` (`password-auth.ts:420-427`), giving two behaviours; low value for a 3/hour action.
- A client cooldown timer after success: the server limit already bounds sends; a timer adds state and inconsistency with forgot-password.
- Surfacing provider outages on resend (today swallowed into 202): protected enumeration rule.
- Adding `network_error` to `BY_CODE` (`"We couldn’t reach NabaPresence." / "Check your connection and try again."`): worthwhile, but it changes every auth surface; propose once, at coordinator level with F01/F02, not from this flow alone.
- Removing placement B as near-dead code: it still serves `?status=email_not_verified`; deduplicating with the disclosure is cosmetic.
- Spinner on the link variant / switching all auth submits to `Button pending`: cross-flow consistency call for the coordinator (sign-in submit `sign-in-form.tsx:453-467` and forgot-password use the same label swap).

## 9. Tests

Existing: `tests/components/sign-in-form.test.tsx:100-125` (alert resend, asserts "Confirmation email sent." — update to the new copy), `:147-154` (disclosure always present — keep); `tests/components/auth-api.test.tsx:56-62`; `tests/e2e/auth.spec.ts:79-102` (stubs login 403 `email_not_verified`, which prod no longer returns — consider switching to `/sign-in?status=email_not_verified`); route/limit coverage in `tests/integration/routes/auth-additions.test.ts:35-170`, `tests/server/abuse-limit-wiring.test.ts:5`. Nothing covers placement C's resend, the empty-email path, or focus.

Add (component, `tests/components/resend-confirmation-button.test.tsx`):
1. Empty email + `onInvalidEmail` → callback called, `resendConfirmation` not called; on `SignInForm`, email field gets "Enter your email address." and focus.
2. Success → polite region contains "A new confirmation link is on its way to a@example.test if it still needs confirming."; button still in the document and `document.activeElement` is the button; label "Send another link".
3. Change email after success → label back to "Resend confirmation email".
4. 429 → "Too many attempts. Wait a while, then try again."; a second identical failure clears then re-sets the region.
5. Invite: `inviteToken` forwarded from placement C and (P-4) from the alert.
6. Pending: second click while held resolves only one call.
E2E (`auth.spec.ts`): create-account → 202 stub → heading focused (P-3), resend 202 stub, assert request body and neutral copy; one axe pass on the confirm-sent stage in `accessibility.spec.ts`; 320px reflow capture of the success text with a long address.
