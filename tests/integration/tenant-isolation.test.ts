import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip
const adminUrl = process.env.DIRECT_DATABASE_URL
const runtimeUrl = process.env.TEST_RUNTIME_DATABASE_URL

describeDatabase("database tenant isolation", () => {
  let admin: ReturnType<typeof postgres>
  let runtime: ReturnType<typeof postgres>
  const organisationA = crypto.randomUUID()
  const organisationB = crypto.randomUUID()

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
      select has_table_privilege(
        'naba_app_runtime',
        'review',
        'select'
      ) as ok
    `
    expect(grant.ok).toBe(true)
    await admin`
      insert into organisation (id, slug, name)
      values
        (${organisationA}, ${`tenant-a-${organisationA}`}, 'Tenant A'),
        (${organisationB}, ${`tenant-b-${organisationB}`}, 'Tenant B')
    `
    await admin`
      insert into location (organisation_id, name)
      values
        (${organisationA}, 'Tenant A location'),
        (${organisationB}, 'Tenant B location')
    `
    await admin`
      insert into organisation_billing (organisation_id, state)
      values (${organisationA}, 'pilot'), (${organisationB}, 'pilot')
    `
    await admin`
      insert into ai_credit_period (
        organisation_id, kind, starts_at, ends_at, allowance, source_ref
      )
      values
        (${organisationA}, 'pilot_month', '2026-10-01', '2026-11-01', 50, '2026-10'),
        (${organisationB}, 'pilot_month', '2026-10-01', '2026-11-01', 50, '2026-10')
    `
  })

  afterAll(async () => {
    await admin`delete from organisation where id in (${organisationA}, ${organisationB})`
    await Promise.all([admin.end(), runtime.end()])
  })

  it("returns only rows for the transaction tenant", async () => {
    const names = await runtime.begin(async (sql) => {
      await sql`select set_config('app.organisation_id', ${organisationA}, true)`
      return sql<{ name: string }[]>`select name from location order by name`
    })
    expect(names).toEqual([{ name: "Tenant A location" }])
  })

  it("returns no tenant rows without a tenant context", async () => {
    expect(await runtime`select name from location`).toEqual([])
    expect(await runtime`select name from organisation`).toEqual([])
  })

  it("isolates billing records and AI credit periods", async () => {
    const seen = await runtime.begin(async (sql) => {
      await sql`select set_config('app.organisation_id', ${organisationA}, true)`
      const billing = await sql<{ organisationId: string }[]>`
        select organisation_id::text as "organisationId"
        from organisation_billing
        where organisation_id in (${organisationA}, ${organisationB})
      `
      const periods = await sql<{ organisationId: string }[]>`
        select organisation_id::text as "organisationId"
        from ai_credit_period
        where organisation_id in (${organisationA}, ${organisationB})
      `
      return { billing, periods }
    })
    expect(seen.billing).toEqual([{ organisationId: organisationA }])
    expect(seen.periods).toEqual([{ organisationId: organisationA }])
    expect(await runtime`select 1 from organisation_billing`).toEqual([])
    expect(await runtime`select 1 from ai_credit_period`).toEqual([])
    await expect(
      runtime.begin(async (sql) => {
        await sql`select set_config('app.organisation_id', ${organisationA}, true)`
        await sql`
          insert into ai_credit_period (
            organisation_id, kind, starts_at, ends_at, source_ref
          )
          values (${organisationB}, 'adjustment', now(), now() + interval '1 day', 'x')
        `
      })
    ).rejects.toThrow()
    const updated = await runtime.begin(async (sql) => {
      await sql`select set_config('app.organisation_id', ${organisationA}, true)`
      return sql`
        update organisation_billing set version = version + 1
        where organisation_id = ${organisationB}
        returning 1
      `
    })
    expect(updated).toHaveLength(0)
  })

  it("blocks cross-tenant writes even when the caller supplies the id", async () => {
    await expect(
      runtime.begin(async (sql) => {
        await sql`select set_config('app.organisation_id', ${organisationA}, true)`
        await sql`
          insert into location (organisation_id, name)
          values (${organisationB}, 'Cross-tenant write')
        `
      })
    ).rejects.toThrow()
  })
})
