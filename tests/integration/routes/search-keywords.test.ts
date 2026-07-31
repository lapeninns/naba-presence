import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedReview,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

describeDatabase("Google search keyword analytics", () => {
  let admin: ReturnType<typeof postgres>
  let google: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    google = await startGoogleStub()
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: google.baseUrl,
      GBP_KEYWORDS_ENABLED: "true",
    })
  })

  afterAll(async () => {
    await server.stop()
    await google.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  it("backfills, reports thresholds faithfully, restates, and isolates keywords", async () => {
    const owner = await createTestTenant(admin)
    const other = await createTestTenant(admin)
    organisations.push(owner.organisationId, other.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const linked = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    let exactValue = 42
    google.respond(
      {
        method: "GET",
        pathIncludes: "/searchkeywords/impressions/monthly",
      },
      () => ({
        status: 200,
        json: {
          searchKeywordsCounts: [
            {
              searchKeyword: "nepalese food",
              insightsValue: { value: String(exactValue) },
            },
            {
              searchKeyword: "pub near me",
              insightsValue: { threshold: "15" },
            },
          ],
        },
      })
    )

    const firstSync = await fetch(`${server.baseUrl}/api/sync/keywords`, {
      method: "POST",
      headers: jsonHeaders(owner.cookie),
      body: JSON.stringify({ externalLocationId: linked.externalLocationId }),
    })
    expect(firstSync.status, await firstSync.clone().text()).toBe(200)
    expect((await firstSync.json()).organisations[0].outcomes[0]).toMatchObject({
      status: "succeeded",
      months: 18,
      upserted: 36,
    })
    const providerCalls = google.calls.filter((call) =>
      call.path.includes("/searchkeywords/impressions/monthly")
    )
    expect(providerCalls).toHaveLength(18)
    expect(providerCalls[0]?.path).toContain("pageSize=100")
    expect(providerCalls[0]?.path).toContain("monthlyRange.startMonth.year=")

    const report = await fetch(
      `${server.baseUrl}/api/analytics/presence/keywords?range=6m`,
      { headers: { cookie: owner.cookie } }
    )
    expect(report.status, await report.clone().text()).toBe(200)
    expect(await report.json()).toMatchObject({
      state: "ready",
      keywords: [
        {
          keyword: "nepalese food",
          impressions: 252,
          upperBound: 252,
          thresholded: false,
        },
        {
          keyword: "pub near me",
          impressions: 0,
          upperBound: 90,
          thresholded: true,
        },
      ],
    })

    const isolated = await fetch(
      `${server.baseUrl}/api/analytics/presence/keywords?range=18m`,
      { headers: { cookie: other.cookie } }
    )
    expect(isolated.status).toBe(200)
    expect(await isolated.json()).toMatchObject({
      state: "no_link",
      keywords: [],
    })

    exactValue = 50
    await admin`
      update sync_checkpoint
      set next_attempt_at = now()
      where organisation_id = ${owner.organisationId}
        and external_location_id = ${linked.externalLocationId}
        and sync_type = 'keywords'
    `
    const restatement = await fetch(`${server.baseUrl}/api/sync/keywords`, {
      method: "POST",
      headers: jsonHeaders(owner.cookie),
      body: JSON.stringify({ externalLocationId: linked.externalLocationId }),
    })
    expect(restatement.status, await restatement.clone().text()).toBe(200)
    expect((await restatement.json()).organisations[0].outcomes[0]).toMatchObject({
      status: "succeeded",
      months: 2,
      upserted: 4,
    })
    const updated = await fetch(
      `${server.baseUrl}/api/analytics/presence/keywords?range=1m`,
      { headers: { cookie: owner.cookie } }
    )
    expect((await updated.json()).keywords[0]).toMatchObject({
      keyword: "nepalese food",
      impressions: 50,
    })
  }, 30_000)
})

function jsonHeaders(cookie: string) {
  return { cookie, "content-type": "application/json" }
}
