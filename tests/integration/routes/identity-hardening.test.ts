import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

describeDatabase("Google identity hardening", () => {
  let admin: ReturnType<typeof postgres>
  const createdOrganisations: string[] = []
  const marker = crypto.randomUUID().slice(0, 8)
  const email = (label: string) =>
    `identity-${marker}-${label}@example.test`

  beforeAll(() => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    process.env.DATABASE_URL = process.env.TEST_RUNTIME_DATABASE_URL!
    process.env.NEXTAUTH_SECRET =
      "identity-hardening-session-secret-32-characters"
    process.env.TOKEN_ENCRYPTION_KEY =
      "identity-hardening-token-key-32-characters"
    process.env.CRON_SECRET = "identity-hardening-cron-secret"
  })

  afterAll(async () => {
    if (createdOrganisations.length) {
      await admin.begin(async (sql) => {
        await sql`select set_config('app.retention_run', 'true', true)`
        await sql`
          delete from audit_log
          where organisation_id in ${sql(createdOrganisations)}
        `
        await sql`
          delete from organisation
          where id in ${sql(createdOrganisations)}
        `
      })
    }
    await admin`
      delete from app_user
      where email like ${`identity-${marker}-%@example.test`}
    `
    await admin.end()
  })

  it("rejects an unverified email collision without relinking the subject", async () => {
    const { provisionOwner } = await import("@/lib/server/provisioning")
    const originalSub = `identity-original-${marker}`
    const original = await provisionOwner({
      sub: originalSub,
      email: email("collision"),
      name: "Original identity",
      email_verified: true,
    })
    createdOrganisations.push(original.organisationId)

    await expect(
      provisionOwner({
        sub: `identity-attacker-${marker}`,
        email: email("collision"),
        name: "Unverified identity",
        email_verified: false,
      })
    ).rejects.toMatchObject({
      status: 403,
      code: "unverified_google_email",
    })

    const [user] = await admin`
      select google_subject as "googleSubject"
      from app_user
      where id = ${original.userId}
    `
    expect(user.googleSubject).toBe(originalSub)
  })

  it("updates a verified changed email by matching the Google subject first", async () => {
    const { provisionOwner } = await import("@/lib/server/provisioning")
    const sub = `identity-email-change-${marker}`
    const original = await provisionOwner({
      sub,
      email: email("old"),
      name: "Email change",
      email_verified: true,
    })
    createdOrganisations.push(original.organisationId)

    const returning = await provisionOwner({
      sub,
      email: email("new"),
      name: "Email changed",
      email_verified: true,
    })
    expect(returning.userId).toBe(original.userId)
    expect(returning.organisationId).toBe(original.organisationId)

    const [user] = await admin`
      select email, display_name as "displayName"
      from app_user
      where id = ${original.userId}
    `
    expect(user).toEqual({
      email: email("new"),
      displayName: "Email changed",
    })
  })

  it("holds a changed email that belongs to another identity", async () => {
    const { provisionOwner } = await import("@/lib/server/provisioning")
    const first = await provisionOwner({
      sub: `identity-held-first-${marker}`,
      email: email("held-first"),
      name: "Held first",
      email_verified: true,
    })
    const second = await provisionOwner({
      sub: `identity-held-second-${marker}`,
      email: email("held-second"),
      name: "Held second",
      email_verified: true,
    })
    createdOrganisations.push(
      first.organisationId,
      second.organisationId
    )

    const returning = await provisionOwner({
      sub: `identity-held-first-${marker}`,
      email: email("held-second"),
      name: "Held first updated",
      email_verified: true,
    })
    expect(returning.userId).toBe(first.userId)

    const users = await admin`
      select id::text as id, email, google_subject as "googleSubject"
      from app_user
      where id in (${first.userId}, ${second.userId})
      order by email
    `
    expect(users).toEqual([
      {
        id: first.userId,
        email: email("held-first"),
        googleSubject: `identity-held-first-${marker}`,
      },
      {
        id: second.userId,
        email: email("held-second"),
        googleSubject: `identity-held-second-${marker}`,
      },
    ])
    const [audit] = await admin`
      select metadata
      from audit_log
      where organisation_id = ${first.organisationId}
        and action = 'identity.email_change_held'
      order by created_at desc
      limit 1
    `
    expect(audit.metadata).toMatchObject({
      requestedEmail: email("held-second"),
      googleSubject: `identity-held-first-${marker}`,
    })
  })

  it("links a verified email when no subject match exists", async () => {
    const { provisionOwner } = await import("@/lib/server/provisioning")
    const userId = crypto.randomUUID()
    await admin`
      insert into app_user (id, email, display_name)
      values (${userId}, ${email("verified-link")}, 'Pending link')
    `

    const linked = await provisionOwner({
      sub: `identity-verified-link-${marker}`,
      email: email("verified-link"),
      name: "Verified link",
      email_verified: true,
    })
    createdOrganisations.push(linked.organisationId)
    expect(linked.userId).toBe(userId)

    const [user] = await admin`
      select google_subject as "googleSubject"
      from app_user
      where id = ${userId}
    `
    expect(user.googleSubject).toBe(`identity-verified-link-${marker}`)
  })
})
