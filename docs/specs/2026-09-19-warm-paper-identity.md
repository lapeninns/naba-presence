# Visual identity: warm paper, forest ink, one grotesk

Status: superseded, 2026-09-23, by
`docs/specs/2026-09-23-operators-desk-identity.md`. (Accepted 2026-09-19;
superseded `docs/specs/2026-09-04-apple-identity.md`.) The four-layer token
architecture, the contrast gate (`pnpm check:contrast`,
`tests/design-tokens-contrast.test.ts`), the density model and the
information architecture from `docs/specs/2026-09-18-work-first-ia.md` and
`docs/specs/2026-09-19-listings.md` are carried forward unchanged; the values,
the type, the chrome and the inbox composition are replaced.

## Why this changed

The product was asked to stop looking like anyone else's. The Apple identity
borrowed a platform's blue, its translucent materials and its springs; the
editorial identity before it borrowed a magazine. An agency shows these
screens to its clients, so the tool has to read as the agency's own desk:
warm, quiet, and unmistakably not Google.

## Direction

Warm paper, forest ink, and a grotesk that means business. A warm off-white
canvas; near-white cards with no border and a 1px hairline shadow; one deep
green on the primary action, focus, the selected row and one recurring
surface (the Today panel); one charcoal counter-surface per screen (the
composer footer, the bulk bar, or a caption bar over media). Type does the
hierarchy work, every figure is tabular, and the customer's words are the
largest readable body on the screen.

### Signature device: the caption bar

A low charcoal strip anchored 16px inside the bottom edge of a framed header
(`caption-bar` utility): a muted mono index in parentheses, a bold title, a
1px rule that fills the middle, and meta at the right separated by middle
dots. Over a photograph it is charcoal at 72%; on a plain frame it is
`surface-alt` (`data-solid`). One per frame, never on prose. Status:
candidate until it has been seen by real operators.

### Restraint

Charcoal appears at most once per screen in light mode. No gradients except a
photo scrim under a caption bar. No card tints per client, queue or status.
No hairline borders around every card. No blur.

## Tokens (`app/globals.css`)

| Layer  | What changed                                                                                                                                                                                                                                                                                                               |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ramps  | Neutrals are one warm hue (85) at tiny chroma. The accent is forest green (hue 160): `accent-500` for the solid, `600` for hover and the Today panel, `700` for text. Gold `--np-rating` for stars only. Charts start from the accent; no blue series.                                                                     |
| Roles  | New: `--np-surface-alt` (rows, panels), `--np-charcoal` + `--np-ink-on-charcoal` + `--np-ink-muted-on-charcoal`, `--np-caption-bar` + `--np-caption-bar-opaque`, `--np-accent-surface` + its two inks. Focus is a 2px accent ring standing 2px off the control. Materials resolve to opaque surfaces.                      |
| Type   | `--font-sans` is Schibsted Grotesk, `--font-mono` is JetBrains Mono, both self-hosted variable fonts loaded in `app/layout.tsx` with `next/font/local`; licences in `public/fonts/*/OFL.txt`. New `--text-reading` (17/28) for the review and reply cards.                                                                 |
| Shape  | Radii unchanged: tag 6, control 10, card 14, panel 16, modal 20, sheet 28, concentric inner radii. Hairline is 1px at 6% ink.                                                                                                                                                                                              |
| Motion | `--np-ease-out: cubic-bezier(0.16, 1, 0.3, 1)` for entrances and movement; `--np-ease-standard` for colour. The spring names remain and resolve to these curves. `--np-duration-enter: 450ms`, `--np-stagger: 60ms`, capped at four steps by `enter-stagger`. Keyframes `np-rise`, `np-rise-lg`, `np-slide-in`, `np-fade`. |
| Layout | Sidebar 248px, toolbar 56px, page padding 24px (16px below `md`), reading measure 720px.                                                                                                                                                                                                                                   |

Every new colour role has its pairs in `lib/design/contrast-pairs.ts`; the
gate measures 188 pairs in both themes.

## Chrome

Sidebar and toolbar are the canvas with a 1px hairline edge, no blur. The
sidebar leads with the organisation name and the wordmark as caption; the
wordmark (`components/app-shell/brand-mark.tsx`) is the name set bold and
tight with "Presence" in the accent ink and a small accent square, until a
drawn mark exists. The active nav row carries the accent tint and a 3px bar
down its left edge. Below `md` the hamburger sits at the toolbar's trailing
edge at 44px.

## Inbox composition (`components/inbox`)

1. **Today panel** (`today/today-strip.tsx`): one deep-green panel, radius
   16, 280–320px tall, with the needs-reply count and its scope top-left,
   the client cards (260×72, avatar letter, mono index, name, open count)
   along the foot, and two 40px square controls at the right for locations
   needing attention and the first client's setup. Below `md` those two
   controls become full-width rows under the panel.
2. **Queue chips** (`queue-tabs.tsx`): five pills, the current one accent
   solid, counts in mono.
3. **Review rows** (`review-list.tsx`): cards on `surface-alt`, radius 14,
   8px apart; gold stars, name, mono age; one excerpt line; venue, status
   pill, chevron. The selected row is the only one carrying the accent: a
   tint and a 3px inset bar.
4. **Header frame** (`review-detail.tsx`): the reviewer's name, a hairline,
   the mono caption "Google review" and "Open listing"; then a framed header
   carrying the caption bar with index, location, rule, client · stars ·
   age. The review payload carries no cover photo, so the frame is a solid
   `fill-secondary` panel 136px tall and the bar is drawn solid.
5. **The review and the live reply**: a status panel (the one `role=status`
   in the pane) beside two quote cards of the same geometry, the customer's
   words at reading size with an accent quote glyph and a footer bar, and
   what Google shows now or "Nothing is live yet."
6. **Activity**: the audit timeline, revealed once on scroll.
7. **Verification** (`verification-panel.tsx`): four cards — Length, Banned
   terms, Tone match, Semantic check — with the fourth the verdict, accent
   solid when the reply may go live, danger tint when blocked.
8. **Composer** (`reply-composer.tsx`): one panel split 50/50 at `lg`: tone
   pills and the draft facts (accent squares, mono byte count, saved time,
   the save shortcut, who drafted, when last published) on the left; the
   reply textarea and its tools on the right. The pane footer beneath it is
   the screen's one charcoal surface and holds Publish.
9. **Empty statements** (`empty-states.tsx`): a two-tone sentence, headline
   in ink and continuation in muted ink at the same size, with one pill
   action outlined in the accent.

## Motion

Page load: title, then the Today panel (+80ms), its headline (+160ms), the
client cards staggered from 220ms; the review rows from 380ms, 60ms apart,
capped at four steps. Selecting a review slides the detail 12px from the
right in 260ms. Timeline rows and verification cards below the fold reveal
once through `lib/motion/reveal.ts` (IntersectionObserver, threshold 0,
120px bottom margin, unobserve on entry, final state kept). Hover fill
changes take 140ms and only run for fine pointers (`hover-fine:`). Under
`prefers-reduced-motion` every duration collapses to 0.01ms and the reveal
helper finishes every group immediately; content is never hidden by default.

## Deviations recorded against the page plan

- The header frame is 136px, not a 3:1 photo frame: the review payload has
  no cover image and an empty 240px frame would be filler.
- Tone has three options (warm and professional, concise, empathetic)
  because those are the tones the drafting API accepts.
- "View on Google" is not shown: the review payload carries no public URL.
- Publish lives in the pinned pane footer (charcoal) rather than inside the
  composer panel, so the screen has exactly one charcoal surface and the
  primary action never scrolls away.
