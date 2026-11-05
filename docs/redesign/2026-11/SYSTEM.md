# NabaPresence redesign 2026-11: shared design-system specification

Status: **proposal for owner review** (phase B, `b-direction`). This is the
implementable companion of [`DIRECTION.md`](./DIRECTION.md). A later worker
implements it. This phase changed no application code or tokens.

**How to read each item:**
- **Verdict:** **Keep** (no change), **Change** (edit an existing token or
  component) or **New** (add).
- **Maps to:** the exact token(s) in `app/globals.css` and the component
  file(s).
- **Migration:** what the implementer does, and which tests or gates move.

Contrast figures are WCAG 2.x ratios from the oklch values in
`app/globals.css`. "Gated" means the pair is in `lib/design/contrast-pairs.ts`
(run by `pnpm check:contrast` and `tests/design-tokens-contrast.test.ts`).
Pairs marked **add pair** must be added to that manifest in the same PR.

---

## 0. Gates: what this spec touches and how to update them honestly

| Gate | What it enforces (today) | Affected by | Honest update |
|---|---|---|---|
| `pnpm check:design --ratchet` (`scripts/check-design.mjs`, baseline `scripts/design-baseline.json`: R1 12, R2 9, R3 53, R4 12, R5 1, R6 2, R7 14) | R1 no arbitrary type; R2 no literal colour; R3 no arbitrary spacing/size; R4 no arbitrary radius/shadow/z; R5 no raw primitives outside `components/ui`; R6 no inline style; R7 no literal breakpoints | Nav/rail rewrite (removes `min-h-[34px]`, `min-h-[30px]`, `w-[3px]`, `inset-y-[7px]` in `nav.tsx`, R3 −4); segmented control radii (`rounded-[7px]` ×2 at `:80`, `:94`, `rounded-[10px]` at `:117` → tokens, R4 −3); `/design-system` type literals (`text-[11.5px]` ×2, `text-[11px]` ×3, R1 −5); the other literal radii under the new ladder: `checkbox.tsx:74` `rounded-[5px]` → `rounded-sm` (4) and `chart.tsx:57` `rounded-[3px]` (legend swatch) → `rounded-sm` (R4 −2); new `send` variant and dispatch bar (must use tokens only) | **Counts may only fall.** After each wave run `pnpm check:design --update-baseline` *only* to lock in reductions; never to accept a rise. New components must add 0 findings. Do not add `design-exempt` comments for new code. Fix stale rule text in the same PR: R1 "nine roles" → ten (add `figure`, `count`); R4 "z-index waits for the shared scale" → "use `z-*` utilities"; R7 "768 / 1180 split" → "md / wide". |
| `pnpm check:contrast` (`scripts/check-contrast.mjs` + `lib/design/contrast-pairs.ts`, 222/222 pass) | text 4.5, large 3, graphic 3, both themes; light/dark parity of every `--np-*`; no `color-mix()`; in-gamut | New `--np-*-on-charcoal` roles; `--primary` re-aliased to ink; table-header-bg flattened; chart categorical order | **Add the pairs listed in §2.2–§2.3 and §9.1 before changing tokens.** Keep every existing pair; the `--np-ink-faint` graphic pairs (`contrast-pairs.ts:175-187`) go only together with the token (§2.1). **Parity check:** the new geometry tokens (`--np-edge-current`, `--np-dispatch-pad-*`, `--np-changes-panel-w`, `--np-settings-nav-w`) match none of the `themeIndependent` prefixes (`contrast-pairs.ts:751-760`), so the implementer extends that regex with exactly `edge-current|dispatch-pad|changes-panel|settings-nav`. The reviewer confirms that no colour role matches the new prefixes. Remove the duplicated `accent-active` pair (listed twice, `contrast-pairs.ts:352-363`) as a cleanup, not a relaxation. New roles need dark values (the parity check) and must not be added to the `themeIndependent` regex to dodge it. |
| `tests/design-system-contract.test.ts` | Token names exist (`:62-134` list incl. `--np-radius-card`, `--np-radius-control`, `--np-table-header-bg`, `--np-chart-6`, `--np-accent-tint`); `--primary` alias mapping (`:180-181`); type roles (`:269-270`); mono self-hosted (`:347`); primitives read radius tokens (`:371-372`); dark/no-script twins identical | Radius values, `--primary` alias, table header, retired and renamed tokens | Radius, table-header and chart token **names** stay; only values change. Exact edits: (1) drop `--np-ink-faint` (`:53`) and `--np-line-focus` (`:58`) from `SEMANTIC_ROLES` in the same commit that deletes them; (2) the ease rename (§13) rewrites `:88-89` and `:216-219` to the new names; (3) `:177-194` only checks `--primary` matches `/^var\(--np-/`, which guards nothing, so **add** positive assertions `--primary: var(--np-ink)`, `--send: var(--np-accent)` and `--send-foreground: var(--np-ink-on-accent)`. Keep every other assertion. |
| Component tests pinning classes | e.g. `tests/components/nm-filter-chip.test.tsx:289-290` (tab current `font-semibold`, `after:bg-ink`, unchanged); `nm-drop4.test.tsx:151,294` (`bg-accent-tint` on the accent tag and selection tile, kept) | Nav current style; selected row | Update only assertions about nav-current and selected-row classes; add new assertions for the neutral grammar. |
| Label pins | 49 assertions in 17 files mention "Live on Google" (`git grep -c` on tests): `tests/components/{action-bar,listing-change-requests,operation-outcome,photos-flows,posts-action-bar,profile-editor,publish-flow,review-detail,review-list,review-publish-ux,review-publish}.test.tsx`, `tests/e2e/{accessibility,operations-features}.spec.ts`, `tests/lib/{inbox-actions,reply-state,review-situation}.test.ts`, and `tests/operation-outcome-states.test.ts`. Agentic journeys check headings | Vocabulary §DIRECTION 6 (decision D6) | Change labels in `lib/editors/outcome.ts` once and update the tests in the same commit. List every renamed accessible name in the PR body (capture states and agentic tests rely on names, see QA-HARNESS "Known caveats"). |
| `tests/breakpoints.test.ts` | CSS breakpoints match `lib/ui/breakpoints.ts` | Nothing; no breakpoint values change (§13) | none |

---

## 1. Foundations kept as is

Four token layers (ramps → semantic `--np-*` → component → shadcn aliases),
no literal colour below layer 1, and the `desk` / `controls` / `capsules` /
`short` / `tall` / `float-bar` / `drawn-disabled` / `hover-fine` /
`keyboard-open` variants (`app/globals.css:14-105`): **Keep.**
Identity vocabulary comment (`:107-137`): **Change** wording (ONE ACCENT →
"green sends"; DARK BAR → "dispatch bar").

---

## 2. Colour and semantic status roles

### 2.1 Surfaces, ink and lines

| Role | Light | Dark | Verdict | Maps to | Migration |
|---|---|---|---|---|---|
| canvas / surface / surface-alt / raised / sunken / overlay | neutral-50 / 0 / 100 / 0 / 100 / 0 | 0.18 / 0.22 / 0.20 / 0.24 / 0.20 / 0.24 (hue 240) | Keep | `--np-surface-*` `:457-462`, `:846-851` | — |
| ink / ink-secondary / ink-muted | neutral-900 / 600 / 500 | 0.95 / 0.85 / 0.72 | Keep | `--np-ink*` `:474-479` | — |
| ink-faint | = ink-muted | = ink-muted | **Change: retire** as a separate step (it equals ink-muted in both themes) | `--np-ink-faint` `:477`, `:860`; utility `text-ink-faint` | Alias it to ink-muted for one release, codemod `text-ink-faint` → `text-ink-muted`, then delete it and its *graphic* pair |
| fill / fill-secondary / fill-tertiary | neutral-150 / 100 / 50 | 0.28 / 0.25 / 0.21 | Keep; **fill is now also "current place"** | `--np-fill*` `:482-484` | ink on fill: 14.42 light / 12.60 dark (gated `ink`/fill) |
| line-subtle / line / line-strong | neutral-150 / 200 / 400 | 0.27 / 0.32 / 0.56 | Keep | `:488-490` | line-strong 3:1 graphic is gated |
| line-focus, field-ring, field-ring-invalid | — | — | **Change: delete** (unused; taste Wave 0) | `:491`, `:563-564`, `:925-926` | Remove from both theme blocks and the no-script twin |

### 2.2 Accent, primary and send

| Role | Light | Dark | Verdict | Maps to | Migration |
|---|---|---|---|---|---|
| `--np-accent` (green, the **send** colour) | accent-500 `oklch(0.45 0.105 150)` | `oklch(0.74 0.14 150)` | Keep value; **narrow use** to send-actions, focus ring, brand mark | `:493`, `:873` | — |
| `--primary` (shadcn alias → `bg-primary`) | `var(--np-accent)` | same | **Change → `var(--np-ink)`**, `--primary-foreground → var(--np-ink-inverse)` | `:799-800` | white on ink 17.28:1; dark ink-inverse on ink 16.25:1 (gated pair `ink-inverse`/ink). About 21 `bg-primary` and 14 `text-primary` call sites: audit each. The skip link and `--sidebar-primary` move to ink; any "send" use moves to `bg-send`. **Selection controls follow:** `switch.tsx:23` (`data-checked:bg-primary`), `checkbox.tsx:79`, `radio-group.tsx:38` and `progress.tsx` turn ink. Keep that: it is a control state, not a Google action. Ink on surface is 17.28:1, above the 3:1 graphic floor. |
| **`--np-ink-hover` / `--np-ink-active`** | neutral-600 `oklch(0.36 0.02 240)` / neutral-950 `oklch(0.18 0.012 240)` | `oklch(0.85 0.01 240)` / `oklch(0.98 0.004 250)` | **New** hover and pressed fills for the ink `default` button. Today the variant hard-codes `hover-fine:hover:bg-accent-hover`, `aria-expanded:bg-accent-hover` and `active:bg-(--np-accent-active)` (`components/ui/button.tsx:82-83`); those classes move to `send`. | globals.css layer 2 + utilities `bg-ink-hover`, `bg-ink-active` | **add pair** ink-inverse on each: light 10.82 / 18.79, dark 11.90 / 17.74 |
| `--send` / `--color-send`, `--send-foreground` | `var(--np-accent)` / `var(--np-ink-on-accent)` | same | **New** alias layer for the send variant | `globals.css` aliases + `@theme inline` | white on accent 7.08:1 (gated `ink-on-accent`/accent, hover, active) |
| `--np-accent-tint`, `--np-selection-bg` | accent-100 | 0.3 0.05 150 | **Change use:** no longer the nav-current or selected-row fill. Kept for `ListRowTag tone="accent"`, `::selection` (strong) and the SelectionBar accent tile (pinned by `nm-drop4.test.tsx`) | `:497`, `:543` | `--np-selection-bg` → `var(--np-fill)`; ListRow `selected` draws fill + `shadow-np-edge-select` (new, §7.3) |

### 2.3 Status roles (who acts next)

The existing four status families stay. They are the only hues allowed for
state.

| Tone (DIRECTION §6) | Ink | Tint | Solid (dots, glyph fills) | Verdict | Contrast (gated) |
|---|---|---|---|---|---|
| neutral: nobody | `--np-ink-secondary` | `--np-fill` | `--np-ink-muted` | Keep (`lib/ui/status-tone.ts` `neutral`) | ink-secondary/fill 9.03 light / 9.22 dark: **add pair** (not gated today) |
| amber: a person | `--np-warning-ink` 0.46 0.1 65 | `--np-warning-tint` | `--np-warning-solid` | Keep values; **one tone for every `awaiting_approval`** | ink/tint 6.61 light / 8.30 dark (gated) |
| blue: Google or system | `--np-info-ink` | `--np-info-tint` | `--np-info-solid` | Keep | ink/tint 6.36 / 7.33 (gated) |
| green: confirmed on Google | `--np-success-ink` | `--np-success-tint` | `--np-success-solid` | Keep; **only for `live`** (not KPI deltas, not "can publish", not "in sync" dots: those are ink or neutral) | ink/tint 6.84 / 7.76 (gated) |
| red: broken | `--np-danger-ink` | `--np-danger-tint` | `--np-danger-solid` | Keep | ink/tint 6.09 / 7.19 (gated) |

**Status ink on the new selected-row fill.** The selected row moves from accent-tint to `--np-fill` (§10). So **add pairs** `{success,warning,danger,info}-ink` on `--np-fill`: light 6.43 / 6.11 / 5.70 / 5.95, dark 8.15 / 9.12 / 7.49 / 7.84. Keep the existing accent-tint pairs (`contrast-pairs.ts:401-436`) while the accent tag and selection tile still use accent-tint. All figures come from `lib/design/contrast.ts`; paste the gate's own output into the PR.

**New: status ink on the dispatch bar** (status glyphs on charcoal; today the
bar shows only neutral ink):

| Token | Light (charcoal `oklch(0.24 0.02 240)`) | Dark (charcoal `oklch(0.30 0.016 240)`) | Kind | Ratio light / dark |
|---|---|---|---|---|
| `--np-success-on-charcoal` | `oklch(0.80 0.12 150)` | same | graphic + text | 9.19 / 7.62 |
| `--np-warning-on-charcoal` | `oklch(0.85 0.12 80)` | same | graphic + text | 10.28 / 8.52 |
| `--np-danger-on-charcoal` | `oklch(0.80 0.10 25)` | same | graphic + text | 8.45 / 7.00 |
| `--np-info-on-charcoal` | `oklch(0.80 0.09 250)` | same | graphic + text | 8.84 / 7.32 |
| `--np-disabled-on-charcoal-bg` / `-ink` | `oklch(0.32 0.016 240)` / `var(--np-ink-muted-on-charcoal)` | `oklch(0.36 0.016 240)` / `var(--np-ink-muted-on-charcoal)` | text | 6.33 / 5.81 (replaces `opacity: 0.45`, `globals.css:1502-1504`) |

**add pair** ×4 (`text` kind, which also covers graphic) in both themes. The
dark values may reference the dark status inks (`--np-*-ink` in `.dark` have
the same L), which satisfies parity without a literal.

**The send button on charcoal:** the light-theme green fill against the
charcoal bar is 2.31:1. The button is identified by its label (white on green
7.08:1, gated), and WCAG 1.4.11 does not require a text button's fill to
contrast with its surround. **Do not add a failing pair or relax the
threshold.** If the owner wants the edge itself to read, add a 1px
`--np-ink-on-charcoal` inner ring at rest. Dark theme: 6.22:1, fine.

### 2.4 Data and tags

| Role | Verdict | Maps to | Migration |
|---|---|---|---|
| Categorical chart order | **Change:** `chart-1` green (the main data element), `chart-4` blue, `chart-5` amber. `chart-6` red is **removed from categorical use** (red is status-reserved, and next to amber ΔE is 12.7, below the normal-vision floor of 15, per the dataviz validator). Validated light: green/blue/amber pass all checks (worst adjacent ΔE 19.6). | `--np-chart-*` `:580-585`, `:936-941`; `components/ui/chart.tsx` | Keep the `--np-chart-6` token (contract test `:70` pins the name) but stop using it as a series; document it as "danger series only for error-rate charts". |
| `chart-3` grey | **Keep** as a *context* series ("Reviews received" behind "Replied on Google"). It fails the categorical chroma floor by design: it is not a categorical hue. | `:582` | Charts with ≥2 identity series never use chart-3 as an identity. |
| Dark chart steps | **Change (minor):** the validator puts the dark L 0.72–0.76 steps just above its lightness band (0.70 max). Proposal: dark chart-1 0.70, chart-4 0.68, chart-5 0.72 | `:936-941` | Re-run `check:contrast` (graphic 3:1 vs dark surface still clears) |
| `--np-rating` | Keep (stars only) | `:589`, `:944` | — |
| Tags (neutral/blue/pink/purple) | Keep; never status | `:534-541` | — |
| Client avatar colours (`lib/clients/colours.ts:11-16`, R2 ×6) | **Change:** move the six hex values into a ramp `--np-ramp-client-1..6` + roles `--np-client-1..6-bg` (the existing hex values, same in both themes, which the parity check accepts via `var()` to the ramp) and `--np-client-ink` (`#FFFFFF` / `#1A1714` chosen per bg as `components/clients/client-avatar.tsx:32-33` does today) | globals.css layer 1/2; `client-avatar.tsx` | R2 baseline −6 (−8 with the avatar inks); **add pair** client-ink on each client-bg (text) |

---

## 3. Typography and the responsive type scale

**Keep** the one system sans (`--font-sans`, `:147-149`), D1 (display, heading
and reading → sans), and JetBrains Mono self-hosted (`app/layout.tsx:21-30`).
Every role below maps to `--text-<role>` in `@theme inline` (`app/globals.css:162-197`), with
touch values in `:root` (`:646-666`) and desk values in the `desk` block (`:1100-1116`). No value changes.

| Role (utility) | Touch (default) | Desk (`desk`) | Verdict | Use |
|---|---|---|---|---|
| `text-caption` | 13/18 | 12/16 | Keep | meta, labels, table heads |
| `text-count` | 13/16 | 12/16 | Keep | badges, counts (now **sans tabular**) |
| `text-ui` | 15/20 | 13/20 | Keep | controls, nav, tabs |
| `text-body` | 16/24 | 14/22 | Keep | running text |
| `text-title` | 17/24 | 16/24 | Keep | card titles, sheet titles, empty titles |
| `text-section` | 20/26 | 18/26 | Keep | h2 |
| `text-page-title` | 26 / 1.18 | clamp(22, 1.1vw+15, 28) | Keep | h1, once per page |
| `text-display` | 32 | clamp(28–36) | Keep (rare) | sign-in, 404 |
| `text-figure` | 24/32 | 22/28 | Keep | KPI values |
| `text-reading` | 17/28, measure 72ch | 17/28 | Keep | the customer's words and reply drafts |

| Item | Verdict | Maps to | Migration |
|---|---|---|---|
| Mono scope | **Change:** mono only for IDs, codes and error references | `components/app-shell/count-badge.tsx:35` (`font-mono` → `tabular-nums`), `components/ui/table.tsx:352-356` (numeric cells → sans `tabular-nums`), account role chip (`account-menu.tsx`, `font-mono uppercase` → sans sentence case) | Component tests on CountBadge class strings; the visual ratchet is unaffected |
| `/design-system` stale labels (`text-[11.5px]` ×2, `text-[11px]` ×3, desk-only numbers) | **Change** | `app/design-system/page.tsx:277-326, 510, 657` | R1 −5 |
| Brand mark serif N (`text-[17px]`) | **Change** to sans 700 on the accent square (§DIRECTION shell) | `components/app-shell/brand-mark.tsx:9-29` | R1 −2 |
| Weight ladder | **Keep** 400 / 500 (labels, inactive nav) / 600 (titles, current nav, pills) / 700 (h1, figures on phone) | — | No `font-bold` on body copy |

---

## 4. Spacing scale

| Token | Value | Verdict | Notes |
|---|---|---|---|
| Base | 4px (Tailwind spacing) | Keep | `gap-1..12` |
| `--np-gap-card` / `--np-gap-section` | 16 / 24 | Keep | `:687-688` |
| `--np-card-pad` | 16 touch / 20 desk | Keep | `:689`, `:1117` |
| `--np-page-pad-x` / `-y` | clamp(16, 2.4vw, 32) / clamp(16, 2vw, 28) | Keep | `:682-683` |
| `--np-panel-pad`, `--np-list-gap` | — | **Change: delete** (no consumer outside globals.css) | Delete every definition: `--np-panel-pad` at `:690`, `:1118`; `--np-list-gap` at `:742`, `:1132`, `:1144` |
| Dispatch bar padding | 12 / 16, docked 12 16 10 | **New** `--np-dispatch-pad-y: 12px`, `--np-dispatch-pad-x: 16px` | `components/ui/action-bar.tsx` |

---

## 5. Content widths and page frames

| Width | Value | Verdict | Used by |
|---|---|---|---|
| `narrow` | 760 | Keep | sign-in, single forms, invite |
| `default` / `standard` | 1080 | Keep | Team, Settings content, listing editors |
| `wide` | 1440 | Keep | Reports, Listings board |
| `workspace` | full, panes scroll | Keep | Inbox, Calendar |
| `--np-measure-reading` | 72ch | Keep | review text, drafts |
| `--np-form-rail-w` | 12.5rem | Keep | profile section nav |
| **`--np-changes-panel-w`** | **340px** | **New** | listing editor Changes panel from `wide` (`components/editors/editor-frame.tsx`) |
| **`--np-settings-nav-w`** | **230px** | **New** | settings two-pane from md (`components/settings/settings-nav.tsx`) |

`PageFrame` (`components/app-shell/page-frame.tsx:18-58`): Keep the API.
Replace the hand-written `md:[@media(min-height:620px)]` with the `tall`
variant (R7 −1, plus inbox-view −6).

---

## 6. Density modes

| Mode | Where | Verdict | Tokens |
|---|---|---|---|
| Touch (default) | everything without a fine pointer, or < 48rem | Keep | 44 controls, 52 rows, 56 settings rows |
| Comfortable desk | `desk` | Keep | 36 controls, 44 rows, 44 settings rows (`:1125-1136`) |
| Compact | `[data-density="compact"]` under `desk` only: Inbox list, DataTable, Outbox list | Keep; **add Outbox** | 30 controls, 36 rows (`:1140-1149`); never under 24px targets |
| User toggle | — | Keep retired | (agency A8) |

---

## 7. Borders, radii, elevation

### 7.1 Borders
Keep 1px `--np-line` for cards and dividers, `--np-line-strong` for control
edges (3:1), `--np-line-subtle` for row dividers. **New:** `--np-edge-current:
3px` (selected row, edited field row, changed row in diffs), drawn in ink as
an inset shadow, not a border, so layout never moves.

### 7.2 Radii (decision D3)

| Token | Today | **New** | Utility | Users |
|---|---|---|---|---|
| `--np-radius-tag` | 6 | **4** | `rounded-sm` | role chips, keycaps, small tags |
| `--np-radius-control` | 8 | **6** | `rounded-md` | buttons, inputs, nav rows, segmented thumb |
| `--np-radius-field` | 8 | **6** | — | fields |
| `--np-radius-card` | 12 | **8** | `rounded-lg` | cards, KPI strip, dispatch bar, skeleton list |
| `--np-radius-panel` | 12 | **8** | `rounded-xl` | panels |
| `--np-radius-menu` | 14 | **10** | `rounded-menu` | menus, popovers |
| `--np-radius-toast` | 12 | **10** | `rounded-toast` | toasts |
| `--np-radius-modal` | 16 | **12** | `rounded-2xl` | dialogs, side panels (leading corners) |
| `--np-radius-sheet` | 20 | **16** | `rounded-3xl` | bottom sheets |
| `--np-radius-sheet-inset` | 28 | **24** | `rounded-sheet-inset` | inset sheets (8px inset → concentric with device corners) |
| `--np-radius-pill` | 999 | 999 | `rounded-pill` | chips, status pills, scope chip |
| **`--np-radius-track`** / **`--np-radius-thumb`** | literal 10 / 7 | **8 / 6** | — | segmented control (`components/ui/segmented-control.tsx:80,115`) |

Migration: one token block (`:592-604`) + two literals (R4 −2). Status pills
move from `rounded-(--np-radius-tag)` to `rounded-pill` (DIRECTION concepts).

### 7.3 Elevation

| Token | Verdict | Use |
|---|---|---|
| `--np-shadow-hairline`, `-raised`, `-pop`, `-modal`, `-sheet`, `-float` | Keep values | cards have **no** shadow; float = menus and popovers (as today); pop = toasts and the dispatch bar when floating; modal = dialogs and panels |
| Menus: border **and** shadow | **Change:** keep `shadow-np-float`, drop the `border border-line` (`menu-surface.tsx:39`, `popover.tsx:150`, `dropdown-menu.tsx:55`) | taste overlay fan-out |
| **`--np-shadow-edge-select`** | **New** `inset 3px 0 0 var(--np-ink)` | selected list row, edited form row |

---

## 8. Icons

**Keep** `lucide-react` (^1.27, 189 files), stroke **1.75** at rest and **2–2.25**
for current/selected and status glyphs.

| Context | Size | Verdict |
|---|---|---|
| Inline in buttons, rows, desk nav | 16 (`size-4`) | Keep |
| Rail tiles, phone app bar, More sheet | 20–22 (`size-5`) | Keep |
| Tab bar | 22–24 (`size-6`) | Keep |
| Status glyph in pills | caption + 1 (14) at stroke 2 | **New rule:** each tone family has a distinct glyph shape (DIRECTION §6.1) so state never relies on hue |
| Empty states | 20 line icon, no tinted square | Keep (taste P4); the `illustration` prop is **retired** (used in 7 files) |
| Naming | **Change:** one import style (`XIcon` suffix), as a codemod over the 189 files that import `lucide-react` in `app/`, `components/` and `lib/` | Behaviour-neutral; lint rule optional |

---

## 9. Actions, links, fields, validation, action bars

### 9.1 Buttons (`components/ui/button.tsx`)

| Variant | Verdict | Fill / ink | Use |
|---|---|---|---|
| `default` | **Change** → ink fill (`bg-primary` = ink), `text-primary-foreground`; hover `bg-ink-hover`, press/expanded `bg-ink-active` (§2.2) | 17.28:1 | the one local primary per surface (Save, Invite, Apply, Create) |
| **`send`** | **New** | `bg-send` (accent) / `text-send-foreground`; hover accent-hover; press accent-active (the classes that leave `default`) | only actions that **write** to Google: Publish reply, Approve and publish, Publish N changes, Retry sending, Reconnect and retry. Reads such as *Check Google* and *Check Google now* are secondary (`on-charcoal` inside the bar) |
| `secondary` / `outline` | Keep | surface + line-strong | second actions |
| `ghost` | Keep; replace `bg-ink/6`, `/10` alpha fills with `bg-fill-secondary` / `bg-fill` | — | tertiary, icon buttons |
| `danger`, `danger-outline`, `destructive` | Keep | — | delete, disconnect, revoke |
| `on-dark` / `ghost-dark` | Keep, renamed `on-charcoal` in docs | — | inside the dispatch bar |
| `link` | Keep | accent-ink underline on hover | inline links |
| Disabled | Keep drawn (`--np-disabled-*`). **Fix** the `on-charcoal` utility (`globals.css:1478-1505`): its `[data-variant="default"]` selectors (focus halo, and `:disabled { opacity: 0.45 }` at `:1502-1504`) are retargeted to `[data-variant="send"]`, and disabled `send` on charcoal uses `--np-disabled-on-charcoal-bg/-ink` (§2.3) | — | |
| Pending | Keep `pending` + spinner + `aria-busy`; the label for every send is **"Sending…"** | — | |
| Sizes | Keep `default` (control-h), `sm` (control-h-sm with 44px hit area), `icon*` | — | |

Rule: **one primary per surface.** On a screen with a dispatch bar, the bar's
primary is the only filled button.

### 9.2 Links
Inline links: keep accent-ink (`--np-accent-ink`, gated on canvas/surface/tint)
with an underline on hover-fine and focus. **Change:** back links (app bar
"‹ Parent", top-bar back, `SheetBack`) move from accent-ink to **ink** at
`text-ui` weight 500, because they are chrome (`components/app-shell/app-bar.tsx:47-101`,
`components/ui/sheet.tsx:392-397`).

### 9.3 Fields and validation (`components/ui/field.tsx`, input, textarea, select, combobox, OTP, tag-input, time-field)
Keep pilot P2: 44/36 height, `--np-radius-field` (now 6), `line-strong` edge,
focus halo, invalid = danger edge + danger halo while focused, the error under
the field with an icon, and `ValidationSummary` at the top of long forms
listing N problems with links. **New:** an *edited* field row (a form row
whose value differs from Google) shows `shadow-edge-select` + "Was <Google
value>" caption (`components/locations/hours-editor.tsx`,
`components/locations/profile/sections/*`).

### 9.4 Action bars → dispatch bar and save bar (`components/ui/action-bar.tsx`)

| Bar | Verdict | Tone | Content | Placement |
|---|---|---|---|---|
| **Dispatch bar** | **Change** (rename doc concept; keep component) | `charcoal` | status glyph (`--np-*-on-charcoal`) + state label + one sub-line; secondaries (`on-charcoal`); one `send` primary | docked on phone (above the home indicator, rides the keyboard), sticky at the end of the content column on tablet/desk |
| **Save bar** | **Change** default `tone` → `surface` (taste 1B) | surface + line + pop | dashed glyph + "N unsaved changes" + "saved in NabaPresence only"; ghost Discard; ink Save | same placement |
| Rule | **New** | — | a bar is `charcoal` only when its **subject is a Google-bound change**: its status line carries a lifecycle state, and its primary, if any, is `send` (e.g. *Withdraw* or *View on Google* as `on-charcoal` secondaries are fine). Local-only saves always use the surface bar. A test fails if a `default` (ink) button renders inside `.on-charcoal`, because ink on charcoal is 1.05:1. | `action-bar.tsx`, `tests/components/action-bar.test.tsx` |

Status text is `aria-live="polite"` (kept). A disabled primary always has
`disabledReason` shown as the bar's sub-line (kept rule, `button.tsx:364-404`).

---

## 10. Navigation, tabs, filters, lists, tables, pagination

| Item | Verdict | Spec | Maps to |
|---|---|---|---|
| Current place (sidebar row, rail tile, More row, settings section, scope menu row) | **Change** | `bg-fill` + `text-ink` + `font-semibold` + icon stroke 2 + `aria-current="page"`; no bar, no accent | `components/app-shell/nav.tsx:51-58,101-109`, `more-sheet.tsx:41-46`, `components/settings/settings-nav.tsx` |
| Tab bar current | **Change** | ink icon on a 56×28 `bg-fill` pill + semibold ink label (no accent) | `components/app-shell/tab-bar.tsx:31-37,133` |
| Nav counts | Keep (P3): plain figures on the sidebar, ink `CountBadge` on rail/tab | add: Outbox shows **failures only** in danger ink with a `triangle-alert` glyph | `nav.tsx:116-131` |
| Scope control | **Change** (one per size) | desk: `ScopeButton` in the sidebar (28px client mark, name, health dot + words, chevrons); tablet: pill in the top bar; phone: app-bar chip → *Working on* sheet | `client-switcher.tsx`, `scope-sheet.tsx`, `context-health-chip.tsx` (retire the chip, keep the announcer), `nav.tsx` (remove pinned clients) |
| Tabs (`TabNav`, line) | Keep | ink 2px underline, `focus-ring-inset`, overflow → "More" on desk, scroll on touch | `components/ui/tabs.tsx` |
| Listing area tabs | **Change** | max 6 + More; count badge (ink) on edited areas; remove the *Review & publish* tab from the strip (route kept) | `components/listings/area-frame.tsx:154-233`, `lib/listings/area-nav.ts` |
| Segmented control | Keep, radii tokenised; disabled drawn (not `opacity-50`) | track `--np-radius-track` 8, thumb 6 | `segmented-control.tsx:80-146` |
| Filter chips | Keep (pressed = ink) | — | `components/ui/chip.tsx:262-306` |
| Filter bar | **New pattern** | one row above the content: period segmented → listing filter chip → compare chip → spacer → page actions. Wraps on tablet; on phone it becomes a chip row (`ChipRow`) and the segmented control becomes a chip that opens a sheet | `components/reporting/report-toolbar.tsx`, `components/inbox/filter-toolbar.tsx` |
| List rows | Keep mail rows; **selected = fill + 3px ink edge**; hover `surface-alt` on hover-fine; the trailing pill is **below** the snippet on touch, trailing on desk | `components/ui/list-row.tsx:518-525` |
| Tables | **Change:** no header band (`--np-table-header-bg: var(--np-surface)` in all 3 blocks), `text-caption font-medium text-ink-muted`, sticky with surface, numbers right-aligned sans tabular, no zebra; below 48rem container → labelled record cards (kept) | `components/ui/table.tsx:297-370`, `diff-view.tsx:66`, `chart.tsx:105` (drop their own bands) |
| Pagination | **New primitive** `Pagination` ("Showing 5 of 9 listings · sorted by …" + Previous/Next secondary sm; page numbers only on desk tables > 5 pages). Lists keep `LoadMore` ("Load more reviews") | `components/ui/pagination.tsx` (new), `components/ui/load-more.tsx` |
| Change track | **New primitive** `ChangeTrack`: 4 stops *Saved here · Approved · Sent · On Google*, with a compact form without labels for tables. Stop tones: **done** = `circle-check` in `--np-ink-secondary`, connector ink-secondary; **current** = `circle-dot` in `--np-ink`, label semibold; **todo** = `circle` in `--np-ink-quaternary` (decorative; the label carries the meaning), label ink-muted; **failed** = `triangle-alert` in `--np-danger-ink`, label = the state's pill label; **skipped** = `circle-minus` ink-muted, label "Not needed"; **On Google reached** = `badge-check` in `--np-success-ink`, the only green on the track. Positions per state are in DIRECTION §6.1. | `components/ui/lifecycle.tsx` becomes the base; fix the sr word "not started" → "Not sent yet" (`lifecycle.tsx:25`) |
| Status pill | **Change:** vocabulary keys from DIRECTION §6 and the glyph per tone; `rounded-pill` | `components/ui/status-pill.tsx`, `lib/ui/status-tone.ts`, `lib/editors/outcome.ts`, `components/ui/operation-outcome.tsx` |
| Outbox list | **New** composition (ListRows compact, grouped by tone) | `components/outbox/*` (new, phase C) |

---

## 11. Dialogs, sheets, drawers, menus, toasts

Keep the overlay foundation (`components/ui/overlay.tsx`): `auto` → bottom
sheet on phone, dialog from sm, right panel for side work, inset sheet for
short choice lists, the discard guard, grabber, footer bar.

| Item | Verdict | Spec |
|---|---|---|
| Dialog | Keep sizes 520 / 760, max-h min(86dvh, 760); radius → 12 through `--np-radius-modal` (no code change beyond the token) | `components/ui/overlay.tsx:269-340`, `dialog.tsx`, `alert-dialog.tsx`; one question or one form |
| Right panel (`Sheet side=right`) | Keep 560 / 880; **use for** the listing publish sheet on tablet, notifications on tablet/desk, quick look | `components/ui/sheet.tsx` panel recipe; leading corners `--np-radius-modal` (**change**: today square) |
| Bottom sheet | Keep; radius → 16 via `--np-radius-sheet`; sticky footer with one primary | `overlay.tsx` sheet recipe; phone forms (invite, filters), More (`more-sheet.tsx`) |
| Inset sheet | Keep; radius → 24 via `--np-radius-sheet-inset` | `overlay.tsx` inset recipe; *Working on* scope sheet (`scope-sheet.tsx`), short menus |
| Menus / popovers | **Change:** shadow only, no border; highlight `bg-fill` (command palette selected row also `bg-fill`, not accent tint: `command.tsx:25`) | — |
| Toasts | Keep position and z; radius → 10; **title = the DIRECTION §6.1 long form, verbatim** (e.g. "Sent, waiting for Google to confirm", "Confirmed on Google at HH:MM"); success-tone toast only for `live`; `sent`/`waiting` use info | `components/ui/toast.tsx`, every `toast()` call that says "published"/"live" (§DIRECTION 6.3) |
| Notifications panel | **New composition**: right panel (tablet/desk) and page (phone); filters Unread / All / Failures; each row = glyph by tone, title, object · listing, time, unread dot | `components/notifications/*`, `components/app-shell/notifications-link.tsx` |

---

## 12. Loading, empty, error, success; interaction states

| State | Verdict | Spec | Maps to |
|---|---|---|---|
| Loading | Keep P4: flat bars at final size, `motion-safe:animate-pulse`; delete the `shimmer` keyframe once Progress indeterminate uses a pulse | `components/ui/skeleton.tsx`, `progress.tsx:83`, `globals.css:288-298` |
| Empty | Keep P4: 20px line icon + `title` + one sentence (≤ 44 chars) + one action; retire `illustration` | `components/ui/empty.tsx` |
| Error | Keep `Empty variant="error"` + Retry; inline errors say "Nothing was changed" when true; provider codes only as "Error reference <code>" in caption | `components/ui/query-states.tsx`, `lib/errors/action-errors.ts` |
| Success | **Change:** a Google success is only *On Google*; a local success is "Saved here, not on Google" (neutral toast) | `lib/editors/outcome.ts` |
| Focus | Keep one halo (`focus-halo`, 2px surface + 2px accent-400; danger when invalid; forced-colours outline) | `globals.css:1441-1476` |
| Hover | Keep: fills only under `hover-fine`; **fix** shell rows using bare `hover:` (`nav.tsx:53`, `more-sheet.tsx:43`, `tab-bar.tsx:33`) | — |
| Pressed | Keep 1px translate (buttons), 0.97 scale (chips), `accent-active` for send, `bg-fill` for secondaries | — |
| Selected | **Change:** fill + 3px ink edge (rows); ink chip (filters); white thumb (segmented) | — |
| Disabled | Keep drawn; **finish** the opacity fan-out: tabs `:175,193,371`, selection-bar `:198`, switch `:24`, radio-group `:39`, segmented `:109`, command `:293`, grouped-list `:229`, checkbox `:80`, choice-card `:47`, list-row-swipe `:304`, settings-row `:703`, boundary `:24`, app-bar `:406`, on-charcoal | each file listed |
| Pending | Keep `aria-busy` + spinner + label; long sends show the track's current stop | — |

---

## 13. Motion and reduced motion

Keep tokens (`:627-640`): fast 140 (feedback), standard 260, overlay 240,
sheet 320, push 300; one ease-out `cubic-bezier(0.16,1,0.3,1)` and the
standard curve for colour. **Change:** delete unused entrance keyframes
`np-rise`, `np-rise-lg`, `np-slide-in`, `np-fade` and `enter-stagger`
(`:300-347`, `:1510-1515`) after confirming no consumers; rename the
`--np-ease-spring*` aliases (they are not springs) to `--np-ease-press` /
`--np-ease-emphasis`. The change track advances with a 140ms colour
transition only. Reduced motion: keep both the token collapse (`:1174-1183`)
and the global 0.01ms rule (`:1517-1530`).

---

## 14. Breakpoints (content-driven), safe areas, keyboard, touch targets

### 14.1 Breakpoints: **no value changes**

| Name | Value | What switches there | Why it stays |
|---|---|---|---|
| `sm` | 40rem (640) | Dialogs stop being bottom sheets (`overlay.tsx` via `PHONE_OVERLAY`, `lib/ui/breakpoints.ts:89`); tab text labels un-abbreviate (`performance-view.tsx` tabs) | A centred 520px dialog needs ≥ 544px |
| `md` | 48rem (768) | Tab bar + app bar → rail + top bar (`tab-bar.tsx`, `app-bar.tsx`, `topbar.tsx`, `nav.tsx`, `app-shell.tsx:358-371`); settings index → two-pane, 230 + ≥ 460 content (`settings-nav.tsx`, `app/(dashboard)/settings/page.tsx`); `desk` scale with a fine pointer (`globals.css:1098`); tablet scope pill (`client-switcher.tsx`) | 768 − 72 rail = 696 content: enough for a single-column form at 640 measure |
| `lg` | 64rem (1024) | Inbox list + detail split (`inbox-view.tsx:1218`, list `clamp(300px, 40%, 480px)` from `lib/inbox/layout.ts:11-13`, detail ≥ 560 for the composer); quick look (`quick-look-panel.tsx`); the top-bar search becomes a field (`command-palette.tsx` `CommandPaletteButton`); the KPI strip goes to one row of four (`kpi-tile.tsx`) | 1024 − 72 = 952 → 380 list + 572 detail |
| `wide` | 73.75rem (1180) | Rail → 240 sidebar with the *Working on* scope button and breadcrumbs (`nav.tsx`, `topbar.tsx:22-39`, `breadcrumbs-context.tsx`); listing editor Changes panel (340) inline (`components/editors/editor-frame.tsx`) | 1180 − 240 = 940 → 576 form + 24 gap + 340 panel |
| `xl` | 80rem (1280) | Reports chart + table side by side only when the table has ≤ 4 columns, otherwise stacked (`components/performance/performance-view.tsx`, `components/reporting/*`) | — |
| height `tall` | 38.75rem (620) | Workspace panes lock and scroll inside | kept |
| height `short` | < 40rem | Docked bars fold to one row | kept |

The 834px tablet (portrait iPad) sits in the md–lg band: rail, single pane,
and the publish sheet as a right panel. That is what `listing-tablet` and
`inbox-tablet` show. Mirror: `lib/ui/breakpoints.ts:26-33` (unchanged;
`tests/breakpoints.test.ts` unaffected).

### 14.2 Safe areas and the on-screen keyboard
Keep `--np-safe-*`, `--np-keyboard-inset`, `--np-dock-bottom`, `pt-safe`,
`pb-dock`, `h-visual`, `<ViewportInsets/>` (threshold 120px) and the chrome
contract (one bottom bar; the tab bar hides while a dock or the keyboard is
present). The dispatch bar is a docked bar on phone (`data-docked="bottom"`),
so it inherits this. Sheets dock above the keyboard (`--overlay-dock`).
Landscape phone (844×390): the dispatch bar folds to one row (`short`) and the
tab bar hides while a sheet is open.

### 14.3 Touch targets
Keep 44px for every primary target on touch (`--np-touch`); 24px is the floor
anywhere (`--np-touch-min`). Chips 28 drawn with a 44 hit area; tab bar cells
56 tall; list rows ≥ 52 touch / 44 desk / 36 compact; icon buttons 44 touch /
36 desk; the swipe actions keep a visible "⋯" alternative (WCAG 2.5.7).

---

## 15. Dark theme

Built, not inverted (kept, `:837-959` + the no-script twin). This spec adds
dark values for every new role (`--np-*-on-charcoal`, `--send*` via aliases,
`--np-disabled-on-charcoal-*`, client roles). Charcoal stays dark (D4). The
neutral current-place fill uses dark `--np-fill` 0.28 (ink 12.60:1). Status
tints are the dark tints already gated. Concepts are light only; the
implementer's QA runs `--themes light,dark`.

---

## 16. Implementation order (suggested waves)

1. **Tokens + gates:** add pairs first, then the radius ladder, `--np-*-on-charcoal`, `--np-ink-hover/active`, table header, and retire unused tokens; make the contract-test edits listed in §0; run `check:contrast`, `check:design --ratchet`, `pnpm test`.
2. **Primitives**, with **one hard ordering rule:** `--primary → ink`, the new `send` variant, moving every charcoal-bar primary to `send` (about 27 `<ActionBar>` uses default to charcoal, `action-bar.tsx:102`), and retargeting the `on-charcoal` selectors land in **the same commit**. Otherwise ink buttons on charcoal (1.05:1) ship invisible. Then: ActionBar dispatch/save; StatusPill + vocabulary in `lib/editors/outcome.ts`; ChangeTrack (`lifecycle.tsx`); ListRow selected; Table header; Pagination; finish disabled fan-out.
3. **Shell:** nav current grammar; scope control per size; retire health chip and pinned clients; tab bar pill; More sheet; Outbox destination (behind a flag until the read model exists).
4. **Surfaces:** Inbox (queues, dispatch states, verification block), listing editors (Changes panel, area tabs, phone section index), Reports (filter bar, no scope select), Team/Settings (two-pane, save bar), notifications panel.
5. **Vocabulary fixes** in DIRECTION §6.3 (each with a component or unit test proving no premature "published/live").
