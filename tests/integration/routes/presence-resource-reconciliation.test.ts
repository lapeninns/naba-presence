import { randomUUID } from "node:crypto"

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

describeDatabase("Presence resource background reconciliation", () => {
  let admin: ReturnType<typeof postgres>
  let google: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    google = await startGoogleStub()
    server = await startAppServer({ GOOGLE_API_PROXY_BASE: google.baseUrl })
  })

  afterAll(async () => {
    await server.stop()
    await google.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  it("authenticates cron, isolates failures, and records all resource attempts", async () => {
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
    const endpoint = `${server.baseUrl}/api/sync/presence-resources`
    const unauthorised = await fetch(endpoint, {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json" },
    })
    expect(unauthorised.status).toBe(401)

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: "Bearer route-harness-cron-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({ maxOrganisations: 25, maxLocations: 5 }),
    })
    expect(
      response.status,
      `${await response.clone().text()}\n${server.stderr}`
    ).toBe(200)
    const payload = await response.json()
    const outcomes = payload.outcomes.filter(
      (outcome: { organisationId: string; locationId: string }) =>
        outcome.organisationId === owner.organisationId &&
        outcome.locationId === linked.locationId
    )
    expect(outcomes).toHaveLength(6)
    expect(
      outcomes.map((outcome: { resource: string }) => outcome.resource).sort()
    ).toEqual([
      "foodMenus",
      "hours",
      "media",
      "placeActions",
      "posts",
      "profile",
    ])
    expect(
      outcomes.some(
        (outcome: { status: string }) => outcome.status === "failed"
      )
    ).toBe(true)

    const states = await admin<{ resource: string; status: string }[]>`
      select resource, status from presence_resource_reconcile_state
      where organisation_id = ${owner.organisationId} and location_id = ${linked.locationId}
      order by resource`
    expect(states).toHaveLength(6)

    // Every resource is now scheduled forward, so the location is no longer
    // due and an immediate second tick walks nothing for this tenant. Without
    // that the sweep re-walks its head-of-order organisations every fifteen
    // minutes and a fleet larger than one page never reaches its tail.
    const due = await admin<{ count: string }[]>`
      select count(*)::text as count from presence_resource_reconcile_state
      where organisation_id = ${owner.organisationId}
        and location_id = ${linked.locationId}
        and next_attempt_at <= now()`
    expect(Number(due[0].count)).toBe(0)

    const [before] = await admin<{ id: string }[]>`
      select organisation_id::text as id from organisation_job_route
      where organisation_id < ${owner.organisationId}
      order by organisation_id desc limit 1`
    const again = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: "Bearer route-harness-cron-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        maxOrganisations: 1,
        maxLocations: 5,
        ...(before ? { organisationCursor: before.id } : {}),
      }),
    })
    expect(again.status).toBe(200)
    expect(
      (await again.json()).outcomes.filter(
        (outcome: { organisationId: string }) =>
          outcome.organisationId === owner.organisationId
      )
    ).toHaveLength(0)
  }, 30_000)

  it("pages the cursor to the tail and reaps stranded proposals there", async () => {
    const first = await createTestTenant(admin)
    const second = await createTestTenant(admin)
    organisations.push(first.organisationId, second.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: second.organisationId,
    })
    const linked = await seedLinkedReview(admin, {
      organisationId: second.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })

    // A crash between the claim and the settle leaves this row locking its
    // identity: no fresh proposal can be raised for it and the decision path
    // refuses it. Inserted directly with an old updated_at — the set_updated_at
    // trigger fires only on UPDATE.
    const strandedId = randomUUID()
    await admin`
      insert into presence_import_proposal (
        id, organisation_id, location_id, external_location_id, resource_type,
        identity_key, kind, field_key, suggested_patch, status,
        pinned_canonical_revision, pinned_canonical_hash, pinned_google_hash,
        batch_id, raised_via, updated_at
      ) values (
        ${strandedId}, ${second.organisationId}, ${linked.locationId},
        ${linked.externalLocationId}, 'profile', 'phone', 'field_changed',
        'phone',
        ${JSON.stringify({ op: "set_field", fieldKey: "phone", value: "+44 1223 000000" })}::jsonb,
        'processing', '1', 'hash-canonical', 'hash-google',
        ${randomUUID()}, 'sweep', now() - interval '30 minutes'
      )
    `

    // Start the walk just below the lower of the two tenants so the assertion
    // is about reaching the tail, not about how many other tenants the test
    // database happens to hold.
    const ordered = [first.organisationId, second.organisationId].sort()
    const [before] = await admin<{ id: string }[]>`
      select organisation_id::text as id from organisation_job_route
      where organisation_id < ${ordered[0]}
      order by organisation_id desc limit 1`
    let cursor: string | null = before?.id ?? null
    let firstPageCursor: string | null = null
    const seen = new Set<string>()
    for (let page = 0; page < 40; page += 1) {
      const response: Response = await fetch(
        `${server.baseUrl}/api/sync/presence-resources`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer route-harness-cron-secret",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            maxOrganisations: 1,
            maxLocations: 5,
            ...(cursor ? { organisationCursor: cursor } : {}),
          }),
        }
      )
      expect(response.status, await response.clone().text()).toBe(200)
      const body = (await response.json()) as {
        outcomes: Array<{ organisationId: string }>
        nextCursor: string | null
      }
      if (page === 0) firstPageCursor = body.nextCursor
      for (const outcome of body.outcomes) seen.add(outcome.organisationId)
      if (!body.nextCursor) break
      cursor = body.nextCursor
      if (seen.has(second.organisationId)) break
    }
    // A page that reconciled organisations must hand back a resume point.
    // Returning null here is the regression that strands every organisation
    // after the first page for good, and no existing test could see it.
    expect(firstPageCursor).not.toBeNull()
    expect(seen.has(second.organisationId)).toBe(true)

    const [stranded] = await admin<{ status: string; failureCode: string }[]>`
      select status, failure_code as "failureCode"
      from presence_import_proposal where id = ${strandedId}`
    expect(stranded).toMatchObject({
      status: "failed",
      failureCode: "proposal_apply_failed",
    })
  }, 60_000)
})
