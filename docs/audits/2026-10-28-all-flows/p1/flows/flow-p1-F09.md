# p1-F09: Arriving at the public entry (`/`) and the shared auth shell

Worktree `/tmp/naba-presence-p1`, branch `ux/flows-presence-p1`. This is analysis only. I edited no repo files and ran no servers or tests.

## 1. Flow ID, name, start and end

- **ID / name:** p1-F09, arriving at the public entry and the frame every auth page shares.
- **Start:** `GET /`. `app/page.tsx:5-9` sends the visitor to `/inbox` if they have a session, or if `NODE_ENV !== "production"`, or if local bootstrap is on (localhost `NEXTAUTH_URL` plus `LOCAL_BOOTSTRAP_ENABLED`, `lib/server/session.ts:291-297`). Everyone else goes to `/sign-in`. In production, a signed-out visitor (including Google's OAuth reviewer) lands on `/sign-in`.
- **Frame covered:** `app/(auth)/layout.tsx` (the grid), `components/auth/auth-card.tsx` (skip link, aside, compact brand, header, footer, Legal nav), `components/auth/auth-link.tsx`, `app/(auth)/error.tsx`, the root `app/layout.tsx` metadata and viewport, `app/not-found.tsx` (unmatched public URLs), and `app/global-error.tsx` (a failure while rendering `/` itself, which sits outside `(auth)`).
- **Exits:** the sign-in form (F01, its own flow), the Legal nav to `/privacy` and `/terms` (legal flow), the brand link to `/sign-in`, and from a 404 the link to `/inbox`. For a signed-out visitor in production that link reaches `/sign-in?next=%2Finbox` through the dashboard layout (`app/(dashboard)/layout.tsx:38-45`).
- **Boundaries:** form behaviour, MFA, invitations and recovery belong to the other p1 flows. This file covers only the frame they share and the copy that frame carries.

## 2. Steps today

1. **The visitor requests `/`.** The server component reads the session cookie `naba_session` (`lib/server/session.ts:25,254-257`) and responds with a 307 redirect (`app/page.tsx:9`). The proxy only adds a request-path header (`proxy.ts:15-22`).
2. **`/sign-in` renders on the server.** `getSession()` runs, and a live session redirects to `next` or `/inbox` (`app/(auth)/sign-in/page.tsx:23-24`). Tab title: "Sign in · NabaPresence" (`:9`). The description is inherited from the root (`app/layout.tsx:45-49`).
3. **Frame below `lg` (phone, 390 or 320):** the aside is `hidden … lg:flex` (`auth-card.tsx:119`), so the visitor sees, in order:
   - skip link (off screen)
   - the brand link "NabaPresence" to `/sign-in`, 44px tall (`:231-239`)
   - eyebrow "Welcome back"
   - h1 "Sign in to NabaPresence"
   - "Your Google reviews and Business Profiles, from one inbox." (`sign-in-panel.tsx:11-14`)
   - the form
   - footer "Access is by invitation or a new account.", or "…available by invitation during the pilot." (`sign-in-panel.tsx:66-72`)
   - the Legal nav: Privacy policy and Terms of service, 44px on touch (`auth-card.tsx:184-185,275-297`).
4. **Frame from `lg` (1024+):** a charcoal aside on the left: brand link, the statement "Google reviews and listings, run from one desk.", three beats, and the footnote "For hospitality businesses, and for the agencies that manage their Google Business Profiles." (`auth-card.tsx:30-52,114-170`). The card column sits on the right, vertically centred (`:230`).
5. **Keyboard.** The first tab stop is "Skip to content" to `#main` (`:221-223`). `main` has `tabIndex=-1` (`:225-229`). The phone layout has no aside, so the skip lands on the first content anyway. That is harmless and meets 2.4.1.
6. **Render failure inside `(auth)`.** `app/(auth)/error.tsx` shows the same AuthCard (product aside): eyebrow "Something went wrong", h1 "This page didn't load", a `role="alert"` box ("We couldn't show this page. Nothing about your account changed. Try again in a moment."), the reference digest, a full-width "Try again" button (label changes to "Trying again…" with `aria-busy` while pending), and the footer link "Back to sign in" (`error.tsx:33-64`).
7. **Render failure on `/` itself** (DB down while a cookie is present). `/` has no `(auth)` boundary, so `app/global-error.tsx` handles it: "Something went wrong", "Try again", a plain `<a>` "Go to Inbox", and "share the reference with an owner or admin" (`global-error.tsx:70-115`).
8. **An unknown public URL** (`/pricing`, `/about`) renders `app/not-found.tsx` with HTTP 404: the brand link to `/inbox`, "This page doesn't exist", the description, and the primary "Back to Inbox" (`not-found.tsx:21-40`, words from `components/app-shell/boundary.tsx:96-103`).

## 3. States inventory

The sign-in page makes **no API call on load**: no fetch on mount, and the schemas are imported lazily on submit (`sign-in-form.tsx:166-174`). On submit it sends `POST /api/auth/password/login` (`lib/api/auth.ts:22`), which is F01. Nothing in this flow can be stubbed with `page.route`, because the server components decide the redirects and boundaries.

| State | How reached | What the user sees | Notes |
| --- | --- | --- | --- |
| `/` signed out (prod) | Production build with `LOCAL_BOOTSTRAP_ENABLED` off and no `naba_session` cookie, then `goto("/")` | 307 to `/sign-in` | In dev or the harness, `/` goes to `/inbox` (`page.tsx:7-8`). To capture, either load `/sign-in` directly or assert on `response.request().redirectedFrom()` in a prod start |
| Sign-in, phone light | 390×844, `localStorage.theme="light"` (as in `accessibility.spec.ts:394-398`), `goto("/sign-in")` | Brand, "Welcome back", h1, one-line description, form, footer, Legal | Main BEFORE/AFTER shot for proposal P-1 (scroll to the bottom) |
| Sign-in, phone dark | Same, `theme="dark"`. To see browser chrome, emulate `colorScheme: "dark"` on Android Chrome | Card on `--np-surface` (#151c21), chrome on theme-color #0d1216 | P-2 seam. A headless screenshot does not show the toolbar; assert `meta[name=theme-color]` instead |
| Sign-in, 320×568 | `setViewportSize(320,568)` | 288px content column (`px-4`, `auth-card.tsx:230`) | Reflow check (1.4.10). No horizontal scroll expected |
| Sign-in, desktop | 1440×1000 | Charcoal aside plus card | Unchanged by these proposals. The phone-only line must not render here |
| Create account | `/sign-in?mode=create-account` | "New account" / "Create your NabaPresence account" | Same frame |
| Registration closed | Server env `REGISTRATION_MODE` not `open`, no `invite` | Footer "NabaPresence is available by invitation during the pilot." | Env only, needs a separate start. Optional |
| Skip link focused | `goto("/sign-in")`, press Tab once | Pill at top-left | Enter moves focus to `#main` |
| Auth error boundary | Not stubbable. In a **prod** build, set cookie `naba_session=x` and make the DB unreachable, then `goto("/sign-in")`. `getSession` throws (`session.ts:254-257`) and `(auth)/error.tsx` renders. A safer alternative is an RTL render (`tests/components/auth-error.test.tsx`) | Card, alert, digest, "Try again", "Back to sign in" | Dev shows the Next overlay instead. Do not take down the shared dev DB; use a throwaway |
| Global error on `/` | Same cookie and DB-down trick on `goto("/")` | `global-error.tsx` | Context only. Not in this proposal set |
| Root 404 | `goto("/does-not-exist")` signed out | 404 card, "Back to Inbox" | Production: the click goes to `/sign-in?next=%2Finbox` |

## 4. Protected rules

- The `/` redirect decision and its non-production / local-bootstrap bypass: `app/page.tsx:5-9`, `lib/server/session.ts:291-297`.
- The signed-in redirect on sign-in, with the sanitised `next`: `app/(auth)/sign-in/page.tsx:22-24`.
- The Legal nav must stay on every auth page at every width, because `/` lands here for Google's OAuth homepage check: `auth-card.tsx:273-297` (comment at `:273-274`).
- The error boundaries never show `error.message`, only the digest: `error.tsx:13-16,41-48`, `global-error.tsx:15-16`. Tested in `tests/components/auth-error.test.tsx:30`.
- Auth copy must never address the reader as an agency with clients: `tests/components/auth-kit.test.tsx:53-69`, `tests/e2e/auth.spec.ts:38-50`.
- One `main#main`, one h1, and the skip link as the first focusable element: `auth-kit.test.tsx:18-34`.
- The theme-color hex values are design-exempt R2 and need an exemption marker: `app/layout.tsx:67-72`, `scripts/check-design.mjs:322-329`.

## 5. Prior audit status (15 Oct)

None of the 15 Oct findings target the `/` redirect or the AuthCard frame directly.
- **SET-23** (auth errors titled per surface): fixed (`results.md:283`). It shapes the error copy F01 uses, not this boundary.
- **SET-20** (one 404 title and verb): fixed (`results.md:280`). The root 404 uses `NOT_FOUND_TITLE` and `notFoundActionLabel` (`not-found.tsx:3-7,37`). Verified.
- **SET-17 / SET-18:** invitation and password flows (fixed, `results.md:277-278`), not this frame.
- **CLR-11 / CLR-12:** share sheet and public report (fixed, `results.md:248-249`), not this frame.
- **D10** (support channel) is **not decided** (`results.md:48,287`). That limits what the error boundary's reference line can promise. See §8.

## 6. Friction found

| # | Observation | Evidence | Sev | E/H |
| --- | --- | --- | --- | --- |
| 1 | A first-time phone visitor never learns who the product is for. All of the "who and why" (hospitality businesses and their agencies, approval before replies go live, publishing confirmed by Google) is in the aside, which is `display:none` below `lg`. On a phone the only product statement is the 9-word description. Screen-reader users on a phone miss it too. | `auth-card.tsx:119` (`hidden … lg:flex`), `:30-52`; `sign-in-panel.tsx:14` | P2 | Evidence |
| 2 | The browser chrome colour does not match the auth canvas. theme-color is the app canvas (#f6f9fc / #0d1216), but the auth layout paints `bg-surface` (#ffffff / #151c21). In dark mode on Android Chrome the toolbar is visibly darker than the page. | `app/layout.tsx:68-71`; `app/(auth)/layout.tsx:13`; `globals.css:442-443,812-813` | P3 | Evidence (seam); visual impact is a hypothesis until seen on a device |
| 3 | The auth skip link hides itself with a fixed `-translate-y-24` after a `mt-(--np-safe-top)` push. The app shell's link was changed to `calc(100% + safe-top + 1rem)` and is tested at a 32px default font. The auth one has no such test. With today's iOS Safari insets (0 in portrait, no web manifest) it stays hidden, so this is a consistency risk, not a visible bug. | `auth-card.tsx:176-177` vs `components/app-shell/app-shell.tsx:353`; `tests/e2e/text-scale-chrome.spec.ts:59-74` (covers `/inbox` only) | P3 | Hypothesis |
| 4 | When the boundary fires on `/sign-in` itself, its only way out, "Back to sign in", points at the page that just failed. It is a client `next/link`, so it may act as a silent second retry or do nothing visible. | `error.tsx:37`; `auth-link.tsx:12-23` | P3 | Hypothesis (verify in the capture) |
| 5 | The boundary shows "Reference d1" but does not say what it is for. `global-error.tsx:112-115` does ("share the reference with an owner or admin"). | `error.tsx:41-48` | P3 | Evidence. Blocked on D10 (§8) |
| 6 | `<html lang="en">` in the root layout, but `lang="en-GB"` in global-error. The copy is British English, and spell-check in reply textareas follows `lang`. | `app/layout.tsx:83`; `global-error.tsx:33` | P3 | Evidence. Global, so handed off (§8) |
| 7 | A signed-out visitor on an unknown URL is offered "Back to Inbox" (and the brand link goes to `/inbox`). It works, because it redirects to sign-in, but "Back" is slightly wrong for someone who was never there. | `not-found.tsx:27,34-37` | P3 | Evidence. Not proposed (§8) |

**Fine, leave alone:**
- The `/` redirect.
- The single h1 per page and the labelled `aside` / `main` / `nav[aria-label=Legal]` landmarks. The `footer` sits inside `main`, so it carries no contentinfo role.
- The 44px touch floor on the brand, Legal and AuthLink targets (`auth-card.tsx:184-185`, `auth-link.tsx:16`).
- Reflow at 320: a 288px column, `flex-wrap` on Legal, the brand truncates.
- Charcoal in dark mode (D4, `globals.css:819-821`).
- The error boundary's single primary action, its pending treatment (`aria-busy` and "Trying again…", matching global-error), and its "Nothing about your account changed" reassurance.
- "Welcome back" (the spec'd copy, `docs/specs/2026-09-03-agency-ux.md:226`).

## 7. Proposed changes

**P-1. Say who NabaPresence is for on a phone (fixes #1).**
- **What changes:** add one caption to the product variant only, visible only below `lg`, using the aside footnote that is already approved.
- **File and lines:** `components/auth/auth-card.tsx`. Insert between the `{footer ? … : null}` block (`:267-271`) and the `<nav aria-label="Legal">` (`:275`):
  ```tsx
  {/* Below lg the panel is hidden, so a first-time visitor on a phone
      would never learn who the product is for. Product screens only. */}
  {aside === "product" ? (
    <p className="text-center text-caption text-pretty text-ink-muted lg:hidden">
      {ASIDES.product.footnote}
    </p>
  ) : null}
  ```
- **Text shown (verbatim, unchanged):** "For hospitality businesses, and for the agencies that manage their Google Business Profiles."
- **Why at the foot:** the header must stay compact so the form starts within thumb reach (the comment at `:193-198`). The line belongs beside the Legal links a reviewer or curious visitor scrolls to.
- **Why product only:** the recovery, reset and invite footnotes would echo copy that those flows' forms already show. Their owners can opt in later.
- **Benefit:** a phone visitor, and an OAuth reviewer on a phone, learns the audience. Screen readers below `lg` get it too.
- **Principle:** Nielsen #2 (match with the real world) and HIG clarity. The footnote is a product statement the aside comment calls data-free (`:20-25`), so it is truthful.
- **Risk to protected behaviour:** none. It is static copy with no new landmark or heading, and Legal stays last. The copy contains "agencies", but the agency regex tests (`/your agency|agency owner/`, `/your agency|new agency/`) do not match it. It is already in the DOM at `lg`.
- **Shared file?** No, it is area-local. Callers on the product aside: `sign-in-panel.tsx:62`, `app/(auth)/sign-in/verify/page.tsx:26`, `confirm-email/page.tsx:23` (non-invite), `app/(auth)/error.tsx:34`. It is acceptable on all of them (the same line shows on desktop today).

**P-2. Match the browser chrome to the auth canvas (fixes #2).**
- **What changes:** in `app/(auth)/layout.tsx`, export a segment viewport. Next.js merges a nested `viewport` export (see `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-viewport.md:23`). Code:
  ```tsx
  import type { Viewport } from "next"
  // The auth screens sit on --np-surface, not the app canvas, so the
  // browser bar follows suit: #ffffff = oklch(1 0 0),
  // #151c21 ≈ oklch(0.22 0.014 240).
  // design-exempt-start R2: meta theme-color is read before any CSS loads
  export const viewport: Viewport = {
    themeColor: [
      { media: "(prefers-color-scheme: light)", color: "#ffffff" },
      { media: "(prefers-color-scheme: dark)", color: "#151c21" },
    ],
  }
  // design-exempt-end
  ```
- **Benefit:** the page and toolbar read as one surface on Android Chrome. Safari ignores this, which is harmless.
- **Principle:** HIG consistency and aesthetic integrity.
- **Risk to protected behaviour:** none. The other viewport keys (cover, `interactiveWidget`, `colorScheme`) are inherited from the root. The layout stays a server component with no landmarks.
- **Shared file?** No. It changes `(auth)` only. `/privacy`, `/terms` and `/share` keep the root value.
- **Before doing it:** check the hex against `globals.css:443,813` again. If the owner prefers a single bar colour app-wide, drop this proposal.

**P-3 (optional, consistency). Use the app shell's skip-link offset in AuthCard (fixes #3).**
- **What changes:** in `auth-card.tsx:177`, replace `mt-(--np-safe-top) ml-(--np-safe-left) -translate-y-24` with the shell's formula:
  ```
  top-[calc(var(--np-safe-top)+--spacing(3))] left-[calc(var(--np-safe-left)+--spacing(3))] -translate-y-[calc(100%+var(--np-safe-top)+--spacing(4))]
  ```
  Drop `top-3 left-3`. Keep `focus-halo`.
- **Benefit:** the link is hidden by construction, whatever the font size or inset.
- **Principle:** WCAG 2.4.1 and 2.4.7. It also prevents 2.4.11 (focus not obscured) regressing at large text.
- **Risk to protected behaviour:** none. The skip link stays the first focusable element (`auth-kit.test.tsx:27-34`).
- **Before doing it:** confirm `--spacing(3)` is valid in an arbitrary `left-[…]` with this Tailwind version, as `app-shell.tsx:353` already uses it in `top-[…]`.
- **Shared file?** No.

**P-4 (conditional on the capture). On a failure at `/sign-in`, make "Back to sign in" a full reload (addresses #4).**
- **When:** only if the capture shows the link doing nothing.
- **What changes:** in `error.tsx:37`, swap `AuthLink` for a plain `<a href="/sign-in">` carrying `AuthLink`'s classes. global-error makes the same choice for the same reason (`global-error.tsx:102-103`). Keep the label.
- **Principle:** Nielsen #3 (user control).
- **Risk to protected behaviour:** none. It is the same URL with no `next`.
- **Shared file?** No.

## 8. Explicitly not proposed

- **A marketing landing page, or making `/` render content:** out of scope. The redirect is protected.
- **A reference-line instruction in `(auth)/error.tsx` (#5):** an honest "who to send it to" depends on D10 (no support channel exists, `results.md:310`). global-error's "owner or admin" does not fit a first-time registrant. Revisit once D10 lands.
- **Making the root 404 session-aware (#7):** it would add a cookie and DB read to every 404, including bot traffic. The current link already reaches sign-in with `next`. A label like "Back to sign in" would be wrong for signed-in users, who are the majority.
- **Changing "Welcome back" or the root description "Nab a Presence. …":** both are deliberate. The first is the spec copy (`agency-ux.md:226`). The second is the README's brand gloss (`README.md:3`).
- **Root `lang="en-GB"` (#6):** a correct, small fix, but it is global (spell-check and voices in every textarea). Hand off to the Platform lane as a one-line change in `app/layout.tsx:83`, owner to confirm.
- **Trimming the boundary's repeated "didn't load / couldn't show":** the `role="alert"` text must stand alone when announced, so the repetition is deliberate.
- **Showing the aside's statement and beats on a phone:** it would push the form below the fold (`auth-card.tsx:193-198`). One caption is enough.

## 9. Tests

**Existing coverage:**
- `tests/components/auth-kit.test.tsx:18-69`: h1, skip link first, Legal at 44px, safe-area padding, no agency copy.
- `tests/components/auth-error.test.tsx:17-37`: boundary heading, digest, no message, retry, way back.
- `tests/e2e/auth.spec.ts:14-50`: one main and one h1 per page, no agency copy; `:190-240` clean console in light and dark.
- `tests/e2e/accessibility.spec.ts:495-519`: axe on sign-in at 390 and 1440, light and dark.
- `tests/e2e/text-scale-chrome.spec.ts:59-74`: shell skip link only.
- `tests/components/system-pages.test.tsx`: root 404.

**Add:**
1. **auth-kit (P-1):** the product AuthCard renders the footnote twice (aside and phone caption), and the caption has the `lg:hidden` class. `aside="recovery"` renders no phone caption. Legal remains the last element of `main`.
2. **e2e at 390 (P-1):** on `/sign-in`, `getByText("For hospitality businesses, …")` is visible; at 1440 exactly one copy is visible.
3. **e2e (P-2):** on `/sign-in`, `meta[name="theme-color"][media*="dark"]` has content `#151c21`. On `/inbox` it stays `#0d1216`.
4. **text-scale-chrome (P-3):** repeat the hidden-until-focused skip-link assertion for `/sign-in` at a 32px default font.
5. **auth-error (P-4, if done):** the "Back to sign in" element is a plain `a[href="/sign-in"]`.
