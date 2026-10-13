# Mobile interaction infrastructure

Date: 2026-10-13 · Branch: `feat/mobile-interaction-infra`

The low-level pieces every redesign direction builds on: one source of
breakpoints, a rule for when JavaScript may ask about the viewport, the
on-screen keyboard as CSS variables, and a viewport meta that makes safe areas
work.

## Rules

1. **Layout switches in CSS; behaviour switches in JS.** The server cannot
   know the viewport, so a JS media query that picks a layout is a guess a
   phone paints before hydration. Render both trees and hide one with a
   breakpoint variant, or restyle one tree. JS media queries decide only what
   CSS cannot: push navigation vs split view, sheet vs inline panel, closing a
   drawer when the viewport grows, auto-selecting the first review. Prefer
   reading `matchMedia` inside the event handler over subscribing a render.
2. **One source of breakpoints.** CSS owns them (`--breakpoint-*` in
   `@theme`, or Tailwind's defaults; the `controls`/`capsules` variants).
   `lib/ui/breakpoints.ts` mirrors them for JS, and
   `tests/breakpoints.test.ts` parses `app/globals.css` so the two cannot
   drift. Change a value in CSS and in that file, nowhere else. No
   hand-written `(min-width: 768px)` strings in new code: use
   `mediaQuery("md")` or `useBreakpoint("md")`.
3. **Fixed and sticky chrome reads the inset variables.** Anything pinned to
   the bottom adds `env(safe-area-inset-bottom)` and, when it must ride above
   the keyboard, `--np-keyboard-inset`. Always with a fallback:
   `var(--np-keyboard-inset, 0px)`.

## Pieces

| Piece           | File                                       | What it does                                                                                                                                                                                                                                                                                                                                                              |
| --------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Breakpoints     | `lib/ui/breakpoints.ts`                    | `BREAKPOINTS` (rem + px) for `sm md lg xl 2xl sidebar`, `CONTROLS_MIN_HEIGHT`, `MEDIA_QUERIES` / `mediaQuery(name)` including `controls` and `capsules`.                                                                                                                                                                                                                  |
| Media hooks     | `lib/hooks/use-media-query.ts`             | `useMediaQuery(query, serverDefault = true)` unchanged; `useBreakpoint(name, serverDefault = true)`; `useHydratedBreakpoint(name)` → `boolean \| null`, `null` until hydrated.                                                                                                                                                                                            |
| Keyboard insets | `components/app-shell/viewport-insets.tsx` | `<ViewportInsets />` (mounted once in `app/layout.tsx`) tracks `visualViewport` resize + scroll, rAF-throttled, and writes `--np-keyboard-inset`, `--np-visual-viewport-height` and `data-keyboard="open"` (inset > 120px) on `<html>`. `useKeyboardInset()` gives the same number in JS. No-op without `visualViewport`; pinch zoom (scale > 1.05) reads as no keyboard. |
| Viewport meta   | `app/layout.tsx`                           | `width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content`; `theme-color` per system scheme (`#f6f9fc` / `#0d1216`, hex approximations of the two canvas colours); `color-scheme: light dark`.                                                                                                                                         |

### The server-default trade

`useBreakpoint` defaults to `true` on the server: the desk's primary device is
wide, so the hydration render behaves wide and a phone corrects itself one
render later. When that render is visible (only one branch mounts an
element), use `useHydratedBreakpoint` and render the CSS-switched shape for
`null`:

```tsx
const wide = useHydratedBreakpoint("md")
if (wide === null) return <BothPanesCssSwitched />
return wide ? <SplitView /> : <PushNavigation />
```

### Keyboard model

- **Android Chrome** obeys `interactive-widget=resizes-content`: the layout
  viewport shrinks, `bottom: 0` is already above the keyboard, and
  `--np-keyboard-inset` reads ~0.
- **iOS Safari** ignores it and overlays the keyboard on the layout viewport.
  `--np-keyboard-inset = max(0, innerHeight − vv.height − vv.offsetTop)` is
  the covered strip; adding it to `bottom` lifts a bar above the keyboard.
- Collapsing toolbars move the visual viewport by 40–90px; the 120px
  threshold keeps them from setting `data-keyboard`.

## CSS consumers

The utilities that read these variables live in `app/globals.css` (owned by
the design-system lead): safe-area padding (`pt-safe`, `pb-safe`, `px-safe`),
`--np-safe-bottom`, a keyboard-aware `--np-bottom-offset`, dynamic-viewport
heights, and `scroll-padding` on the scroll root sized to the sticky bars so
a focused control is never hidden beneath them (WCAG 2.2 SC 2.4.11, Focus Not
Obscured). A sticky action bar uses `bottom: var(--np-bottom-offset)`; a tab
bar pads by `--np-safe-bottom` and hides under `[data-keyboard=open]`.

## Testing

Automated (`pnpm test`):

- `tests/breakpoints.test.ts` — TS constants vs `app/globals.css` and
  Tailwind's `theme.css`; the shell's arbitrary `[1181px]` widths vs
  `sidebar` until it becomes a token.
- `tests/components/viewport-insets.test.tsx` — mocked `visualViewport`:
  open/close, one write per frame, toolbar vs keyboard, pinch zoom, cleanup,
  no-op path, `useKeyboardInset`.
- `tests/components/use-breakpoint.test.tsx` — query strings, server `null`.

On devices:

1. **iPhone (Safari, and a home-screen install):** open a page with a bottom
   bar and a text field near the bottom. Focus it. The bar should sit on top
   of the keyboard; in Web Inspector, `<html>` shows `data-keyboard="open"`
   and a `--np-keyboard-inset` near the keyboard height (~300–340px). Dismiss
   the keyboard: the attribute goes, the inset returns to `0px`. Pinch-zoom:
   no `data-keyboard`. Landscape on a notched phone: content clears the notch
   via `px-safe`.
2. **Android (Chrome):** the same flow; the bar rides above the keyboard
   because the layout viewport resized, and `--np-keyboard-inset` stays near
   `0px`. Check the gesture-bar inset with `pb-safe`.
3. **Desktop:** resize across 768px and 1181px; the shell's rail and sidebar
   swap in CSS with no flash, and `useBreakpoint` callers agree with the
   Tailwind prefixes.
4. Remote-debug with Safari Web Inspector (iOS) or `chrome://inspect`
   (Android); Chrome DevTools device mode does not emulate the keyboard.
