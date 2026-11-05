# Concepts (redesign 2026-11, phase B)

Static mockups for [`../DIRECTION.md`](../DIRECTION.md) and [`../SYSTEM.md`](../SYSTEM.md).
Every frame is tagged "Concept · sample data". Names, reviews and numbers are invented.

| Frame | Size | State shown |
|---|---|---|
| `inbox-desktop.webp` | 1440×900 | Approval queue, approver view (Asha approves Sam's request): AI draft, checks passed, *Waiting for your approval* |
| `inbox-tablet.webp` | 834×1194 | Verification failed: *Blocked by checks*, publish disabled with its reason |
| `inbox-phone-list.webp` | 390×844 | *All* queue with every row status |
| `inbox-phone-detail.webp` | 390×844 | *Failed: retry* after an expired Google login; Reconnect, then Retry sending |
| `listing-desktop.webp` | 1440×900 | Hours editor, *Draft saved*, inline Changes panel, dispatch bar |
| `listing-tablet.webp` | 834×1194 | Publish sheet: *Sent, waiting for Google*, approval *Not needed* |
| `listing-phone.webp` | 390×844 | *Awaiting approval*, Withdraw |
| `report-desktop.webp` / `-tablet` / `-phone` | 1440×1100 / 834×1194 / 390×1200 | Filters, KPI strip, chart (hover on the latest week), table, pagination |
| `team-desktop.webp` | 1440×900 | Members, roles, publishing access, invitations |
| `team-tablet.webp` | 834×1194 | Team inside the two-pane settings |
| `settings-tablet.webp` | 834×1194 | Two-pane settings (Reply policy), local save bar (ink, not charcoal) |
| `team-phone.webp` | 390×844 | Invite sheet |
| `shell-desktop.webp` | 1440×900 | Sidebar, *Working on* scope menu open, search, bell, account, Outbox |
| `shell-tablet.webp` | 834×1194 | Rail, scope pill, notifications panel |
| `shell-phone-scope.webp` / `shell-phone-more.webp` | 390×844 | *Working on* sheet; More sheet with account and theme |
| `lifecycle-board.webp` | 1440×1000 | Every status label, pill, track, and two dispatch bars |
| `current/*.webp` | — | The **current** app (fixture tenant), for comparison: taste-pilot run 2026-10-29 (`*-chromium-light-*`) and `after-52b237ba` |

## Source and rendering

- `src/kit.mjs` (tokens, primitives, status vocabulary), `src/shell.mjs`, and one `src/c-*.mjs` per concept. Each is one element tree with inline CSS, flexbox only.
- `src/render.mjs <out>` writes `html/<name>.html` (real static HTML/CSS) and `png/<name>.png`. PNGs are made with satori + resvg from `next/dist/compiled/@vercel/og`, so no browser is needed. The phase-B sandbox could not launch any browser engine.
- `src/shoot.mjs <html-dir> <out>` re-shoots the HTML in Playwright Chromium wherever a browser runs.
- Fonts for the PNG renderer: static instances of the system sans (SF Pro) at 400/500/600/700 plus SF Mono 400. They are made locally with fontTools from `/System/Library/Fonts/SFNS.ttf`, with every variable axis pinned and `fvar`/`gvar`/`STAT` dropped, and read from `FONT_DIR` (default `test-results/b-direction/fonts`). They are **not committed**.
- Rebuild: `node docs/redesign/2026-11/concepts/src/render.mjs test-results/b-direction/concepts-out`, then `cwebp -q 82 -m 6` each PNG.
