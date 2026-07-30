# NabaPresence design system

**Date:** 2026-07-28
**Decision:** shadcn/ui component shapes (base-rhea style, Base UI primitives) with the
Google Business Profile palette. Colour and type are ours; radius, density, sizing and
component structure stay stock.

> **Ownership:** This document's palette rationale remains authoritative. The full
> production system lives in
> [NabaPresence full design-system replacement](../superpowers/specs/2026-07-29-full-design-system-replacement-design.md).

## Why this shape

The repo began as a bare shadcn starter on the `olive` base colour — warm grey-green
neutrals (oklch hue ~107) and no accent colour at all, with a leftover blue chart ramp
(hue 251–265) that matched nothing. Google's greys are cool (hue 240–271, chroma ≤0.010),
so dropping Google Blue onto olive neutrals reads muddy. The neutrals had to move with
the accent.

Two options were rejected:

- **Full Material 3 clone** (pill buttons, tonal elevation, Google Sans) — would require
  forking every component's variants, and every future `shadcn add` would need hand-editing
  to match.
- **Accent-only swap** — leaves the warm-olive / cool-blue tension in place.

## Method

Every value is a published Google Material / GBP hex converted to oklch, then measured:
4.5:1 for text (WCAG AA), 3:1 for focus indicators and control boundaries. Four of the
first-pass picks failed and were replaced with darker Material steps. Decorative fills
(star, chart series) are exempt from text contrast.

Contrast was computed directly, then the shipped values were re-read out of the running
browser and compared against intent — see [Verification](#verification).

## Tokens

### Light

| Token | Hex | oklch | Measured |
|---|---|---|---|
| `background` | `#FFFFFF` | `oklch(1 0 0)` | — |
| `foreground` | `#202124` | `oklch(0.248 0.006 271.2)` | 16.10:1 on bg |
| `card`, `popover` | `#FFFFFF` | `oklch(1 0 0)` | — |
| `primary` | `#1A73E8` | `oklch(0.574 0.195 257.9)` | 4.51:1 w/ white |
| `primary-foreground` | `#FFFFFF` | `oklch(1 0 0)` | — |
| `secondary` | `#F1F3F4` | `oklch(0.963 0.003 228.8)` | — |
| `muted` | `#F8F9FA` | `oklch(0.982 0.002 247.8)` | — |
| `muted-foreground` | `#5F6368` | `oklch(0.498 0.009 253.9)` | 6.05:1 on bg |
| `accent` | `#E8F0FE` | `oklch(0.953 0.021 261.8)` | — |
| `accent-foreground` | `#0B57D0` | `oklch(0.495 0.199 260.6)` | 5.57:1 on accent |
| `destructive` | `#B3261E` | `oklch(0.501 0.178 28.7)` | 6.54:1 as text |
| `border` | `#DADCE0` | `oklch(0.894 0.006 264.5)` | decorative |
| `input` | `#E8EAED` | `oklch(0.936 0.005 258.3)` | fill, not border |
| `ring` | `#1A73E8` | `oklch(0.574 0.195 257.9)` | 4.51:1 |
| `rating` | `#FBBC04` | `oklch(0.83 0.17 84)` | decorative |
| `success` | `#146C2E` | `oklch(0.467 0.125 148.2)` | 6.53:1 as text |
| `warning` | `#F9AB00` | `oklch(0.796 0.167 76)` | fill only |

### Dark

| Token | Hex | oklch | Measured |
|---|---|---|---|
| `background` | `#1F1F1F` | `oklch(0.239 0 0)` | — |
| `foreground` | `#E8EAED` | `oklch(0.936 0.005 258.3)` | 13.68:1 on bg |
| `card`, `popover` | `#28292C` | `oklch(0.281 0.006 271.2)` | — |
| `primary` | `#A8C7FA` | `oklch(0.825 0.08 260.3)` | 7.50:1 w/ its fg |
| `primary-foreground` | `#062E6F` | `oklch(0.321 0.121 260.2)` | — |
| `secondary`, `muted` | `#2D2E31` | `oklch(0.301 0.006 271.2)` | — |
| `muted-foreground` | `#9AA0A6` | `oklch(0.703 0.011 248)` | 6.24:1 on bg |
| `accent` | `#1F3760` | `oklch(0.34 0.078 260.5)` | — |
| `accent-foreground` | `#E8EAED` | `oklch(0.936 0.005 258.3)` | 9.82:1 on accent |
| `destructive` | `#F2B8B5` | `oklch(0.834 0.068 22)` | 9.65:1 as text |
| `border` / `input` | — | `oklch(1 0 0 / 12%)` / `/ 15%` | — |
| `success` | `#6DD58C` | `oklch(0.792 0.143 151.6)` | — |

### Charts

The four Google brand colours plus Google teal, held constant across both themes:
`#4285F4` `#EA4335` `#FBBC04` `#34A853` `#12B5CB`. All land at L 0.63–0.83, which reads on
`#1F1F1F`. These replaced the template's stray blue ramp. They are decorative — label
series, never rely on hue alone.

## The five contrast fixes

Google's published hexes could not all be used as-is, because base-rhea uses several of
these tokens as *text* rather than as fills.

1. **`accent-foreground` is Blue 800, not Blue 600.** base-rhea applies
   `focus:bg-accent focus:text-accent-foreground`, so this pair must survive on the tint.
   `#1A73E8` on `#E8F0FE` is **3.93:1** — fails. `#0B57D0` gives **5.57:1**.

2. **`destructive` is `#B3261E`, not Google Red.** base-rhea never fills with destructive;
   it renders `bg-destructive/10 text-destructive`. As text, `#EA4335` is **3.92:1** on
   white and `#D93025` is **4.10:1** on its own tint — both fail. `#B3261E` passes both
   (**6.54:1** / **5.54:1**).

3. **`success` is Green 900, not Google Green.** `#34A853` as text is **4.21:1**. `#146C2E`
   is **6.53:1**. Google Green survives only as a chart fill.

4. **`input` is a fill, and stayed light.** The initial plan set `#80868B` for a 3:1 control
   boundary — wrong: base-rhea uses `bg-input/50` as a *surface* across 19 components
   (`input`, `textarea`, `select`, `switch`, `checkbox`, `slider`, `tabs`, `kbd`, …) with a
   transparent border. A mid-grey would have produced dark grey input fields.

5. **Button hover darkens instead of lightening.** Stock base-rhea is `hover:bg-primary/80`,
   which blends primary *toward the page*: white-on-primary falls to **3.27:1**. No Google
   blue survives it (`#0B57D0` still fails at 4.26:1). Replaced with
   `color-mix(in oklch, var(--primary), var(--foreground) 12%)` → `#1F69CE`, **5.29:1** —
   and Google's own buttons darken on hover. This is base-rhea's existing idiom; its
   `secondary` and `muted` bubble variants already use the same `color-mix` form.

## base-rhea behaviours that shaped these choices

Worth knowing before changing tokens:

- **`--accent` is a focus/highlight state, not a brand tint.** It appears as
  `focus:bg-accent`, not as a resting surface.
- **Popovers force `.dark`.** `DropdownMenuContent` / `SelectContent` open with
  `class="dark … bg-popover/70"` plus backdrop blur (the `inverted-translucent` menu style
  in `components.json`), so **dark tokens govern menus in both themes**. They also override
  item highlight to `bg-foreground/10`, bypassing `--accent` entirely.
- **Dark `accent-foreground` is deliberately neutral.** Those popovers set
  `**:data-[variant=destructive]:text-accent-foreground!`, so a blue value would render
  destructive menu items blue. Verified in-browser: "Report review" renders neutral.
- **`--destructive-foreground` is unreferenced** anywhere in the component set.
- **Menus size to `w-(--anchor-width)`**, so an icon-button trigger yields a cramped menu
  unless given an explicit width.

## Deviations from stock

Three component files were edited; everything else is untouched so future `shadcn add`
output drops in clean.

| File | Change |
|---|---|
| `components/ui/button.tsx` | `default` variant hover → `color-mix` darken |
| `components/ui/badge.tsx` | same, on `[a]:hover` |
| `components/ui/bubble.tsx` | same, on interactive bubble content |

Two further edits were needed to keep `pnpm lint` green. Both are upstream shadcn code that
`shadcn add --all` brought in, and both tripped `react-hooks/set-state-in-effect` (new in
eslint-config-next 16) by calling `setState` synchronously in an effect body. Each was
rewritten with `useSyncExternalStore`:

- `hooks/use-mobile.ts`
- `components/ui/carousel.tsx` — also fixes a latent leak: it attached both `select` and
  `reInit` but only detached `select`.

## Font tokens

`--font-mono` was never mapped in `@theme inline`, so the `font-mono` utility resolved to
Tailwind's default stack even though Geist Mono was being loaded in `layout.tsx`. Both
families are now mapped. They stay `var()` references so `layout.tsx` remains the single
owner of the family names.

## Verification

- `pnpm typecheck`, `pnpm lint`, `pnpm build` — all clean; no browser console errors.
- All 21 tokens read back out of the running page via canvas pixel sampling and compared
  against intent: **exact match** in light and dark (max Δ 3/255 on `chart-5`, from rounding
  oklch to three decimals). The probe was validated against known hex literals first.
- The shipped hover `color-mix` resolves in-browser to `#1F69CE`, matching the predicted
  value used for the 5.29:1 calculation.
- `app/design-system/page.tsx`, served at `/design-system`, is the production proof for
  the system's foundations and production compositions, checked in both themes. Keep it
  working — it is the regression surface for this palette and its component hierarchy.

## Accepted limitations

- **Field affordance is quiet.** `bg-input/50` computes to `#F4F5F6`, **1.09:1** against the
  page. That is base-rhea's deliberate design (identical to the olive template's 1.10:1, so
  no regression), but it is weak for identifying a form field. Fields are identifiable by
  label and focus ring, not boundary. To strengthen it, raise `--input` toward `#DADCE0` or
  give inputs a visible border — one token, not a fork.
- **Charts rely on hue.** Fine for brand fidelity, not for colourblind readers. Add direct
  labels or patterns before shipping real charts.

## Extending

- Build from tokens (`bg-card`, `text-muted-foreground`, `border-border`), never ad-hoc hex.
- New semantic colour used as **text** must be measured against `background` *and* `muted`,
  and against its own `/10` tint if rendered base-rhea style.
- Reach for `--rating` for stars, `--success` / `--warning` / `--destructive` for status, and
  `--chart-*` for series.
- `shadcn add <component>` needs no palette work; only re-check anything introducing a new
  `hover:bg-primary/<n>`.
