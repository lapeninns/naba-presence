# NabaPresence full design-system replacement

**Date:** 2026-07-29  
**Status:** Approved for planning  
**Decision:** Replace the complete product-facing visual system with the supplied
NabaPresence design language while retaining shadcn/ui and Base UI as the implementation
and accessibility foundation.

## Goal

The application should no longer look like stock base-rhea with a Google palette. It
should present one coherent NabaPresence system across the shell, all six product views,
states, overlays, and responsive layouts: Google Business Profile clarity, restrained
floating depth, and a review-operations identity centered on verified public replies.

This is a visual-system and composition replacement. It is not a replacement of React,
Next.js, Tailwind, shadcn/ui, or Base UI.

## Source material

The design reference is the package at:

`/Users/amankumarshrestha/Downloads/Google Business Profile design system`

Its README, token files, component specimens, Dashboard template, and Reviews template
define intent. Its handwritten JSX and runtime `injectCss` implementation are prototype
references only and must not be copied into production.

## Architecture

The ownership stack is:

1. React 19, Next.js 16, and Tailwind CSS 4.
2. Base UI for focus, keyboard interaction, overlays, positioning, and semantics.
3. `components/ui/*` for generic shadcn controls and composition primitives.
4. NabaPresence semantic tokens, variants, and product compositions.
5. Product views and workflows.

The complete `components/ui/*` collection remains available. Existing primitives are
restyled and extended rather than replaced by a parallel `.nr-*` library. New shadcn
components remain installable through `components.json` and receive a focused NabaPresence
visual and accessibility review when introduced.

## Explicit non-goals

- Do not import the incoming `.nr-*` React components or `injectCss` runtime.
- Do not create duplicate Button, Input, Dialog, Menu, Sheet, Tooltip, or Sidebar systems.
- Do not replace Base UI interaction behavior for visual fidelity.
- Do not introduce the incoming template's unimplemented Business profile, Messages,
  Photos, Posts, or Hours destinations.
- Do not change APIs, data contracts, permissions, publishing policy, verification,
  navigation state, or product behavior as part of the visual replacement.
- Do not remove the current Menu assistant or any other shipping view because it is
  absent from the supplied reference templates.

## Visual foundations

### Color

The current contrast-tested Google/GBP semantic palette remains authoritative. Preserve
the existing light and dark values for background, foreground, card, popover, primary,
accent, destructive, success, warning, rating, charts, and sidebar tokens.

Add only missing semantic concepts required by the new system, including `info`, glass
surfaces, translucent surfaces, and border-strength aliases. New semantic text colors
must pass WCAG AA against every surface on which they are used. Decorative chart and
rating colors must always be accompanied by text, labels, or symbols.

### Typography

Keep Geist and Geist Mono loaded through `next/font/local`; do not import the embedded
font data from the reference package.

Adopt the supplied compact scale as guidance:

- page display: 28px / 700;
- page title: 22px / 650;
- section heading: 15px / 650;
- card heading: 14px / 650;
- body: 13.5px with 1.45 line height;
- labels: 12px / 600;
- captions: 11px;
- metrics: 24px / 650 in Geist Mono.

Persistent interface text should remain at least 13px where space permits. Geist Mono is
reserved for numerals, timestamps, IDs, byte counts, and tabular data—not prose.

### Spacing and layout

Introduce the supplied 2px/4px spacing scale and semantic layout variables. The primary
desktop rhythm is:

- floating sidebar: 256px with a 14px outer margin;
- page horizontal padding: 30px;
- page top padding: 26px;
- card gap: 14px;
- section gap: 22px;
- default card padding: 18px;
- large panel padding: 20px;
- content maximum: 1180px unless an existing workflow requires more width.

Values should be exposed to Tailwind through theme mappings where useful. Product views
may use responsive utility classes; they must not duplicate token values as arbitrary
pixels without a layout-specific reason.

### Radius

Use purpose-graded radii rather than increasing one global radius indiscriminately:

- 6px: tags and keyboard hints;
- 8px: chips and compact controls;
- 12px: buttons, icon buttons, and navigation items;
- 14px: inputs, textareas, list rows, and inner cards;
- 18px: standard content and metric cards;
- 20px: major panels;
- 22px: floating shell containers;
- 24px: modal and sheet surfaces;
- pill: badges, filter chips, and progress tracks.

Nested elements step down at least one radius level from their container.

### Elevation and glass

Depth consists of a surface, hairline border, and soft shadow—not shadow alone.

- Strong glass: desktop sidebar and floating chrome.
- Light translucency: business summary and KPI cards.
- Opaque surfaces: review prose, text editors, forms, tables, popovers, dialogs, sheets,
  publishing controls, and destructive confirmations.
- Never stack glass on glass.
- Blur receives a high-opacity fallback when `backdrop-filter` is unsupported.
- Dark mode uses layered charcoal surfaces rather than pure black.

The application background may use restrained blue and teal radial atmosphere at the
shell level. Individual pages must not add competing gradients.

### Motion

Adopt fast, interruptible motion tokens:

- 150ms for hover and filter state;
- 200ms for controls and card interaction;
- 250ms for panel changes;
- approximately 320ms for overlays, subject to Base UI's existing animation contracts.

Hover lift applies only to interactive cards. Reduced-motion mode removes lifts and
collapses nonessential durations without weakening state communication.

## Product signature

Glass is supporting chrome, not the identity. The signature NabaPresence pattern is the
auditable public-response flow:

`customer review → assisted reply → safeguards and verification → approval → published reply`

The reviews workspace must make this progression understandable through structure,
status, language, and activity—not merely through color. The customer message and
business response may use a conversation treatment, while verification and publication
remain visibly connected to the reply.

## Component policy

### Generic primitives

Generic controls remain in `components/ui/*`. They contain no business terminology and
own accessibility behavior. Token changes should carry most of the visual replacement.
NabaPresence-specific variants are added only when a semantic token cannot express the
required distinction.

### Product compositions

Business-specific compositions remain in `components/naba-presence/*` and are assembled
from generic primitives. Introduce a named composition only when it is reused or owns a
coherent responsibility. Candidate responsibilities include:

- business/location context;
- profile completeness;
- review queue item;
- review conversation;
- reply composer;
- verification summary;
- activity timeline;
- operational metric;
- connection setup;
- menu workspace.

Do not create a one-to-one port of every component in the reference package.

## Shell and responsive behavior

### Desktop, 1200px and above

- Floating 256px sidebar with 14px margin and 22px radius.
- Business or organisation context at the top.
- Grouped product navigation in the middle.
- Account identity at the bottom.
- Content occupies the remaining width and uses the new page rhythm.
- The permanent top bar is reduced to essential context and actions; it must not compete
  with the page title.

### Tablet, 768–1199px

- Preserve the existing shadcn Sidebar collapse behavior and accessible trigger.
- Use a compact rail where space permits.
- Secondary panels become sheets or drawers rather than forcing horizontal overflow.
- Cards collapse from multi-column layouts based on content requirements.

### Mobile, below 768px

- Preserve the current accessible sheet-based primary navigation initially.
- Do not introduce the reference BottomNav until product navigation has been explicitly
  prioritized to fit it without hiding shipping destinations.
- Cards become one column.
- Review queue and detail become separate mobile states with a clear back action.
- Sheets replace side drawers and preserve focus management.
- Interactive targets remain at least 44px.

## View designs

### Overview

Use a business-context summary followed by operational metrics and current health. Keep
the shipping review/reply analytics and operations-health content; do not substitute the
reference template's broader GBP metrics unless the API provides them. KPI cards receive
light translucency, while charts and latest-review reading surfaces remain comparatively
opaque. Loading, empty, and retry states retain their current behavior.

### Reviews

Preserve the existing queue tabs, search, location/rating/sort controls, advanced filter
Sheet, pagination, verification, media, activity, tone policy, drafting, regeneration,
and publishing behavior.

Visually restructure the desktop workspace into:

1. compact page context and filters;
2. review queue with raised, clearly selected rows;
3. opaque detail/reply workspace;
4. verification and activity visibly attached to the reply lifecycle.

The conversation treatment may distinguish customer and business messages, but must not
hide editable draft state, policy failures, or publication status. The primary publish or
update action remains singular and visually dominant.

### Menu assistant

Bring the new surface, spacing, and typography language to the existing source-selection
and menu workspace. Preserve upload, location selection, menu parsing, public menu, and
assistant behavior. The menu itself is a reading surface and stays opaque. Empty and
loading states use the shared system.

### Analytics

Use the new metric treatment and panel rhythm. Preserve date and granularity presets,
charts, response-rate progress, and the wide location table. Tables remain opaque and
prioritize alignment and density over decorative depth. Numeric columns remain monospaced.

### Connections

Restyle the current setup flow as a calm guided sequence using elevated major panels and
opaque account/location rows. Preserve account selection, location import, historical
backfill, operational status, destructive confirmation, and recovery behavior. Technical
identifiers remain monospaced.

### Settings

Use the new card hierarchy and field rhythm without turning every field group into a
floating object. Preserve publishing safeguards, team access, language/timezone,
retention, and compliance behavior. Forms, enforcement states, and destructive actions
remain opaque and explicit.

## Feedback and error handling

- Success and transient completion feedback use Toasts.
- Errors requiring action remain inline near the affected content.
- Field errors remain associated through `aria-describedby` and `aria-invalid`.
- Loading states use Skeletons matching the final layout.
- Empty states explain what happened and provide the next valid action.
- Destructive confirmation uses `AlertDialog`, names the object and consequence, and
  repeats the destructive verb in the confirm action.
- Offline or broad synchronization problems use a warning banner with recovery guidance.

Existing retry paths and last-good-data behavior remain unchanged.

## Accessibility requirements

- Preserve Base UI focus trapping, restoration, dismissal, and keyboard behavior.
- Every interactive control has an accessible name.
- Focus indicators remain at least 2px and at least 3:1 against adjacent colors.
- Normal text meets 4.5:1 on solid and translucent surfaces in both themes.
- Status is never communicated by color alone.
- Charts have text alternatives or direct labels.
- Layouts tolerate 200% zoom without loss of content or function.
- Reduced motion and no-backdrop-filter modes are tested.
- Mobile targets are at least 44px.

## Design-system proof and documentation

Replace the current `/design-system` palette-only proof sheet with a production-facing
system page that covers:

- light and dark foundations;
- typography and numeric treatment;
- spacing, radius, elevation, and glass;
- core control states;
- status and feedback;
- shell/navigation examples;
- representative review, reply, metric, table, form, and overlay compositions;
- reduced-motion and no-blur expectations.

Keep contrast evidence and semantic token names visible. Update component documentation
when a shared component's public variants or styling contract changes.

## Migration strategy

Implement in reviewable stages while keeping the application functional:

1. foundations and proof sheet;
2. shared primitive styling;
3. shell and responsive navigation;
4. shared product compositions;
5. Overview;
6. Reviews;
7. Menu assistant;
8. Analytics;
9. Connections;
10. Settings;
11. accessibility, visual, and performance sweep;
12. remove superseded styles and update documentation.

Do not run a second component library in parallel during the migration. Temporary legacy
appearance is acceptable at view boundaries, but each migrated view must use the new
foundations exclusively.

## Verification

Each stage receives the narrowest relevant checks. The completed replacement requires:

- `pnpm typecheck`;
- `pnpm lint`;
- `pnpm test`;
- `pnpm build`;
- `pnpm test:a11y`;
- light and dark browser review of all six views;
- desktop, tablet, and mobile browser review;
- keyboard navigation through shell, filters, overlays, and publishing;
- reduced-motion review;
- no-backdrop-filter fallback review;
- no horizontal overflow at supported viewport widths;
- console free of application errors during the reviewed flows.

## Acceptance criteria

- Every shipping view visibly belongs to one NabaPresence system.
- No incoming `.nr-*` runtime implementation is present.
- shadcn/ui and Base UI remain the generic component and interaction foundation.
- Existing product behavior and API contracts are preserved.
- Glass is restrained to the declared surface hierarchy.
- The review-to-publication lifecycle is the strongest product-specific visual pattern.
- All verification requirements pass, or any external blocker is documented explicitly.
