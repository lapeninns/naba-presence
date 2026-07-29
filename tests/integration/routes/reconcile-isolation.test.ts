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

type TenantFixture = {
  owner: Awaited<ReturnType<typeof createTestTenant>>
  connectionId: string
  externalLocationId: string
  googleReviewId: string
}

describeDatabase("reconcile tenant isolation", () => {
  let admin: ReturnType<typeof postgres>
  let stub: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    stub = await startGoogleStub()
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: stub.baseUrl,
    })
  })

  afterAll(async () => {
    await server.stop()
    await stub.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  async function createFixture(label: string): Promise<TenantFixture> {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const linked = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    const [location] = await admin<{ google_location_name: string }[]>`
      select google_location_name
      from external_location
      where id = ${linked.externalLocationId}
    `
    const googleReviewId = `reconcile-${label}`
    stub.respond(
      {
        method: "GET",
        pathIncludes: `/${location.google_location_name.replace("locations/", "")}/reviews`,
      },
      () => ({
        status: 200,
        json: {
          reviews: [
            {
              name: `${connection.googleAccountName}/${location.google_location_name}/reviews/${googleReviewId}`,
              reviewId: googleReviewId,
              reviewer: { displayName: `Reviewer ${label}` },
              starRating: "FIVE",
              comment: `Fleet-safe review ${label}`,
              createTime: "2026-08-01T10:00:00.000Z",
              updateTime: "2026-09-01T10:00:00.000Z",
            },
          ],
        },
      })
    )
    return {
      owner,
      connectionId: connection.connectionId,
      externalLocationId: linked.externalLocationId,
      googleReviewId,
    }
  }

  it("continues other tenants when one connection requires reconnect", async () => {
    const tenantA = await createFixture("A")
    const tenantB = await createFixture("B")
    const tenantC = await createFixture("C")
    await admin`
      update google_connection
      set
        access_token_expires_at = now() - interval '1 hour',
        refresh_token_ciphertext = null
      where id = ${tenantB.connectionId}
    `

    const response = await fetch(`${server.baseUrl}/api/sync/reconcile`, {
      method: "POST",
      headers: {
        authorization: "Bearer route-harness-cron-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({ maxOrganisations: 100 }),
    })
    expect(response.status, await response.clone().text()).toBe(200)
    const body = (await response.json()) as {
      processed: number
      nextCursor: string | null
      failures: Array<{
        organisationId: string
        externalLocationId: string | null
        errorCode: string
      }>
    }
    expect(body.processed).toBeGreaterThanOrEqual(3)
    expect(body.nextCursor).toBeNull()
    expect(body.failures).toContainEqual({
      organisationId: tenantB.owner.organisationId,
      externalLocationId: tenantB.externalLocationId,
      errorCode: "google_reconnect_required",
    })

    for (const tenant of [tenantA, tenantC]) {
      const [review] = await admin<{ count: number }[]>`
        select count(*)::int as count
        from review
        where organisation_id = ${tenant.owner.organisationId}
          and google_review_id_hash =
            encode(digest(${tenant.googleReviewId}, 'sha256'), 'hex')
      `
      expect(review.count).toBe(1)
      const [checkpoint] = await admin<{ status: string }[]>`
        select status
        from sync_checkpoint
        where organisation_id = ${tenant.owner.organisationId}
          and external_location_id = ${tenant.externalLocationId}
          and sync_type = 'reconcile'
      `
      expect(checkpoint.status).toBe("succeeded")
    }

    const [connection] = await admin<{ status: string }[]>`
      select status
      from google_connection
      where id = ${tenantB.connectionId}
    `
    expect(["expired", "revoked"]).toContain(connection.status)
    const [task] = await admin<{ status: string }[]>`
      select status
      from connection_task
      where organisation_id = ${tenantB.owner.organisationId}
        and google_connection_id = ${tenantB.connectionId}
        and task_type = 'reconnect'
    `
    expect(task.status).toBe("open")
  })
})
