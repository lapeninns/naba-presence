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
    await admin`
      do $$
      begin
        if not exists (
          select 1 from pg_roles where rolname = 'naba_test_runtime'
        ) then
          create role naba_test_runtime login password 'naba_test_runtime';
        end if;
      end
      $$
    `
    await admin`grant usage on schema public to naba_test_runtime`
    await admin`grant select, insert, update, delete on all tables in schema public to naba_test_runtime`
    await admin`grant usage, select on all sequences in schema public to naba_test_runtime`
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
