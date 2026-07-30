import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import {
  createTestTenant,
  destroyTenants,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

const validSettings = {
  approvalRequired: true,
  rawContentRetentionDays: 30,
  defaultLanguageCode: "en",
  defaultTimezone: "Europe/London",
}

describeDatabase("route roles", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  let viewer: Awaited<ReturnType<typeof createTestTenant>>
  let member: Awaited<ReturnType<typeof createTestTenant>>
  let owner: Awaited<ReturnType<typeof createTestTenant>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    viewer = await createTestTenant(admin, {
      role: "viewer",
      canPublish: false,
    })
    member = await createTestTenant(admin, {
      role: "member",
      canPublish: false,
    })
    owner = await createTestTenant(admin)
    organisations.push(
      viewer.organisationId,
      member.organisationId,
      owner.organisationId
    )
    server = await startAppServer({
      GOOGLE_CLIENT_ID: "route-harness-google-client",
      GOOGLE_CLIENT_SECRET: "route-harness-google-secret",
    })
  })

  afterAll(async () => {
    await server.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  it("forbids viewers from changing settings", async () => {
    const response = await fetch(`${server.baseUrl}/api/settings`, {
      method: "PATCH",
      headers: {
        cookie: viewer.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({ approvalRequired: true }),
    })
    expect(response.status).toBe(403)
    expect((await response.json()).error).toBe("permission_denied")
  })

  it("forbids members from reading the audit log", async () => {
    const response = await fetch(`${server.baseUrl}/api/audit-log`, {
      headers: { cookie: member.cookie },
    })
    expect(response.status).toBe(403)
    expect((await response.json()).error).toBe("permission_denied")
  })

  it("lets owners change settings", async () => {
    const response = await fetch(`${server.baseUrl}/api/settings`, {
      method: "PATCH",
      headers: {
        cookie: owner.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify(validSettings),
    })
    expect(response.status).toBe(200)
  })

  it("restricts organisation Google connection changes to owners and admins", async () => {
    const forbidden = await fetch(
      `${server.baseUrl}/api/google/connect/start`,
      {
        method: "POST",
        headers: {
          cookie: member.cookie,
          "content-type": "application/json",
        },
        body: "{}",
      }
    )
    expect(forbidden.status).toBe(403)

    const allowed = await fetch(
      `${server.baseUrl}/api/google/connect/start`,
      {
        method: "POST",
        headers: {
          cookie: owner.cookie,
          "content-type": "application/json",
        },
        body: "{}",
      }
    )
    expect(allowed.status).toBe(200)
    const { authorizationUrl } = (await allowed.json()) as {
      authorizationUrl: string
    }
    const oauth = new URL(authorizationUrl)
    expect(oauth.searchParams.get("access_type")).toBe("offline")
    expect(oauth.searchParams.get("prompt")).toBe("consent")
    expect(oauth.searchParams.get("state")).toBeTruthy()
    expect(allowed.headers.get("set-cookie")).toContain("naba_google_oauth=")
  })
})
