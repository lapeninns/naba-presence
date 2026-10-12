import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedLocation,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

/**
 * Central billing enforcement through the real routes (plan P07-S3): with
 * BILLING_ENFORCEMENT_ENABLED on and the organisation's own flag on, a
 * read-only organisation gets 402 billing_read_only on new work, while
 * export, disconnect, unlink and session switching still answer. Pilots,
 * and read-only organisations whose flag is off, are untouched.
 */
describeDatabase("billing read-only enforcement", () => {
  let admin: ReturnType<typeof postgres>
  let stub: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const tenants: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    stub = await startGoogleStub()
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: stub.baseUrl,
      GOOGLE_TIMEOUT_MS: "2500",
      BILLING_ENFORCEMENT_ENABLED: "true",
    })
  })

  afterAll(async () => {
    await server.stop()
    await stub.stop()
    await destroyTenants(admin, tenants)
    await admin.end()
  })

  async function tenant(options: {
    state: "pilot" | "read_only"
    enforced: boolean
  }) {
    const owner = await createTestTenant(admin)
    tenants.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const location = await seedLinkedLocation(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    // Last: an enforced read-only organisation has no seats for new links.
    await admin`
      update organisation_billing
      set state = ${options.state}, enforcement_enabled = ${options.enforced}
      where organisation_id = ${owner.organisationId}
    `
    return { owner, connection, location }
  }

  function send(
    cookie: string,
    method: string,
    path: string,
    body: unknown = {}
  ) {
    return fetch(`${server.baseUrl}${path}`, {
      method,
      headers: { cookie, "content-type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body),
    })
  }

  it("refuses new work with 402 billing_read_only", async () => {
    const { owner, location } = await tenant({
      state: "read_only",
      enforced: true,
    })
    const writes: [string, string][] = [
      ["PUT", `/api/locations/${location.locationId}/profile`],
      ["POST", `/api/locations/${location.locationId}/posts`],
      [
        "POST",
        `/api/locations/${location.locationId}/posts/${randomUUID()}/publish`,
      ],
      ["PATCH", "/api/settings"],
      ["POST", "/api/google/connect/start"],
      ["POST", `/api/reviews/${randomUUID()}/drafts`],
    ]
    for (const [method, path] of writes) {
      const response = await send(owner.cookie, method, path)
      expect(
        response.status,
        `${method} ${path}: ${await response.clone().text()}`
      ).toBe(402)
      expect(await response.json()).toMatchObject({
        error: "billing_read_only",
        details: { reason: "read_only", mode: "read_only" },
      })
    }
    const audits = await admin<{ n: number }[]>`
      select count(*)::int as n from audit_log
      where organisation_id = ${owner.organisationId}
        and action like 'location.profile%'
    `
    expect(audits[0].n).toBe(0)
  })

  it("still reads, exports, unlinks, disconnects and switches", async () => {
    const { owner, connection, location } = await tenant({
      state: "read_only",
      enforced: true,
    })

    const read = await send(owner.cookie, "GET", "/api/location-links")
    expect(read.status, await read.clone().text()).toBe(200)

    // The handler runs: with nothing retained for the subject it answers its
    // own 404, not the billing 402.
    const exported = await send(owner.cookie, "POST", "/api/privacy/export", {
      subject: "Somebody Example",
    })
    expect(await exported.json()).toMatchObject({
      error: "privacy_subject_not_found",
    })

    const unlinked = await send(
      owner.cookie,
      "DELETE",
      `/api/location-links?externalLocationId=${location.externalLocationId}`
    )
    expect(unlinked.status, await unlinked.clone().text()).toBe(200)

    const disconnected = await send(
      owner.cookie,
      "POST",
      `/api/google/connections/${connection.connectionId}/disconnect`
    )
    expect(disconnected.status, await disconnected.clone().text()).not.toBe(402)
    expect(disconnected.status).toBeLessThan(500)
    const [state] = await admin<{ status: string }[]>`
      select status from google_connection where id = ${connection.connectionId}
    `
    expect(state.status).toBe("disconnected")

    // A second workspace the same person belongs to.
    const other = randomUUID()
    tenants.push(other)
    await admin`
      insert into organisation (id, slug, name, workspace_mode)
      values (${other}, ${`harness-${other.slice(0, 12)}`}, 'Other', 'agency')
    `
    // 0109's organisation trigger has already given it a pilot record.
    await admin`
      insert into member (organisation_id, user_id, role, can_publish)
      values (${other}, ${owner.userId}, 'owner', true)
    `
    const switched = await send(owner.cookie, "POST", "/api/session/switch", {
      organisationId: other,
    })
    expect(switched.status, await switched.clone().text()).toBe(200)
  })

  it("leaves a pilot, and a read-only organisation with its flag off, alone", async () => {
    for (const options of [
      { state: "pilot" as const, enforced: true },
      { state: "read_only" as const, enforced: false },
    ]) {
      const { owner } = await tenant(options)
      const response = await send(owner.cookie, "PATCH", "/api/settings", {})
      expect(response.status, JSON.stringify(options)).not.toBe(402)
    }
  })
})
