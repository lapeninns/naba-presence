import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

describeDatabase("first-tenant provisioning under RLS", () => {
  let admin: ReturnType<typeof postgres>
  const createdOrgs: string[] = []
  const newIdentity = (displayName: string) => {
    const subject = crypto.randomUUID()
    return {
      provider: "supabase",
      subject,
      email: `provision-${subject.slice(0, 8)}@example.test`,
      displayName,
      emailVerified: true,
    }
  }

  beforeAll(() => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    process.env.DATABASE_URL = process.env.TEST_RUNTIME_DATABASE_URL!
    process.env.NEXTAUTH_SECRET =
      "provisioning-test-session-secret-32-characters"
    process.env.TOKEN_ENCRYPTION_KEY =
      "provisioning-test-token-key-32-characters"
    process.env.CRON_SECRET = "provisioning-test-cron-secret"
  })

  afterAll(async () => {
    if (createdOrgs.length) {
      await admin`
        delete from organisation where id in ${admin(createdOrgs)}
      `
    }
    await admin`
      delete from app_user where email like 'provision-%@example.test'
    `
    await admin.end()
  })

  it("provisions a brand-new user and organisation as the runtime role", async () => {
    const { provisionAuthenticatedOwner } = await import(
      "@/lib/server/provisioning"
    )
    const result = await provisionAuthenticatedOwner(
      newIdentity("Provision Test")
    )
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

  it("gives a new organisation an explicit pilot billing record", async () => {
    const { provisionAuthenticatedOwner } = await import(
      "@/lib/server/provisioning"
    )
    const result = await provisionAuthenticatedOwner(newIdentity("Pilot Billing"))
    createdOrgs.push(result.organisationId)
    const rows = await admin`
      select
        state,
        plan_id as "planId",
        stripe_subscription_id as "subscription"
      from organisation_billing
      where organisation_id = ${result.organisationId}
    `
    expect(rows).toEqual([{ state: "pilot", planId: null, subscription: null }])
    const periods = await admin`
      select 1 from ai_credit_period
      where organisation_id = ${result.organisationId}
    `
    expect(periods).toHaveLength(0)
  })

  it("creates a business-mode organisation with exactly one home client", async () => {
    const { provisionAuthenticatedOwner } = await import(
      "@/lib/server/provisioning"
    )
    const result = await provisionAuthenticatedOwner(newIdentity("Home Client Test"))
    createdOrgs.push(result.organisationId)
    const [organisation] = await admin`
      select workspace_mode as mode from organisation
      where id = ${result.organisationId}
    `
    expect(organisation.mode).toBe("business")
    const clients = await admin`
      select is_home as "isHome", archived_at as "archivedAt" from client
      where organisation_id = ${result.organisationId}
    `
    expect(clients).toEqual([{ isHome: true, archivedAt: null }])
  })

  it("provisions the workspace mode a new owner chose, with a home client only for a business", async () => {
    const { provisionAuthenticatedOwner } = await import(
      "@/lib/server/provisioning"
    )
    const shapes: Record<string, unknown> = {}
    for (const workspaceMode of ["agency", "business", undefined] as const) {
      const subject = crypto.randomUUID()
      const result = await provisionAuthenticatedOwner({
        provider: "supabase",
        subject,
        email: `provision-${subject.slice(0, 8)}@example.test`,
        displayName: "Mode Test",
        emailVerified: true,
        ...(workspaceMode ? { workspaceMode } : {}),
      })
      createdOrgs.push(result.organisationId)
      const [shape] = await admin`
        select
          o.workspace_mode as mode,
          (select count(*)::int from client c where c.organisation_id = o.id)
            as clients,
          (select count(*)::int from client c
            where c.organisation_id = o.id and c.is_home) as "homeClients"
        from organisation o
        where o.id = ${result.organisationId}
      `
      shapes[workspaceMode ?? "default"] = shape
    }
    expect(shapes).toEqual({
      agency: { mode: "agency", clients: 0, homeClients: 0 },
      business: { mode: "business", clients: 1, homeClients: 1 },
      default: { mode: "business", clients: 1, homeClients: 1 },
    })
  })

  it("reuses the default organisation for a returning user", async () => {
    const { provisionAuthenticatedOwner } = await import(
      "@/lib/server/provisioning"
    )
    const identity = newIdentity("Repeat")
    const first = await provisionAuthenticatedOwner(identity)
    createdOrgs.push(first.organisationId)
    const second = await provisionAuthenticatedOwner(identity)
    expect(second.organisationId).toBe(first.organisationId)
  })
})
