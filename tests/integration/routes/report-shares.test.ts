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

    // The view is counted by after(), once the response has gone, so the
    // row can lag the fetch by a moment.
    let viewCount = 0
    for (let attempt = 0; attempt < 20 && viewCount < 1; attempt++) {
      const [row] = await admin<{ viewCount: number }[]>`
        select view_count as "viewCount" from report_share
        where client_id = ${a.clientId}
      `
      viewCount = row.viewCount
      if (viewCount < 1)
        await new Promise((resolve) => setTimeout(resolve, 100))
    }
    expect(viewCount).toBeGreaterThanOrEqual(1)
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
    // Revoked, expired and never-issued tokens of the right shape all reach
    // the database lookup and must come back byte-for-byte the same. A
    // malformed token is refused before the lookup (its shape is public, so
    // that says nothing about whether a link exists), which shifts Next's
    // streaming framing; it is checked separately below.
    const bodies: string[] = []
    for (const path of [
      publicPath(revoked.url),
      publicPath(expired.url),
      `/share/report/${"x".repeat(43)}`,
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

    const malformed = await fetch(`${server.baseUrl}/share/report/short`, {
      redirect: "manual",
    })
    expect(malformed.status).toBe(404)
    expect(malformed.headers.get("x-robots-tag")).toContain("noindex")
    expect(await malformed.text()).toContain("This report link isn’t available")

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
  // NP1-G06: proven with mocks only until now (report-shares-routes.test.ts).
  it("lets no other organisation revoke a share, through its client or one of its own", async () => {
    const owner = await fixture()
    const a = await clientWithVenue(
      owner.cookie,
      owner.organisationId,
      "Kept Arms"
    )
    const { url, share: kept } = await share(owner.cookie, a.clientId)
    const stranger = await fixture()
    const own = await clientWithVenue(
      stranger.cookie,
      stranger.organisationId,
      "Stranger Inn"
    )
    const member = await seedMemberUser(admin, {
      organisationId: owner.organisationId,
    })

    for (const [who, cookie, clientId, status, error] of [
      [
        "stranger, owner's client",
        stranger.cookie,
        a.clientId,
        404,
        "client_not_found",
      ],
      [
        "stranger, own client",
        stranger.cookie,
        own.clientId,
        404,
        "report_share_not_found",
      ],
      ["member", member.cookie, a.clientId, 403, undefined],
    ] as const) {
      const response = await request(
        `/api/clients/${clientId}/report-shares/${kept.id}`,
        cookie,
        { method: "DELETE" }
      )
      expect(response.status, who).toBe(status)
      if (error) expect(await response.json(), who).toMatchObject({ error })
    }

    const [row] = await admin<
      { revokedAt: Date | null; revokedBy: string | null }[]
    >`
      select revoked_at as "revokedAt", revoked_by::text as "revokedBy"
      from report_share
      where id = ${kept.id}
    `
    expect(row).toEqual({ revokedAt: null, revokedBy: null })
    const audits = await admin`
      select 1 from audit_log
      where action = 'report_share.revoked' and subject_id = ${kept.id}
    `
    expect(audits).toEqual([])
    const page = await fetch(`${server.baseUrl}${publicPath(url)}`, {
      redirect: "manual",
    })
    expect(page.status).toBe(200)
  })
})
