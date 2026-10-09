# Business mode and AI reply credits — plan

> Historical record, archived during consolidation on 2026-10-09. The credits
> and business-mode work is now on `main` through PR #56 (merge `efceaf46`).
> Status statements, branch instructions and QA receipts below describe the
> original 2026-10-03 work; they are not current project rules or fresh QA evidence.

Written 2026-10-03. Status: **proposed**, not started.

NabaPresence has been agency-first since `2026-09-03-agency-ux.md`. For now
the product sells to **one business per account**, and the AI text
generation that the business consumes has to be metered and capped. Agency
mode stays in the code, switched off, so it can return as a setting.

Delivery order: **A (credits) → B (business mode) → C (agency as a setting)**.
A ships on its own; nothing in it depends on B.

## Decisions taken in this plan

Defaults chosen where the product owner has not ruled yet. Each one is cheap
to change before its phase starts.

| Question                                                      | Default                                                                           | Why                                                                                   |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Can a business have several locations?                        | Yes, 1..N                                                                         | Lapen Inns runs nine venues under one owner                                           |
| What is a credit?                                             | One AI-written draft                                                              | Easy for a customer to understand; tokens are still recorded for cost                 |
| Is semantic verification charged?                             | No; metered and capped by a hidden token backstop                                 | It checks the operator's own text too, and charging for a safety check discourages it |
| Template replies (rating-only reviews) and human-typed drafts | Free                                                                              | No model call writes the reply                                                        |
| Allowance                                                     | `AI_MONTHLY_DRAFT_CREDITS` env default, optional per-organisation override column | One number to launch with; a per-account amount without a billing system              |
| Billing period                                                | Calendar month, UTC                                                               | No billing provider yet to supply a period                                            |
| Mode for new organisations                                    | `business`                                                                        | The product sold today                                                                |

## Phase A — AI credit control

### What exists today

- `lib/server/ai.ts` `openAiStructured()` calls the OpenAI Responses API and
  discards `payload.usage`. Nothing records or limits a call.
- Two callers: `generateReply()` (draft model) and `semanticVerification()`
  (verify model).
- Draft generation runs only in `POST /api/reviews/[id]/drafts`
  (`app/api/reviews/[id]/drafts/route.ts`) in three phases: gates in a
  transaction → provider call with no connection held → settle in a
  transaction. Re-verification runs in `POST /api/drafts/[id]/verify`.
- Kill switches: `DRAFTS_ENABLED`, `SEMANTIC_VERIFY_ENABLED`.
- Roadmap item B1.3 (`docs/sprints/2026-09-18-platform-roadmap.md`) described
  an AI cap; it was never built. This phase replaces it.

### A1. Schema (migration `0059_ai_credits.sql`)

```sql
create table ai_usage (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  kind text not null check (kind in ('draft', 'verify')),
  status text not null check (status in ('reserved', 'settled', 'released')),
  credits integer not null default 0,        -- 1 for a draft, 0 for verify
  model text not null,
  input_tokens integer,
  output_tokens integer,
  review_id uuid,                            -- no FK: reviews are erased on retention
  draft_id uuid,
  request_id text,
  user_id uuid references app_user(id) on delete set null,
  period_start date not null,                -- first day of the UTC month
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index ai_usage_period_idx on ai_usage (organisation_id, period_start, kind, status);
-- RLS: the same forced tenant_isolation policy as `client`.

alter table organisation add column ai_monthly_draft_credits integer
  check (ai_monthly_draft_credits is null or ai_monthly_draft_credits >= 0);
-- null = use AI_MONTHLY_DRAFT_CREDITS.
```

Retention: `ai_usage` holds no review text, so the 30-day raw-content purge
does not apply. Keep 13 months for the cost history. The privacy export lists
it.

### A2. Reserve, call, settle (`lib/server/ai-credits.ts`)

The provider call takes seconds and runs outside a transaction, so a "count
then call" check would let two concurrent requests both spend the last
credit. The draft route therefore follows the three phases it already uses:

1. **Reserve (phase one transaction).** `select … from organisation where id
= $org for update` serialises reservations per organisation. Count
   `reserved + settled` draft credits for the current `period_start`. If that
   count is at or over the allowance, throw
   `ApiError(402, "ai_credits_exhausted", …)` with `{ used, allowance,
resetsAt }` in the details. Otherwise insert a `reserved` row and return
   its id.
2. **Provider call.** `openAiStructured()` returns `{ value, usage }` instead
   of just the value. Callers read `usage.input_tokens` and
   `usage.output_tokens` from the Responses payload.
3. **Settle (phase three transaction).** Mark the row `settled` with tokens,
   model and `draft_id`.
   - Provider error or timeout: mark the row `released` (credits 0). The
     customer does not pay for a failed call.
   - Settle transaction fails _after_ a successful provider call (for example
     the review entered `publish_in_progress`): still settle it. Money was
     spent.
   - Process dies between reserve and settle: a reaper in the existing job
     tick releases `reserved` rows older than 10 minutes. Their tokens are
     unknown. The cost is accepted and logged.

Only `source === "ai"` drafts reserve. `human` and `template` drafts do not
touch credits.

Verification calls (`kind = 'verify'`, credits 0) are inserted after the
call with their tokens. A per-organisation monthly **token backstop**
(`AI_MONTHLY_TOKEN_BACKSTOP`, default high) is checked before any call. It is
the guard against a runaway loop, not a product limit. Over the backstop:

- Generation is refused.
- Semantic verification is skipped, reported as `ran: false`. The draft stays
  `pending`, so it cannot be published until verified, which keeps the
  approval boundary intact.

### A3. API and contracts

- `GET /api/ai/credits` returns `{ used, allowance, remaining, periodStart,
resetsAt }`. Any member can read it. Contract in `lib/contracts/ai-credits.ts`.
- `PUT /api/operations/organisations/[id]/ai-credits`, support/operator only,
  sets the per-organisation override. It writes an audit event.
- `ai_credits_exhausted` is added to `lib/api` error mapping so the composer
  can tell it apart from `drafts_paused`.
- `/api/operations/health` gains AI token totals per model for the month.

### A4. UI

- **Reply composer** (`components/inbox/reply-composer.tsx`): show "7 of 200
  credits left this month" beside Generate. At 0, Generate is disabled with
  "Out of AI credits until 1 Nov. You can still write a reply yourself." The
  manual path stays open.
- **Settings**: a "Usage" card showing "X of Y credits used this month", the
  reset date, and a small daily bar chart from `ai_usage`.
- **Notification**: the existing notifications system (0050) gets a
  `ai_credits_low` event at 80% and an `ai_credits_exhausted` event at 100%,
  sent once per period to owners and admins.
- **Query invalidation**: a successful draft generation invalidates the
  credits query.

### A5. Tests

- Unit (pglite): reserve/settle/release, the period boundary, and the
  override versus the env default.
- Concurrency: N parallel reservations against an allowance of 1 must yield
  exactly one reserved row.
- Route: exhausted returns 402 with details; a provider failure releases the
  credit; human and template drafts do not reserve.
- Reaper: stale reservations are released.
- E2E: the composer shows remaining credits, and the exhausted state disables
  Generate.

## Phase B — Business mode (single business per account)

### Approach: hidden home client

The data model does not change shape. Every business-mode organisation has
exactly one `client` row with `is_home = true`, and every location is filed
under it. Because of that:

- RLS, `lib/server/permissions.ts`, `clientVisibilityPredicate`, `?clientId=`
  filters, scoped invitations (0056) and report shares (0057) all keep
  working unchanged. There is no second security path to review.
- Turning agency mode on later is a matter of revealing the home client.

### B1. Schema (migration `0060_workspace_mode.sql`)

```sql
alter table organisation add column workspace_mode text not null
  default 'business' check (workspace_mode in ('business', 'agency'));
alter table client add column is_home boolean not null default false;
create unique index client_one_home on client (organisation_id) where is_home;
```

Backfill per organisation:

- **0 clients**: create the home client, named after the organisation, and
  file every unassigned location under it. Mode becomes `business`.
- **1 client**: mark that client `is_home`, file unassigned locations under
  it, and set mode to `business`.
- **More than 1 client**: leave the mode as `agency` and change nothing.
  These organisations are listed in the migration notice for a manual
  decision.

Production must be checked before this ships (see Open questions).

### B2. Keeping the invariant

- `organisation` creation in `lib/server/provisioning.ts` (both insert sites)
  also creates the home client.
- Location linking (`app/api/location-links/route.ts`,
  `lib/server/automatic-google-setup.ts`): in business mode,
  `client_id` defaults to the home client instead of null.
- `POST /api/clients` returns 409 `business_mode_single_client` in business
  mode. `DELETE`/archive of the home client is refused.
- A test asserts that every business-mode organisation has exactly one active
  client and no unassigned locations.

### B3. Session and wording

- `sessionSchema` gains `workspaceMode`. The dashboard layout already
  hydrates the session, so the shell knows the mode on first paint.
- `lib/workspace/mode.ts` provides `useWorkspaceMode()` and a small term map
  (`{ org: "Business" | "Agency", ... }`). Components read words from it
  rather than branching inline.

### B4. What changes on screen in business mode

| Surface                                        | Change                                                                                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nav (`components/app-shell/nav.tsx`)           | Inbox, Listings, Reports, Team, Settings. **Clients is removed.**                                                                                                               |
| Command palette                                | Clients group and "New client" removed                                                                                                                                          |
| Top bar                                        | `client-switcher.tsx` hidden; the health chip reports the business                                                                                                              |
| Client scope cookie, `?clientId=`              | Not rendered. The home client is applied server-side where a filter needs it                                                                                                    |
| `/clients`, `/clients/new`, `/clients/[id]/**` | Redirect to `/listings` (`/clients/[id]/settings` goes to `/settings`)                                                                                                          |
| Listings board                                 | No client grouping or chips; `file-under-client.tsx` hidden                                                                                                                     |
| Setup wizard (`lib/setup/steps.ts`)            | `agency` step becomes **Business** ("Your business name and timezone"); `client` step removed. Flow: Business → Connect → Account → Locations → Backfill → Notifications → Team |
| Settings                                       | `agency-name-form.tsx` becomes "Business name"                                                                                                                                  |
| Team                                           | Client-access dialog becomes **location** access; invitations scope by location                                                                                                 |
| Reports and share links                        | "Share report" shares the business; the client picker is hidden                                                                                                                 |
| Inbox filters                                  | Client filter hidden; location filter stays                                                                                                                                     |

Most of this is gated in a few places: the nav registry, `clientPageKind`
consumers, and the setup step list. It is not scattered checks across every
file.

### B5. Tests

- Contract: `sessionSchema` includes the mode.
- Unit: the setup step list per mode; the nav registry per mode; the
  redirects.
- Integration: provisioning creates the home client; linking a location
  files it under the home client; `POST /api/clients` returns 409.
- E2E (port 3100 harness): a business-mode owner never sees the words
  "client" or "agency" on Inbox, Listings, Reports, Team, Settings or Setup.
  Implemented as a text scan with an allowlist.
- Visual fixtures (`tests/visual`): add a business-mode tenant.

## Phase C — Agency mode as a setting (later)

Not built now, but nothing above may block it.

- An owner-only switch in Settings, or support-only at first.
- **Business → Agency:** reveal the home client under its name and turn
  `is_home` off. Clients nav reappears.
- **Agency → Business:** allowed only with at most one active client, which
  becomes the home client.
- Credits stay per organisation. An agency plan would probably want
  per-client reporting of `ai_usage`, which is possible without a schema
  change by joining through `review_id → location → client`.

## Sequencing and PRs

Each PR goes on its own branch off `main`. Checks before each one: `pnpm
typecheck`, `pnpm lint`, and the relevant unit, integration and E2E tests.

1. `feat(ai): record AI usage and token counts`: A1 table, `openAiStructured`
   returns usage, inserts settled rows. No limits yet. Safe to ship first to
   see real costs.
2. `feat(ai): monthly draft credits with reservation`: A2, A3, 402 handling.
3. `feat(inbox): show AI credits and out-of-credits state`: A4 composer,
   Settings usage card, notifications.
4. `feat(workspace): business mode schema and home client`: B1, B2, session
   field. No UI change yet.
5. `feat(shell): business mode navigation and wording`: B3, B4 shell,
   redirects, settings, team, reports.
6. `feat(setup): business setup flow`: B4 wizard.

Migrations are applied manually per `docs/ci.md` and the runbook: staging
first, then production, never as part of a merge.

## Open questions for the product owner

1. **Allowance number.** What monthly credit amount should the default be?
   This needs the real cost per draft, which PR 1 will measure.
2. **Production organisations with more than one client.** The Lapen Inns
   organisation was backfilled with one client per Google account (0043), so
   it may have several. Should they merge into one home client, or should
   that organisation stay in agency mode?
3. **Top-ups.** When a business runs out, does support raise its override,
   or should there be paid top-ups? The latter means billing, which is out of
   scope here.
4. **Regenerate.** Should "regenerate" on the same review cost a credit each
   time? This plan says yes, because each one is a model call.
