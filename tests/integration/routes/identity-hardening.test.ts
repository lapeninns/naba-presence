import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

/**
 * Identity linking through provision_authenticated_user, the only sign-in
 * provisioning path. These cases used to run through the Google twin
 * (provision_google_user), dropped in 0132 because no route reached it.
 */
describeDatabase("authenticated identity hardening", () => {
  let admin: ReturnType<typeof postgres>
  const createdOrganisations: string[] = []
  const marker = crypto.randomUUID().slice(0, 8)
  const email = (label: string) =>
    `identity-${marker}-${label}@example.test`
  const identity = (
    subject: string,
    label: string,
    overrides: { displayName?: string; emailVerified?: boolean } = {}
  ) => ({
    provider: "supabase",
    subject: `identity-${subject}-${marker}`,
    email: email(label),
    displayName: overrides.displayName ?? "Identity test",
    emailVerified: overrides.emailVerified ?? true,
  })

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

  const subjectOf = async (userId: string) => {
    const [user] = await admin`
      select auth_subject as "authSubject"
      from app_user
      where id = ${userId}
    `
    return user.authSubject as string | null
  }

  it("rejects an unverified email without relinking the subject", async () => {
    const { provisionAuthenticatedOwner } = await import(
      "@/lib/server/provisioning"
    )
    const original = await provisionAuthenticatedOwner(
      identity("original", "unverified")
    )
    createdOrganisations.push(original.organisationId)

    await expect(
      provisionAuthenticatedOwner(
        identity("attacker", "unverified", { emailVerified: false })
      )
    ).rejects.toMatchObject({ status: 403, code: "email_not_verified" })

    expect(await subjectOf(original.userId)).toBe(
      `identity-original-${marker}`
    )
  })

  it("refuses to rebind an email that another identity already holds", async () => {
    const { provisionAuthenticatedOwner } = await import(
      "@/lib/server/provisioning"
    )
    const original = await provisionAuthenticatedOwner(
      identity("bound", "bound")
    )
    createdOrganisations.push(original.organisationId)

    await expect(
      provisionAuthenticatedOwner(identity("intruder", "bound"))
    ).rejects.toMatchObject({ status: 409, code: "auth_identity_conflict" })

    expect(await subjectOf(original.userId)).toBe(`identity-bound-${marker}`)
  })

  it("updates a verified changed email by matching the subject first", async () => {
    const { provisionAuthenticatedOwner } = await import(
      "@/lib/server/provisioning"
    )
    const original = await provisionAuthenticatedOwner(
      identity("email-change", "old")
    )
    createdOrganisations.push(original.organisationId)

    const returning = await provisionAuthenticatedOwner(
      identity("email-change", "new", { displayName: "Email changed" })
    )
    expect(returning.userId).toBe(original.userId)
    expect(returning.organisationId).toBe(original.organisationId)
    expect(returning.emailChangeHeld).toBe(false)

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
    const { provisionAuthenticatedOwner } = await import(
      "@/lib/server/provisioning"
    )
    const first = await provisionAuthenticatedOwner(
      identity("held-first", "held-first")
    )
    const second = await provisionAuthenticatedOwner(
      identity("held-second", "held-second")
    )
    createdOrganisations.push(first.organisationId, second.organisationId)

    const returning = await provisionAuthenticatedOwner(
      identity("held-first", "held-second")
    )
    expect(returning.userId).toBe(first.userId)
    expect(returning.emailChangeHeld).toBe(true)

    const users = await admin`
      select id::text as id, email, auth_subject as "authSubject"
      from app_user
      where id in (${first.userId}, ${second.userId})
      order by email
    `
    expect(users).toEqual([
      {
        id: first.userId,
        email: email("held-first"),
        authSubject: `identity-held-first-${marker}`,
      },
      {
        id: second.userId,
        email: email("held-second"),
        authSubject: `identity-held-second-${marker}`,
      },
    ])
  })

  it("links a verified email when no subject match exists", async () => {
    const { provisionAuthenticatedOwner } = await import(
      "@/lib/server/provisioning"
    )
    const userId = crypto.randomUUID()
    await admin`
      insert into app_user (id, email, display_name)
      values (${userId}, ${email("verified-link")}, 'Pending link')
    `

    const linked = await provisionAuthenticatedOwner(
      identity("verified-link", "verified-link")
    )
    createdOrganisations.push(linked.organisationId)
    expect(linked.userId).toBe(userId)
    expect(await subjectOf(userId)).toBe(`identity-verified-link-${marker}`)
  })
})
