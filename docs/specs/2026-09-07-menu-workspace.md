# Food menu workspace redesign

Status: implementation draft; browser acceptance is outstanding.
Scope: rebuild the audited MenuEditor and its MenuTab integration. Keep the stronger Inbox inspector unchanged. Preserve the existing Apple-identity design tokens, API contracts, permissions and full-replacement publishing flow.

## Product intent

A venue manager should be able to find the right menu, change a dish or price, understand the complete effect of the change, and publish deliberately. The old editor showed only menus[0], coerced price text while typing, relied on placeholders, and removed whole sections without local confirmation or undo.

## Information architecture

The flow is: location / Food menu -> choose a menu -> find a section -> edit items -> optional preview -> Review changes -> Publish to Google.

The menu selector scopes editing only. A nearby sentence explicitly states that review and publishing cover all menus. A native select uses the existing field chrome; it does not introduce another headless dependency. New menu is a secondary action. The existing pinned EditorFooter retains the primary Review changes action.

Desktop uses a 12rem section rail alongside a flexible editor column. The rail shows item counts and jump controls. Search appears when there are more than four sections; it matches section and item names/descriptions and filters only the navigation, never the draft or publish payload. Below the large breakpoint the rail precedes the editor. Item name and price share a row where space permits and stack on narrow screens. Descriptions use the full width. This responsive implementation still requires browser verification inside the real application shell.

Each section has a labelled disclosure control, item count, keyboard-accessible move controls and remove action. The first section starts expanded. Other sections start collapsed to reduce initial form density. Collapsed sections unmount their fields, but raw text lives in the workspace state and is retained.

## Editing and feedback

Menu names and descriptions, section names and descriptions, item names, descriptions and prices are editable. Every field has a persistent visible label. Prices include a currency code, so dollars from different currencies are not ambiguous. Blank means no listed price; zero is an explicit price. New item prices default to GBP, matching the existing editor; imported currencies survive editing and clear/re-entry during the session.

Items can be duplicated and moved with buttons; sections can be moved with buttons. Drag-only manipulation is intentionally avoided. Client-side IDs are independent of array position and never enter the API payload. Added entries receive focus on their name field.

Validation checks every menu, including hidden menus and collapsed sections. Inline errors use the existing Field system. The summary explains why review is blocked and offers Go to first issue, which selects the corresponding menu, opens its section and focuses the field. Preview is disabled while errors exist so it cannot silently display a previous valid price instead of the text being edited.

## Price correctness

Raw text and the structured wire price are separate. Typing 12., 12.5 and 12.50 must not remove the decimal point or reposition the caret through formatting. Valid input updates the wire representation; invalid input stays visible locally and does not replace a valid wire value. Review is blocked until corrected.

Conversion uses decimal strings, integer nanos and a lexical int64 bound check, not floating-point multiplication of the whole amount. Imported nanos are not rounded to two decimals. The review price formatter uses the same exact representation. Negative values, commas, scientific notation, malformed decimals and values outside the supported bound are rejected explicitly.

Unknown object properties, item options and additional language labels are preserved. This is not a new options or translation editor. Preview explicitly states that it excludes those extra details and is not an exact reproduction of Google's layout.

## Removal and undo

Menu, section and item removal requires confirmation. The dialog names the object, gives the affected item count, and states that Google is unchanged until publication. Keep editing receives initial focus.

Undo removal restores the most recent removed subtree into the current draft rather than replacing the draft with an old snapshot. Later edits to other items therefore survive. Undo is session-only and one level deep; another removal replaces the previous undo entry. Discard all edits is a separate confirmation and resets the complete local draft, including invalid raw input. It is not the same as undo.

## Publishing integration

Retain the existing save -> fetch fresh revision/hashes -> publish sequence, full-replacement confirmation, role gates and publish-flow error reporting. Editing is locked while the review sheet is open or publishing is active. All operations retain the existing server-side enforcement; UI checks are not a substitute.

The existing item comparison is supplemented by a human-readable structural summary so menu/section renames, order changes, empty sections and description text are included in review. Existing remote drift can be reviewed without making a meaningless local edit first. Invalid raw inputs count as local changes for Discard even when the serialized amount has not changed. The existing reload dirty guard is retained; this change does not claim cross-device persistence or fully verified in-app navigation protection.

## Component ownership

- components/locations/menu-editor.tsx: controlled workspace, selection, validation, removal/undo and section navigation.
- components/locations/menu/item-editor.tsx: labelled item fields and item actions.
- components/locations/menu/section-editor.tsx: disclosure, section metadata and item composition.
- components/locations/menu/menu-preview.tsx: read-only primary-label draft preview.
- lib/locations/forms/menu-editor.ts: exact prices, passthrough serialization, identity, validation, immutable moves and inverse removal.
- components/locations/menu-tab.tsx: resource integration, discard confirmation and existing review/publish flow.
- lib/locations/menu-diff.ts: exact review-price formatting.

No schema migrations, new runtime dependencies, credentials, backend routes or global styling changes are required.

## Acceptance gate

44 dependency-free model cases pass using the exact helper source, transpiled with TypeScript and executed through Node's test runner. The helper also passes standalone strict TypeScript checking at ES2017. These results are not a full project typecheck or a Vitest/React/browser pass.

16 React interaction regression tests are added but have not run in this environment. Before merge, run the repository formatter, lint, typecheck, targeted Vitest suites and the existing menu/e2e flow. Verify desktop, narrow mobile, light/dark, keyboard operation, dialog focus after deleting the final menu, 200% zoom, very long names, large menu data, discard, permission states and a stubbed successful/failed publishing flow. Capture screenshots from the real app and check console health. No live Google publication is required for QA.
