import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import {
  createTestTenant,
  destroyTenants,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

describeDatabase("signed-out entry point", () => {
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

  it("redirects anonymous dashboard traffic to /sign-in", async () => {
    const response = await fetch(`${server.baseUrl}/reviews`, {
      redirect: "manual",
    })
    expect([303, 307]).toContain(response.status)
    expect(response.headers.get("location")).toContain("/sign-in")
  })

  it("serves the sign-in page with email and password entry", async () => {
    const response = await fetch(`${server.baseUrl}/sign-in`)
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).toContain("type=\"email\"")
    expect(body).toContain("type=\"password\"")
    expect(body).not.toContain("Continue with Google")
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

  it("requires an application session before starting Google OAuth", async () => {
    const response = await fetch(
      `${server.baseUrl}/api/google/connect/start`,
      { method: "POST" }
    )
    expect(response.status).toBe(401)
  })
})
