import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import {
  createTestTenant,
  destroyTenants,
  seedMemberUser,
  seedReview,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

// End to end against the database: owners make, list and revoke a client's
// report links; the public page shows that client's venue and never another
// client's; a revoked, an expired and a made-up token all get the same 404.

describeDatabase("report shares", () => {
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

  async function fixture(options: Parameters<typeof createTestTenant>[1] = {}) {
    const tenant = await createTestTenant(admin, options)
    organisations.push(tenant.organisationId)
    return tenant
  }

  const request = (path: string, cookie: string, init: RequestInit = {}) =>
    fetch(`${server.baseUrl}${path}`, {
      ...init,
      redirect: "manual",
      headers: {
        cookie,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    })

  async function clientWithVenue(
    cookie: string,
    organisationId: string,
    name: string
  ) {
    const created = await request("/api/clients", cookie, {
      method: "POST",
      body: JSON.stringify({ name }),
    })
    const { client } = (await created.json()) as { client: { id: string } }
    const seeded = await seedReview(admin, {
      organisationId,
      text: `${name} secret review text`,
    })
    await request(`/api/clients/${client.id}/locations`, cookie, {
      method: "POST",
      body: JSON.stringify({ locationIds: [seeded.locationId] }),
    })
    const [location] = await admin<{ name: string }[]>`
      select name from location where id = ${seeded.locationId}
    `
    return { clientId: client.id, venue: location.name }
  }

  async function share(cookie: string, clientId: string, days = 90) {
    const response = await request(
      `/api/clients/${clientId}/report-shares`,
      cookie,
      { method: "POST", body: JSON.stringify({ expiresInDays: days }) }
    )
    expect(response.status).toBe(201)
    return (await response.json()) as {
      url: string
      share: { id: string; status: string }
    }
  }

  const publicPath = (url: string) => new URL(url).pathname

  it("shows one client's report to anyone with the link, and nothing else", async () => {
    const owner = await fixture()
    const a = await clientWithVenue(
      owner.cookie,
      owner.organisationId,
      "Old Crown Group"
    )
    const b = await clientWithVenue(
      owner.cookie,
      owner.organisationId,
      "Bella Vita"
    )
    const { url } = await share(owner.cookie, a.clientId)

    const page = await fetch(`${server.baseUrl}${publicPath(url)}`, {
      redirect: "manual",
    })
    expect(page.status).toBe(200)
    expect(page.headers.get("referrer-policy")).toBe("no-referrer")
    expect(page.headers.get("x-robots-tag")).toContain("noindex")
    expect(page.headers.get("cache-control")).toContain("no-store")
    const html = await page.text()
    expect(html).toContain("Old Crown Group")
    expect(html).toContain(a.venue)
    expect(html).not.toContain(b.venue)
    expect(html).not.toContain("Bella Vita")
    expect(html).not.toContain("secret review text")
    expect(html).not.toContain("Harness reviewer")
    expect(html).not.toContain(a.clientId)
    expect(html).not.toContain(owner.email)

    const [row] = await admin<{ viewCount: number }[]>`
      select view_count as "viewCount" from report_share
      where client_id = ${a.clientId}
    `
    expect(row.viewCount).toBeGreaterThanOrEqual(1)
  })

  it("answers revoked, expired and unknown tokens with the same 404", async () => {
    const owner = await fixture()
    const a = await clientWithVenue(
      owner.cookie,
      owner.organisationId,
      "Harbour Kitchen"
    )
    const revoked = await share(owner.cookie, a.clientId)
    const expired = await share(owner.cookie, a.clientId)
    const revoke = await request(
      `/api/clients/${a.clientId}/report-shares/${revoked.share.id}`,
      owner.cookie,
      { method: "DELETE" }
    )
    expect(revoke.status).toBe(200)
    await admin`
      update report_share
      set created_at = now() - interval '2 days',
          expires_at = now() - interval '1 day'
      where id = ${expired.share.id}
    `
    const bodies: string[] = []
    for (const path of [
      publicPath(revoked.url),
      publicPath(expired.url),
      `/share/report/${"x".repeat(43)}`,
      "/share/report/short",
    ]) {
      const response = await fetch(`${server.baseUrl}${path}`, {
        redirect: "manual",
      })
      expect(response.status, path).toBe(404)
      expect(response.headers.get("x-robots-tag")).toContain("noindex")
      const html = await response.text()
      expect(html).not.toContain("Harbour Kitchen")
      // The token itself is echoed in the RSC payload's route segments;
      // everything else must be byte-for-byte the same page.
      const token = path.split("/").pop()!
      bodies.push(html.replaceAll(token, "<token>"))
    }
    expect(new Set(bodies).size).toBe(1)

    const audit = await admin<{ action: string }[]>`
      select action from audit_log
      where organisation_id = ${owner.organisationId}
        and subject_type = 'report_share'
      order by created_at
    `
    expect(audit.map((row) => row.action)).toEqual([
      "report_share.created",
      "report_share.created",
      "report_share.revoked",
    ])
  })

  it("is owner/admin only, and another organisation's client is a 404", async () => {
    const owner = await fixture()
    const a = await clientWithVenue(
      owner.cookie,
      owner.organisationId,
      "Quiet Arms"
    )
    const member = await seedMemberUser(admin, {
      organisationId: owner.organisationId,
    })
    const listByMember = await request(
      `/api/clients/${a.clientId}/report-shares`,
      member.cookie
    )
    expect(listByMember.status).toBe(403)

    const stranger = await fixture()
    for (const init of [{}, { method: "POST", body: "{}" }]) {
      const response = await request(
        `/api/clients/${a.clientId}/report-shares`,
        stranger.cookie,
        init
      )
      expect(response.status).toBe(404)
    }
  })
})
