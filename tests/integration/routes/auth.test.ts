import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import {
  createTestTenant,
  destroyTenants,
} from "../helpers/tenant"

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
    expect((await response.json()).error).toBe(
      "authentication_required"
    )
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
