# p1-F10 · Read the privacy policy and terms of service

Analysis only, read from worktree `/tmp/naba-presence-p1` (branch `ux/flows-presence-p1`). No repo files were edited and nothing was run. The operator's email value is shown below as `LEGAL_OPERATOR.privacyEmail`, not printed.

## 1. Flow ID, name, start and end

- **ID:** p1-F10. **Name:** read the privacy policy or the terms of service.
- **Routes:** `/privacy` (`app/(legal)/privacy/page.tsx`) and `/terms` (`app/(legal)/terms/page.tsx`). There is **no `app/(legal)/layout.tsx`**, so only the root layout applies (`app/layout.tsx:78-99`). Both pages render through `LegalDocument` / `LegalSection` (`components/legal/legal-document.tsx:40-137`). Operator details come from `lib/legal/operator.ts:12-26`.
- **Entry points:**
  - The Google OAuth consent screen (external, often a new tab, reviewer has no account).
  - The `Legal` nav on every auth card (`components/auth/auth-card.tsx:273-297`; `/` lands there for signed-out visitors, `app/page.tsx:5-10`).
  - Cross-links inside the text (`terms/page.tsx:58`, `privacy/page.tsx:269`).
  - Direct URL or fragment (`/privacy#retention`).
  - No in-app (signed-in) link exists: grep finds `/privacy` and `/terms` only in `auth-card.tsx` and `legal-document.tsx`.
- **Exits:**
  - The top-left "‹ NabaPresence" link goes to `/` (`legal-document.tsx:62-69`). That redirects to `/sign-in`, or to `/inbox` when signed in or bootstrapped (`app/page.tsx:9`).
  - The footer `Legal` nav: Privacy policy, Terms of service, Sign in (`legal-document.tsx:23-27,89-107`).
  - Two external links to Google (`privacy/page.tsx:66-71,174-179`), same tab.
- **Boundaries:** sign-in, register and forgot-password are other flows (F01–F0x). `/settings/privacy` (data and privacy settings) is a different, signed-in flow.

## 2. Steps today

1. The visitor opens `/privacy` or `/terms`. The page is prerendered: `dynamic = "force-static"` (`privacy/page.tsx:18`, `terms/page.tsx:18`). It reads no session or database (test `tests/components/legal-pages.test.tsx:20-27`). It makes **no API calls** on load. `assertLegalDetailsForProduction()` runs at render and fails a production build if any operator value is a `[placeholder]` (`legal-document.tsx:52`, `operator.ts:41-50`).
2. The frame renders in this order:
   - A skip link "Skip to content" pointing to `#main`, the first focusable element (`legal-document.tsx:55-60`; test `:105`).
   - A banner `<header>` holding the home link (`:61-70`).
   - `<main id="main" tabIndex={-1}>` (`:71-75`), containing an `<article>` (`:76`) with a nested `<header>`: the h1 (`:78-80`), "Effective {date}" as a muted `<p>` (`:81-83`), and the summary (`:84`).
3. The sections follow. Each is a `<section aria-labelledby={id}>` with an `<h2 id>` (`legal-document.tsx:122-125`), so every heading is already a fragment target. There are no h3s.
   - Privacy has 9 sections: `google-access, collect, retention, disconnect, sharing, security, rights, children, changes` (`privacy/page.tsx:44-274`).
   - Terms has 9 sections: `accounts, google, content, acceptable-use, availability, liability, ending, changes, contact` (`terms/page.tsx:37-138`).
4. Running text is `text-body`, held to `max-w-prose` (`legal-document.tsx:129`). Lists are indented discs (`:130`). `code` and long words wrap at 320px (`:76`, test `:108-119`). The article panel shows `sm:bg-surface` from `sm` up (`:76`).
5. The footer `<nav aria-label="Legal">` sits outside `main` and marks the current page with `aria-current="page"` and bold ink (`legal-document.tsx:16-17,89-107`, test `:121-135`). Links are 24px tall on a fine pointer and 44px on a coarse one (`pointer-coarse:min-h-(--np-touch)`).
6. To make a request, the reader has to copy the privacy email. It is **plain text, not a link**: `email {privacyEmail}` (`privacy/page.tsx:252`) and `Questions about these terms: {privacyEmail}` (`terms/page.tsx:135`).
7. The reader leaves by the home link, the footer, browser Back, or by closing the tab (when they came from Google).

There is no form, no async state and no error state. The only failure mode is a build-time one (the placeholder guard).

## 3. States inventory

No `page.route` stubs are needed: the pages make no fetches. Capture both routes at 390 light, 390 dark, 1280 light, 1280 dark and 320 light.

| State | How reached | What the user sees | Notes |
| --- | --- | --- | --- |
| Privacy, top | `GET /privacy` | Brand link, "Privacy policy" h1, "Effective 1 October 2026", summary, first section "Google permissions we ask for" | The reviewer's key content (scopes, Limited Use) is first. Good. |
| Terms, top | `GET /terms` | Same frame, "Terms of service" | |
| Deep link | `GET /privacy#rights`, `GET /terms#contact` | Scrolled to that h2 | Scroll offset comes from global `html { scroll-padding-top }` (`app/globals.css:1192-1195,1319-1321`). There is no sticky bar here, so the heading gets 52px of air on a phone. Fine. |
| Skip link focused | Load, then press Tab once | Pill "Skip to content", top-left | Enter moves focus to `main`. |
| Footer focus, current page | Tab to the footer | "Terms of service" bold on `/terms` | Check the focus halo in dark mode. |
| Coarse pointer | `hasTouch: true, isMobile: true` at 390 | Footer links 44px tall | `pointer-coarse:` |
| 320px reflow | viewport 320×640 | Scope URL `code` wraps; no horizontal scroll | Assert `document.scrollingElement.scrollWidth <= 320`. |
| Dark | `addInitScript(() => localStorage.setItem("theme","dark"))` (same as `tests/e2e/accessibility.spec.ts:394-398`) | Dark canvas; panel `bg-surface` from sm | |
| Print | `page.emulateMedia({ media: "print" })`, optionally plus `colorScheme: "dark"`; Chromium `page.pdf()` | Today: home link, footer nav and (≥sm) the panel padding all print | See H2 below for the dark-print hypothesis. |
| Signed-in visit | Any session cookie | Identical page; the "Sign in" footer link still shows | Static, so the session is irrelevant. |

Harness notes:
- Visual capture already lists `anon:/privacy` and `anon:/terms` (`tests/visual/nm-capture.mjs:126-127`). `audit:mobile` lists only `anon:/privacy` (`tests/visual/mobile-audit-lib.mjs:54`).
- `tests/visual/nm-serve.mjs:142-145` claims `/privacy` redirects to `/inbox` under `LOCAL_BOOTSTRAP_ENABLED=true`. Nothing in the legal route does that: there is no layout, it is force-static, and `proxy.ts:15-22` only sets a header. Treat the comment as stale, but confirm with one `GET /privacy` under the e2e env before capturing.

## 4. Protected rules

| Rule | Where |
| --- | --- |
| The legal text is policy. Statements must match the code, and changes go in the same PR as the behaviour. Not for this pass. | `privacy/page.tsx:20-24` |
| Static: no session, no DB, no `lib/server` import | `privacy/page.tsx:17-18`, `terms/page.tsx:17-18`, `legal-document.tsx:29-34`, test `legal-pages.test.tsx:20-27,86-89` |
| Production build fails on placeholder operator details | `operator.ts:28-50`, `legal-document.tsx:52` |
| An empty registered address is left out, with no stray punctuation | `privacy/page.tsx:37`, `terms/page.tsx:29`, test `:71-82` |
| The skip link is the first link and targets `#main`. There is one `main` and one h1. | `legal-document.tsx:55-75`, test `:94-106` |
| The footer `Legal` nav sits outside `main`, has 44px coarse targets, and sets `aria-current` | `legal-document.tsx:89-107`, test `:121-135` |
| The auth card's Privacy link must stay (Google OAuth review checks the home page) | `auth-card.tsx:273-297` |
| Existing section `id`s are now public URLs (Google reviewers and support may link them). Do not rename them. | `privacy/page.tsx:44-264`, `terms/page.tsx:37-133` |

## 5. Prior audit status (15 Oct)

- No 15 Oct finding targets `/privacy` or `/terms` (grep of `findings.md` and `results.md`). The cited IDs are all on other surfaces and all fixed (`results.md:248-249,277-278,283`): SET-17 (invitation role), SET-18 (passwords), SET-23 (auth error copy), CLR-11 and CLR-12 (share sheet and public report).
- D10 (`plan.md:48`, `results.md:310`) is relevant at the edge: the privacy email is **not** a help channel. Linking that same address with `mailto:` (proposal C2) keeps it for privacy and terms questions only. It adds no new help or feedback entry.
- Already done well, so leave it alone:
  - Skip link, landmarks and a single h1.
  - 320px wrapping.
  - 44px footer targets and `aria-current`.
  - Measure (`max-w-prose`).
  - Safe-area padding.
  - External links in the same tab.
  - The effective date is shown, and the scopes come first.

## 6. Friction found

| # | Observation | Evidence | Sev | E/H |
| --- | --- | --- | --- | --- |
| F1 | Two documents of 9 sections each, with long lists, and no on-page contents. To reach "Your rights and requests" or "Sharing" you scroll the whole page, and nothing tells you which sections exist. The `id`s are there but nothing links to them, so nobody discovers them or can copy them. | `legal-document.tsx:40-110` (no contents); ids at `:123` | P2 | Evidence (absence). Page length is a hypothesis; measure at 390. |
| F2 | The privacy contact is plain text, so a phone reader must long-press, select and copy a long address to act on their rights. | `privacy/page.tsx:252`, `terms/page.tsx:135` | P2 | Evidence |
| F3 | Section h2s use `text-title` (17px touch, 16px desk), against 16px or 14px body. Hierarchy rests on weight alone, which makes a long document hard to scan. The design system's own h2 is `text-section` (20/18). | `legal-document.tsx:123`; `components/ui/section-header.tsx:45`; tokens `app/globals.css:625-628,1074-1077` | P3 | Evidence |
| F4 | No print treatment. The home link, the footer nav and (≥sm) the panel padding print. Headings can be orphaned at a page foot. | `legal-document.tsx:61-70,76,89-107` (only the skip link has `print:hidden`, `:57`) | P3 | Evidence |
| F5 | Dark mode printing may give light ink on white paper: backgrounds are dropped and the `.dark` tokens stay. No print colour override exists anywhere except `print:bg-white` in the app shell. | `app/globals.css` (no `@media print`), `components/app-shell/app-shell.tsx:350` | P3 | **Hypothesis.** Verify with `emulateMedia({media:"print", colorScheme:"dark"})` + `page.pdf()`. |
| F6 | No axe scan covers `/privacy` or `/terms` at either viewport or in either theme. | `tests/e2e/accessibility.spec.ts:385-530` (sign-in, recovery and invite only) | P2 (coverage) | Evidence |
| F7 | `audit:mobile` misses `/terms`. | `tests/visual/mobile-audit-lib.mjs:54` | P3 | Evidence |

Checked and fine: the heading order (h1 → h2, no skips); the landmarks (banner, main, contentinfo, nav "Legal"); the home link's name "NabaPresence home", which contains the visible "NabaPresence" (SC 2.5.3); the effective date presentation (plain and above the summary); the way back to sign in (top home link plus footer); focus visibility (`focus-halo`); fragment offset (global scroll padding).

## 7. Proposed changes (smallest coherent set, all area-local)

### C1 · "On this page" contents (fixes F1). Files: `components/legal/legal-document.tsx`, both pages

Make the section ids and titles the single source of truth, so the contents list and the headings cannot drift apart. The heading text moves **verbatim**; the wording does not change.

- In each page, declare an ordered object, for example in privacy:
  `const SECTIONS = { googleAccess: { id: "google-access", title: "Google permissions we ask for" }, collect: { id: "collect", title: "What we collect" }, … changes: { id: "changes", title: "Changes to this policy" } } as const`
  Use all 9, keeping today's ids and titles. Terms gets the same treatment.
- Render each section as `<LegalSection {...SECTIONS.collect}>`.
- Pass `contents={Object.values(SECTIONS)}` to `LegalDocument`. Property order holds for non-integer keys.
- In `LegalDocument`, add `contents?: ReadonlyArray<{ id: string; title: string }>`. Between the article `<header>` (`:77-85`) and `{children}` (`:86`), render:

  ```tsx
  <nav aria-labelledby="legal-contents" className="print:hidden">
    <h2 id="legal-contents" className="text-ui font-semibold text-ink-muted">On this page</h2>
    <ol className="mt-2 grid gap-x-6 sm:grid-cols-2">
      {contents.map((s) => (
        <li key={s.id}><a href={`#${s.id}`} className={LEGAL_NAV_LINK_CLASS + " text-ui text-ink"}>{s.title}</a></li>
      ))}
    </ol>
  </nav>
  ```

  Use a plain `<a>`: it is a same-page fragment, so no `Link` is needed and the page stays JS-free. Reuse `LEGAL_NAV_LINK_CLASS` for 24px fine and 44px coarse targets plus the halo, and add underline-on-hover. On a phone that is 9 × 44px ≈ 396px. From sm up it is 2 columns ≈ 5 rows × 24px.
- Copy, verbatim: `On this page`.
- **Benefit:** sections can be found and linked (support can send `/privacy#retention`), and the reader sees the structure up front.
- **Principles:** HIG hierarchy and familiarity (the GOV.UK and Apple legal contents pattern); Nielsen 6 (recognition over recall) and 7 (flexibility); WCAG 2.4.6 and 1.3.1 (headings and lists).
- **Risk:** none to protected behaviour. It is static markup with no JS. The skip link stays first (test `:105`). The nav label differs from "Legal" (test `:123`). No contents title equals "Privacy policy" (test `:67`). There is still one h1.
- **Shared file?** No: `legal-document.tsx` has two callers, the two legal pages.

### C2 · Make the privacy contact a `mailto:` link (fixes F2). Files: `privacy/page.tsx:252`, `terms/page.tsx:135`

- Replace `{privacyEmail}` with `<a className={INLINE_LINK_CLASS} href={`mailto:${privacyEmail}`}>{privacyEmail}</a>`. The text is unchanged.
- It is an inline link in running text, so it is exempt from SC 2.5.8 (it matches `INLINE_LINK_CLASS`, `legal-document.tsx:19-21`).
- **Benefit:** one tap to act on data rights.
- **Principles:** Nielsen 7; HIG simplicity.
- **Risk:** none. The address and wording are identical. Test `:52-55` uses `getAllByText(regex)` and still matches. D10 is unaffected: it is the same published privacy contact, and no help channel is added.
- **Shared?** No.

### C3 · Section headings at the design-system h2 size (fixes F3). File: `legal-document.tsx:123`

- Change `text-title` to `text-section`. That is 20px touch and 18px desk, the same as `SectionHeader`'s h2 (`components/ui/section-header.tsx:45`).
- **Benefit:** headings are scannable through size as well as weight.
- **Principles:** HIG hierarchy; SC 1.3.1 (the visual structure matches the semantic structure).
- **Risk:** none. **Shared?** No.

### C4 · Print styles (fixes F4). File: `legal-document.tsx`

- Add `print:hidden` to the banner header (`:61`), the footer (`:89`) and the C1 nav.
- Add `print:bg-transparent print:p-0` to the article (`:76`).
- Add `print:break-after-avoid` to the h2 (`:123`).
- Optionally add `print:[&_a[href^=http]]:after:content-['_('_attr(href)_')']`, so the "Google API Services User Data Policy" link prints its URL. The myaccount link's text already is its URL. Check the arbitrary value against `pnpm check:design`. If it trips a rule, drop the option.
- **Principles:** HIG consistency (the shared report already ships print rules, `components/share/shared-client-report.tsx:109`); Nielsen 8 (minimalist output).
- **Risk:** none. **Shared?** No.

### C5 · Tests (fixes F6 and F7)

See section 9. These are test-only changes.

## 8. Explicitly not proposed

- **Any wording change.** That includes the "Effective" label, the summary copy, section titles, retention numbers and contact phrasing. They are policy (`privacy/page.tsx:20-24`). Follow-up: the footer nav's `aria-label="Legal"` also holds "Sign in". That is a harmless label mismatch and should stay as is.
- **Scrollspy or `aria-current` in the contents.** It needs client JS, and the pages are JS-free on purpose (`legal-document.tsx:29-34`). Static `aria-current` already sits in the footer.
- **Self-link "#" anchors on every heading.** They add 9 extra tab stops. The C1 contents links already give a copyable URL per section.
- **Per-section or end-of-page "Back to top".** The footer follows immediately, and C1's list is one Home or status-bar tap away. It adds noise for little gain.
- **A `<details>` collapsed contents on phones.** It hides structure behind a tap. Revisit only if the 390px BEFORE/AFTER shows C1 pushing the first section unreasonably far down. The alternative is `sm:hidden` details plus `hidden sm:block` list, which duplicates the DOM.
- **`<time dateTime>` for the effective date.** It needs a second ISO field in `operator.ts` or a parse step, with drift risk, for little user value. No SC requires it.
- **Larger desk body text (14px → `text-reading` 17/28).** `text-reading` is reserved for "the customer's words" (`app/globals.css:612-615,631`). A desk long-form size is a design-system decision, so it needs the owner.
- **Dark-mode print fix (F5).** If the hypothesis is confirmed, the right fix is global: an `@media print` that restores the light tokens in `app/globals.css`. That affects every surface, including the shared report, so it needs a separate slice.
- **Dropping `aria-labelledby` from `<section>`.** That would remove 9 named region landmarks. Axe accepts the regions, and they are useful for landmark navigation in a long document. Leave them.
- **`lang="en-GB"`.** It is a root layout change (`app/layout.tsx:83`), global and out of area.

## 9. Tests

**Existing coverage:**
- `tests/components/legal-pages.test.tsx` covers the static guard, the content promises, one main and one h1, skip link order, 320px wrap rules, footer targets and `aria-current`, and the placeholder guard.
- None of `tests/e2e/auth.spec.ts`, `accessibility.spec.ts` or `touch-critical.spec.ts` visits `/privacy` or `/terms`.

**Worth adding:**
1. Unit tests in `legal-pages.test.tsx`, run for each page:
   - `nav[aria-labelledby=legal-contents]` links map 1:1, in order, to `article section > h2`, matching both `href="#id"` and the text.
   - Every contents link carries `pointer-coarse:min-h-(--np-touch)`.
   - The skip link is still the first `a`.
   - The privacy email renders as an `a[href="mailto:…"]` built from `LEGAL_OPERATOR.privacyEmail`.
   - The section ids stay equal to today's list. That pins them as public URLs.
2. In `tests/e2e/accessibility.spec.ts`, inside the existing theme × viewport loop (`:385-398`), add `test("legal pages")`. It runs `goto("/privacy")`, waits for the heading, runs `expectAccessible`, then repeats for `/terms`. That adds dark and light at 390 and 1440 for free.
3. Optionally, a touch-critical check at 390 with coarse pointer: the contents and footer links are at least 44px tall, and `scrollWidth <= clientWidth` at 320.
4. Add `"anon:/terms"` to `tests/visual/mobile-audit-lib.mjs:54`.
