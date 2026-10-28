# p1-F04 — Confirm an email address from the emailed link

Worktree read: `/tmp/naba-presence-p1` (branch `ux/flows-presence-p1`). Analysis only; no repo file edited, nothing run.

## 1. Flow ID, name, start and end

- **ID / name:** p1-F04, confirm an email address from the emailed link (plain and invited variants).
- **Start:** the emailed link, `GET /auth/confirm?token_hash=…&type=email[&inviteToken=…]` (built by `app/api/auth/password/resend/route.ts:20-24` and registration). The GET never spends the token. It 307s to `/confirm-email?token_hash=…[&inviteToken=…]` (`app/auth/confirm/route.ts:47-64`).
- **Interstitial:** `app/(auth)/confirm-email/page.tsx` is a server component with one plain `<form method="post" action="/auth/confirm">` (`:34-52`).
- **Success exits:** 303 to `/inbox`, or to `/sign-in/verify` when the person has TOTP factors (`route.ts:104-107`). MFA is flow p1 verify, not this one.
- **Failure exits:** 303 (POST) or 307 (GET) to `/sign-in?email=error&status=<code>` (`route.ts:30-38`). Sign-in shows `confirmStatusMessage(status)` (`app/(auth)/sign-in/page.tsx:36-38`, `lib/api/auth-errors.ts:185-190`).
- **Boundaries:** a recovery link (`type=recovery`) goes to `/reset-password` (reset flow). Resend confirmation lives on sign-in (sign-in flow). The invitation page `/invite/[token]` is the invite flow.

## 2. Steps today

1. The person opens the emailed link. The GET checks `token_hash` (at least 20 characters) and `type` with zod (`route.ts:13-17,51-55`). If they fail, it redirects to `/sign-in?email=error&status=invalid_email_link` (`:65-66`). Otherwise it redirects to the interstitial, carrying `token_hash` and, for email links only, `inviteToken` (`:56-64`).
2. The interstitial renders (`page.tsx:21-58`):
   - Eyebrow: "Email confirmation".
   - Title: "Confirm your email", or "Accept your invitation" when `inviteToken` is present (`:20,25`).
   - Description (`:26-30`).
   - The invite aside, or the product aside, on wide screens (`:23`).
   - Footer: "Back to sign in" (`:31`).
3. **With `token_hash`:** a form with hidden inputs `token_hash`, `type=email` and optional `inviteToken` (`:35-43`). One primary button, "Confirm and sign in" or "Confirm and accept invitation" (`:44-51`). It wraps at 320px (`components/auth/wrapping-button.ts:8-9`).
4. **Without `token_hash`:** no form. The body reads "This confirmation link is incomplete. Open the link from your email again, or sign in to request a new one." (`:53-58`). The header above it still says "Confirm your email" / "Confirm your email address to finish setting up…".
5. **Press.** The browser does a native POST. The server runs these checks in order:
   - same-origin check (`route.ts:75`);
   - per-IP abuse budget `confirm_email`, 30 per 15 minutes, taken before the token is looked at (`:76-78`; `lib/server/abuse-limits.ts:94-97`);
   - form check (`:84-88`);
   - `verifyEmailToken`, which **spends the token** at the provider (`:89-92`). Every provider error maps to `invalid_email_link` (`lib/server/password-auth.ts:348-356`);
   - `completeEmailAuthentication`: the MFA ticket, or provisioning of the member (invite) or owner (`lib/server/email-auth.ts:100-138,140-147`). Invitation checks run **after** the token is spent (`lib/server/provisioning.ts:331-365`). An owner with no organisation hits `requireOpenRegistration` (`provisioning.ts` around `:128-132`, `lib/server/registration.ts:8-16`).
6. **Success:** the session cookie (or MFA ticket cookie) is set, then a 303 to `/inbox` or `/sign-in/verify`. No "email confirmed" acknowledgement is shown anywhere; arriving in the inbox is the only signal.
7. **Failure:** a 303 to sign-in with `status=<ApiError.code>`, or `invalid_email_link` for any non-ApiError (`route.ts:33-36`). On sign-in:
   - The page redirects to `/inbox` if a session already exists (`sign-in/page.tsx:24`).
   - Otherwise the status becomes the form's initial `message` (`components/auth/sign-in-form.tsx:140-142`).
   - It renders as a destructive `AuthErrorAlert`, `role="alert"` (`:319-323`), and focus moves to it on mount (`:150-154`).
   - The inviteToken is **not** carried to sign-in (`route.ts:31-36`).
8. **Pending feedback:** none. The button has no `pending` state (`page.tsx:44-51`), and the page ships no client handler. Between the press and the 303 (provider verify plus DB provisioning), the only feedback is the browser's own loading indicator. A second press is possible (see F2).

### What each reachable `status=` says on sign-in (`lib/api/auth-errors.ts`)

| status (source) | Title / description / action | Fit after a confirmation link |
| --- | --- | --- |
| `invalid_email_link` (malformed GET, any provider error incl. already-used token or provider outage, any non-ApiError) `:74-78` | "That link is invalid or has expired." / "Request a fresh one and try again." / link **"Request another link" → `/forgot-password`** | **Poor.** The fresh link they need is a *confirmation* email. The action sends them to password reset. Not true for a double-press (already confirmed). |
| unknown code, e.g. `cross_origin_request`, `identity_provisioning_failed` (falls back) `:189` | same as above | `identity_provisioning_failed` happens after the token is spent, so the advice is wrong (P3, rare) |
| `auth_rate_limited` `:58-61` | "Too many attempts." / "Wait a while, then try again." | "Try again" does not say how. The token was **not** spent (`route.ts:76-78`), so the same email link still works. |
| `mfa_required` `:136-139` | "This account uses two-step verification." / "Sign in with your email and password to enter your code." | Fine |
| `invitation_expired` `:84-87` | "That invitation has expired." / "Ask an organisation owner or admin to send a new one." | Fine |
| `invitation_not_found` `:88-91` | "We could not find that invitation." / "Check the link, or ask for a new invitation." | Fine |
| `invitation_already_used` `:92-95` | "This invitation has already been accepted." / "Sign in to continue." | Fine |
| `invitation_changed` `:96-99` | "This invitation changed while you were looking at it." / "Reload the page to see the current invitation." | Wrong on sign-in: reloading sign-in shows no invitation (P3, race-only) |
| `invitation_email_mismatch` `:100-103` | "…for a different email address." / "Sign in with the address that received it." | Fine |
| `member_limit_reached` `:104-108`, `invitation_scope_empty` `:109-113`, `support_session_forbidden` `:114-116`, `auth_identity_conflict` `:117-120`, `registration_closed` `:43-47`, `email_not_verified` `:52-57` | as written | Fine. `email_not_verified` shows the resend action only once the person types an email (`components/auth/auth-error-alert.tsx:22-24`). |

## 3. States inventory

The interstitial makes **no API calls on load**; it is server-rendered from the query string. The submit is a top-level **navigation POST** to `/auth/confirm` with form-urlencoded data, not a fetch. Playwright's `page.route("**/auth/confirm", …)` intercepts it. Sign-in states need no stub: navigate straight to the URL with no session cookie.

| State | How reached | What the user sees | Notes |
| --- | --- | --- | --- |
| S1 Interstitial, plain | `GET /confirm-email?token_hash=hhhhhhhhhhhhhhhhhhhhhhhhhhhhhh` | "Email confirmation" / "Confirm your email" / one button "Confirm and sign in" / "Back to sign in" | Product aside at ≥1024px |
| S2 Interstitial, invited | `…&inviteToken=inv-1` | "Accept your invitation", "Confirm and accept invitation", invite aside | |
| S3 Incomplete link | `GET /confirm-email` (or `?inviteToken=inv-1`) | Header "Confirm your email…" above the body "This confirmation link is incomplete…"; no button; footer link only | Header and body disagree (F4) |
| S4 Pending (today) | S1, then `page.route("**/auth/confirm", r => new Promise(res => setTimeout(() => res(r.fulfill({status:303, headers:{location:"/inbox"}})), 8000)))`, click, screenshot at ~500ms | Unchanged page; the button stays enabled and reads the same | Use the same stub for the AFTER capture ("Confirming…" + spinner) |
| S5 Double press | S4 stub; click twice; count `request` events on `/auth/confirm` with method POST | Today: 2 POSTs in Chromium (hypothesis, verify) | AFTER: exactly 1 |
| S6 Success | Stub POST: `route.fulfill({status:303, headers:{location:"/inbox"}})` | The inbox (needs the harness's signed-in fixture), otherwise stub the location to any page | No acknowledgement copy (not proposed) |
| S7 MFA | Stub location `/sign-in/verify` | The code screen (other flow) | |
| S8 Link failed | `/sign-in?email=error&status=invalid_email_link`, or the POST stub `{status:303, headers:{location:"/sign-in?email=error&status=invalid_email_link"}}` | Destructive alert "That link is invalid or has expired." + "Request another link" (→ /forgot-password), focused | Main proposal target (C1) |
| S9 Rate limited | `/sign-in?email=error&status=auth_rate_limited` | "Too many attempts." / "Wait a while, then try again." | C1 |
| S10 Invitation outcomes | `/sign-in?email=error&status=invitation_expired` (and `_not_found`, `_already_used`, `_changed`, `_email_mismatch`, `member_limit_reached`, `invitation_scope_empty`) | The table above | `invitation_changed` is in C1 |
| S11 MFA required | `/sign-in?email=error&status=mfa_required` | "This account uses two-step verification." | Fine |
| S12 Unknown code | `/sign-in?email=error&status=identity_provisioning_failed` | Same as S8 | C1 |
| S13 S8 with email typed | S8, then type an email in Email | (AFTER) the alert gains the "Resend confirmation email" link; the folded disclosure also has one | Resend POST `/api/auth/password/resend` → stub `{status:202, body:'{"accepted":true}'}` |

Capture at 390 light, 390 dark and 1280, plus 320 for S1/S2 (button wrap).

## 4. Protected rules

- The GET never spends the token. Only the button's same-origin POST does (`route.ts:40-46,47-68`; `page.tsx:8-13`).
- The confirm form is a plain no-JS form: `method="post" action="/auth/confirm"` with hidden fields `token_hash`, `type=email` and `inviteToken` (`page.tsx:34-43`). Unit-tested at `tests/components/confirm-email-page.test.tsx:23-44`.
- Same-origin check (`route.ts:75`). Per-IP abuse budget before the token is touched (`:76-78`, `abuse-limits.ts:94-97`).
- Failure redirect shape: `/sign-in?email=error&status=<code>`, 303 on POST (`route.ts:30-38,108-110`). The invite token is not echoed.
- Success targets `/inbox` and `/sign-in/verify`. MFA ticket rather than a session when factors exist (`route.ts:104-107`, `email-auth.ts:100-138`).
- Invitation scoping: invite rechecks under a row lock, email must match (`provisioning.ts:331-365`, `registration.ts:18-21`). Owner admission is enforced (`registration.ts:8-16`).
- Server authority: nothing claims success before the 303 lands.
- Sign-in already-signed-in redirect (`sign-in/page.tsx:24`). Resend affordance always visible, no enumeration (`sign-in-form.tsx:479-500`).

## 5. Prior audit status (15 Oct)

- **SET-23** (surface-aware auth copy; "Sign in to continue."): fixed. `auth-errors.ts:23-35,92-95,164-173`. `confirmStatusMessage` takes a surface, default "sign-in" (`:185-190`). The confirmation-link origin is not a surface, which is where F1 lives.
- **SET-17, SET-18**: invite page and password fields; they don't touch this interstitial. Verified fixed per `results.md:277-278`, not re-litigated.
- **CLR-11, CLR-12**: share report, not this flow.
- No 15 Oct finding covered `/confirm-email` itself. It was built in W6-05 (`page.tsx:8-13`).

## 6. Friction found

| # | Observation | Evidence | Sev | E/H |
| --- | --- | --- | --- | --- |
| F1 | After a failed confirmation link, sign-in offers **"Request another link" → `/forgot-password`**. That makes the person reset a password to get what is really a confirmation email. The right tool (resend confirmation) is folded inside "Didn't receive a confirmation email?" lower down. | `auth-errors.ts:74-78`; `auth-error-alert.tsx:25-33`; `sign-in-form.tsx:488-499` | P2 | Evidence |
| F2 | No pending state, and a second press is not blocked. Press 2 can reach the server after press 1 has spent the token. The result is `invalid_email_link`: "That link is invalid or has expired" for an address that **is** now confirmed. If press 1's cookie never landed (aborted navigation), the person is told to request a new link. | `page.tsx:44-51` (no `pending`, no handler); `route.ts:89-92` spends the token, `password-auth.ts:348-356` maps any provider error | P2 | Server path: evidence. Browser re-submit behaviour: hypothesis (verify via S5) |
| F3 | The failure copy never says the email may already be confirmed, so a person who double-pressed or reopened the link has no "just sign in" cue. | `auth-errors.ts:74-78` | P2 | Evidence |
| F4 | The incomplete-link state contradicts itself. The header says "Confirm your email address to finish setting up your account and sign in." with no button below it. The only way on is "Back to sign in", and the body's "sign in to request a new one" doesn't name where on sign-in. | `page.tsx:25-31,53-58` | P3 | Evidence |
| F5 | Invited person whose link fails: sign-in loses the invite (`route.ts:31-36`), and the alert's resend sends no inviteToken (`auth-error-alert.tsx:23`). The new link then provisions as an owner, which under invite-only gives `registration_closed`. Nothing tells them to reopen the invitation email instead. | `route.ts:31-36`; `auth-error-alert.tsx:23`; `registration.ts:8-16` | P2 | Evidence (path); how often it happens: hypothesis |
| F6 | `auth_rate_limited` says "Wait a while, then try again." but not *how* to try again. The same email link is still good, because the budget is taken before the token. | `auth-errors.ts:58-61`; `route.ts:76-78` | P3 | Evidence |
| F7 | On sign-in, `invitation_changed` says "Reload the page to see the current invitation." Reloading sign-in shows no invitation. | `auth-errors.ts:96-99` | P3 (race-only) | Evidence |
| F8 | Fine, leave alone: one primary action; the label wraps at 320; 44px targets (`AuthLink`, `WRAPPING_BLOCK_BUTTON`); `<main>` + single `h1`; skip link; the alert is focused and `role="alert"` on sign-in; neutral copy; `Referrer-Policy` on token pages (`next.config.ts:100-109`). | as cited | — | Evidence |

## 7. Proposed changes

### C1 — Confirmation-link wording for sign-in statuses that come from `/auth/confirm` (F1, F3, F5, F6, F7)

- **Files:** `lib/api/auth-errors.ts` (area), `app/(auth)/sign-in/page.tsx` (area). No shared files.
- **How sign-in knows the origin:** `/auth/confirm` is the only producer of `email=error` (`route.ts:32`; grep shows no other writer). Read it on the page; the route stays untouched.
- **Code, `auth-errors.ts`:** add an override map and an optional third parameter:

```ts
/** Statuses that arrive from /auth/confirm (`email=error`): the person was opening an email link. */
const FROM_EMAIL_LINK: Record<string, AuthMessage> = {
  invalid_email_link: {
    title: "That email link has expired or was already used.",
    description:
      "If you’ve already confirmed your email, sign in below. To get a new confirmation link, enter your email and choose Resend. Invited to a team? Open your invitation email again instead.",
    action: "resend-confirmation",
  },
  auth_rate_limited: {
    title: "Too many attempts.",
    description: "Wait a while, then open the link from your email again.",
  },
  invitation_changed: {
    title: "This invitation changed after it was sent.",
    description: "Open your invitation email again to see the current invitation.",
  },
}

export function confirmStatusMessage(status: string, surface: AuthSurface = "sign-in", from?: "email-link"): AuthMessage {
  if (from === "email-link") {
    const own = FROM_EMAIL_LINK[status] ?? (BY_CODE[status] ? undefined : FROM_EMAIL_LINK.invalid_email_link)
    if (own) return own
  }
  return messageForCode(status, surface) ?? BY_CODE.invalid_email_link
}
```

- **Code, `sign-in/page.tsx`:** add `email?: string` to the `searchParams` type (`:14-19`). Change `:37` to `confirmStatusMessage(params.status, "sign-in", params.email === "error" ? "email-link" : undefined)`.
- **Why `resend-confirmation`:** `AuthErrorAlert` already renders `ResendConfirmationButton` from the alert once an email is typed (`auth-error-alert.tsx:22-24`). The form passes its live `email` (`sign-in-form.tsx:321`), so no component change is needed.
- **Trade-off, accepted:** a malformed *recovery* link also lands here via the GET (`route.ts:65-66`). Those people keep the form's "Forgot password?" link (`sign-in-form.tsx:428-434`).
- **Benefit:** the route out matches the task. A person who is already confirmed is told to just sign in. Invitees get pointed back to the invitation, which carries the token.
- **Principles:** Nielsen #9 (help users recognise, diagnose and recover from errors) and #2 (match between system and the real world). HIG: preserve context. WCAG 3.3.3 Error Suggestion.
- **Protected-behaviour risk: none.**
  - Client copy and selection only; no route, shape or redirect change.
  - The resend endpoint is already neutral (202 `{accepted:true}`, `resend/route.ts:26-29`).
  - This alert is driven by the URL, not by account state, so it adds no enumeration channel. The always-visible disclosure stays.
  - Without `email=error`, behaviour is exactly as today (`sign_out_everywhere_failed`, the bare-status e2e at `tests/e2e/auth.spec.ts:107`).

### C2 — Pending state and a single-submit guard that keep the plain no-JS POST (F2)

- **Files:** new area-local client component `components/auth/confirm-email-form.tsx`. `app/(auth)/confirm-email/page.tsx:34-52` renders it. Uses the existing `Button` `pending`/`pendingLabel` API (`components/ui/button.tsx:147-154,192-200`); no shared change.
- **Code:**

```tsx
"use client"
function ConfirmEmailForm({ tokenHash, inviteToken, label }: { tokenHash: string; inviteToken?: string; label: string }) {
  const [pending, setPending] = useState(false)
  const sent = useRef(false)
  useEffect(() => {
    // A page restored from the back-forward cache must not stay stuck on "Confirming…".
    const reset = (e: PageTransitionEvent) => { if (e.persisted) { sent.current = false; setPending(false) } }
    window.addEventListener("pageshow", reset)
    return () => window.removeEventListener("pageshow", reset)
  }, [])
  return (
    <form method="post" action="/auth/confirm"
      onSubmit={(event) => { if (sent.current) { event.preventDefault(); return } sent.current = true; setPending(true) }}>
      {/* the same three hidden inputs as page.tsx:35-43 */}
      <Button type="submit" size="lg" block className={WRAPPING_BLOCK_BUTTON} pending={pending} pendingLabel="Confirming…">{label}</Button>
    </form>
  )
}
```

- **Keep the page a server component.** Pass `label` as "Confirm and sign in" or "Confirm and accept invitation".
- **Never call `preventDefault` on the first submit.** The browser still does the native POST and the 303 navigation. Without JS (or before hydration) the server-rendered form posts exactly as today.
- **Benefit:** visible, announced progress (`aria-busy`, spinner). One press is one spend of the token, so a successful confirmation is no longer followed by a false "expired" message.
- **Principles:** Nielsen #1 (visibility of system status) and #5 (error prevention). HIG: consistent feedback. Matches the sign-in form's own double-submit guard (`sign-in-form.tsx:158-173,452-466`). WCAG 4.1.2 Name, Role, Value (busy state exposed).
- **Protected-behaviour risk: none.**
  - The form keeps the same method, action and fields, so `confirm-email-page.test.tsx` still passes.
  - The submitter button has no `name`, so disabling it removes nothing from the posted data.
  - No success is shown before the server's 303.
- **Residual:** a hung request leaves "Confirming…" until the person reloads or goes back. Reload re-GETs the interstitial with the token, which is safe.

### C3 — Make the incomplete-link state agree with itself and say where to go (F4)

- **File:** `app/(auth)/confirm-email/page.tsx` only.
- **When `!params.token_hash`:**
  - Title: "This confirmation link is incomplete".
  - Description: "Part of the link is missing, so it can’t confirm your email."
  - Body, replacing `:54-57`: "Open the link from your email again. If that doesn’t work, go to sign in and choose “Didn’t receive a confirmation email?” to get a new one."
  - Keep the footer "Back to sign in".
- **Benefit:** the header no longer asks for an action the page can't do, and the way on is named.
- **Principles:** Nielsen #4 (consistency and standards) and #9. WCAG 2.4.6 Headings and Labels.
- **Protected-behaviour risk: none.** Static copy only. The existing unit test (`:46-52`) matches `/This confirmation link is incomplete/`, so add `{ exact: false }` or scope the query to the paragraph, since the text now also appears in the `h1`.

## 8. Explicitly not proposed

- **Carrying `inviteToken` into the failure redirect, or sending `email=error` only from POST.** These change the route handler's response shape (protected). C1's copy covers the invitee instead. Owner decision if wanted.
- **Distinguishing a provider outage from an expired token.** `password-auth.ts:348-356` maps every provider error to `invalid_email_link`. Server-side and protected.
- **An "Email confirmed" success acknowledgement on `/inbox`.** It would need a new redirect parameter or flag. Arriving in the inbox is enough evidence.
- **Changing the destructive tone of the alert for informational statuses** (`mfa_required`, `invitation_already_used`). The sign-in form owns that alert across flows. Low value.
- **Linking the incomplete state to `/invite/<token>`.** The state is only reachable by hand-editing the URL (the GET always sets `token_hash`). Not worth adding token handling.
- **A new `AuthSurface` member** in place of the `from` parameter. It would force a new `UNAVAILABLE_TITLE` entry and widen a type that other flows use.

## 9. Tests

- **Existing coverage:**
  - `tests/components/confirm-email-page.test.tsx:23-52`: form shape, invite token, incomplete state.
  - `tests/server/auth-confirm-route.test.ts:67-148`: GET never spends the token; recovery routing; malformed → sign-in; POST signs in; MFA; refuses recovery.
  - `tests/components/auth-api.test.tsx:182-193`: confirmStatusMessage mapping.
  - `tests/components/sign-in-form.test.tsx:175`: status message rendered.
  - `tests/e2e/auth.spec.ts:104-110`: bare `status=invitation_expired`.
  - `tests/integration/routes/password-auth.test.ts`, `pilot-admission.test.ts`, `mfa.test.ts` cover the real token path.
- **Add for C1** (`auth-api.test.tsx`):
  - `confirmStatusMessage("invalid_email_link","sign-in","email-link")` returns the new title with `action: "resend-confirmation"`.
  - An unknown code with `email-link` returns the same message.
  - `invitation_expired` with `email-link` is unchanged.
  - Without `from`, today's messages are unchanged.
- **Add for C1, e2e** (`auth.spec.ts`): `/sign-in?email=error&status=invalid_email_link`, then:
  - the alert contains "expired or was already used" and has no "Request another link" link;
  - after typing an email, the alert has a "Resend confirmation email" button;
  - stub `POST **/api/auth/password/resend` as 202 `{"accepted":true}`, then expect "Confirmation email sent."
- **Add for C2** (new component test):
  - The first submit is not default-prevented and the button becomes `aria-busy` with "Confirming…".
  - A second `fireEvent.submit` is default-prevented.
  - `FormData` is unchanged.
  - A `pageshow` event with `persisted: true` resets the button.
- **Add for C2, optional e2e:** the S5 stub; assert exactly one POST to `/auth/confirm`.
- **Add for C3:** update the incomplete-state assertion and assert the `h1` text.
- **Coverage gap:** neither `tests/e2e/accessibility.spec.ts` nor `touch-critical.spec.ts` visits `/confirm-email` (grep finds none). Add `/confirm-email?token_hash=…` (plain and invited) and `/sign-in?email=error&status=invalid_email_link` to the axe and touch route lists.
