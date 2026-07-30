import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip
const adminUrl = process.env.DIRECT_DATABASE_URL
const runtimeUrl = process.env.TEST_RUNTIME_DATABASE_URL

describeDatabase("app_user isolation", () => {
  let admin: ReturnType<typeof postgres>
  let runtime: ReturnType<typeof postgres>
  const suffix = crypto.randomUUID()
  const organisationA = crypto.randomUUID()
  const organisationB = crypto.randomUUID()
  const userA = crypto.randomUUID()
  const userB = crypto.randomUUID()
  const userAEmail = `tenant-a-${suffix}@example.test`
  const userBEmail = `tenant-b-${suffix}@example.test`
  const directInsertEmail = `direct-${suffix}@example.test`
  const definerEmail = `def-${suffix}@example.test`

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
        (${organisationA}, ${`user-a-${suffix}`}, 'User tenant A'),
        (${organisationB}, ${`user-b-${suffix}`}, 'User tenant B')
    `
    await admin`
      insert into app_user (id, email, display_name)
      values
        (${userA}, ${userAEmail}, 'Tenant A user'),
        (${userB}, ${userBEmail}, 'Tenant B user')
    `
    await admin`
      insert into member (organisation_id, user_id, role)
      values
        (${organisationA}, ${userA}, 'owner'),
        (${organisationB}, ${userB}, 'owner')
    `
  })

  afterAll(async () => {
    await admin`
      delete from organisation
      where id in (${organisationA}, ${organisationB})
    `
    await admin`
      delete from app_user
      where email in (
        ${userAEmail},
        ${userBEmail},
        ${directInsertEmail},
        ${definerEmail}
      )
    `
    await Promise.all([admin.end(), runtime.end()])
  })

  it("hides other tenants' users from a tenant transaction", async () => {
    const rows = await runtime.begin(async (sql) => {
      await sql`
        select set_config('app.organisation_id', ${organisationA}, true)
      `
      return sql<{ email: string }[]>`
        select email from app_user
        where email in (${userAEmail}, ${userBEmail})
        order by email
      `
    })
    expect(rows.map((row) => row.email)).toEqual([userAEmail])
  })

  it("denies reading app_user with no context at all", async () => {
    expect(
      await runtime<{ email: string }[]>`
        select email from app_user
        where email in (${userAEmail}, ${userBEmail})
      `
    ).toEqual([])
  })

  it("blocks direct inserts from the runtime role", async () => {
    await expect(
      runtime`
        insert into app_user (email, display_name)
        values (${directInsertEmail}, 'X')
      `
    ).rejects.toThrow(/row-level security/)
  })

  it("provisions through the definer function without any context", async () => {
    const [user] = await runtime<{ id: string }[]>`
      select id::text as id
      from provision_google_user(
        ${definerEmail},
        'Def',
        ${`sub-${suffix}`},
        true
      )
    `
    expect(user.id).toBeTruthy()
  })

  it("attach_member_user never rewrites an existing display name", async () => {
    await runtime.begin(async (sql) => {
      await sql`
        select set_config('app.organisation_id', ${organisationA}, true)
      `
      await sql`select attach_member_user(${userBEmail}, 'Hijacked Name')`
    })
    const [row] = await admin<{ display_name: string }[]>`
      select display_name from app_user where email = ${userBEmail}
    `
    expect(row.display_name).toBe("Tenant B user")
  })
})
