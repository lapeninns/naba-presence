# design-sync notes — NabaReview

Repo-specific gotchas for future syncs. Read this before re-running.

## Shape

- This repo is a Next.js **application**, not a published component library. There is no
  library `dist/`, so the converter runs in **synth-entry mode** (`[NO_DIST]` is expected,
  not a failure). The design system is `components/ui/*.tsx` — 60 files.
- `srcDir` is pinned to `components/ui`. Do **not** leave it unset: auto-detection picks the
  first of `src/ | lib/ | components/`, and this repo has a `lib/` holding only `utils.ts`,
  so discovery would find nothing useful.
- `tsconfig` must stay set. Every component imports `@/lib/utils`, and esbuild needs
  `compilerOptions.paths` (`@/*` → `./*`) to resolve it.

## The node_modules self-link (required, recreate per clone)

The converter resolves the package as `<node-modules>/<pkg>`, which does not exist in the
DS's own repo. Create a self-link before building:

```sh
ln -sfn "$PWD" node_modules/NabaReview
```

Without it the build dies with `ENOENT … node_modules/NabaReview/package.json`. It is
gitignored (under `/node_modules`), so it must be recreated on every fresh clone, and a
`pnpm install` may remove it. This also lets authored previews `import { X } from "NabaReview"`.

## 60 components, not 338

The 60 files export 338 PascalCase components — every subpart (`CardHeader`, `TableCell`,
`SelectItem`) counts as one. `componentSrcMap` pins the 60 primaries and sets the other 278
to `null`. That removes their **card and `.d.ts`** only: the synth entry is `export *` over
all 60 files, so every subpart is still in `_ds_bundle.js` and on `window.NabaReview`
(355 exports). Verified by grepping the bundle.

Because the excluded subparts are no longer in the component list, the converter's
"related siblings" list comes out empty — that is why every `docs/components/<Name>.md`
carries a **`## Parts`** section. Those lists are generated from the real exports; if a
component gains or loses a subpart, regenerate rather than hand-editing.

Four files whose root export is not the filename-derived name (already handled):
`chart.tsx` → `ChartContainer`, `direction.tsx` → `DirectionProvider`,
`input-otp.tsx` → `InputOTP`, `resizable.tsx` → `ResizablePanelGroup`.
`CarouselApi` is a type, not a component.

## Grouping

`components/ui/` is a `GENERIC_DIR` for the converter, so dir-derived grouping yields one
flat `general` group. Groups come from `category:` frontmatter in `docs/components/<Name>.md`
(`docsDir`). The nine groups partition all 60 exactly — Actions 4, Forms 14, Data Display 9,
Feedback 7, Overlays 9, Navigation 5, Layout 6, AI & Chat 5, Utilities 1.

## CSS must be compiled (the components are Tailwind-utility-styled)

`app/globals.css` is a Tailwind v4 source file (`@import "tailwindcss"`), not shippable CSS.
`cssEntry` points at `.design-sync/.cache/ds-compiled.css`, produced from
`.design-sync/ds-tailwind.css` (which imports globals.css and adds `@source` lines). Compile
it before every converter run — that is what `buildCmd` does.

## Fonts: the sharpest trap in this repo

`app/globals.css` maps `--font-sans: var(--font-sans)` because next/font defines that
variable at runtime on `<html>`. **Outside the Next app that reference dangles**, so the
first build rendered every preview card in browser-default serif while the app itself looked
fine. `.design-sync/ds-tailwind.css` overrides the `--font-sans` / `--font-mono` /
`--font-heading` theme keys with literal family names to fix this. Do not "simplify" that
block away, and do not fix it by editing `app/globals.css` — the app relies on the runtime
variable.

`prepare-fonts.mjs` harvests the woff2 out of `.next` because next/font downloads them at
build time and nothing is committed. Two hard-won details:

- **next/font's family name is not stable.** The production chunk
  (`.next/static/chunks`) names families after the *JS variable* that declared them
  (`geist`, `fontMono`); the dev chunk (`.next/dev/static/chunks`) uses the real names
  (`Geist`, `Geist Mono`). Which you get varies by build. The script therefore scans both
  trees and **normalizes** every face to a canonical family, deduping by (family, file).
  Never reintroduce a dependency on the declared name.
- **Files are renamed.** Next's names are content hashes containing `~` and multiple dots
  (`6306c77e7c8268e4-s.0rhz0arwfsn~5.woff2`); the upload API rejects them as reserved/invalid
  paths. Shipped names are `geist-N.woff2` / `geist-mono-N.woff2`.

`<Family> Fallback` faces are deliberately skipped — they resolve via `local()`
metric-adjusted system fonts, so there is no file to ship, and naming them in the font stack
produced `[FONT_MISSING]`.

## Known render warns (triaged, expected — not new)

- `[TOKENS_MISSING]` 12 custom properties: `--toast-index`, `--toast-height`,
  `--toast-offset-y`, `--toast-swipe-movement-x`, `--toast-swipe-movement-y`,
  `--accordion-panel-height`, `--drawer-swipe-progress`, `--nested-drawers`, and similar.
  These are set at runtime by the components themselves (inline style / JS), so no
  stylesheet defines them. Expected, non-blocking.
- `[NO_DIST]` on every run — synth-entry mode is this repo's normal state.
- `[RENDER_THIN]` on `Dialog` and `AlertDialog`: "DOM content present but rendered height is 0px".
  **Benign and confirmed by screenshot** — both card correctly (the Dialog shot shows the full
  reply composer). Their content is portalled and `fixed`, so measured height collapses to 0 while
  the render itself is complete. Do not rework these previews on the strength of this warn.
- `[GRID_OVERFLOW]` no longer appears: 18 components carry `cfg.overrides` card modes. If a NEW
  one appears, apply the remedy the warn names rather than editing the preview.

## Transient, not a real failure

A run once produced `[RENDER] … net::ERR_ADDRESS_INVALID` for five components
(HoverCard, Menubar, Popover, Sheet, DirectionProvider). It did not reproduce on re-run —
the validator's local static server lost its port. If you see `ERR_ADDRESS_INVALID`,
re-validate before investigating the components.

## Browser for the render check

No playwright cache and no chromium on this machine, but Google Chrome is installed.
Both `package-validate.mjs` and `package-capture.mjs` honour `DS_CHROMIUM_PATH`, so the
200MB chromium download is unnecessary:

```sh
export DS_CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

`playwright` is installed into `.ds-sync/` with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`.
Verified working: playwright 1.62 driving Chrome 150.

## Authoring previews — read this before writing any `.design-sync/previews/*.tsx`

Folded from the first authoring wave (30 components, 6 agents). These cost real time to find.

### The inner loop cannot compile new Tailwind classes

`preview-rebuild.mjs --components …` recompiles preview JS only — it never re-runs Tailwind, and
`_ds_bundle.css` is rewritten solely by the full `package-build.mjs`. A class not already in the
compiled sheet is a **silent no-op**: no warning, no error, no ⚠ cell. It cost a whole component
in wave 1 (`ScrollArea`'s `h-*` classes did nothing, so nothing scrolled) and made a `Textarea`
render *shorter* than default (`min-h-28` vanished, leaving only `min-h-16`).

Mitigated by the `@source inline(...)` safelist in `ds-tailwind.css`, which pre-compiles the
ordinary layout/typography vocabulary and the DS semantic colours. Anything exotic still needs
checking against `ds-bundle/_ds_bundle.css` first. Note Tailwind escapes dots in selectors, so a
naive grep gives false results on classes like `size-3.5`; and utilities like `space-y-4` emit as
`.space-y-4>:not(:last-child)`, so match on the class prefix, not `.class{`.

### Base UI is not Radix — the shipped source has dead Radix-era selectors

`render` prop, never `asChild` (0 files use asChild). Beyond that, wave 1 found four selectors in
the component source that Base UI never triggers. These are **pre-existing bugs in the components,
not sync artifacts**, all cosmetic-state only:

- `radio-group.tsx` — `RadioGroupItem` renders `<span role="radio">` and never receives a
  `disabled` attribute (only `data-disabled`/`aria-disabled`), so `disabled:opacity-50`,
  `disabled:cursor-not-allowed` and `peer-disabled:*` on its label are all dead. Should be
  `data-disabled:*`. **A disabled radio does not look disabled.**
- `slider.tsx` — a scalar `defaultValue` falls through to `[min, max]`, rendering **two thumbs**
  on a single-value slider. Pass an array even for one thumb.
- `toggle-group.tsx` — `data-[state=on]:bg-muted` never fires (Base UI emits
  `aria-pressed`/`data-pressed`). **This one is redundant, NOT load-bearing** — do not "fix" it.
  The shared base in `toggle.tsx:9` carries `aria-pressed:bg-muted`, which Base UI does trigger and
  which `ToggleGroupItem` composes, so pressed segments tint correctly in both variants. Standalone
  `Toggle` also takes a real `disabled` attribute, unlike `RadioGroupItem`/`Checkbox` below.
- `button-group.tsx` — the whole `has-[>[data-variant=outline]]:…` border-harmonising family is
  inert because `Button` never sets `data-variant`; and `has-[select[aria-hidden=true]]` targets a
  `<select>` that Base UI's `Select.Root` renders as an `<input>`. Two adjacent tinted controls
  therefore show an invisible seam — use an explicit `ButtonGroupSeparator`.

Also: `checkbox.tsx`'s `disabled:opacity-50` can't match for the same reason (Base UI renders
`<span role="checkbox">`); the working recipe is a `Field` wrapper, whose `group/field` lets
`group-has-disabled/field:opacity-50` fire off the hidden input. `Switch` is unaffected — it
already uses `data-disabled:*`.

### API facts that contradict the generic shadcn guidance

- **`Avatar` HAS a `size` prop** (`"default" | "sm" | "lg"`) and it is load-bearing: `AvatarBadge`
  and `AvatarGroupCount` size themselves off `group-data-[size=…]`, so a `className="size-*"`
  override yields a right-sized avatar with a wrong-sized badge. (The generic shadcn rule "Avatar
  has no size prop" is FALSE for base-rhea. `docs/components/Avatar.md` has been corrected.)
- **`Textarea`'s `rows` is a no-op** — `field-sizing-content` drives height from `min-h-16`.
  Override the floor instead. (`docs/components/Textarea.md` corrected.)
- **`Select` root needs `items`** — Base UI only mounts `SelectItem` while open, so a closed
  `SelectValue` renders the raw value without it.
- **`ToggleGroup`'s `spacing` defaults to `2` — detached chips.** Pass `spacing={0}` for a joined
  segmented control; the shared-border and rounded-outer-cap rules are all gated on
  `data-[spacing=0]`. Same class of trap as the `Slider` array-`defaultValue` one above.
- **`--destructive-foreground` does not exist** — never pair it with `bg-destructive`.
- `Badge` icon padding is opt-in via `data-icon="inline-start"` on the *icon*, not the badge.
- `InputOTP`'s `aria-invalid` belongs on the **slots**; the real `<input>` is a sibling of
  `InputOTPGroup`, so a root-level `aria-invalid` never reaches the group's `has-` ring.
- The generated `<Name>.d.ts` files are frequently prop-less stubs (`{[key: string]: unknown}`).
  **The component source is the only authoritative props reference.** See the `dtsPropsFor` note
  under Re-sync risks.

### Not statically renderable (documented, deliberately not shipped as cells)

- **Focus rings** — capture screenshots an unfocused page and `:focus-visible` won't match
  programmatic focus. This matters because the focus ring is how the DS identifies a form field.
- **`Progress` indeterminate** (`value={null}`) — Base UI's indicator emits no width, making it
  pixel-identical to `value={0}`.
- **`Checkbox` indeterminate** — the indicator renders `CheckIcon` unconditionally, so it is
  identical to `checked`.
- **`Select` open state** — the popup portals to `document.body`, escaping the card transform,
  and `alignItemWithTrigger` pushes it off the top of the shot. Needs a `cardMode`/`viewport`
  override to card properly; wave 1 shipped a closed-trigger cell instead.
- **`ScrollArea` horizontal scrollbar** — the root renders `{children}` inside `Viewport` with a
  vertical-only `<ScrollBar />` sibling, so a horizontal bar passed as a child scrolls with the
  content. Its scrollbar is also a 10px overlay reserving no space — inner content needs its own
  right padding or a right-aligned column gets clipped.

### Grid overrides applied (`cfg.overrides`)

`Progress` → `{cardMode: "single", primaryStory: "ResponseRateByLocation"}` (content positioned
outside its cell); `Pagination` and `Tabs` → `{cardMode: "column"}` (stories wider than a grid
cell). Note `Pagination` only fits because item counts are capped — more than ~6 items between
Previous and Next overflows again.

### How to read the sheets when grading

- **Grade dense cells from `_screenshots/review/raw/<group>__<Name>__<Cell>.png`, not the
  composite.** Composite sheets are downscaled hard when read (a 1000×3257 sheet arrives ~614px
  wide, ~0.61×), which invents defects that are not there. A `needs-work` minted off a downscaled
  composite triggers a rebuild/re-capture cycle that fixes nothing.
- **`grep @font-face ds-bundle/_ds_bundle.css` returning 0 is CORRECT and not a fonts problem.**
  The `@font-face` rules live in `ds-bundle/fonts/fonts.css` next to the woff2 files;
  `ds-bundle/styles.css` is the real entry and imports both it and `_ds_bundle.css`. To check
  fonts, grep for a literal family in the compiled CSS (or just run `check-css.mjs`).

### A thrown render produces a SILENTLY BLANK cell — not a `⚠`

The single most dangerous finding of the second wave. `DropdownMenuLabel` / `ContextMenuLabel` /
`MenubarLabel` are Base UI `Menu.GroupLabel` and **throw** (`MenuGroupContext is missing`) unless
nested in a `…MenuGroup`/`…MenuRadioGroup` — which the canonical shadcn shape (label as a direct
child of `…MenuContent`) does not do. It hit 3 of 5 components in one batch. The cells rendered
pure white with **no ⚠ marker, no red line, `pageErrs: []`, and capture reporting "0 errors"** —
the harness's try/catch misses commit-phase throws. Grading from the sheet alone would have
shipped three dead cells.

**Rule: a blank cell is a thrown error until proven otherwise.** Find it by loading
`?story=<Cell>` with a `pageerror` listener attached, not by staring at the sheet.

Related: three components (`Bubble`, `Attachment`, `Marker`) originally shipped blank floor cards
for one shared reason — **the styled surface is a subpart, the root is an unstyled wrapper**.
`Bubble`'s variants all target `*:data-[slot=bubble-content]`, `Attachment`'s padding is entirely
`has-data-[slot=…]:` conditional, and `Marker` is a full-width flex row 16px tall when empty.

### Library-version and composition traps (second wave)

- **`ResizablePanelGroup` wraps react-resizable-panels v4** — the prop is `orientation`, **not
  `direction`** (v4 has no `direction`; it is silently spread onto the div and the group stays
  horizontal). A numeric `defaultSize` means **pixels**; percentages must be strings (`"40"`).
  `ResizablePanel`'s `className` lands on a nested inner div. `resizable.tsx`'s
  `aria-[orientation=vertical]:flex-col` is another dead selector — v4's group sets `flexDirection`
  inline and no `aria-orientation`. (The handle's `aria-[orientation=horizontal]:*` DO work.)
- **`Sidebar` must use `collapsible="none"` inside a card.** The offcanvas/icon branches render in
  `fixed inset-y-0 h-svh` behind a `hidden md:block` gate and fall through to a closed mobile
  `Sheet` below 768px, so they escape, over-size, or vanish. `SidebarProvider`'s `min-h-svh` and
  `w-full` both need overriding. The collapsed icon rail is **not statically renderable**.
  `SidebarMenuBadge`/`SidebarMenuAction` are absolute siblings *after* the button, not children.
- **Base UI's `Accordion` has no `openMultiple`/`type="single"`** — the value is an array, so
  `defaultValue={["a","b"]}` opens two. `animate-accordion-down/up` emit **no CSS** (nothing
  defines `--animate-accordion-*`); harmless. **`Collapsible` ships completely unstyled** — the
  consumer supplies the whole shell.
- **`Carousel`**: `opts={{loop:true}}` rotates the last slide into first position on first paint,
  which reads as scrambled data — avoid in previews. Arrows need `mx-12` on the root, not `px-12`.
- **recharts is double-bundled.** `chart.tsx`'s namespace import is tree-shaken to only
  `ResponsiveContainer`/`Tooltip`/`Legend`, so `BarChart` and friends are NOT on
  `window.NabaReview` and a preview bundles its own recharts. Consequences: never use the DS's
  `ChartTooltip`/`ChartLegend` inside a preview chart (wrong store context — import `Tooltip`/
  `Legend` from recharts; `ChartTooltipContent`/`ChartLegendContent` are safe), **always pass
  explicit `width`/`height`** (ResponsiveContainer's size context does not cross the boundary, and
  an unsized chart renders nothing), and set **`isAnimationActive={false}`** — otherwise capture
  catches recharts' 1500ms reveal mid-flight and the chart looks broken.
- **`Toast`**: skip `ToastPortal`/`Toaster` in previews so `ToastViewport`'s `fixed` resolves
  against the card's own box. `createToastManager()` + `timeout={0}` gives a stable resting state.
- **`Combobox`**: items must go through `ComboboxCollection`, or the empty state renders items
  *and* the "no match" message stacked.
- **`ContextMenu` cannot be anchored statically** — the root seeds a 0×0 `DOMRect` at (0,0) and
  only replaces it from a real `contextmenu` event, and `ContextMenuContent` hard-codes its
  `Positioner`, so `anchor` is unreachable. The preview uses `sideOffset`/`alignOffset` against
  that zero-rect origin as a stand-in click point (flagged in-file — do not copy those numbers).
- **`DirectionProvider` renders no DOM** and must be paired with `dir` on a real element.
  Bidi trap: a trailing full stop on Latin text inside `dir="rtl"` is reordered to the far edge and
  reads as a rendering fault.
- **`MessageScrollerButton` is never unmounted** — it is `data-active="false"` + `opacity-0`, and
  the provider defaults to `defaultScrollPosition="end"`, so it is invisible by default. Use
  `defaultScrollPosition="start"` to photograph it.
- **`AlertDialogAction` is a plain `Button`, not a Close** — it does not dismiss. Only
  `AlertDialogCancel` is. **`DialogPortal` is exported but useless for retargeting**: `DialogContent`
  renders its own portal and forwards no props, so there is no `container` escape hatch.

### More dead selectors and DS-level issues found in wave 2

Pre-existing, cosmetic, **not** sync artifacts — listed so nobody re-derives them:

- `NavigationMenuLink`'s `active` is visually dead: Base UI writes `data-active=""` but the DS
  selector is `data-[active=true]`. **There is no current-page affordance.**
- `NavigationMenuIndicator` is broken — it wraps Base UI's `NavigationMenu.Icon` (a Trigger caret
  slot that throws outside an Item), not a Radix-style arrow. Do not use it.
- `DrawerHeader`'s `md:text-left` is inert — `group-data-[swipe-axis=y]/drawer-popup:text-center`
  wins on specificity (0,2,0 vs 0,1,0), so top/bottom drawer headers are centred at every width.
- `ButtonGroup` (horizontal) is **RTL-broken**: the outer left edge loses its border, both outer
  corners square off, a rounded bump lands on an internal seam, and one seam doubles to 2px.
  Vertical is fine.
- **`variant="destructive"` is neutralised inside every menu popup** by
  `**:data-[variant=destructive]:text-accent-foreground!`, so destructive menu items look identical
  to normal ones. Worth an owner's decision.
- `ComboboxContent` hard-codes `dark`, leaving `ComboboxEmpty`/`ComboboxLabel` faint in light mode.

### Correction to an earlier note: focus rings ARE renderable in overlays

The wave-1 note said focus rings cannot be captured. That holds for a plain page, but **inside
these overlays Base UI focuses the first control on open**, so the ring does render. A bare
`<button>` picks up Chrome's default outline; `Button variant="ghost"` with layout overrides gives
the DS ring instead.

### Grading gotcha that nearly froze bad verdicts

`cssEntry`/`extraFonts` sit in the converter's **styling trust class**: `renderHashFor` does not
hash `_ds_bundle.css`, so a stylesheet fix does NOT invalidate grades, and capture skips
fully-graded components ("carried forward"). A `good` verdict minted against a broken stylesheet
would therefore persist forever. After ANY global styling fix, re-capture with `--force` and
re-grade. Wave 1's 33 components were force-re-captured for exactly this reason.

## Re-sync risks — what can silently go stale

- **The self-link and `.ds-sync/` are both gitignored.** A fresh clone has neither. Recreate
  the link, re-copy the staged scripts, and reinstall converter deps before building.
- **Fonts depend on `.next` existing.** `prepare-fonts.mjs` fails loudly if no shippable
  `Geist`/`Geist Mono` face is found, so this cannot regress silently — but it does mean a
  re-sync must run the app build first. `buildCmd` covers it.
- **`componentSrcMap` is an explicit 338-entry list.** Adding a component to
  `components/ui/` will NOT surface it until it is pinned there, and its subparts will
  appear as their own cards until they are set to `null`. Regenerate the map rather than
  editing by hand.
- **`docs/components/*.md` Parts lists are generated.** They will drift if a component's
  exports change and nobody regenerates.
- **The app is being developed in parallel.** `components/naba-review/` and the
  `/design-system` route are app code, correctly outside `srcDir`. If the DS ever moves out
  of `components/ui/`, `srcDir` and the whole `componentSrcMap` need regenerating.
- **`--font-sans` in `app/globals.css`** is a self-reference that works only because
  `app/layout.tsx` names Geist's variable `--font-sans` on `<html>`. If that variable is
  ever renamed, the app breaks (the bundle will not, since it declares literals).
- **The `@theme` block in `ds-tailwind.css` can be killed by a malformed comment** and Tailwind
  will only WARN while exiting 0. This actually happened: a stray close-comment marker left the
  block parsed as part of a selector, every card silently rendered in browser-default serif, and
  `[FONT_MISSING]` did NOT fire (with the block dead, nothing referenced the families, so nothing
  was reported missing). `check-css.mjs` now runs at the end of `buildCmd` and fails the build on
  a missing literal family, a self-referential `--font-*`, or a missing `--primary`. Do not remove
  it from `buildCmd`, and never trust "the FONT warning went away" as evidence the fonts work —
  check for a literal family in the compiled CSS.
- **`dtsPropsFor` is unset and several components emit prop-less `.d.ts` stubs**
  (`{[key: string]: unknown}`), which is what the design agent reads as the API contract. Worth
  filling in for the high-traffic components on a future sync; the props exist in the source.
