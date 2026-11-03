# NabaPresence redesign 2026-11 — Mission

Status (2026-11-03 11:40, orchestrator, legacy-recovery Workstream): **A, B, C (system + shell) and the Outbox merged on integration `4704bc41`** (lane C `c-system-3` @ `9e5b8795` via `56648d84`; lane D `d-outbox-2` @ `104f5740`). `pnpm verify` on the identical tree: 686 files / 10350 tests pass, 1 skipped; design ratchet passes. Screen slices (E) started: inbox chunk 1 (R60–R63) on `redesign-2026-11/e-inbox`. Agents run in small chunks because sessions keep being rejected (O07). Integration branch: `redesign-2026-11/integration` (one bundled PR). Base: `origin/main` `367719b3`; main has since moved (rebase before final CI).

## Scope

Redesign the whole NabaPresence experience across phone, tablet and desktop: information architecture, navigation, workflows, page layouts, shared components, interaction states and responsive behaviour, in one design language. It must answer, on every screen:
1. What needs my attention?
2. Which business, client or location am I working on?
3. What can I do next?
4. What is saved locally?
5. What is awaiting approval?
6. What actually reached Google?
7. What failed, and how do I recover?

**In scope:** every row of `INVENTORY.md` (R01–R164): 80 `app/` route files and 84 nested surfaces.

**Not in scope:**
- `app/api` contracts. They are preserved, and INVENTORY §3 lists them.
- Auth, session, tenant isolation, location access, permission and publishing-grant enforcement, feature flags, provider kill switches, audit and server prefetch. These are preserved; BASELINE §3 records the current model.

**Non-negotiables** (COMMON-BRIEF):
- Keep the stack: Next.js / React / Tailwind / Base UI + shadcn / TanStack Query.
- AI replies keep verification and human approval.
- Never show "published" for a request that was only queued; keep provider write, confirmation, readback and recovery.
- Public shared reports stay read-only.
- No fabricated records.
- Build stays on webpack.
- Tailwind sources stay explicit.

**Viewport matrix:**
- **Shell and critical journeys:** 320, 360, 390, 430, 600, 768, 834, 1024, 1180, 1280, 1440 and 1920 wide. Also just below and above each layout breakpoint (md 768, lg 1024, wide 1180), short heights (390x600, 1024x600) and landscape phone (844x390).
- **Every route:** at least phone 390x844 touch, tablet 834x1194 touch and desktop 1440x900 mouse.

Every result names its engine, input and theme.

## Phases

| Phase | Goal | Owner (worker slug) | Exit evidence | Status |
| --- | --- | --- | --- | --- |
| A | Baseline, inventory, before-evidence | `a-inventory` | `BASELINE.md`, `INVENTORY.md` with `check-inventory.mjs` passing, before-captures at 3 viewports, agentic run recorded | docs merged (`f6ed8b3d`); before-captures pending (orchestrator run); agentic runner blocked (version mismatch, see O01) |
| B | Direction: IA, navigation model, design language | `b-direction` | `DIRECTION.md`, `concepts/` | merged (`ab36cbb9`); concepts rendered with satori, not Playwright |
| C | System: tokens, primitives, shell, state patterns | `c-system`, `c-shell` | `SYSTEM.md`; primitives and shell implemented; unit/component tests | **done** (`56648d84`): all SYSTEM waves (selected rows, flat headers, Pagination, overlays, dark theme, button-colour audit, /design-system showcase), S1–S3 fixed; independent review findings (1 major, 5 minor) fixed; verify, contrast 240/240, webpack build pass; /design-system axe-clean light+dark at 3 viewports (`evidence/c-system-3/`). Menus/sheets not opened in a browser |
| D | Journeys: per-journey flows and states | (tbd) | `JOURNEYS-*.md` | not run |
| E | Implementation route by route, keyed by INVENTORY ids | (tbd) | coverage table "implemented" filled | not run |
| F | Verification: viewport matrix captures, a11y, agentic e2e, `pnpm verify`, `pnpm verify:release` | (tbd) | after-captures, before/after report, e2e reports, gate receipts | not run |
| G | Integration and handoff: one bundled PR | orchestrator | PR prepared (merge and deploy need separate authority) | not run |

## Coverage table

The cell values are:
- `not run`
- `done (<evidence>)`
- `blocked (<reason>)`
- `n/a (<why>)`

The columns mean:
- **design:** covered by DIRECTION/SYSTEM/JOURNEYS.
- **implemented:** on the integration branch.
- **phone / tablet / desktop:** after-capture reviewed at 390 / 834 / 1440.
- **a11y:** axe plus keyboard.
- **e2e:** an agentic or Playwright journey covers it.

A row is done only when every applicable column is `done`.

| ID | Path | Kind | design | implemented | phone | tablet | desktop | a11y | e2e |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R01 | / | layout | not run | not run | not run | not run | not run | not run | not run |
| R02 | / | redirect | not run | not run | not run | not run | not run | not run | not run |
| R03 | / (root not-found) | not-found | not run | not run | not run | not run | not run | not run | not run |
| R04 | / (global-error) | global-error | not run | not run | not run | not run | not run | not run | not run |
| R05 | /auth/confirm | handler | not run | not run | not run | not run | not run | not run | not run |
| R06 | /design-system | page | not run | not run | not run | not run | not run | not run | not run |
| R07 | /photos | redirect | not run | not run | not run | not run | not run | not run | not run |
| R08 | /posts | redirect | not run | not run | not run | not run | not run | not run | not run |
| R09 | /privacy | page | not run | not run | not run | not run | not run | not run | not run |
| R10 | /profile | redirect | not run | not run | not run | not run | not run | not run | not run |
| R11 | /profile/[...section] | redirect | not run | not run | not run | not run | not run | not run | not run |
| R12 | /r/[code] | handler | not run | not run | not run | not run | not run | not run | not run |
| R13 | /settings/listing | redirect | not run | not run | not run | not run | not run | not run | not run |
| R14 | /share | layout | not run | not run | not run | not run | not run | not run | not run |
| R15 | /share/report/[token] | page | not run | not run | not run | not run | not run | not run | not run |
| R16 | /share/report/[token] | error | not run | not run | not run | not run | not run | not run | not run |
| R17 | /share/report/[token] | not-found | not run | not run | not run | not run | not run | not run | not run |
| R18 | /terms | page | not run | not run | not run | not run | not run | not run | not run |
| R19 | surface: proxy request-path header (all page routes) | surface | not run | not run | not run | not run | not run | not run | not run |
| R20 | surface: shared report header and period switcher (on /share/report/[token]) | surface | not run | not run | not run | not run | not run | not run | not run |
| R21 | surface: shared report reviews and replies section (on /share/report/[token]) | surface | not run | not run | not run | not run | not run | not run | not run |
| R22 | surface: shared report Google Business Profile section (on /share/report/[token]) | surface | not run | not run | not run | not run | not run | not run | not run |
| R23 | surface: shared report footer (on /share/report/[token]) | surface | not run | not run | not run | not run | not run | not run | not run |
| R24 | surface: theme handling (all routes) | surface | not run | not run | not run | not run | not run | not run | not run |
| R25 | (auth) layout (wraps /sign-in, /sign-in/verify, /forgot-password, /reset-password, /confirm-email, /invite/[token]) | layout | not run | not run | not run | not run | not run | not run | not run |
| R26 | /sign-in | page | not run | not run | not run | not run | not run | not run | not run |
| R27 | /sign-in/verify | page | not run | not run | not run | not run | not run | not run | not run |
| R28 | /forgot-password | page | not run | not run | not run | not run | not run | not run | not run |
| R29 | /reset-password | page | not run | not run | not run | not run | not run | not run | not run |
| R30 | /confirm-email | page | not run | not run | not run | not run | not run | not run | not run |
| R31 | /invite/[token] | page | not run | not run | not run | not run | not run | not run | not run |
| R32 | (auth) error boundary | error | not run | not run | not run | not run | not run | not run | not run |
| R33 | surface: MFA step-up prompt (dialog, on any dashboard route via AppShell) | surface | not run | not run | not run | not run | not run | not run | not run |
| R34 | surface: password requirements checklist (on /sign-in create-account and /reset-password) | surface | not run | not run | not run | not run | not run | not run | not run |
| R35 | surface: resend confirmation (on /sign-in disclosure, create-account confirm-sent panel, AuthErrorAlert) | surface | not run | not run | not run | not run | not run | not run | not run |
| R36 | surface: invitation actions (on /invite/[token], signed-in visitor) | surface | not run | not run | not run | not run | not run | not run | not run |
| R37 | /* (app/(dashboard) route group: every dashboard route) | layout | not run | not run | not run | not run | not run | not run | not run |
| R38 | /notifications | page | not run | not run | not run | not run | not run | not run | not run |
| R39 | /setup | page | not run | not run | not run | not run | not run | not run | not run |
| R40 | /setup | loading | not run | not run | not run | not run | not run | not run | not run |
| R41 | /* (dashboard route group) | loading | not run | not run | not run | not run | not run | not run | not run |
| R42 | /* (dashboard route group) | error | not run | not run | not run | not run | not run | not run | not run |
| R43 | /* (dashboard route group) | not-found | not run | not run | not run | not run | not run | not run | not run |
| R44 | surface: sidebar rail (on every dashboard route) | surface | not run | not run | not run | not run | not run | not run | not run |
| R45 | surface: top bar / app bar (on every dashboard route) | surface | not run | not run | not run | not run | not run | not run | not run |
| R46 | surface: mobile tab bar (on every dashboard route) | surface | not run | not run | not run | not run | not run | not run | not run |
| R47 | surface: More sheet (on every dashboard route, phone) | surface | not run | not run | not run | not run | not run | not run | not run |
| R48 | surface: scope sheet (on every dashboard route, phone) | surface | not run | not run | not run | not run | not run | not run | not run |
| R49 | surface: command palette (on every dashboard route) | surface | not run | not run | not run | not run | not run | not run | not run |
| R50 | surface: client switcher + search (on every dashboard route, desk) | surface | not run | not run | not run | not run | not run | not run | not run |
| R51 | surface: account menu (on every dashboard route) | surface | not run | not run | not run | not run | not run | not run | not run |
| R52 | surface: notifications link / bell (on every dashboard route) | surface | not run | not run | not run | not run | not run | not run | not run |
| R53 | surface: billing banner (on every dashboard route except /settings/billing*) | surface | not run | not run | not run | not run | not run | not run | not run |
| R54 | surface: reconnect banner (on every dashboard route except /settings/connections*) | surface | not run | not run | not run | not run | not run | not run | not run |
| R55 | surface: impersonation banner (on every dashboard route during a support session) | surface | not run | not run | not run | not run | not run | not run | not run |
| R56 | surface: context health chip (on every dashboard route, desk) | surface | not run | not run | not run | not run | not run | not run | not run |
| R57 | surface: breadcrumbs (on every dashboard route, wide desk) | surface | not run | not run | not run | not run | not run | not run | not run |
| R58 | surface: access-denied page component (on role-gated routes) | surface | not run | not run | not run | not run | not run | not run | not run |
| R59 | surface: theme provider (app-wide, from app/layout.tsx) | surface | not run | not run | not run | not run | not run | not run | not run |
| R60 | /inbox | page | done (DIRECTION/SYSTEM) | done (2cc31076) | done (`evidence/e-inbox/captures` @ eb5fe28e) | done (`evidence/e-inbox/captures` @ eb5fe28e) | done (`evidence/e-inbox/captures` @ eb5fe28e) | done (axe 0, keyboard; eb5fe28e) | not run |
| R61 | /inbox | loading | done (DIRECTION/SYSTEM) | done (2cc31076) | done (`evidence/e-inbox/captures` @ eb5fe28e) | done (`evidence/e-inbox/captures` @ eb5fe28e) | done (`evidence/e-inbox/captures` @ eb5fe28e) | done (axe 0, keyboard; eb5fe28e) | not run |
| R62 | /inbox | error | done (DIRECTION/SYSTEM) | done (2cc31076) | done (`evidence/e-inbox/captures` @ eb5fe28e) | done (`evidence/e-inbox/captures` @ eb5fe28e) | done (`evidence/e-inbox/captures` @ eb5fe28e) | done (axe 0, keyboard; eb5fe28e) | not run |
| R63 | surface: review list (on /inbox) | surface | done (DIRECTION/SYSTEM) | done (2cc31076) | done (`evidence/e-inbox/captures` @ eb5fe28e) | done (`evidence/e-inbox/captures` @ eb5fe28e) | done (`evidence/e-inbox/captures` @ eb5fe28e) | done (axe 0, keyboard; eb5fe28e) | not run |
| R64 | surface: review detail (on /inbox?selected=<id>) | surface | done (DIRECTION/SYSTEM) | done (44d9e485) | done (`evidence/e-inbox/captures` @ 30b45583) | done (`evidence/e-inbox/captures` @ 30b45583) | done (`evidence/e-inbox/captures` @ 30b45583) | done (axe 0, keyboard; 30b45583) | not run |
| R65 | surface: reply composer (on /inbox?selected=<id>) | surface | done (DIRECTION/SYSTEM) | done (44d9e485) | done (`evidence/e-inbox/captures` @ 30b45583) | done (`evidence/e-inbox/captures` @ 30b45583) | done (`evidence/e-inbox/captures` @ 30b45583) | done (axe 0, keyboard; 30b45583) | not run |
| R66 | surface: AI generate / verify panel (on /inbox?selected=<id>) | surface | done (DIRECTION/SYSTEM) | done (44d9e485) | done (`evidence/e-inbox/captures` @ 30b45583) | done (`evidence/e-inbox/captures` @ 30b45583) | done (`evidence/e-inbox/captures` @ 30b45583) | done (axe 0, keyboard; 30b45583) | not run |
| R67 | surface: approval request / approve flow (on /inbox?selected=<id>, queue=approval) | surface | done (DIRECTION/SYSTEM) | done (868caf9d) | done (`evidence/e-inbox/captures` @ fa136722) | done (`evidence/e-inbox/captures` @ fa136722) | done (`evidence/e-inbox/captures` @ fa136722) | done (axe 0, keyboard; fa136722) | not run |
| R68 | surface: publish confirmation + provider readback states (on /inbox?selected=<id>) | surface | done (DIRECTION/SYSTEM) | done (868caf9d) | done (`evidence/e-inbox/captures` @ fa136722) | done (`evidence/e-inbox/captures` @ fa136722) | done (`evidence/e-inbox/captures` @ fa136722) | done (axe 0, keyboard; fa136722) | not run |
| R69 | surface: delete published reply (on /inbox?selected=<id>) | surface | done (DIRECTION/SYSTEM) | done (868caf9d) | done (`evidence/e-inbox/captures` @ fa136722) | done (`evidence/e-inbox/captures` @ fa136722) | done (`evidence/e-inbox/captures` @ fa136722) | done (axe 0, keyboard; fa136722) | not run |
| R70 | surface: filters dialog (on /inbox) | surface | done (DIRECTION/SYSTEM) | done (36b0b553) | done (`evidence/e-inbox/captures-chunk5` @ 5d95f051, Chrome 156) | done (`evidence/e-inbox/captures-chunk5` @ 5d95f051, Chrome 156) | done (`evidence/e-inbox/captures-chunk5` @ 5d95f051, Chrome 156) | done (axe 0, keyboard; 5d95f051) | not run |
| R71 | surface: bulk select SelectionBar + bulk approve (on /inbox) | surface | done (DIRECTION/SYSTEM) | done (36b0b553) | done (`evidence/e-inbox/captures-chunk5` @ 5d95f051, Chrome 156) | done (`evidence/e-inbox/captures-chunk5` @ 5d95f051, Chrome 156) | done (`evidence/e-inbox/captures-chunk5` @ 5d95f051, Chrome 156) | done (axe 0, keyboard; 5d95f051) | not run |
| R72 | surface: bulk template reply / compose (on /inbox) | surface | done (DIRECTION/SYSTEM) | done (36b0b553) | done (`evidence/e-inbox/captures-chunk5` @ 5d95f051, Chrome 156) | done (`evidence/e-inbox/captures-chunk5` @ 5d95f051, Chrome 156) | done (`evidence/e-inbox/captures-chunk5` @ 5d95f051, Chrome 156) | done (axe 0, keyboard; 5d95f051) | not run |
| R73 | surface: inbox empty states (on /inbox) | surface | done (DIRECTION/SYSTEM) | done (36b0b553) | done (`evidence/e-inbox/captures-chunk5` @ 5d95f051, Chrome 156) | done (`evidence/e-inbox/captures-chunk5` @ 5d95f051, Chrome 156) | done (`evidence/e-inbox/captures-chunk5` @ 5d95f051, Chrome 156) | done (axe 0, keyboard; 5d95f051) | not run |
| R74 | surface: mobile list -> detail navigation (on /inbox, below lg) | surface | done (DIRECTION/SYSTEM) | done (b70f958d) | done (`evidence/e-inbox/captures-chunk5` @ 5d95f051, Chrome 156) | done (`evidence/e-inbox/captures-chunk5` @ 5d95f051, Chrome 156) | done (`evidence/e-inbox/captures-chunk5` @ 5d95f051, Chrome 156) | done (axe 0, keyboard; 5d95f051) | not run |
| R75 | surface: sync reviews + Google freshness (on /inbox) | surface | done (DIRECTION/SYSTEM) | done (b70f958d) | done (`evidence/e-inbox/captures-chunk5` @ 5d95f051, Chrome 156) | done (`evidence/e-inbox/captures-chunk5` @ 5d95f051, Chrome 156) | done (`evidence/e-inbox/captures-chunk5` @ 5d95f051, Chrome 156) | done (axe 0, keyboard; 5d95f051) | not run |
| R76 | surface: keyboard shortcuts dialog (on /inbox) | surface | done (DIRECTION/SYSTEM) | done (b70f958d) | done (`evidence/e-inbox/captures-chunk5` @ 5d95f051, Chrome 156) | done (`evidence/e-inbox/captures-chunk5` @ 5d95f051, Chrome 156) | done (`evidence/e-inbox/captures-chunk5` @ 5d95f051, Chrome 156) | done (axe 0, keyboard; 5d95f051) | not run |
| R77 | /listings | page | done (DIRECTION/SYSTEM) | done (fde4fa8c) | done (`evidence/e-board/captures-final5` @ b5433767) | done (`evidence/e-board/captures-final5` @ b5433767) | done (`evidence/e-board/captures-final5` @ b5433767) | done (axe 0, keyboard; b5433767) | not run |
| R78 | /listings/bulk | page | done (DIRECTION/SYSTEM) | done (75c4c1fc) | done (`evidence/e-bulk/captures-final3` @ 0a1fd2f9) | done (`evidence/e-bulk/captures-final3` @ 0a1fd2f9) | done (`evidence/e-bulk/captures-final3` @ 0a1fd2f9) | done (axe 0, keyboard; 0a1fd2f9) | not run |
| R79 | /listings/bulk/[operationId] | page | done (DIRECTION/SYSTEM) | done (75c4c1fc) | done (`evidence/e-bulk/captures-final3` @ 0a1fd2f9) | done (`evidence/e-bulk/captures-final3` @ 0a1fd2f9) | done (`evidence/e-bulk/captures-final3` @ 0a1fd2f9) | done (axe 0, keyboard; 0a1fd2f9) | not run |
| R80 | /listings/[id] | layout | done (DIRECTION/SYSTEM) | done (db9cd607) | done (`evidence/e-listings` @ b6c8846f) | done (`evidence/e-listings` @ b6c8846f) | done (`evidence/e-listings` @ b6c8846f) | done (axe 0, keyboard; b6c8846f) | not run |
| R81 | /listings/[id] | page | done (DIRECTION/SYSTEM) | done (db9cd607) | done (`evidence/e-listings` @ b6c8846f) | done (`evidence/e-listings` @ b6c8846f) | done (`evidence/e-listings` @ b6c8846f) | done (axe 0, keyboard; b6c8846f) | not run |
| R82 | /listings/[id] | loading | done (DIRECTION/SYSTEM) | done (db9cd607) | done (`evidence/e-listings` @ b6c8846f) | done (`evidence/e-listings` @ b6c8846f) | done (`evidence/e-listings` @ b6c8846f) | done (axe 0, keyboard; b6c8846f) | not run |
| R83 | surface: listings board filters and search (on /listings) | surface | done (DIRECTION/SYSTEM) | done (fde4fa8c) | done (`evidence/e-board/captures-final5` @ b5433767) | done (`evidence/e-board/captures-final5` @ b5433767) | done (`evidence/e-board/captures-final5` @ b5433767) | done (axe 0, keyboard; b5433767) | not run |
| R84 | surface: listings board selection and bulk action bar (on /listings) | surface | done (DIRECTION/SYSTEM) | done (fde4fa8c) | done (`evidence/e-board/captures-final5` @ b5433767) | done (`evidence/e-board/captures-final5` @ b5433767) | done (`evidence/e-board/captures-final5` @ b5433767) | done except w320 target-size under sticky app bar (L04) | not run |
| R85 | surface: listing quick look panel (on /listings) | surface | done (DIRECTION/SYSTEM) | done (fde4fa8c) | done (`evidence/e-board/captures-final5` @ b5433767) | done (`evidence/e-board/captures-final5` @ b5433767) | done (`evidence/e-board/captures-final5` @ b5433767) | done (axe 0, keyboard; b5433767) | not run |
| R86 | surface: bulk compose form (on /listings/bulk) | surface | done (DIRECTION/SYSTEM) | done (75c4c1fc) | done (`evidence/e-bulk/captures-final3` @ 0a1fd2f9) | done (`evidence/e-bulk/captures-final3` @ 0a1fd2f9) | done (`evidence/e-bulk/captures-final3` @ 0a1fd2f9) | done (axe 0, keyboard; 0a1fd2f9) | not run |
| R87 | surface: bulk operation progress view (on /listings/bulk/[operationId]) | surface | done (DIRECTION/SYSTEM) | done (75c4c1fc) | done (`evidence/e-bulk/captures-final3` @ 0a1fd2f9) | done (`evidence/e-bulk/captures-final3` @ 0a1fd2f9) | done (`evidence/e-bulk/captures-final3` @ 0a1fd2f9) | done (axe 0, keyboard; 0a1fd2f9) | not run |
| R88 | surface: listing header and area sub-navigation (on /listings/[id] and /listings/[id]/*) | surface | done (DIRECTION/SYSTEM) | done (db9cd607) | done (`evidence/e-listings` @ b6c8846f) | done (`evidence/e-listings` @ b6c8846f) | done (`evidence/e-listings` @ b6c8846f) | done (axe 0, keyboard; b6c8846f) | not run |
| R89 | /listings/[id]/booking | page | done (DIRECTION/SYSTEM) | done (4085c3f3) | done (`evidence/e-listings-3/final-3864e73e` @ 3864e73e) | done (`evidence/e-listings-3/final-3864e73e` @ 3864e73e) | done (`evidence/e-listings-3/final-3864e73e` @ 3864e73e) | done (axe 0, keyboard; 3864e73e) | not run |
| R90 | /listings/[id]/changes | page | not run | not run | not run | not run | not run | not run | not run |
| R91 | /listings/[id]/hours | page | done (DIRECTION/SYSTEM) | done (c477ae81) | done (`evidence/e-listings/l2` @ 5c879320/ffa57a64) | done (`evidence/e-listings/l2` @ 5c879320/ffa57a64) | done (`evidence/e-listings/l2` @ 5c879320/ffa57a64) | done (axe 0, keyboard; ffa57a64) | not run |
| R92 | /listings/[id]/menu | page | done (DIRECTION/SYSTEM) | done (4085c3f3) | done (`evidence/e-listings-3/final-3864e73e` @ 3864e73e) | done (`evidence/e-listings-3/final-3864e73e` @ 3864e73e) | done (`evidence/e-listings-3/final-3864e73e` @ 3864e73e) | done (axe 0, keyboard; 3864e73e) | not run |
| R93 | /listings/[id]/people | page | not run | not run | not run | not run | not run | not run | not run |
| R94 | /listings/[id]/photos | page | not run | not run | not run | not run | not run | not run | not run |
| R95 | /listings/[id]/posts | page | not run | not run | not run | not run | not run | not run | not run |
| R96 | /listings/[id]/profile | page | done (DIRECTION/SYSTEM) | done (4085c3f3) | done (`evidence/e-listings-3/final-3864e73e` @ 3864e73e) | done (`evidence/e-listings-3/final-3864e73e` @ 3864e73e) | done (`evidence/e-listings-3/final-3864e73e` @ 3864e73e) | done (axe 0 except phone identity: L04 bar-edge bystander at max scroll; keyboard) | not run |
| R97 | /listings/[id]/review-link | page | not run | not run | not run | not run | not run | not run | not run |
| R98 | /listings/[id]/suggestions | page | not run | not run | not run | not run | not run | not run | not run |
| R99 | /listings/[id]/verification | page | not run | not run | not run | not run | not run | not run | not run |
| R100 | surface: Review changes sheet (on /listings/[id]/hours, /listings/[id]/menu, profile saved reviews) | surface | done (DIRECTION/SYSTEM) | done (c477ae81) | done (`evidence/e-listings/l2` @ 5c879320/ffa57a64) | done (`evidence/e-listings/l2` @ 5c879320/ffa57a64) | done (`evidence/e-listings/l2` @ 5c879320/ffa57a64) | done (axe 0, keyboard; ffa57a64) | not run |
| R101 | surface: Discard / Leave without saving? dialog (on every /listings/[id]/* editor) | surface | done (DIRECTION/SYSTEM) | done (c477ae81) | done (`evidence/e-listings/l2` @ 5c879320/ffa57a64) | done (`evidence/e-listings/l2` @ 5c879320/ffa57a64) | done (`evidence/e-listings/l2` @ 5c879320/ffa57a64) | done (axe 0, keyboard; ffa57a64) | not run |
| R102 | surface: Activity drawer (on every /listings/[id]/* area header) | surface | not run | not run | not run | not run | not run | not run | not run |
| R103 | surface: Add photos (upload) dialog (on /listings/[id]/photos) | surface | not run | not run | not run | not run | not run | not run | not run |
| R104 | surface: Photo lightbox (on /listings/[id]/photos) | surface | not run | not run | not run | not run | not run | not run | not run |
| R105 | surface: Post composer sheet (on /listings/[id]/posts) | surface | not run | not run | not run | not run | not run | not run | not run |
| R106 | surface: Schedule post sheet (on /listings/[id]/posts) | surface | not run | not run | not run | not run | not run | not run | not run |
| R107 | surface: Menu editor and item sheet (on /listings/[id]/menu) | surface | done (DIRECTION/SYSTEM) | done (4085c3f3) | done (`evidence/e-listings-3/final-3864e73e` @ 3864e73e) | done (`evidence/e-listings-3/final-3864e73e` @ 3864e73e) | done (`evidence/e-listings-3/final-3864e73e` @ 3864e73e) | done (axe 0, keyboard; 3864e73e) | not run |
| R108 | surface: Special hours editor (on /listings/[id]/hours) | surface | done (DIRECTION/SYSTEM) | done (c477ae81) | done (`evidence/e-listings/l2` @ 5c879320/ffa57a64) | done (`evidence/e-listings/l2` @ 5c879320/ffa57a64) | done (`evidence/e-listings/l2` @ 5c879320/ffa57a64) | done (axe 0 except L04 artifact; L06 date ring verified at desktop/w1024, e-listings-3 3864e73e) | not run |
| R109 | surface: Editor shell - frame, footer, status pill, capability banner, freshness (on every /listings/[id]/* area) | surface | done (DIRECTION/SYSTEM) | done (db9cd607) | done (`evidence/e-listings` @ b6c8846f) | done (`evidence/e-listings` @ b6c8846f) | done (`evidence/e-listings` @ b6c8846f) | done (axe 0, keyboard); reconnect/verification/retired banners unreachable (L01) | not run |
| R110 | surface: Listing change requests (two-person approval) (on /listings/[id]/hours, /profile, /menu, /photos) | surface | done (DIRECTION/SYSTEM) | done (c477ae81) | done (`evidence/e-listings/l2` @ 5c879320/ffa57a64) | done (`evidence/e-listings/l2` @ 5c879320/ffa57a64) | done (`evidence/e-listings/l2` @ 5c879320/ffa57a64) | done (axe 0, keyboard; ffa57a64) | not run |
| R111 | /calendar | page | not run | not run | not run | not run | not run | not run | not run |
| R112 | /clients | page | done (DIRECTION/SYSTEM) | done (5b73b4e1) | done (`evidence/e-clients/captures-final` @ 5eb5ed2d) | done (`evidence/e-clients/captures-final` @ 5eb5ed2d) | done (`evidence/e-clients/captures-final` @ 5eb5ed2d) | done (axe 0, keyboard; 5eb5ed2d) | not run |
| R113 | /clients | loading | done (DIRECTION/SYSTEM) | done (5b73b4e1) | done (`evidence/e-clients/captures-final` @ 5eb5ed2d) | partial: route-loading after sidebar nav not caught on tablet/desktop; query-loading captured | partial: route-loading after sidebar nav not caught on tablet/desktop; query-loading captured | done (axe 0, keyboard; 5eb5ed2d) | not run |
| R114 | /clients | error | done (DIRECTION/SYSTEM) | done (5b73b4e1) | done (`evidence/e-clients/captures-final` @ 5eb5ed2d) | done (`evidence/e-clients/captures-final` @ 5eb5ed2d) | done (`evidence/e-clients/captures-final` @ 5eb5ed2d) | done (axe 0, keyboard; 5eb5ed2d) | not run |
| R115 | /clients/new | page | done (DIRECTION/SYSTEM) | done (5b73b4e1) | done (`evidence/e-clients/captures-final` @ 5eb5ed2d) | done (`evidence/e-clients/captures-final` @ 5eb5ed2d) | done (`evidence/e-clients/captures-final` @ 5eb5ed2d) | done (axe 0, keyboard; 5eb5ed2d) | not run |
| R116 | /clients/[clientId] | layout | done (DIRECTION/SYSTEM) | done (767cd141) | done (`evidence/e-clients-2/captures-final` @ b4e4353b) | done (`evidence/e-clients-2/captures-final` @ b4e4353b) | done (`evidence/e-clients-2/captures-final` @ b4e4353b) | done (axe 0, keyboard; b4e4353b) | not run |
| R117 | /clients/[clientId] | page | done (DIRECTION/SYSTEM) | done (767cd141) | done (`evidence/e-clients-2/captures-final` @ b4e4353b) | done (`evidence/e-clients-2/captures-final` @ b4e4353b) | done (`evidence/e-clients-2/captures-final` @ b4e4353b) | done (axe 0, keyboard; b4e4353b) | not run |
| R118 | /clients/[clientId] | loading | done (DIRECTION/SYSTEM) | done (767cd141) | done (`evidence/e-clients-2/captures-final` @ b4e4353b) | done (`evidence/e-clients-2/captures-final` @ b4e4353b) | done (`evidence/e-clients-2/captures-final` @ b4e4353b) | done (axe 0, keyboard; b4e4353b) | not run |
| R119 | /clients/[clientId]/settings | page | done (DIRECTION/SYSTEM) | done (767cd141) | done (`evidence/e-clients-2/captures-final` @ b4e4353b) | done (`evidence/e-clients-2/captures-final` @ b4e4353b) | done (`evidence/e-clients-2/captures-final` @ b4e4353b) | done (axe 0, keyboard; b4e4353b) | not run |
| R120 | /reports | page | not run | not run | not run | not run | not run | not run | not run |
| R121 | /reports | loading | not run | not run | not run | not run | not run | not run | not run |
| R122 | /reports | error | not run | not run | not run | not run | not run | not run | not run |
| R123 | surface: share-report dialog (on /clients/[clientId] and /reports) | surface | done (DIRECTION/SYSTEM) | done (767cd141) | done (`evidence/e-clients-2/captures-final` @ b4e4353b) | done (`evidence/e-clients-2/captures-final` @ b4e4353b) | done (`evidence/e-clients-2/captures-final` @ b4e4353b) | done (axe 0, keyboard; b4e4353b) | not run |
| R124 | surface: client form (on /clients/new) | surface | not run | not run | not run | not run | not run | not run | not run |
| R125 | surface: health filter (on /clients) | surface | not run | not run | not run | not run | not run | not run | not run |
| R126 | surface: client colour field (on /clients/new and /clients/[clientId]/settings) | surface | done (DIRECTION/SYSTEM) | done (767cd141) | done (`evidence/e-clients-2/captures-final` @ b4e4353b) | done (`evidence/e-clients-2/captures-final` @ b4e4353b) | done (`evidence/e-clients-2/captures-final` @ b4e4353b) | done (axe 0, keyboard; b4e4353b) | not run |
| R127 | surface: publication calendar grid (on /calendar) | surface | not run | not run | not run | not run | not run | not run | not run |
| R128 | surface: archived clients view (on /clients?view=archived) | surface | not run | not run | not run | not run | not run | not run | not run |
| R129 | surface: client quick look (on /clients, lg+) | surface | not run | not run | not run | not run | not run | not run | not run |
| R130 | surface: single-listing report (on /reports?locationId=) | surface | not run | not run | not run | not run | not run | not run | not run |
| R131 | surface: shared client report (on /share/report/[token]) | surface | not run | not run | not run | not run | not run | not run | not run |
| R132 | /settings | layout | not run | not run | not run | not run | not run | not run | not run |
| R133 | /settings | page | not run | not run | not run | not run | not run | not run | not run |
| R134 | /settings | loading | not run | not run | not run | not run | not run | not run | not run |
| R135 | /settings | error | not run | not run | not run | not run | not run | not run | not run |
| R136 | /settings/billing | page | not run | not run | not run | not run | not run | not run | not run |
| R137 | /settings/billing/confirming | page | not run | not run | not run | not run | not run | not run | not run |
| R138 | /settings/connections | page | not run | not run | not run | not run | not run | not run | not run |
| R139 | /settings/notifications | page | not run | not run | not run | not run | not run | not run | not run |
| R140 | /settings/operations | page | not run | not run | not run | not run | not run | not run | not run |
| R141 | /settings/policy | page | not run | not run | not run | not run | not run | not run | not run |
| R142 | /settings/privacy | page | not run | not run | not run | not run | not run | not run | not run |
| R143 | /settings/security | page | not run | not run | not run | not run | not run | not run | not run |
| R144 | /settings/usage | page | not run | not run | not run | not run | not run | not run | not run |
| R145 | /team | page | not run | not run | not run | not run | not run | not run | not run |
| R146 | /team | loading | not run | not run | not run | not run | not run | not run | not run |
| R147 | surface: connections disconnect typed-email confirm (on /settings/connections) | surface | not run | not run | not run | not run | not run | not run | not run |
| R148 | surface: invite teammate dialog (on /team) | surface | not run | not run | not run | not run | not run | not run | not run |
| R149 | surface: role change dialog (on /team) | surface | not run | not run | not run | not run | not run | not run | not run |
| R150 | surface: MFA enrolment (on /settings/security) | surface | not run | not run | not run | not run | not run | not run | not run |
| R151 | surface: policy editor (on /settings and /settings/policy) | surface | not run | not run | not run | not run | not run | not run | not run |
| R152 | surface: billing plan change / confirming (on /settings/billing) | surface | not run | not run | not run | not run | not run | not run | not run |
| R153 | surface: privacy export/delete requests (on /settings/privacy) | surface | not run | not run | not run | not run | not run | not run | not run |
| R154 | surface: operations pause (on /settings/operations) | surface | not run | not run | not run | not run | not run | not run | not run |
| R155 | surface: toast notifications (app-wide, from app/layout.tsx) | surface | not run | not run | not run | not run | not run | not run | not run |
| R156 | surface: reviewed-write stepper (Review -> Approve -> Send -> Outcome) (on /listings/[id]/profile, /listings/[id]/people, /listings/[id]/verification) | surface | not run | not run | not run | not run | not run | not run | not run |
| R157 | surface: lodging / service reviewed-change approval sheet (on /listings/[id]/profile) | surface | not run | not run | not run | not run | not run | not run | not run |
| R158 | surface: listing lifecycle danger zone and lifecycle review (on /listings/[id]/people) | surface | not run | not run | not run | not run | not run | not run | not run |
| R159 | surface: setup Google cards - account picker, listing import, review import (on /setup?step=account\|locations\|backfill) | surface | not run | not run | not run | not run | not run | not run | not run |
| R160 | surface: new Google listing draft form (on /setup?step=locations) | surface | not run | not run | not run | not run | not run | not run | not run |
| R161 | surface: content warnings acknowledgement (on /listings/[id]/posts composer, /listings/bulk, /listings/[id]/profile) | surface | not run | not run | not run | not run | not run | not run | not run |
| R162 | surface: publish result steps and operation receipt notice (in review-changes sheet, combined review, bulk operation view, posts action bar) | surface | not run | not run | not run | not run | not run | not run | not run |
| R163 | surface: list row swipe actions (on /team member list, phone) | surface | not run | not run | not run | not run | not run | not run | not run |
| R164 | surface: route focus on client navigation (every dashboard route) | surface | not run | not run | not run | not run | not run | not run | not run |

## Decisions log

| # | Date | Decision | Options considered | Why | By | Confirm? |
| --- | --- | --- | --- | --- | --- | --- |
| M01 | 2026-11-03 | Tablet capture preset is 834x1194 touch, and it runs both the phone-shell and desk-shell interactive states | 768x1024 (e2e.config `tablet`); 834x1194 (iPad Air portrait, brief's matrix) | Brief names 834. At 834 the rail and toolbar show (`md`) with touch density (`desk` off), the combination least covered today | a-inventory | yes |
| M02 | 2026-11-03 | `--sizes` entries below 1024px wide default to touch, at or above to mouse; `:touch`/`:mouse` overrides | always mouse; always touch | Matches the presets and the common tablet/laptop split | a-inventory | no |
| M03 | 2026-11-03 | Inventory "states" are code-verified only in phase A; render verification moves to the before-capture run | block inventory until renders exist | Sandbox cannot bind ports (BASELINE §2); the code-read rows still give the coverage contract | a-inventory | yes |
| M04 | 2026-11-03 | Phase-A evidence and handoff kept in the worktree (`test-results/a-inventory/`) instead of the durable folder | wait for write access | Durable folder is read-only from the worker sandbox; orchestrator copies | a-inventory | yes |
| M05 | 2026-11-03 | Build and `pnpm verify` ran without `with-lock.sh` | wait on the lock | The lock dir cannot be created from the sandbox (with-lock would wait forever); the lock was not held at the time | a-inventory | yes |

| M06 | 2026-11-03 | DIRECTION §9 D1-D9, D11-D14 accepted as proposed | accept / revise | Coherent with identity specs; reversible token/label changes | orchestrator | yes |
| M07 | 2026-11-03 | D10 = (b): readback mismatch stays Failed; no backend behaviour change in this redesign | (a) Not confirmed | Mission preserves provider-write/readback behaviour; backend change needs the owner | orchestrator | yes |
| M08 | 2026-11-03 | Outbox nav gated by a route-existence constant (`lib/navigation/outbox.ts`, `false` until the page lands) | org feature flag; env flag | No client env-flag pattern; one-line flip with the page | c-shell | yes |
| M09 | 2026-11-03 | Rendering, captures and e2e run by the orchestrator; workers do code and docs | workers render | Worker sandbox denies port binding and browser launch | orchestrator | no |

| M10 | 2026-11-03 | Continuation uses Workstream agents (SpawnAgent), not the supervised factory_worker path (owner instruction) | factory_worker | Owner restored the normal controller; supervised path is opt-in | orchestrator | no |

| M11 | 2026-11-03 | Editor footer "Review changes" uses `on-dark`, not `send`; green only on the real publish in the review sheet | record a §10 exception | SYSTEM §9: send only for writes to Google (independent review major finding) | orchestrator | yes |
| M12 | 2026-11-03 | Stepper done steps in secondary ink, vertical current step on bg-fill; swipe triage and filter count badge in ink | keep green/accent | "Green only for live/sends" | c-system-3 | yes |
| M13 | 2026-11-03 | ChangeTrack to-do glyph in ink-muted | ink-quaternary | Compact track is not always paired with a status pill | c-system-3 | yes |
| M14 | 2026-11-03 | `AccessDenied` gains optional `whoCanOpen`; Outbox: open to owner, admin or member, ask an owner or admin | single `whoCanHelp` | Members cannot grant access | orchestrator | yes |
| M15 | 2026-11-03 | `/api/outbox` and `/api/outbox/counts` send `cache-control: private, no-store` | rely on Next default | Integration assertion found no header at all; matches audit-log route | d-outbox-2 | no |
| M16 | 2026-11-03 | Outbox empty state has no illustration | keep a local illustration | Empty illustration slot retired by the system | orchestrator | yes |
| M17 | 2026-11-03 | Outbox partial/loading/empty captures use DB levers on a throwaway PG17 (pause, revoked SELECT, lock, unassigned member); error uses an intercepted 500 | HTML/RSC tampering | Real states through the real stack | d-outbox-2 | yes |
| M18 | 2026-11-03 | Remaining slices are run as small agent chunks (2–4 inventory rows, commit per row), replaced on rejection | long-lived lane agents; orchestrator-only | Owner choice after four `model_request_rejected` sessions (O07) | owner | no |

## Operational blockers

| # | Blocker | Effect | Next step |
| --- | --- | --- | --- |
| O01 | Machine e2e runner mismatch: `@e2e-dev/web@0.11.2` imports `rejectUnknownOptions`, absent from installed `e2e@0.15.2` (`CONFIG_LOAD_FAILED`) | Agentic journeys (`tests/agentic`) cannot run | Machine-level reinstall of a matching pair in `~/node_modules` (outside repo; owner's install). Playwright suite unaffected |
| O03 | Fixture tenant has one client and no reachable share-report / disconnect dialog states in nm-capture | 3 interaction states uncaptured before and after | Add a second fixture client and fix the capture state scripts in a QA slice |
| O04 | 2026-11-03 08:3x: Outbox agent (session 6a624bb7) failed twice with `model_request_rejected` from the model provider | Outbox page/API unfinished; WIP committed on `redesign-2026-11/d-outbox`; S1/S2 fix committed `6f269f47` (unrendered) | Owner checks provider/account; then resume the same agent. Not retried further |
| O05 | 2026-11-03 ~08:50: design-system agent (session 6de2e253) also failed with `model_request_rejected` | Primitives (StatusPill, ChangeTrack, ActionBar split) and remaining SYSTEM waves unfinished; verified commits `59c74a09`, `a5bbe239` (vocabulary, 13/14 fixes, pnpm test 10203 pass); WIP `wip(ui)` on `redesign-2026-11/c-system-2` unverified | Same as O04: owner checks provider; resume same agent |
| O06 | 2026-11-03 10:10: repaired supervised pool accepted both starts (team3 `worker-1d911ad5`, team4 `worker-19a4541b`) | O02/O04/O05 superseded for these two tasks | Monitor; one worker per slot |
| O07 | 2026-11-03 10:5x–11:3x (legacy-recovery Workstream): four agent sessions (C original + replacement, D original + replacement) ended with `model_request_rejected` after a period of work; one restart in the same session also failed. Orchestrator session unaffected | Lost turns only; trees were clean or committed each time. Orchestrator finished the Outbox prop + Empty fix (`b8064e9f`, `104f5740`) | Small chunks (M18); agents told to keep tool output small and never read session JSONL. Root cause unconfirmed (possibly the legacy bridge rejecting foreign session metadata) |
| O02 | 2026-11-03 07:56-07:58: two worker starts (team8, team2) returned "delivery not confirmed"; no worktree or branch was created | c-system completion and later slices not delegated | Not retried further; re-check scheduler, then one start per slot |

## Open defects

Seeded from BASELINE §5. Each id is resolved when a phase E/F row cites the fix and the after-evidence.

| Defect | Route (INVENTORY id) | Severity | Status |
| --- | --- | --- | --- |
| D01–D30 | see BASELINE §5.1 | 2 high, 14 medium, 14 low | open (code-verified at 367719b3) |
| S1 | Shell rail at 844x390 landscape cuts off Team/Settings | medium | fix merged `6f269f47`; at `c281ba68` account stays visible but Settings is still clipped in the static shot. **Resolved:** interaction check at `c281ba68` (Chromium, touch) scrolls Settings into view and navigates to /settings at 844x390, 1024x600, 768x500 (`evidence/controller/rail-reach-c281ba68/rail-reach.json`, script `check-rail-reach.mjs`) |
| S2 | Tablet scope pill truncates "All clients" at 768 despite free width | low | fixed, verified in render `shell-matrix-c281ba68/w768x1024/listings.png` |
| S3 | Scope health words differ by size: tablet pill "Some clients need checking", desktop sidebar "1 client needs attention" for the same data | low | **fixed** `a8647e7d` + count-aware wording `8c80c552`; one fixture, tablet and desktop read the same words (`evidence/c-system-3/probe-scope-5bbd4b98.json`) |
| L01 | Editor gate banners for reconnect / verification / retired capability never fire: `lib/server/capabilities.ts` `buildResources` never sets those `reasonCode`s, so a disconnected Google login shows no banner until publish fails | R109 | medium | open, pre-existing server gap; needs owner decision (server capabilities change) |
| L02 | `lib/listings/health.ts` tones "Changes to publish" (unpublished) and pending verification as `pending` (blue = "Sent, waiting for Google") | R77, R81 | low | fixed `b537fa18` |
| L03 | `components/ui/action-bar.tsx` `line-clamp-2` on a flex-col status merges title and detail in docked DispatchBar/SaveBar (worked around in editor-footer `b6c8846f`) | R109 | low | fixed `e5b16fa9` |
| L04 | At 320px the sticky app bar's scope chip partly covers an 18px row checkbox scrolled under it (axe target-size, R84 selected-many); focused control stays clear | R84, app shell | low | decided by default (owner to confirm): not a product defect. html already has scroll-padding-top for the phone app bar (globals.css:1232) and :focus-visible scroll-margin (:1354), so focused/tapped controls clear the bar; axe flags unfocused bystanders that straddle the bar edge at the capture's scroll position. Captures place the subject via scroll-padding and log bar-edge bystanders separately. Alternatives: inner phone scroll container (large shell change) or 24px intrinsic Checkbox/Switch hit boxes |
| L05 | `lib/clients/health.ts:240` maps client "unpublished" to pending/blue, same defect as L02 at client level | clients | low | fixed `ecf57657` |
| L06 | `components/ui/field.tsx:549-550` draws the field focus halo on `focus:` only; on desktop Chromium a date/time input's calendar button takes its own Tab stop and the halo disappears (17 date/time inputs). Fixed locally for bulk (`0a1fd2f9`) | shared field | medium (WCAG 2.4.7) | fixed `bb4b0a86` (merged 5b73b4e1); bulk date input ring verified; re-check R108/R96 in listings L3 |
| L07 | `components/ui/toast` `showToast` / `useOutcomeToast` default to `success`, so local-only toasts (client updated/unfiled/moved/archived/restored/refiled, other app-only saves) show success green; no neutral type exists. Callers on clients index/new/share set no type as a workaround | shared toast | low | open; shared-UI batch |
| L08 | `components/ui/settings-row.tsx` "Changed" word and the hours editor `ChangedMark` use `text-accent-ink` (green outside a send); should be ink "Edited" like profile/menu | shared settings row, hours | low | open; shared-UI batch |
| L09 | Content warnings (R161): bulk compose and the profile editor let a resend start without the client-side "Acknowledge the content warnings first" block that posts now has; the server refuses again, so no unsafe send, but the UI is inconsistent | R161, bulk, profile | low | open; shared-UI batch |
| L10 | `lib/locations/schedule-display.ts` draws an "Active" schedule in the ok/green tone (green outside a send/live state) | posts schedules | low | open; shared-UI batch |
| L11 | `lib/editors/outcome.ts` gives the `saved_locally` toast type `success`; SYSTEM §12 says local-only outcomes are neutral (pairs with L07) | editors | low | open; shared-UI batch with L07 |
| T1 | `tests/components/sign-in-recovery.test.tsx` "clears the last answer on a new attempt" failed once in full `pnpm test` at `c281ba68`; passed 3/3 in isolation; files untouched by the redesign | low (flaky) | open, watch in final gate |
| T2 | `tests/server/runner-pre-job-hook.test.ts` timed out twice (5 s) in full `pnpm verify` on `e-listings-3` 3864e73e under machine load; 37/37 pass alone; file untouched by the redesign | low (flaky) | open, watch in final gate |
| BASELINE §5.2 render items (13) | see BASELINE §5.2 | 3 high claimed | needs render |

## Evidence index

| Evidence | Where | Status |
| --- | --- | --- |
| Base checks (install, verify, build, design ratchet) | BASELINE §1; logs `test-results/a-inventory/*.log` in the a-inventory worktree (to be copied to `2026-11-redesign/evidence/a-inventory/`) | done |
| Inventory sweep parts and audit re-check JSON | `test-results/a-inventory/parts/` (same) | done |
| Before-captures 367719b3 (phone/tablet/desktop light 225 shots, phone/desktop dark 298 incl. light pairs, shell matrix 95) | `2026-11-redesign/evidence/controller/{after-before,after-before-367719b3-dark,shell-matrix-before}-367719b3/` + manifests (orchestrator, detached worktree `before-wt`, Chromium) | done; states not reached: share-report dialog, disconnect dialog, client switcher (fixture has 1 client) |
| Curated before webp (34) | `docs/redesign/2026-11/evidence/before/<viewport>--<shot>.webp` (list: `tests/visual/nm-capture-before.curated.txt`; from the 367719b3 captures, cropped to 1800-2400px tall) | done; `desktop--state--share-report-dialog` shows the page only (state not reached, O03) |
| Agentic journeys desktop and mobile at 367719b3 | `before-367719b3/agentic-{desktop,mobile}/` | **blocked** (port binding; e2e runner `CONFIG_LOAD_FAILED`) |
| After-captures integration `dd1d209a` (A+B+C2): shell matrix 17 sizes x 6 shots; every route phone/tablet/desktop light (225 shots); phone/desktop dark | `2026-11-redesign/evidence/controller/{shell-matrix,after,after-dd1d209a-dark}-dd1d209a/` + manifests; script `evidence/controller/capture-integration.sh` | done (Chromium, touch <1024, mouse >=1024; states not reached: client-switcher (1 client), share-report dialog, disconnect dialog; More sheet at >=768 expected absent) |
| Integration `c281ba68` (A+B+C2 + vocabulary + S1/S2 fixes): static checks all exit 0; `pnpm test` 10206 pass / 1 fail (T1); captures 95 + 225 + 298 shots, console errors only on the deliberate 404/invalid-code routes | `2026-11-redesign/evidence/controller/*-c281ba68*` | done (Chromium) |
| Prior captures (not current: 2026-10-14, pre #262/#264) | `notion-mail-ledger/evidence/after-52b237ba/` etc. | reference only |
