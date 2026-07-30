import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip
const adminUrl = process.env.DIRECT_DATABASE_URL
const runtimeUrl = process.env.TEST_RUNTIME_DATABASE_URL

describeDatabase("content-free routing table isolation", () => {
  let admin: ReturnType<typeof postgres>
  let runtime: ReturnType<typeof postgres>
  const suffix = crypto.randomUUID()
  const organisationA = crypto.randomUUID()
  const organisationB = crypto.randomUUID()
  const connectionA = crypto.randomUUID()
  const connectionB = crypto.randomUUID()
  const externalLocationA = crypto.randomUUID()
  const externalLocationB = crypto.randomUUID()
  const locationName = `locations/${suffix}`

  beforeAll(async () => {
    if (!adminUrl || !runtimeUrl) {
      throw new Error(
        "DIRECT_DATABASE_URL and TEST_RUNTIME_DATABASE_URL are required."
      )
    }
    admin = postgres(adminUrl, { max: 1 })
    runtime = postgres(runtimeUrl, { max: 1 })
    await admin`
      insert into organisation (id, slug, name)
      values
        (${organisationA}, ${`route-a-${suffix}`}, 'Route tenant A'),
        (${organisationB}, ${`route-b-${suffix}`}, 'Route tenant B')
    `
    await admin`
      insert into google_connection (
        id,
        organisation_id,
        google_subject,
        scope
      )
      values
        (${connectionA}, ${organisationA}, ${`route-a-${suffix}`}, 'business.manage'),
        (${connectionB}, ${organisationB}, ${`route-b-${suffix}`}, 'business.manage')
    `
    await admin`
      insert into external_location (
        id,
        organisation_id,
        google_connection_id,
        google_account_name,
        google_location_name,
        title
      )
      values
        (
          ${externalLocationA},
          ${organisationA},
          ${connectionA},
          ${`accounts/a-${suffix}`},
          ${locationName},
          'Route A'
        ),
        (
          ${externalLocationB},
          ${organisationB},
          ${connectionB},
          ${`accounts/b-${suffix}`},
          ${locationName},
          'Route B'
        )
    `
  })

  afterAll(async () => {
    await admin`
      delete from organisation
      where id in (${organisationA}, ${organisationB})
    `
    await Promise.all([admin.end(), runtime.end()])
  })

  it("lets a tenant claim a webhook route for itself", async () => {
    await runtime.begin(async (sql) => {
      await sql`
        select set_config('app.organisation_id', ${organisationA}, true)
      `
      await sql`
        insert into webhook_route (
          google_location_name,
          organisation_id,
          external_location_id
        )
        values (${locationName}, ${organisationA}, ${externalLocationA})
      `
    })
  })

  it("blocks another tenant from stealing the same route", async () => {
    await expect(
      runtime.begin(async (sql) => {
        await sql`
          select set_config('app.organisation_id', ${organisationB}, true)
        `
        await sql`
          insert into webhook_route (
            google_location_name,
            organisation_id,
            external_location_id
          )
          values (${locationName}, ${organisationB}, ${externalLocationB})
          on conflict (google_location_name) do update
          set organisation_id = excluded.organisation_id,
              external_location_id = excluded.external_location_id
        `
      })
    ).rejects.toThrow()
  })

  it("still resolves routes with no tenant context (webhook path)", async () => {
    const [row] = await runtime<{ org: string }[]>`
      select organisation_id::text as org
      from webhook_route
      where google_location_name = ${locationName}
    `
    expect(row.org).toBe(organisationA)
  })

  it("keeps organisation_job_route readable context-free but not writable", async () => {
    expect(
      (await runtime`select organisation_id from organisation_job_route`)
        .length
    ).toBeGreaterThan(0)
    await expect(
      runtime`
        insert into organisation_job_route (organisation_id)
        values (${organisationB})
      `
    ).rejects.toThrow(/row-level security/)
  })
})
