# NabaPresence redesign 2026-11 — Mission

Status: **phase A in progress.** This skeleton was written by worker `a-inventory` on 2026-11-03. Integration branch: `redesign-2026-11/integration` (one bundled PR). Base: `origin/main` `367719b3`.

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
| A | Baseline, inventory, before-evidence | `a-inventory` | `BASELINE.md`, `INVENTORY.md` with `check-inventory.mjs` passing, before-captures at 3 viewports, agentic run recorded | docs done; **captures and agentic blocked** (BASELINE §2) |
| B | Direction: IA, navigation model, design language | `b-direction` | `DIRECTION.md`, `concepts/` | not run |
| C | System: tokens, primitives, shell, state patterns | (tbd) | `SYSTEM.md`; primitives and shell implemented; unit/component tests | not run |
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
| R60 | /inbox | page | not run | not run | not run | not run | not run | not run | not run |
| R61 | /inbox | loading | not run | not run | not run | not run | not run | not run | not run |
| R62 | /inbox | error | not run | not run | not run | not run | not run | not run | not run |
| R63 | surface: review list (on /inbox) | surface | not run | not run | not run | not run | not run | not run | not run |
| R64 | surface: review detail (on /inbox?selected=<id>) | surface | not run | not run | not run | not run | not run | not run | not run |
| R65 | surface: reply composer (on /inbox?selected=<id>) | surface | not run | not run | not run | not run | not run | not run | not run |
| R66 | surface: AI generate / verify panel (on /inbox?selected=<id>) | surface | not run | not run | not run | not run | not run | not run | not run |
| R67 | surface: approval request / approve flow (on /inbox?selected=<id>, queue=approval) | surface | not run | not run | not run | not run | not run | not run | not run |
| R68 | surface: publish confirmation + provider readback states (on /inbox?selected=<id>) | surface | not run | not run | not run | not run | not run | not run | not run |
| R69 | surface: delete published reply (on /inbox?selected=<id>) | surface | not run | not run | not run | not run | not run | not run | not run |
| R70 | surface: filters dialog (on /inbox) | surface | not run | not run | not run | not run | not run | not run | not run |
| R71 | surface: bulk select SelectionBar + bulk approve (on /inbox) | surface | not run | not run | not run | not run | not run | not run | not run |
| R72 | surface: bulk template reply / compose (on /inbox) | surface | not run | not run | not run | not run | not run | not run | not run |
| R73 | surface: inbox empty states (on /inbox) | surface | not run | not run | not run | not run | not run | not run | not run |
| R74 | surface: mobile list -> detail navigation (on /inbox, below lg) | surface | not run | not run | not run | not run | not run | not run | not run |
| R75 | surface: sync reviews + Google freshness (on /inbox) | surface | not run | not run | not run | not run | not run | not run | not run |
| R76 | surface: keyboard shortcuts dialog (on /inbox) | surface | not run | not run | not run | not run | not run | not run | not run |
| R77 | /listings | page | not run | not run | not run | not run | not run | not run | not run |
| R78 | /listings/bulk | page | not run | not run | not run | not run | not run | not run | not run |
| R79 | /listings/bulk/[operationId] | page | not run | not run | not run | not run | not run | not run | not run |
| R80 | /listings/[id] | layout | not run | not run | not run | not run | not run | not run | not run |
| R81 | /listings/[id] | page | not run | not run | not run | not run | not run | not run | not run |
| R82 | /listings/[id] | loading | not run | not run | not run | not run | not run | not run | not run |
| R83 | surface: listings board filters and search (on /listings) | surface | not run | not run | not run | not run | not run | not run | not run |
| R84 | surface: listings board selection and bulk action bar (on /listings) | surface | not run | not run | not run | not run | not run | not run | not run |
| R85 | surface: listing quick look panel (on /listings) | surface | not run | not run | not run | not run | not run | not run | not run |
| R86 | surface: bulk compose form (on /listings/bulk) | surface | not run | not run | not run | not run | not run | not run | not run |
| R87 | surface: bulk operation progress view (on /listings/bulk/[operationId]) | surface | not run | not run | not run | not run | not run | not run | not run |
| R88 | surface: listing header and area sub-navigation (on /listings/[id] and /listings/[id]/*) | surface | not run | not run | not run | not run | not run | not run | not run |
| R89 | /listings/[id]/booking | page | not run | not run | not run | not run | not run | not run | not run |
| R90 | /listings/[id]/changes | page | not run | not run | not run | not run | not run | not run | not run |
| R91 | /listings/[id]/hours | page | not run | not run | not run | not run | not run | not run | not run |
| R92 | /listings/[id]/menu | page | not run | not run | not run | not run | not run | not run | not run |
| R93 | /listings/[id]/people | page | not run | not run | not run | not run | not run | not run | not run |
| R94 | /listings/[id]/photos | page | not run | not run | not run | not run | not run | not run | not run |
| R95 | /listings/[id]/posts | page | not run | not run | not run | not run | not run | not run | not run |
| R96 | /listings/[id]/profile | page | not run | not run | not run | not run | not run | not run | not run |
| R97 | /listings/[id]/review-link | page | not run | not run | not run | not run | not run | not run | not run |
| R98 | /listings/[id]/suggestions | page | not run | not run | not run | not run | not run | not run | not run |
| R99 | /listings/[id]/verification | page | not run | not run | not run | not run | not run | not run | not run |
| R100 | surface: Review changes sheet (on /listings/[id]/hours, /listings/[id]/menu, profile saved reviews) | surface | not run | not run | not run | not run | not run | not run | not run |
| R101 | surface: Discard / Leave without saving? dialog (on every /listings/[id]/* editor) | surface | not run | not run | not run | not run | not run | not run | not run |
| R102 | surface: Activity drawer (on every /listings/[id]/* area header) | surface | not run | not run | not run | not run | not run | not run | not run |
| R103 | surface: Add photos (upload) dialog (on /listings/[id]/photos) | surface | not run | not run | not run | not run | not run | not run | not run |
| R104 | surface: Photo lightbox (on /listings/[id]/photos) | surface | not run | not run | not run | not run | not run | not run | not run |
| R105 | surface: Post composer sheet (on /listings/[id]/posts) | surface | not run | not run | not run | not run | not run | not run | not run |
| R106 | surface: Schedule post sheet (on /listings/[id]/posts) | surface | not run | not run | not run | not run | not run | not run | not run |
| R107 | surface: Menu editor and item sheet (on /listings/[id]/menu) | surface | not run | not run | not run | not run | not run | not run | not run |
| R108 | surface: Special hours editor (on /listings/[id]/hours) | surface | not run | not run | not run | not run | not run | not run | not run |
| R109 | surface: Editor shell - frame, footer, status pill, capability banner, freshness (on every /listings/[id]/* area) | surface | not run | not run | not run | not run | not run | not run | not run |
| R110 | surface: Listing change requests (two-person approval) (on /listings/[id]/hours, /profile, /menu, /photos) | surface | not run | not run | not run | not run | not run | not run | not run |
| R111 | /calendar | page | not run | not run | not run | not run | not run | not run | not run |
| R112 | /clients | page | not run | not run | not run | not run | not run | not run | not run |
| R113 | /clients | loading | not run | not run | not run | not run | not run | not run | not run |
| R114 | /clients | error | not run | not run | not run | not run | not run | not run | not run |
| R115 | /clients/new | page | not run | not run | not run | not run | not run | not run | not run |
| R116 | /clients/[clientId] | layout | not run | not run | not run | not run | not run | not run | not run |
| R117 | /clients/[clientId] | page | not run | not run | not run | not run | not run | not run | not run |
| R118 | /clients/[clientId] | loading | not run | not run | not run | not run | not run | not run | not run |
| R119 | /clients/[clientId]/settings | page | not run | not run | not run | not run | not run | not run | not run |
| R120 | /reports | page | not run | not run | not run | not run | not run | not run | not run |
| R121 | /reports | loading | not run | not run | not run | not run | not run | not run | not run |
| R122 | /reports | error | not run | not run | not run | not run | not run | not run | not run |
| R123 | surface: share-report dialog (on /clients/[clientId] and /reports) | surface | not run | not run | not run | not run | not run | not run | not run |
| R124 | surface: client form (on /clients/new) | surface | not run | not run | not run | not run | not run | not run | not run |
| R125 | surface: health filter (on /clients) | surface | not run | not run | not run | not run | not run | not run | not run |
| R126 | surface: client colour field (on /clients/new and /clients/[clientId]/settings) | surface | not run | not run | not run | not run | not run | not run | not run |
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

## Open defects

Seeded from BASELINE §5. Each id is resolved when a phase E/F row cites the fix and the after-evidence.

| Defect | Route (INVENTORY id) | Severity | Status |
| --- | --- | --- | --- |
| D01–D30 | see BASELINE §5.1 | 2 high, 14 medium, 14 low | open (code-verified at 367719b3) |
| BASELINE §5.2 render items (13) | see BASELINE §5.2 | 3 high claimed | needs render |

## Evidence index

| Evidence | Where | Status |
| --- | --- | --- |
| Base checks (install, verify, build, design ratchet) | BASELINE §1; logs `test-results/a-inventory/*.log` in the a-inventory worktree (to be copied to `2026-11-redesign/evidence/a-inventory/`) | done |
| Inventory sweep parts and audit re-check JSON | `test-results/a-inventory/parts/` (same) | done |
| Before-captures 367719b3 (phone/tablet/desktop light, desktop/phone dark) | `2026-11-redesign/evidence/a-inventory/before-367719b3/` via `tests/visual/nm-capture-before.sh` | **blocked** (port binding) |
| Curated before webp (34) | `docs/redesign/2026-11/evidence/before/` (list: `tests/visual/nm-capture-before.curated.txt`) | **blocked** |
| Agentic journeys desktop and mobile at 367719b3 | `before-367719b3/agentic-{desktop,mobile}/` | **blocked** (port binding; e2e runner `CONFIG_LOAD_FAILED`) |
| Prior captures (not current: 2026-10-14, pre #262/#264) | `notion-mail-ledger/evidence/after-52b237ba/` etc. | reference only |
