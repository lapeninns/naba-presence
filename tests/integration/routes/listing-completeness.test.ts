import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { listingCompletenessResponseSchema } from "@/lib/listings/completeness-contract"

import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedLocation,
  seedLinkedReview,
  seedMemberUser,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

// End to end against the database: completeness is read from stored Google
// observations only, owners and admins skip a check with a reason (audited),
// members can read but not change skips, and no organisation sees another's.

const CHECK_IDS = [
  "primary_category",
  "regular_hours",
  "phone",
  "website",
  "verification",
  "description",
  "special_hours",
  "recent_post",
  "recent_photo",
  "cover_photo",
  "logo_photo",
  "unreplied_reviews",
  "booking_link",
  "services_or_menu",
  "description_quality",
  "additional_categories",
  "attributes",
  "website_utm",
  "rating_trend",
]

type Completeness = ReturnType<
  typeof listingCompletenessResponseSchema.parse
>["completeness"][number]

describeDatabase("listing completeness", () => {
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

  /** An organisation (owner by default) with a Google connection. */
  async function fixture(options: Parameters<typeof createTestTenant>[1] = {}) {
    const tenant = await createTestTenant(admin, options)
    organisations.push(tenant.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: tenant.organisationId,
    })
    const listing = () =>
      seedLinkedLocation(admin, {
        organisationId: tenant.organisationId,
        connectionId: connection.connectionId,
        googleAccountName: connection.googleAccountName,
      })
    return { ...tenant, connection, listing }
  }

  /** A stored profile read, as the profile editor leaves one. */
  async function seedProfile(
    organisationId: string,
    locationId: string,
    options: { ageDays?: number; websiteUri?: string | null } = {}
  ) {
    const observedAt = new Date(
      Date.now() - (options.ageDays ?? 0) * 24 * 60 * 60 * 1000
    )
    const websiteUri =
      options.websiteUri === undefined
        ? "https://example.com/?utm_source=gbp"
        : options.websiteUri
    const payload = {
      observedAt: observedAt.toISOString(),
      location: {
        categories: { primaryCategory: { displayName: "Pub" } },
        phoneNumbers: { primaryPhone: "01234 567890" },
        ...(websiteUri ? { websiteUri } : {}),
        profile: {
          description: `A village pub with a garden, real ales and Sunday roasts. ${locationId}`,
        },
      },
    }
    await admin`
      insert into presence_resource_reconcile_state (
        organisation_id, location_id, resource, status,
        last_attempt_at, last_succeeded_at, observed_at, observed_google_payload
      ) values (
        ${organisationId}, ${locationId}, 'profile', 'succeeded',
        ${observedAt}, ${observedAt}, ${observedAt},
        ${admin.json(payload)}
      )
    `
  }

  async function completeness(cookie: string, locationId?: string) {
    const query = locationId ? `&locationId=${locationId}` : ""
    const response = await request(
      `/api/listings/summary?view=completeness${query}`,
      cookie
    )
    expect(response.status, await response.clone().text()).toBe(200)
    return listingCompletenessResponseSchema.parse(await response.json())
      .completeness
  }

  const check = (entry: Completeness | undefined, id: string) => {
    const found = entry?.checks.find((candidate) => candidate.id === id)
    if (!found) throw new Error(`No ${id} check`)
    return found
  }

  const skipRows = (locationId: string) =>
    admin<{ checkId: string; reason: string }[]>`
      select check_id as "checkId", reason
      from listing_completeness_skip
      where location_id = ${locationId}
      order by check_id
    `

  const auditRows = (organisationId: string) =>
    admin<
      {
        action: string
        subjectType: string
        metadata: Record<string, unknown>
      }[]
    >`
      select action, subject_type as "subjectType", metadata
      from audit_log
      where organisation_id = ${organisationId}
        and action like 'listing_completeness.%'
      order by created_at
    `

  it("keeps the default board response and answers completeness from stored reads only", async () => {
    const owner = await fixture()
    const observed = await owner.listing()
    const unseen = await owner.listing()
    await seedProfile(owner.organisationId, observed.locationId)
    const callsBefore = google.calls.length

    const board = await request("/api/listings/summary", owner.cookie)
    expect(board.status).toBe(200)
    const boardBody = (await board.json()) as Record<string, unknown>
    expect(Array.isArray(boardBody.summaries)).toBe(true)
    expect(boardBody).not.toHaveProperty("completeness")

    const all = await completeness(owner.cookie)
    expect(all.map((entry) => entry.locationId).sort()).toEqual(
      [observed.locationId, unseen.locationId].sort()
    )
    for (const entry of all) {
      expect(entry.checks.map((item) => item.id)).toEqual(CHECK_IDS)
      const total = Object.values(entry.counts).reduce((a, b) => a + b, 0)
      expect(total).toBe(CHECK_IDS.length)
    }

    const [one] = await completeness(owner.cookie, observed.locationId)
    expect(one.locationId).toBe(observed.locationId)
    for (const id of ["primary_category", "phone", "website", "verification"])
      expect(check(one, id).status, id).toBe("pass")
    expect(one.score).not.toBeNull()

    const [none] = await completeness(owner.cookie, unseen.locationId)
    for (const id of ["primary_category", "phone", "website"])
      expect(check(none, id).status, id).toBe("unknown")
    expect(check(none, "verification").status).toBe("pass")

    expect(google.calls.length).toBe(callsBefore)
  })

  it("treats a stale profile read as unknown and a missing website as a fail", async () => {
    const owner = await fixture()
    const stale = await owner.listing()
    const noWebsite = await owner.listing()
    await seedProfile(owner.organisationId, stale.locationId, { ageDays: 40 })
    await seedProfile(owner.organisationId, noWebsite.locationId, {
      websiteUri: null,
    })

    const [old] = await completeness(owner.cookie, stale.locationId)
    for (const id of ["primary_category", "phone", "website"])
      expect(check(old, id).status, id).toBe("unknown")
    // Stale never fails: the profile-derived checks all wait for a new read.
    for (const id of ["description", "website_utm", "additional_categories"])
      expect(check(old, id).status, id).not.toBe("fail")

    const [missing] = await completeness(owner.cookie, noWebsite.locationId)
    expect(check(missing, "website")).toMatchObject({
      status: "fail",
      fix: { href: `/listings/${noWebsite.locationId}/profile` },
    })
    expect(check(missing, "phone").status).toBe("pass")
  })

  it("fails unreplied reviews only once reviews have synced", async () => {
    const owner = await fixture()
    const seeded = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: owner.connection.connectionId,
      googleAccountName: owner.connection.googleAccountName,
    })
    await admin`
      update review
      set create_time = now() - interval '10 days',
          update_time = now() - interval '10 days',
          triaged_at = null
      where id = ${seeded.reviewId}
    `

    const [unsynced] = await completeness(owner.cookie, seeded.locationId)
    expect(check(unsynced, "unreplied_reviews").status).toBe("unknown")

    await admin`
      insert into sync_checkpoint (
        organisation_id, external_location_id, sync_type, status, last_succeeded_at
      ) values (
        ${owner.organisationId}, ${seeded.externalLocationId}, 'reconcile',
        'succeeded', now()
      )
    `
    const [synced] = await completeness(owner.cookie, seeded.locationId)
    expect(check(synced, "unreplied_reviews")).toMatchObject({
      status: "fail",
      fix: { href: `/inbox?locationId=${seeded.locationId}` },
    })
  })

  it("lets owners and admins skip a check with a reason, replace it and remove it, audited", async () => {
    const owner = await fixture()
    const listing = await owner.listing()
    await seedProfile(owner.organisationId, listing.locationId, {
      websiteUri: null,
    })
    const path = `/api/locations/${listing.locationId}/completeness-skips`
    const [before] = await completeness(owner.cookie, listing.locationId)
    expect(check(before, "website").status).toBe("fail")

    const created = await request(path, owner.cookie, {
      method: "POST",
      body: JSON.stringify({ checkId: "website", reason: "No website yet" }),
    })
    expect(created.status, await created.clone().text()).toBe(200)
    const { skip } = (await created.json()) as {
      skip: { checkId: string; reason: string; skippedAt: string }
    }
    expect(skip).toMatchObject({
      checkId: "website",
      reason: "No website yet",
      skippedBy: "Harness user",
    })
    expect(Number.isNaN(Date.parse(skip.skippedAt))).toBe(false)

    const listed = await request(path, owner.cookie)
    expect(listed.status).toBe(200)
    expect(await listed.json()).toMatchObject({
      skips: [{ checkId: "website", reason: "No website yet" }],
    })

    const [after] = await completeness(owner.cookie, listing.locationId)
    expect(check(after, "website")).toMatchObject({
      status: "skipped",
      fix: null,
      skip: { reason: "No website yet" },
    })
    expect(after.counts.skipped).toBe(before.counts.skipped + 1)
    expect(after.counts.fail).toBe(before.counts.fail - 1)

    const replaced = await request(path, owner.cookie, {
      method: "POST",
      body: JSON.stringify({ checkId: "website", reason: "Facebook only" }),
    })
    expect(replaced.status).toBe(200)
    expect(await skipRows(listing.locationId)).toEqual([
      { checkId: "website", reason: "Facebook only" },
    ])

    const removed = await request(`${path}?checkId=website`, owner.cookie, {
      method: "DELETE",
    })
    expect(removed.status).toBe(200)
    expect(await removed.json()).toEqual({ removed: true })
    const again = await request(`${path}?checkId=website`, owner.cookie, {
      method: "DELETE",
    })
    expect(await again.json()).toEqual({ removed: false })
    expect(await skipRows(listing.locationId)).toEqual([])

    const audit = await auditRows(owner.organisationId)
    expect(audit.map((row) => row.action)).toEqual([
      "listing_completeness.check_skipped",
      "listing_completeness.check_skipped",
      "listing_completeness.skip_removed",
    ])
    for (const row of audit) {
      expect(row.subjectType).toBe("listing_completeness_skip")
      expect(row.metadata).toMatchObject({
        locationId: listing.locationId,
        checkId: "website",
      })
    }

    const adminTenant = await fixture({ role: "admin" })
    const adminListing = await adminTenant.listing()
    const byAdmin = await request(
      `/api/locations/${adminListing.locationId}/completeness-skips`,
      adminTenant.cookie,
      {
        method: "POST",
        body: JSON.stringify({ checkId: "booking_link", reason: "Walk-ins" }),
      }
    )
    expect(byAdmin.status, await byAdmin.clone().text()).toBe(200)
  })

  it("refuses an unknown check or an empty reason, and writes nothing", async () => {
    const owner = await fixture()
    const listing = await owner.listing()
    const path = `/api/locations/${listing.locationId}/completeness-skips`
    for (const body of [
      { checkId: "not_a_check", reason: "Because" },
      { checkId: "website", reason: "" },
      { checkId: "website", reason: "   " },
    ]) {
      const response = await request(path, owner.cookie, {
        method: "POST",
        body: JSON.stringify(body),
      })
      expect(response.status, JSON.stringify(body)).toBe(400)
    }
    const badDelete = await request(
      `${path}?checkId=not_a_check`,
      owner.cookie,
      {
        method: "DELETE",
      }
    )
    expect(badDelete.status).toBe(400)
    expect(await skipRows(listing.locationId)).toEqual([])
    expect(await auditRows(owner.organisationId)).toEqual([])
  })

  it("lets members read skips only on listings they see, and change none", async () => {
    const owner = await fixture()
    const listing = await owner.listing()
    const elsewhere = await owner.listing()
    const path = `/api/locations/${listing.locationId}/completeness-skips`
    await request(path, owner.cookie, {
      method: "POST",
      body: JSON.stringify({ checkId: "logo_photo", reason: "No logo" }),
    })
    const assigned = await seedMemberUser(admin, {
      organisationId: owner.organisationId,
      assignLocationId: listing.locationId,
    })
    const outside = await seedMemberUser(admin, {
      organisationId: owner.organisationId,
      assignLocationId: elsewhere.locationId,
    })

    const read = await request(path, assigned.cookie)
    expect(read.status).toBe(200)
    expect(await read.json()).toMatchObject({
      skips: [{ checkId: "logo_photo", reason: "No logo" }],
    })
    expect((await request(path, outside.cookie)).status).toBe(404)
    expect(
      (await completeness(outside.cookie)).map((entry) => entry.locationId)
    ).toEqual([elsewhere.locationId])

    for (const init of [
      {
        method: "POST",
        body: JSON.stringify({ checkId: "website", reason: "Member says" }),
      },
      { method: "DELETE" },
    ]) {
      const target =
        init.method === "DELETE" ? `${path}?checkId=logo_photo` : path
      const response = await request(target, assigned.cookie, init)
      expect(response.status, init.method).toBe(403)
      expect(await response.json()).toMatchObject({
        error: "permission_denied",
      })
    }
    expect(await skipRows(listing.locationId)).toEqual([
      { checkId: "logo_photo", reason: "No logo" },
    ])
    expect(
      (await auditRows(owner.organisationId)).map((row) => row.action)
    ).toEqual(["listing_completeness.check_skipped"])
  })

  it("keeps each organisation's listings and skips to itself", async () => {
    const a = await fixture()
    const aListing = await a.listing()
    const b = await fixture()
    const bListing = await b.listing()
    const aPath = `/api/locations/${aListing.locationId}/completeness-skips`
    const bPath = `/api/locations/${bListing.locationId}/completeness-skips`
    await request(aPath, a.cookie, {
      method: "POST",
      body: JSON.stringify({ checkId: "attributes", reason: "A's reason" }),
    })
    const bSkip = await request(bPath, b.cookie, {
      method: "POST",
      body: JSON.stringify({ checkId: "attributes", reason: "B's reason" }),
    })
    expect(bSkip.status).toBe(200)

    const seenByB = await completeness(b.cookie)
    expect(seenByB.map((entry) => entry.locationId)).toEqual([
      bListing.locationId,
    ])
    expect(await completeness(b.cookie, aListing.locationId)).toEqual([])
    const seenByA = await completeness(a.cookie)
    expect(seenByA.map((entry) => entry.locationId)).toEqual([
      aListing.locationId,
    ])
    expect(check(seenByA[0], "attributes").skip?.reason).toBe("A's reason")

    for (const init of [
      {},
      {
        method: "POST",
        body: JSON.stringify({ checkId: "attributes", reason: "Hijack" }),
      },
      { method: "DELETE" },
    ]) {
      const target =
        init.method === "DELETE" ? `${aPath}?checkId=attributes` : aPath
      const response = await request(target, b.cookie, init)
      expect(response.status, init.method ?? "GET").toBe(404)
    }
    expect((await request(bPath, a.cookie)).status).toBe(404)

    expect(await skipRows(aListing.locationId)).toEqual([
      { checkId: "attributes", reason: "A's reason" },
    ])
    expect(
      (await auditRows(a.organisationId)).map((row) => row.action)
    ).toEqual(["listing_completeness.check_skipped"])
    expect(
      (await auditRows(b.organisationId)).map((row) => row.action)
    ).toEqual(["listing_completeness.check_skipped"])
  })
})
