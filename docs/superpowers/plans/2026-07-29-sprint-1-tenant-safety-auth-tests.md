# Sprint 1 — Tenant Safety, Authentication, and Test Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make production authentication and tenant isolation functional under the intended database security model: a non-superuser runtime role, RLS actually enforced, a signed-out sign-in entry point, protected `app_user` PII, webhook config assertions, and a route-level integration harness that proves all of it over HTTP — wired into CI.

**Architecture:** A new migration creates a NOLOGIN grants-holder role (`naba_app_runtime`); every environment connects as a LOGIN member of it. A startup assertion in `instrumentation.ts` refuses to boot production with a bypassing role or unsafe webhook config. First-tenant provisioning is reordered to establish `app.organisation_id` before the RLS-sensitive `INSERT … RETURNING`, and `app_user` writes move behind SECURITY DEFINER functions once RLS lands on that table. The route harness boots the real standalone server against the runtime-role `DATABASE_URL` and drives real HTTP with minted session cookies.

**Tech Stack:** PostgreSQL 17 RLS + SECURITY DEFINER, postgres.js, Next.js 16 instrumentation hook, Zod 4, Vitest 4 (integration suites gated by `RUN_DB_TESTS=true`), Playwright + axe, GitHub Actions.

**Sprint dates / points:** 3–14 August 2026, 55 points. Tickets: TST-101 (8), SEC-101 (8), SEC-102 (5), AUTH-101 (8), AUTH-102 (5), TEN-101 (13), WEB-101 (5), CI-101 (3).

## Global Constraints

- No production release while any P0 remains; this sprint's gate is "no remaining uncertainty about whether production sign-in and RLS work together."
- Every fix includes route-level integration tests; "implemented" requires integration-verified behavior.
- Existing uncommitted work on `design-system-replacement` remains untouched; do not commit unless the user explicitly asks.
- Names fixed by the master plan (§2.1): role `naba_app_runtime`, login roles `naba_app` / `naba_test_runtime`, GUC `app.user_id`, functions `provision_google_user`, `attach_member_user`, `provision_local_bootstrap`, module `lib/server/startup.ts` exporting `assertProductionSafety`.
- Migration files follow the repo pattern: `begin; … insert into schema_migration (version) values ('<file-stem>') on conflict (version) do nothing; commit;`
- All commands run with the Supabase stack up (`pnpm supabase:start`, PG at `127.0.0.1:54322`) unless stated otherwise.

**Execution order:** Task 1 (SEC-101) → Task 2 (TST-101) → Task 3 (SEC-102) → Task 4 (AUTH-101) → Task 5 (AUTH-102) → Task 6 (TEN-101) → Task 7 (WEB-101) → Task 8 (CI-101). AUTH-101 lands before TEN-101 on purpose; TEN-101 re-runs AUTH-101's tests after moving `app_user` writes behind the definer function.

---

### Task 1: SEC-101 — Least-privilege runtime role with migration-managed grants

**Deviation:** The baseline contains an ignored local `.worktrees/` checkout, but
the flat ESLint configuration did not ignore it and `pnpm lint` traversed its
generated `.next` output. Added `.worktrees/**` to `globalIgnores` so the
documented repository gate evaluates only this checkout.

**Files:**
- Create: `supabase/migrations/0004_runtime_role.sql`
- Create: `scripts/db-create-runtime-role.mjs`
- Modify: `tests/integration/tenant-isolation.test.ts:15-49` (stop creating grants in the test)
- Modify: `tests/integration/inbox-performance.test.ts` (same beforeAll change)
- Modify: `tests/migration-contract.test.ts` (assert grants; fix the missing `connection_task` entry in `tenantTables`)
- Modify: `compose.yaml` (runtime role for `web`/`scheduler`)
- Modify: `.env.example` (document the role split)

**Interfaces:**
- Produces: DB role `naba_app_runtime` (NOLOGIN grants holder); script `node scripts/db-create-runtime-role.mjs` (idempotent; env `RUNTIME_ROLE_NAME` default `naba_test_runtime`, `RUNTIME_ROLE_PASSWORD` default `naba_test_runtime`, connects via `DIRECT_DATABASE_URL ?? DATABASE_URL`). Every later task's "runtime" connection means a LOGIN member of `naba_app_runtime`.

- [x] **Step 1: Write the failing integration test** — replace the grant bootstrapping in `tests/integration/tenant-isolation.test.ts` `beforeAll` (lines 23-36) so the test *asserts* migration-managed grants instead of creating them:

```ts
  beforeAll(async () => {
    if (!adminUrl || !runtimeUrl) {
      throw new Error(
        "DIRECT_DATABASE_URL and TEST_RUNTIME_DATABASE_URL are required."
      )
    }
    admin = postgres(adminUrl, { max: 1 })
    runtime = postgres(runtimeUrl, { max: 1 })
    const [group] = await admin`
      select 1 as present from pg_roles where rolname = 'naba_app_runtime'
    `
    if (!group) {
      throw new Error(
        "naba_app_runtime missing - run pnpm db:migrate before test:integration"
      )
    }
    const [grant] = await admin`
      select has_table_privilege('naba_app_runtime', 'review', 'select') as ok
    `
    expect(grant.ok).toBe(true)
    // seeding of organisations/locations stays exactly as today (lines 37-48)
```

Apply the same replacement to `inbox-performance.test.ts`'s role-creation block.

- [x] **Step 2: Run to verify failure**

```bash
pnpm supabase:start
DIRECT_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres TEST_RUNTIME_DATABASE_URL=postgresql://naba_test_runtime:naba_test_runtime@127.0.0.1:54322/postgres pnpm test:integration
```

Expected: FAIL with "naba_app_runtime missing".

- [x] **Step 3: Write `supabase/migrations/0004_runtime_role.sql`**

```sql
begin;

-- Grants-holder group role. LOGIN members are created per environment by
-- scripts/db-create-runtime-role.mjs (never by migrations - no passwords here).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'naba_app_runtime') then
    create role naba_app_runtime
      nologin nosuperuser nobypassrls nocreatedb nocreaterole noinherit;
  end if;
end
$$;

grant usage on schema public to naba_app_runtime;
grant select, insert, update, delete on all tables in schema public
  to naba_app_runtime;
grant usage, select on all sequences in schema public to naba_app_runtime;

-- The runtime application must never write migration bookkeeping.
revoke insert, update, delete on schema_migration from naba_app_runtime;

insert into schema_migration (version) values ('0004_runtime_role')
on conflict (version) do nothing;

commit;
```

Rule going forward (enforced in Step 6): every later migration that creates a table adds its own `grant select, insert, update, delete on <table> to naba_app_runtime;` — do not rely on default privileges, because the migration-admin role differs per environment.

- [x] **Step 4: Write `scripts/db-create-runtime-role.mjs`**

```js
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"

import nextEnv from "@next/env"
import postgres from "postgres"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
nextEnv.loadEnvConfig(root)

const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL
if (!url) throw new Error("DIRECT_DATABASE_URL or DATABASE_URL is required")

const roleName = process.env.RUNTIME_ROLE_NAME ?? "naba_test_runtime"
const rolePassword = process.env.RUNTIME_ROLE_PASSWORD ?? "naba_test_runtime"
if (!/^[a-z_][a-z0-9_]*$/.test(roleName)) {
  throw new Error(`Unsafe role name: ${roleName}`)
}

const sql = postgres(url, { max: 1, prepare: false })
try {
  await sql.unsafe(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = '${roleName}') then
        create role ${roleName} login nosuperuser nobypassrls;
      end if;
    end
    $$;
  `)
  await sql.unsafe(
    `alter role ${roleName} with login password '${rolePassword.replaceAll("'", "''")}'`
  )
  await sql.unsafe(`grant naba_app_runtime to ${roleName}`)
  await sql.unsafe(`alter role ${roleName} inherit`)
  console.log(`Runtime login role ready: ${roleName}`)
} finally {
  await sql.end()
}
```

Add the package script in `package.json`: `"db:runtime-role": "node scripts/db-create-runtime-role.mjs"`.

- [x] **Step 5: Apply and verify**

```bash
pnpm db:migrate && pnpm db:runtime-role
DIRECT_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres TEST_RUNTIME_DATABASE_URL=postgresql://naba_test_runtime:naba_test_runtime@127.0.0.1:54322/postgres pnpm test:integration
```

Expected: PASS — including the three pre-existing tenant-isolation cases, now under migration-managed grants.

- [x] **Step 6: Extend `tests/migration-contract.test.ts`** — add `"connection_task"` to the `tenantTables` array (it is in the real RLS loop but missing from the test list), and add:

```ts
it("0004 creates the runtime grants role and protects schema_migration", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/0004_runtime_role.sql", import.meta.url),
    "utf8"
  )
  expect(migration).toContain("create role naba_app_runtime")
  expect(migration).toContain("nologin nosuperuser nobypassrls")
  expect(migration).toContain(
    "revoke insert, update, delete on schema_migration from naba_app_runtime"
  )
})

it("every migration after 0003 grants new tables to naba_app_runtime", async () => {
  const directory = new URL("../supabase/migrations/", import.meta.url)
  const files = (await readdir(directory)).filter(
    (file) => file.endsWith(".sql") && file > "0004"
  )
  for (const file of files) {
    const text = await readFile(new URL(file, directory), "utf8")
    const created = [...text.matchAll(/create table (?:if not exists )?(\w+)/g)]
    for (const [, table] of created) {
      expect(text, `${file} must grant ${table} to naba_app_runtime`).toMatch(
        new RegExp(`grant[^;]+on ${table}[^;]+to naba_app_runtime`)
      )
    }
  }
})
```

- [x] **Step 7: Update `compose.yaml` and `.env.example`.** In `compose.yaml`: give the `migrate` service a second command step so it also creates the runtime login role, and repoint `web` at it. Change the `migrate` service to:

```yaml
    command:
      [
        "sh",
        "-c",
        "node scripts/db-migrate.mjs && RUNTIME_ROLE_NAME=naba_app RUNTIME_ROLE_PASSWORD=naba_app node scripts/db-create-runtime-role.mjs",
      ]
```

and change the `web` service env line to `DATABASE_URL: postgresql://naba_app:naba_app@postgres:5432/nabapresence` (the scheduler service has no `DATABASE_URL`; leave it). In `.env.example`, replace the two top lines' comment with:

```bash
# Runtime connections MUST use a non-superuser member of naba_app_runtime
# (create locally with: pnpm db:runtime-role). Migrations use the admin URL.
DATABASE_URL=postgresql://naba_test_runtime:naba_test_runtime@127.0.0.1:54322/postgres
DIRECT_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

- [x] **Step 8: Run static + unit gates**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: PASS (migration-contract additions green).

---

### Task 2: TST-101 — Route integration-test harness on the real runtime role

**Deviation:** The plan's illustrative `seedReview` insert omits the current
schema's required `external_location_id`, and its raw marker buffers cannot be
decrypted by the real review routes. The helper seeds the minimal
`google_connection`/`external_location` rows and valid harness-key ciphertext;
the binding helper name, parameters, and return shape are unchanged. The draft
IDOR request uses the route's current valid tone `warm_professional` rather
than the plan's invalid `professional`, so request validation does not mask the
intended cross-tenant 404 assertion.
The current Node `ProcessEnv` typing requires an explicit return annotation on
the internal `serverEnv` helper after spreading string overrides; this does not
change the binding `startAppServer` interface. Because organisation cascade
cleanup reaches the intentionally append-only `audit_log`, `destroyTenants`
temporarily disables only its delete-blocking trigger inside the admin cleanup
transaction, then re-enables it; production/runtime behavior is unchanged.

**Files:**
- Create: `tests/integration/helpers/app-server.ts`
- Create: `tests/integration/helpers/tenant.ts`
- Create: `tests/helpers/server-only-stub.ts`
- Create: `tests/integration/routes/auth.test.ts`
- Create: `tests/integration/routes/tenant-isolation-http.test.ts`
- Create: `tests/integration/routes/roles.test.ts`
- Modify: `vitest.config.ts` (alias `server-only` → stub; keep `fileParallelism: false`)

**Interfaces:**
- Consumes: `naba_test_runtime` from Task 1.
- Produces: `startAppServer(overrides?: Record<string, string>): Promise<{ baseUrl: string; stop(): Promise<void> }>` and `expectBootFailure(overrides: Record<string, string>): Promise<string>` (returns stderr) from `helpers/app-server.ts`; `createTestTenant(admin, options?: { role?: "owner"|"admin"|"member"|"viewer"; canPublish?: boolean })` returning `{ organisationId, userId, email, cookie }`, `seedReview(admin, { organisationId, text?, rating? })` returning `{ reviewId, locationId }`, and `destroyTenants(admin, organisationIds)` from `helpers/tenant.ts`. Every later sprint's route tests build on these exact signatures.

- [x] **Step 1: Stub `server-only` for Vitest.** `tests/helpers/server-only-stub.ts` contains only `export {}`. In `vitest.config.ts` add:

```ts
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./tests/helpers/server-only-stub.ts", import.meta.url)
      ),
    },
  },
```

- [x] **Step 2: Write `tests/integration/helpers/app-server.ts`**

```ts
import { spawn, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:net"
import { existsSync } from "node:fs"

const SERVER_ENTRY = ".next/standalone/server.js"

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number }
      probe.close(() => resolve(port))
    })
  })
}

function serverEnv(port: number, overrides: Record<string, string>) {
  return {
    PATH: process.env.PATH!,
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    DATABASE_URL: process.env.TEST_RUNTIME_DATABASE_URL!,
    NEXTAUTH_URL: `http://127.0.0.1:${port}`,
    NEXTAUTH_SECRET: "route-harness-secret-value-32-characters!",
    TOKEN_ENCRYPTION_KEY: "route-harness-token-key-32-characters!!",
    CRON_SECRET: "route-harness-cron-secret",
    LOCAL_BOOTSTRAP_ENABLED: "false",
    WEBHOOKS_ENABLED: "false",
    ...overrides,
  }
}

export async function startAppServer(overrides: Record<string, string> = {}) {
  if (!existsSync(SERVER_ENTRY)) {
    throw new Error("Standalone build missing - run `pnpm build` first")
  }
  if (!process.env.TEST_RUNTIME_DATABASE_URL) {
    throw new Error("TEST_RUNTIME_DATABASE_URL is required")
  }
  const port = await freePort()
  const child: ChildProcess = spawn("node", [SERVER_ENTRY], {
    env: serverEnv(port, overrides),
    stdio: ["ignore", "pipe", "pipe"],
  })
  let stderr = ""
  child.stderr?.on("data", (chunk) => (stderr += chunk))
  const baseUrl = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 30_000
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited ${child.exitCode}: ${stderr}`)
    }
    try {
      const response = await fetch(`${baseUrl}/api/session`)
      if (response.status < 500) break
    } catch {
      /* not listening yet */
    }
    if (Date.now() > deadline) {
      child.kill("SIGKILL")
      throw new Error(`Server never became ready: ${stderr}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return {
    baseUrl,
    stop: async () => {
      child.kill("SIGTERM")
      await Promise.race([
        once(child, "exit"),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ])
      if (child.exitCode === null) child.kill("SIGKILL")
    },
  }
}

export async function expectBootFailure(overrides: Record<string, string>) {
  try {
    const server = await startAppServer(overrides)
    await server.stop()
    throw new Error("Server booted but was expected to fail")
  } catch (error) {
    const message = String(error)
    if (message.includes("expected to fail")) throw error
    return message
  }
}
```

- [x] **Step 3: Write `tests/integration/helpers/tenant.ts`** (admin-seeded tenants + minted session cookies; mirrors `createSession`'s `sha256(token)` storage from `lib/server/session.ts:103-133`):

```ts
import { createHash, randomBytes, randomUUID } from "node:crypto"
import type postgres from "postgres"

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex")

export async function createTestTenant(
  admin: ReturnType<typeof postgres>,
  options: {
    role?: "owner" | "admin" | "member" | "viewer"
    canPublish?: boolean
  } = {}
) {
  const organisationId = randomUUID()
  const userId = randomUUID()
  const email = `harness-${organisationId.slice(0, 8)}@nabapresence.test`
  const token = randomBytes(32).toString("base64url")
  await admin`
    insert into organisation (id, slug, name)
    values (${organisationId}, ${`harness-${organisationId.slice(0, 12)}`},
            'Harness tenant')
  `
  await admin`
    insert into app_user (id, email, display_name, default_organisation_id)
    values (${userId}, ${email}, 'Harness user', ${organisationId})
  `
  await admin`
    insert into member (organisation_id, user_id, role, can_publish)
    values (${organisationId}, ${userId},
            ${options.role ?? "owner"}, ${options.canPublish ?? true})
  `
  await admin`
    insert into app_session (token_hash, user_id, organisation_id, expires_at)
    values (${sha256(token)}, ${userId}, ${organisationId},
            now() + interval '1 hour')
  `
  return { organisationId, userId, email, cookie: `naba_session=${token}` }
}

export async function seedReview(
  admin: ReturnType<typeof postgres>,
  input: { organisationId: string; text?: string; rating?: number }
) {
  const locationId = randomUUID()
  const reviewId = randomUUID()
  const marker = randomUUID()
  await admin`
    insert into location (id, organisation_id, name)
    values (${locationId}, ${input.organisationId}, 'Harness location')
  `
  await admin`
    insert into review (
      id, organisation_id, location_id,
      google_review_name_ciphertext, google_review_name_hash,
      google_review_id_ciphertext, google_review_id_hash,
      reviewer_display_name, reviewer_is_anonymous, star_rating, review_text,
      detected_language_code, language_confidence, has_media,
      create_time, update_time, content_hash, workflow_status, raw_payload
    ) values (
      ${reviewId}, ${input.organisationId}, ${locationId},
      ${Buffer.from(marker)}, ${sha256(`name-${marker}`)},
      ${Buffer.from(marker)}, ${sha256(`id-${marker}`)},
      'Harness reviewer', false, ${input.rating ?? 4},
      ${input.text ?? "Great stay, lovely staff."},
      'en', 0.72, false, now() - interval '1 day', now() - interval '1 day',
      ${sha256(marker)}, 'new', '{}'::jsonb
    )
  `
  return { reviewId, locationId }
}

export async function destroyTenants(
  admin: ReturnType<typeof postgres>,
  organisationIds: string[]
) {
  if (organisationIds.length === 0) return
  await admin`delete from organisation where id in ${admin(organisationIds)}`
  await admin`
    delete from app_user
    where email like 'harness-%@nabapresence.test'
      and default_organisation_id is null
  `
}
```

(If a NOT NULL column added by a later migration breaks `seedReview`, extend the insert here — this helper is the single seam every route suite uses.)

- [x] **Step 4: Write the first three route suites.** All follow this shape — `auth.test.ts`:

```ts
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { createTestTenant, destroyTenants } from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

describeDatabase("route auth", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    server = await startAppServer()
  })
  afterAll(async () => {
    await server.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  it("returns a null session when signed out (production mode)", async () => {
    const response = await fetch(`${server.baseUrl}/api/session`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ session: null })
  })

  it("rejects the inbox without a session", async () => {
    const response = await fetch(`${server.baseUrl}/api/reviews`)
    expect(response.status).toBe(401)
    expect((await response.json()).error).toBe("authentication_required")
  })

  it("returns the session for a minted cookie", async () => {
    const tenant = await createTestTenant(admin)
    organisations.push(tenant.organisationId)
    const response = await fetch(`${server.baseUrl}/api/session`, {
      headers: { cookie: tenant.cookie },
    })
    const { session } = await response.json()
    expect(session.organisationId).toBe(tenant.organisationId)
    expect(session.role).toBe("owner")
  })
})
```

`tenant-isolation-http.test.ts` — seed a review in tenant A and tenant B, then: A's `GET /api/reviews` items contain only A's review id; A's `GET /api/reviews/{B.reviewId}` is **404** (IDOR); A's `POST /api/reviews/{B.reviewId}/drafts` with `{"tone":"professional"}` is **404**. `roles.test.ts` — viewer `PATCH /api/settings` body `{"approvalRequired":true}` is **403 permission_denied**; member `GET /api/audit-log` is **403**; owner `PATCH /api/settings` is **200**.

- [x] **Step 5: Run to verify red→green.** These should pass immediately against current behavior except the null-session case, which passes too (`app/api/session/route.ts:13-19` calls `getSession()` in production). The suite's value is the harness itself:

```bash
pnpm build
DIRECT_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres TEST_RUNTIME_DATABASE_URL=postgresql://naba_test_runtime:naba_test_runtime@127.0.0.1:54322/postgres pnpm test:integration
```

Expected: PASS, with the app server booting on the **runtime role** URL. If the inbox 401 test fails with a 500 mentioning RLS, that is a real finding — fix forward in Task 4, not by weakening the test.

---

### Task 3: SEC-102 — Startup assertion that the runtime identity cannot bypass RLS

**Deviation:** With the installed Zod 4.4, a missing object key is rejected
before `z.unknown().transform(...)` runs. Added `.optional()` to the internal
feature-flag input schema so missing flags reach `parseFeatureFlag` and use the
binding per-flag fallbacks. Next 16 reports an instrumentation rejection as
`Failed to prepare server` while leaving the process alive but unready; the
route harness now treats that stderr signal as boot failure and terminates the
test child, preserving `expectBootFailure`'s binding contract. This Supabase
version's `postgres` login is `rolsuper=false, rolbypassrls=true`, so the
DIRECT_DATABASE_URL boot test asserts the actual `BYPASSRLS` refusal rather
than the plan's assumed superuser message; the startup code still checks both,
and Task 7's unit test covers both identity flags.

**Files:**
- Create: `lib/server/startup.ts`
- Create: `tests/env-flags.test.ts`
- Create: `tests/integration/startup-assertion.test.ts`
- Modify: `instrumentation.ts`
- Modify: `lib/server/env.ts:5-10` (feature-flag empty-string fix)

**Interfaces:**
- Produces: `assertProductionSafety(options?: { enforce?: boolean }): Promise<void>` and `collectSafetyViolations(env: ServerEnv, identity: DbIdentity): string[]` where `type DbIdentity = { rolSuper: boolean; rolBypassRls: boolean; rowSecurity: string }`. Task 7 (WEB-101) adds one more violation rule to `collectSafetyViolations`; Sprint 3+ startup checks extend the same module.

- [x] **Step 1: Write the failing unit test** — `tests/env-flags.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { parseFeatureFlag } from "@/lib/server/env"

describe("feature flags", () => {
  it("treats empty string as the documented default, not true", () => {
    expect(parseFeatureFlag("", true)).toBe(true)
    expect(parseFeatureFlag("", false)).toBe(false)
    expect(parseFeatureFlag(undefined, false)).toBe(false)
    expect(parseFeatureFlag("true", false)).toBe(true)
    expect(parseFeatureFlag("false", true)).toBe(false)
  })
})
```

- [x] **Step 2: Run it** — `pnpm test tests/env-flags.test.ts` — Expected: FAIL (`parseFeatureFlag` not exported).

- [x] **Step 3: Fix the flag parser in `lib/server/env.ts`.** Replace the current `featureFlag` const (lines 5-10) with:

```ts
export function parseFeatureFlag(
  value: unknown,
  fallback: boolean
): boolean {
  if (value === undefined || value === "") return fallback
  if (value === "true") return true
  if (value === "false") return false
  throw new Error(`Feature flag must be "true" or "false", got: ${value}`)
}

const featureFlag = (fallback: boolean) =>
  z.unknown().transform((value) => parseFeatureFlag(value, fallback))
```

and update the five usages: `DRAFTS_ENABLED: featureFlag(true)`, `PUBLISH_ENABLED: featureFlag(true)`, `SYNC_ENABLED: featureFlag(true)`, `WEBHOOKS_ENABLED: featureFlag(true)`, `LOCAL_BOOTSTRAP_ENABLED: featureFlag(false)` (drop the old `.default(false)` chain). Run Step 1's test again — Expected: PASS. Run `pnpm test` — the previously-verified quirk (`LOCAL_BOOTSTRAP_ENABLED=""` ⇒ `true`) is now dead.

- [x] **Step 4: Write `lib/server/startup.ts`**

```ts
import "server-only"

import { getDatabase } from "@/lib/server/db"
import { getServerEnv, type ServerEnv } from "@/lib/server/env"
import { log } from "@/lib/server/logger"

export type DbIdentity = {
  rolSuper: boolean
  rolBypassRls: boolean
  rowSecurity: string
}

export function collectSafetyViolations(
  env: ServerEnv,
  identity: DbIdentity
): string[] {
  const violations: string[] = []
  if (identity.rolSuper) {
    violations.push(
      "DATABASE_URL connects as a superuser; row-level security is inert."
    )
  }
  if (identity.rolBypassRls) {
    violations.push("The runtime role has BYPASSRLS; tenant isolation is off.")
  }
  if (identity.rowSecurity !== "on") {
    violations.push(`row_security is '${identity.rowSecurity}', expected 'on'.`)
  }
  if (env.LOCAL_BOOTSTRAP_ENABLED) {
    const hostname = env.NEXTAUTH_URL ? new URL(env.NEXTAUTH_URL).hostname : ""
    if (hostname !== "localhost" && hostname !== "127.0.0.1") {
      violations.push(
        "LOCAL_BOOTSTRAP_ENABLED must not be set on a non-localhost deployment."
      )
    }
  }
  return violations
}

export async function readDbIdentity(): Promise<DbIdentity> {
  const [row] = await getDatabase()<
    { rolSuper: boolean; rolBypassRls: boolean; rowSecurity: string }[]
  >`
    select
      r.rolsuper as "rolSuper",
      r.rolbypassrls as "rolBypassRls",
      current_setting('row_security') as "rowSecurity"
    from pg_roles r
    where r.rolname = current_user
  `
  return row
}

export async function assertProductionSafety(
  options: { enforce?: boolean } = {}
): Promise<void> {
  const enforce =
    options.enforce ??
    (process.env.NODE_ENV === "production" ||
      process.env.ENFORCE_DB_SAFETY === "true")
  const violations = collectSafetyViolations(
    getServerEnv(),
    await readDbIdentity()
  )
  if (violations.length === 0) {
    log.info("startup.safety_ok", { enforce })
    return
  }
  if (enforce) {
    throw new Error(`Unsafe deployment configuration:\n- ${violations.join("\n- ")}`)
  }
  log.warn("startup.safety_violations_ignored", { violations })
}
```

- [x] **Step 5: Wire it into `instrumentation.ts`** — extend `register()`:

```ts
export async function register() {
  registerOTel({ serviceName: "nabapresence" })
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertProductionSafety } = await import("@/lib/server/startup")
    await assertProductionSafety()
  }
}
```

A thrown error here aborts `next start` — that is the intended behavior.

- [x] **Step 6: Write the integration proof** — `tests/integration/startup-assertion.test.ts` (uses the Task 2 helpers; gated on `RUN_DB_TESTS`):

```ts
it("boots on the runtime role", async () => {
  const server = await startAppServer()
  await server.stop()
})

it("refuses to boot as a superuser", async () => {
  const message = await expectBootFailure({
    DATABASE_URL: process.env.DIRECT_DATABASE_URL!,
  })
  expect(message).toContain("superuser")
})
```

- [x] **Step 7: Rebuild and run**

```bash
pnpm build
DIRECT_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres TEST_RUNTIME_DATABASE_URL=postgresql://naba_test_runtime:naba_test_runtime@127.0.0.1:54322/postgres pnpm test:integration
```

Expected: PASS. Also run `pnpm test && pnpm typecheck && pnpm lint`.

---

### Task 4: AUTH-101 — Provision the first tenant with tenant context established before `INSERT … RETURNING`

**Deviation:** Focused Vitest integration runs do not load the application
`.env`; the provisioning suite supplies deterministic test-only values for the
three required server secrets so the P0 reproduction reaches PostgreSQL rather
than failing environment validation.

**Files:**
- Create: `lib/server/provisioning.ts`
- Create: `lib/server/session-store.ts` (move `createSession` out of the `next/headers` module)
- Create: `tests/integration/provisioning.test.ts`
- Modify: `app/api/google/connect/callback/route.ts:44-107` (delete the inline `provisionOwner`, import the new one)
- Modify: `lib/server/session.ts` (re-export `createSession` from the new store module)

**Interfaces:**
- Consumes: `withTenant` (`lib/server/db.ts:40`), `sha256` (`lib/server/crypto.ts:46`).
- Produces: `provisionOwner(profile: { sub: string; email?: string; name?: string }): Promise<{ organisationId: string; userId: string; token: string }>` from `lib/server/provisioning.ts`; `createSession(sql: TransactionSql, userId, organisationId, options?)` re-exported unchanged from `lib/server/session.ts`. Task 6 swaps this module's `app_user` upsert for `provision_google_user(...)`; Sprint 4 MEM-401 adds `provisionMember(profile, invitation)` beside it.

- [x] **Step 1: Move `createSession`.** Create `lib/server/session-store.ts` containing exactly the current `createSession` function body (`lib/server/session.ts:103-133`) plus its imports (`randomToken`, `sha256` from crypto; `TransactionSql` type). In `lib/server/session.ts`, delete the function and add `export { createSession } from "@/lib/server/session-store"`. No other import site changes (verify with `grep -rn "createSession" app lib`).

- [x] **Step 2: Write the failing integration test** — `tests/integration/provisioning.test.ts`. This is the direct P0 reproduction: it must run as the **runtime role**:

```ts
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

describeDatabase("first-tenant provisioning under RLS", () => {
  let admin: ReturnType<typeof postgres>
  const createdOrgs: string[] = []

  beforeAll(() => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    process.env.DATABASE_URL = process.env.TEST_RUNTIME_DATABASE_URL!
  })
  afterAll(async () => {
    if (createdOrgs.length) {
      await admin`delete from organisation where id in ${admin(createdOrgs)}`
    }
    await admin`delete from app_user where email like 'provision-%@example.test'`
    await admin.end()
  })

  it("provisions a brand-new user and organisation as the runtime role", async () => {
    const { provisionOwner } = await import("@/lib/server/provisioning")
    const sub = `sub-${crypto.randomUUID()}`
    const result = await provisionOwner({
      sub,
      email: `provision-${sub.slice(4, 12)}@example.test`,
      name: "Provision Test",
    })
    createdOrgs.push(result.organisationId)
    expect(result.organisationId).toMatch(/^[0-9a-f-]{36}$/)
    const [member] = await admin`
      select role, can_publish as "canPublish" from member
      where organisation_id = ${result.organisationId}
        and user_id = ${result.userId}
    `
    expect(member).toEqual({ role: "owner", canPublish: true })
    const [user] = await admin`
      select default_organisation_id::text as org from app_user
      where id = ${result.userId}
    `
    expect(user.org).toBe(result.organisationId)
  })

  it("reuses the default organisation for a returning user", async () => {
    const { provisionOwner } = await import("@/lib/server/provisioning")
    const sub = `sub-${crypto.randomUUID()}`
    const email = `provision-${sub.slice(4, 12)}@example.test`
    const first = await provisionOwner({ sub, email, name: "Repeat" })
    createdOrgs.push(first.organisationId)
    const second = await provisionOwner({ sub, email, name: "Repeat" })
    expect(second.organisationId).toBe(first.organisationId)
  })
})
```

- [x] **Step 3: Run to verify it fails for the *right* reason.** Temporarily create `lib/server/provisioning.ts` as a re-export of the current inline logic copied verbatim from the callback route. Run:

```bash
DIRECT_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres TEST_RUNTIME_DATABASE_URL=postgresql://naba_test_runtime:naba_test_runtime@127.0.0.1:54322/postgres RUN_DB_TESTS=true pnpm exec vitest run tests/integration/provisioning.test.ts
```

Expected: FAIL with `new row violates row-level security policy for table "organisation"` — the audited P0, now reproduced in CI-runnable form.

- [x] **Step 4: Write the fixed `lib/server/provisioning.ts`**

```ts
import "server-only"

import { sha256 } from "@/lib/server/crypto"
import { getDatabase } from "@/lib/server/db"
import { createSession } from "@/lib/server/session-store"

export type GoogleProfile = { sub: string; email?: string; name?: string }

export async function provisionOwner(profile: GoogleProfile) {
  return getDatabase().begin(async (sql) => {
    const slugBase = (profile.email?.split("@")[0] ?? profile.sub)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40)
    const [user] = await sql<
      { id: string; default_organisation_id: string | null }[]
    >`
      insert into app_user (email, display_name, google_subject)
      values (
        ${profile.email ?? `${profile.sub}@google.invalid`},
        ${profile.name ?? profile.email ?? "Google user"},
        ${profile.sub}
      )
      on conflict (email) do update
      set google_subject = excluded.google_subject,
          display_name = excluded.display_name
      returning
        id::text as id,
        default_organisation_id::text as default_organisation_id
    `
    let organisationId = user.default_organisation_id
    if (!organisationId) {
      // Establish the tenant context BEFORE the RLS-sensitive insert so the
      // organisation_isolation USING clause makes the RETURNING row visible.
      organisationId = crypto.randomUUID()
      await sql`
        select set_config('app.organisation_id', ${organisationId}, true)
      `
      await sql`
        insert into organisation (id, slug, name)
        values (
          ${organisationId},
          ${`${slugBase || "organisation"}-${sha256(profile.sub).slice(0, 8)}`},
          ${profile.name ? `${profile.name}'s organisation` : "My organisation"}
        )
      `
      await sql`
        insert into member (organisation_id, user_id, role, can_publish)
        values (${organisationId}, ${user.id}, 'owner', true)
      `
      await sql`
        update app_user
        set default_organisation_id = ${organisationId}
        where id = ${user.id}
      `
    } else {
      await sql`
        select set_config('app.organisation_id', ${organisationId}, true)
      `
    }
    const token = await createSession(sql, user.id, organisationId)
    return { organisationId, userId: user.id, token }
  })
}
```

Note what changed versus `app/api/google/connect/callback/route.ts:71-84`: the org id is generated app-side, `set_config` moves **before** the insert, and the insert carries the explicit `id` with no `RETURNING`.

- [x] **Step 5: Update the callback route.** In `app/api/google/connect/callback/route.ts`: delete the inline `provisionOwner` (lines 44-107), add `import { provisionOwner } from "@/lib/server/provisioning"`, and keep the call site at line 143 identical (`const provisioned = await provisionOwner(profile)`).

- [x] **Step 6: Run the provisioning test again** — Expected: PASS (both cases) as the runtime role.

- [x] **Step 7: Full gates + rebuild for the harness**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
DIRECT_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres TEST_RUNTIME_DATABASE_URL=postgresql://naba_test_runtime:naba_test_runtime@127.0.0.1:54322/postgres pnpm test:integration
```

Expected: all PASS.

---

### Task 5: AUTH-102 — Signed-out production entry point that can begin Google OAuth

**Deviation:** A user-owned `next dev` process was already listening on port
3000, and Playwright's local `reuseExistingServer` tested that stale process
instead of the fresh standalone build. Added an opt-in `PLAYWRIGHT_PORT`
override (default and CI behavior unchanged) so local production-build gates
can use an isolated port without stopping the user's server. The isolated axe
run also found the existing 10px mobile sidebar tagline at 4.24:1 contrast;
raised its existing foreground opacity token from 60% to 70% to meet WCAG AA.

**Files:**
- Create: `app/sign-in/page.tsx`
- Create: `components/naba-presence/sign-in-view.tsx`
- Modify: `app/(dashboard)/layout.tsx` (server-side session gate)
- Modify: `app/page.tsx` (root redirect respects auth)
- Modify: `app/api/google/connect/callback/route.ts:265-279` (error redirects land on `/sign-in`)
- Modify: `components/naba-presence/app-shell.tsx:92-106` (sign-out button in the footer)
- Modify: `lib/naba-presence-api.ts` (add `signOut()`)
- Create: `tests/integration/routes/sign-in.test.ts`
- Modify: `tests/e2e/accessibility.spec.ts` (add a `/sign-in` axe scenario)

**Interfaces:**
- Consumes: `beginGoogleConnect()` (`lib/naba-presence-api.ts:332`, already session-optional), `getSession`/`isLocalBootstrapEnabled` (`lib/server/session.ts`).
- Produces: route `/sign-in`; `signOut(): Promise<void>` in `lib/naba-presence-api.ts` (calls `DELETE /api/session`). Sprint 4 MEM-401's invitation page reuses `SignInView` with an `inviteToken` prop — keep the component prop-ready (`{ errorStatus?: string }` today).

- [x] **Step 1: Write the failing route test** — `tests/integration/routes/sign-in.test.ts` (harness helpers; production server, bootstrap off):

```ts
it("redirects anonymous dashboard traffic to /sign-in", async () => {
  const response = await fetch(`${server.baseUrl}/reviews`, {
    redirect: "manual",
  })
  expect([303, 307]).toContain(response.status)
  expect(response.headers.get("location")).toContain("/sign-in")
})

it("serves the sign-in page with a Google entry point", async () => {
  const response = await fetch(`${server.baseUrl}/sign-in`)
  expect(response.status).toBe(200)
  expect(await response.text()).toContain("Continue with Google")
})

it("keeps signed-in users on the dashboard", async () => {
  const tenant = await createTestTenant(admin)
  organisations.push(tenant.organisationId)
  const response = await fetch(`${server.baseUrl}/reviews`, {
    headers: { cookie: tenant.cookie },
    redirect: "manual",
  })
  expect(response.status).toBe(200)
})

it("still lets a signed-out caller start OAuth", async () => {
  const response = await fetch(
    `${server.baseUrl}/api/google/connect/start`,
    { method: "POST" }
  )
  // 503 google_not_configured is acceptable when GOOGLE_CLIENT_ID is unset;
  // 401 is the failure this test guards against.
  expect(response.status).not.toBe(401)
})
```

- [x] **Step 2: Run it** (after `pnpm build`) — Expected: FAIL — `/reviews` returns 200 for anonymous users today.

- [x] **Step 3: Implement the gate.** `app/(dashboard)/layout.tsx` becomes:

```tsx
import { redirect } from "next/navigation"

import { NabaPresenceDashboard } from "@/components/naba-presence/review-app"
import { getSession, isLocalBootstrapEnabled } from "@/lib/server/session"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getSession()
  const allowAnonymous =
    process.env.NODE_ENV !== "production" || isLocalBootstrapEnabled()
  if (!session && !allowAnonymous) redirect("/sign-in")
  return <NabaPresenceDashboard>{children}</NabaPresenceDashboard>
}
```

`app/page.tsx` becomes the same check redirecting to `/reviews` or `/sign-in`.

- [x] **Step 4: Build the page.** `app/sign-in/page.tsx`:

```tsx
import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { SignInView } from "@/components/naba-presence/sign-in-view"
import { getSession } from "@/lib/server/session"

export const metadata: Metadata = { title: "Sign in — NabaPresence" }

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string; status?: string }>
}) {
  if (await getSession()) redirect("/reviews")
  const params = await searchParams
  return (
    <SignInView
      errorStatus={params.google === "error" ? (params.status ?? "unknown") : undefined}
    />
  )
}
```

`components/naba-presence/sign-in-view.tsx` — a client component using the existing design-system primitives (`Card`, `Button`, `Alert` from `components/ui`, matching `connections-view.tsx` idioms): heading "Sign in to NabaPresence", supporting copy "Connect the Google account that manages your Business Profile.", an `Alert` shown when `errorStatus` is set ("Google sign-in failed (status {errorStatus}). Try again."), and a `Button` labeled **Continue with Google** whose `onClick` is:

```tsx
const [pending, setPending] = useState(false)
async function continueWithGoogle() {
  setPending(true)
  try {
    const { authorizationUrl } = await beginGoogleConnect()
    window.location.assign(authorizationUrl)
  } catch (error) {
    setPending(false)
    setLocalError(error instanceof Error ? error.message : "Sign-in failed.")
  }
}
```

- [x] **Step 5: Route callback errors to the page.** In `app/api/google/connect/callback/route.ts` `GET` (lines 270-277), change the error redirect target from `/?google=error&status=${response.status}` to `/sign-in?google=error&status=${response.status}`.

- [x] **Step 6: Sign-out.** Add to `lib/naba-presence-api.ts`: `export async function signOut(): Promise<void> { await apiFetch("/api/session", { method: "DELETE" }) }` (note: `apiFetch` throws on non-2xx; `DELETE /api/session` returns 204). In `components/naba-presence/app-shell.tsx`, make the footer identity block include a "Sign out" `SidebarMenuButton` that calls `signOut()` then `window.location.assign("/sign-in")`.

- [x] **Step 7: Accessibility coverage.** In `tests/e2e/accessibility.spec.ts`, add one scenario (both viewports, following the existing per-test shape at line 43): navigate to `/sign-in`, `expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible()`, run the same `AxeBuilder` scan with zero violations. No API mocks are needed. (CI runs the e2e server with `LOCAL_BOOTSTRAP_ENABLED=true`; `/sign-in` renders regardless of session because CI's bootstrap session only exists after `/api/session` is called — the page itself must not crash either way.)

- [x] **Step 8: Verify**

```bash
pnpm typecheck && pnpm lint && pnpm build
DIRECT_DATABASE_URL=... TEST_RUNTIME_DATABASE_URL=... pnpm test:integration
pnpm test:a11y
```

Expected: all PASS, including the new sign-in route tests and axe scenario.

---

### Task 6: TEN-101 — Protect `app_user`; constrain the content-free routing tables

**Files:**
- Create: `supabase/migrations/0005_tenant_hardening.sql`
- Create: `tests/integration/app-user-isolation.test.ts`
- Create: `tests/integration/routing-tables.test.ts`
- Modify: `lib/server/provisioning.ts` (use `provision_google_user`)
- Modify: `app/api/members/route.ts:88-94` (use `attach_member_user`)
- Modify: `lib/server/session.ts` (set `app.user_id` in `syncLocalOwnerIdentity`; bootstrap via `provision_local_bootstrap`)
- Modify: `app/api/google/locations/route.ts` (surface webhook-route conflicts as 409)
- Modify: `tests/migration-contract.test.ts` (cover 0005)

**Interfaces:**
- Consumes: Task 1's role, Task 4's `provisionOwner`.
- Produces: SQL functions `provision_google_user(p_email text, p_display_name text, p_google_subject text) returns table (id uuid, default_organisation_id uuid)`, `attach_member_user(p_email text, p_display_name text) returns uuid`, `provision_local_bootstrap(p_organisation_id uuid, p_user_id uuid) returns void`; GUC `app.user_id`; error contract `409 location_routing_conflict` on cross-tenant `webhook_route` claims. Sprint 4 HARD-401 hardens `provision_google_user` with `email_verified` rules — same function name.

- [ ] **Step 1: Write the failing SQL-level tests** — `tests/integration/app-user-isolation.test.ts`:

```ts
describeDatabase("app_user isolation", () => {
  // admin + runtime connections and two tenants (A, B) seeded as in
  // tenant-isolation.test.ts; user records created per tenant via admin.

  it("hides other tenants' users from a tenant transaction", async () => {
    const rows = await runtime.begin(async (sql) => {
      await sql`select set_config('app.organisation_id', ${organisationA}, true)`
      return sql`select email from app_user`
    })
    expect(rows.map((row) => row.email)).toEqual([userAEmail])
  })

  it("denies reading app_user with no context at all", async () => {
    expect(await runtime`select email from app_user`).toEqual([])
  })

  it("blocks direct inserts from the runtime role", async () => {
    await expect(
      runtime`insert into app_user (email, display_name) values ('x@y.z', 'X')`
    ).rejects.toThrow(/row-level security/)
  })

  it("provisions through the definer function without any context", async () => {
    const [user] = await runtime`
      select id from provision_google_user('def-${suffix}@example.test', 'Def', 'sub-${suffix}')
    `
    expect(user.id).toBeTruthy()
  })

  it("attach_member_user never rewrites an existing display name", async () => {
    await runtime.begin(async (sql) => {
      await sql`select set_config('app.organisation_id', ${organisationA}, true)`
      await sql`select attach_member_user(${userBEmail}, 'Hijacked Name')`
    })
    const [row] = await admin`
      select display_name from app_user where email = ${userBEmail}
    `
    expect(row.display_name).toBe("Tenant B user")
  })
})
```

and `tests/integration/routing-tables.test.ts`:

```ts
it("lets a tenant claim a webhook route for itself", async () => {
  await runtime.begin(async (sql) => {
    await sql`select set_config('app.organisation_id', ${organisationA}, true)`
    await sql`
      insert into webhook_route (google_location_name, organisation_id, external_location_id)
      values (${locationName}, ${organisationA}, ${externalLocationA})
    `
  })
})

it("blocks another tenant from stealing the same route", async () => {
  await expect(
    runtime.begin(async (sql) => {
      await sql`select set_config('app.organisation_id', ${organisationB}, true)`
      await sql`
        insert into webhook_route (google_location_name, organisation_id, external_location_id)
        values (${locationName}, ${organisationB}, ${externalLocationB})
        on conflict (google_location_name) do update
        set organisation_id = excluded.organisation_id,
            external_location_id = excluded.external_location_id
      `
    })
  ).rejects.toThrow()
})

it("still resolves routes with no tenant context (webhook path)", async () => {
  const [row] = await runtime`
    select organisation_id::text as org from webhook_route
    where google_location_name = ${locationName}
  `
  expect(row.org).toBe(organisationA)
})

it("keeps organisation_job_route readable context-free but not writable", async () => {
  expect(
    (await runtime`select organisation_id from organisation_job_route`).length
  ).toBeGreaterThan(0)
  await expect(
    runtime`insert into organisation_job_route (organisation_id) values (${organisationB})`
  ).rejects.toThrow(/row-level security/)
})
```

- [ ] **Step 2: Run both** — Expected: FAIL (no policies exist; `provision_google_user` undefined).

- [ ] **Step 3: Write `supabase/migrations/0005_tenant_hardening.sql`**

```sql
begin;

-- ---------------------------------------------------------------------------
-- app_user: RLS with self-access (app.user_id) and member-of-current-org reads
-- ---------------------------------------------------------------------------
alter table app_user enable row level security;
alter table app_user force row level security;

create policy app_user_member_read on app_user
  for select
  using (
    exists (
      select 1 from member m
      where m.user_id = app_user.id
        and m.organisation_id =
          nullif(current_setting('app.organisation_id', true), '')::uuid
    )
  );

create policy app_user_self_read on app_user
  for select
  using (id = nullif(current_setting('app.user_id', true), '')::uuid);

create policy app_user_self_update on app_user
  for update
  using (id = nullif(current_setting('app.user_id', true), '')::uuid)
  with check (id = nullif(current_setting('app.user_id', true), '')::uuid);

-- Session bootstrap: the token-hash lookup joins app_user before the org GUC
-- exists; allow reading exactly the user attached to the presented session.
create policy app_user_session_read on app_user
  for select
  using (
    exists (
      select 1 from app_session s
      where s.user_id = app_user.id
        and s.token_hash =
          nullif(current_setting('app.session_token_hash', true), '')
    )
  );

-- All inserts and identity linking go through SECURITY DEFINER functions.
create function provision_google_user(
  p_email text,
  p_display_name text,
  p_google_subject text
) returns table (id uuid, default_organisation_id uuid)
language plpgsql security definer set search_path = public as $$
begin
  return query
  insert into app_user as u (email, display_name, google_subject)
  values (p_email, p_display_name, p_google_subject)
  on conflict (email) do update
    set google_subject = excluded.google_subject,
        display_name = excluded.display_name
  returning u.id, u.default_organisation_id;
end;
$$;

create function attach_member_user(
  p_email text,
  p_display_name text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  insert into app_user (email, display_name)
  values (p_email, p_display_name)
  on conflict (email) do nothing;
  select u.id into v_id from app_user u where u.email = p_email;
  return v_id;
end;
$$;

create function provision_local_bootstrap(
  p_organisation_id uuid,
  p_user_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into organisation (id, slug, name)
  values (p_organisation_id, 'lapen-inns', 'Lapen Inns')
  on conflict (id) do update set name = excluded.name;
  insert into app_user (id, email, display_name)
  values (p_user_id, 'local-owner@nabapresence.local', 'Local owner')
  on conflict (id) do nothing;
  insert into member (organisation_id, user_id, role, can_publish)
  values (p_organisation_id, p_user_id, 'owner', true)
  on conflict (organisation_id, user_id)
  do update set role = 'owner', can_publish = true;
end;
$$;

revoke all on function provision_google_user(text, text, text) from public;
revoke all on function attach_member_user(text, text) from public;
revoke all on function provision_local_bootstrap(uuid, uuid) from public;
grant execute on function provision_google_user(text, text, text)
  to naba_app_runtime;
grant execute on function attach_member_user(text, text) to naba_app_runtime;
grant execute on function provision_local_bootstrap(uuid, uuid)
  to naba_app_runtime;

-- ---------------------------------------------------------------------------
-- Routing tables: world-readable by the runtime role, tenant-checked writes
-- ---------------------------------------------------------------------------
alter table webhook_route enable row level security;
alter table webhook_route force row level security;
create policy webhook_route_resolve on webhook_route
  for select using (true);
create policy webhook_route_claim on webhook_route
  for insert
  with check (
    organisation_id =
      nullif(current_setting('app.organisation_id', true), '')::uuid
  );
create policy webhook_route_update_own on webhook_route
  for update
  using (
    organisation_id =
      nullif(current_setting('app.organisation_id', true), '')::uuid
  )
  with check (
    organisation_id =
      nullif(current_setting('app.organisation_id', true), '')::uuid
  );
create policy webhook_route_delete_own on webhook_route
  for delete
  using (
    organisation_id =
      nullif(current_setting('app.organisation_id', true), '')::uuid
  );

alter table organisation_job_route enable row level security;
alter table organisation_job_route force row level security;
create policy organisation_job_route_read on organisation_job_route
  for select using (true);
-- Rows are created only by the organisation trigger, now privileged:
alter function register_organisation_job_route() security definer
  set search_path = public;

insert into schema_migration (version) values ('0005_tenant_hardening')
on conflict (version) do nothing;

commit;
```

- [ ] **Step 4: Update the three call sites.**
  - `lib/server/provisioning.ts`: replace the raw `insert into app_user … on conflict` (Step 4 of Task 4) with `const [user] = await sql<{ id: string; default_organisation_id: string | null }[]>\`select id::text as id, default_organisation_id::text as default_organisation_id from provision_google_user(${profile.email ?? `${profile.sub}@google.invalid`}, ${profile.name ?? profile.email ?? "Google user"}, ${profile.sub})\``.
  - `app/api/members/route.ts:88-94`: replace the upsert with `const [user] = await sql<{ id: string }[]>\`select attach_member_user(${input.email}, ${input.displayName})::text as id\``. The stale-display-name concern disappears (function never updates existing rows); the response continues to echo `input.displayName` for the newly-invited case only — change the `return` at line 136 to read the actual row: `const [profileRow] = await sql\`select email, display_name as "displayName" from app_user where id = ${user.id}\`` and spread that instead.
  - `lib/server/session.ts`: in `ensureDevelopmentSession` (lines 214-243), replace the three inline upserts with `await sql\`select provision_local_bootstrap(${LOCAL_ORGANISATION_ID}, ${LOCAL_USER_ID})\`` (keep the surrounding `set_config` + `createSession`). In `syncLocalOwnerIdentity` (line 157), add `await sql\`select set_config('app.user_id', ${LOCAL_USER_ID}, true)\`` immediately after the org `set_config` so the self-update policy admits the identity sync.

- [ ] **Step 5: Surface routing conflicts.** In `app/api/google/locations/route.ts`, wrap the `webhook_route` upsert (lines 100-115) in try/catch; on a postgres error with `code === "42501"` (RLS violation — another tenant owns the route), throw `new ApiError(409, "location_routing_conflict", "That Google location is already routed to a different organisation.")`. Add this case to `tests/integration/routing-tables.test.ts` as an HTTP-level test later in Sprint 3 (WEB-303 owns the full semantics); the SQL-level tests above are Sprint 1's evidence.

- [ ] **Step 6: Migrate + run all integration suites**

```bash
pnpm db:migrate
DIRECT_DATABASE_URL=... TEST_RUNTIME_DATABASE_URL=... pnpm test:integration
```

Expected: PASS — including Task 4's provisioning tests (they now exercise `provision_google_user`) and Task 2's HTTP suites (session lookup now depends on `app_user_session_read`; if `GET /api/session` breaks, the policy above is wrong — fix the policy, not the test).

- [ ] **Step 7: Migration-contract additions** — extend `tests/migration-contract.test.ts` with string assertions for 0005: contains `alter table app_user enable row level security`, `security definer` (×3 functions), `webhook_route_claim`. Run `pnpm test`.

- [ ] **Step 8: Full gates** — `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:integration && pnpm test:a11y`. Expected: PASS.

---

### Task 7: WEB-101 — Require strong Pub/Sub verification config when webhooks are enabled

**Files:**
- Modify: `lib/server/startup.ts` (one more violation rule)
- Create: `tests/startup-safety.test.ts` (pure unit tests over `collectSafetyViolations`)
- Modify: `tests/integration/startup-assertion.test.ts` (boot-failure case)

**Interfaces:**
- Consumes: Task 3's `collectSafetyViolations(env, identity)`.
- Produces: the rule "production + `WEBHOOKS_ENABLED` ⇒ `GOOGLE_PUBSUB_AUDIENCE` required" (OIDC is mandatory; the shared token remains an optional *additional* check — `verifyPubSubRequest` in `lib/server/pubsub.ts:21-68` already enforces whatever is configured per request and stays unchanged).

- [ ] **Step 1: Write the failing unit test** — `tests/startup-safety.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { collectSafetyViolations } from "@/lib/server/startup"

const safeIdentity = { rolSuper: false, rolBypassRls: false, rowSecurity: "on" }
const baseEnv = {
  WEBHOOKS_ENABLED: false,
  LOCAL_BOOTSTRAP_ENABLED: false,
  GOOGLE_PUBSUB_AUDIENCE: undefined,
  NEXTAUTH_URL: "https://reviews.example.com",
} as never

describe("collectSafetyViolations", () => {
  it("accepts a safe configuration", () => {
    expect(collectSafetyViolations(baseEnv, safeIdentity)).toEqual([])
  })
  it("flags superuser and BYPASSRLS identities", () => {
    expect(
      collectSafetyViolations(baseEnv, { ...safeIdentity, rolSuper: true })
    ).toHaveLength(1)
    expect(
      collectSafetyViolations(baseEnv, { ...safeIdentity, rolBypassRls: true })
    ).toHaveLength(1)
  })
  it("requires the Pub/Sub OIDC audience when webhooks are on", () => {
    const violations = collectSafetyViolations(
      { ...baseEnv, WEBHOOKS_ENABLED: true } as never,
      safeIdentity
    )
    expect(violations.join(" ")).toContain("GOOGLE_PUBSUB_AUDIENCE")
  })
  it("accepts webhooks with an audience configured", () => {
    expect(
      collectSafetyViolations(
        {
          ...baseEnv,
          WEBHOOKS_ENABLED: true,
          GOOGLE_PUBSUB_AUDIENCE: "https://reviews.example.com/api/webhooks/google/pubsub",
        } as never,
        safeIdentity
      )
    ).toEqual([])
  })
  it("flags LOCAL_BOOTSTRAP_ENABLED off localhost", () => {
    expect(
      collectSafetyViolations(
        { ...baseEnv, LOCAL_BOOTSTRAP_ENABLED: true } as never,
        safeIdentity
      )
    ).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run** — `pnpm test tests/startup-safety.test.ts` — Expected: FAIL on the audience case only.

- [ ] **Step 3: Add the rule** to `collectSafetyViolations` in `lib/server/startup.ts`:

```ts
  if (env.WEBHOOKS_ENABLED && !env.GOOGLE_PUBSUB_AUDIENCE) {
    violations.push(
      "WEBHOOKS_ENABLED requires GOOGLE_PUBSUB_AUDIENCE (OIDC push verification) in production."
    )
  }
```

Run Step 1's test — Expected: PASS.

- [ ] **Step 4: Boot-level proof.** Add to `tests/integration/startup-assertion.test.ts`:

```ts
it("refuses to boot with webhooks enabled and no OIDC audience", async () => {
  const message = await expectBootFailure({ WEBHOOKS_ENABLED: "true" })
  expect(message).toContain("GOOGLE_PUBSUB_AUDIENCE")
})

it("boots with webhooks enabled once the audience is set", async () => {
  const server = await startAppServer({
    WEBHOOKS_ENABLED: "true",
    GOOGLE_PUBSUB_AUDIENCE: "https://harness.invalid/api/webhooks/google/pubsub",
  })
  await server.stop()
})
```

- [ ] **Step 5: Rebuild + run** — `pnpm build && pnpm test:integration` (with the env vars) — Expected: PASS.

---

### Task 8: CI-101 — Run route tests and runtime-role/RLS checks in CI

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json` (add `test:e2e`)

**Interfaces:**
- Consumes: everything above. Produces: the CI contract all later sprints extend (their route suites land in `tests/integration/routes/**` and run automatically).

- [ ] **Step 1: Add the e2e script** — `package.json`: `"test:e2e": "playwright test"` (runs both `routing.spec.ts` and `accessibility.spec.ts`; `test:a11y` remains for the focused local loop).

- [ ] **Step 2: Rewrite the `quality` job steps** in `.github/workflows/ci.yml` (env block unchanged except one addition):

```yaml
    env:
      DATABASE_URL: postgresql://naba_test_runtime:naba_test_runtime@127.0.0.1:5432/nabapresence_test
      DIRECT_DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:5432/nabapresence_test
      TEST_RUNTIME_DATABASE_URL: postgresql://naba_test_runtime:naba_test_runtime@127.0.0.1:5432/nabapresence_test
      NEXTAUTH_SECRET: ci-only-secret-value-with-at-least-32-characters
      TOKEN_ENCRYPTION_KEY: ci-only-token-key-with-at-least-32-characters
      CRON_SECRET: ci-only-cron-secret
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm db:migrate
      - run: pnpm db:runtime-role
      - run: pnpm build
      - run: pnpm test:integration
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm test:e2e
        env:
          LOCAL_BOOTSTRAP_ENABLED: "true"
          NEXTAUTH_URL: http://127.0.0.1:3000
```

Ordering rationale (each was a latent break): the role now exists **before** anything connects as it; `build` precedes `test:integration` because the route harness boots the standalone server; `test:e2e` runs with `LOCAL_BOOTSTRAP_ENABLED=true` so the Task 5 dashboard gate admits the browser and `/api/session` self-provisions the local owner (the pre-existing behavior the a11y specs assume); the e2e step now also executes `routing.spec.ts`, which CI previously never ran.

- [ ] **Step 3: Verify the full pipeline locally in CI order**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm db:migrate && pnpm db:runtime-role && pnpm build && \
DIRECT_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres TEST_RUNTIME_DATABASE_URL=postgresql://naba_test_runtime:naba_test_runtime@127.0.0.1:54322/postgres pnpm test:integration && \
LOCAL_BOOTSTRAP_ENABLED=true pnpm test:e2e
```

Expected: all PASS.

- [ ] **Step 4: Push a PR and watch CI run** (requires master-plan parallel Task P1 — the git remote — to be done). Expected: `quality` green end-to-end. If P1 hasn't landed, mark this step BLOCKED rather than done.

---

## Sprint 1 acceptance criteria → evidence map

| Criterion | Evidence |
|---|---|
| A new user can start OAuth from the signed-out UI | Task 5 route tests + `/sign-in` axe scenario |
| A new organisation is provisioned while the app uses a non-superuser role | Task 4 `tests/integration/provisioning.test.ts` as `naba_test_runtime` |
| Application startup fails if the database identity bypasses RLS | Task 3 `startup-assertion.test.ts` boot-failure case |
| Cross-tenant reads and writes fail at both SQL and HTTP levels | Pre-existing SQL suite + Task 2 `tenant-isolation-http.test.ts` |
| `app_user` PII cannot be read through unrestricted runtime-role queries | Task 6 `app-user-isolation.test.ts` |
| Webhooks cannot start in production without strong authentication configuration | Task 7 boot-failure + unit rules |
| CI invokes at least authentication, IDOR, role, and tenant-isolation route tests | Task 8 pipeline (`test:integration` includes `tests/integration/routes/**`) |

**Release gate:** With Tasks 1–8 green in CI on the runtime role, there is no remaining uncertainty about whether production sign-in and RLS work together.
