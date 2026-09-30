import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  bulkOperationResponseSchema,
  type BulkOperationView,
} from "@/lib/contracts/bulk-listings"
import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedLocation,
  seedMemberUser,
} from "../helpers/tenant"

const describeDatabase =
  process.env.RUN_DB_TESTS === "true" ? describe : describe.skip
const CRON = { authorization: "Bearer route-harness-cron-secret" }
const d = (date: string) => {
  const [year, month, day] = date.split("-").map(Number)
  return { year, month, day }
}

/**
 * WP6 through real routes and the real job tick against a loopback Google
 * stub that keeps per-listing hours, so merges, readback, conflicts and
 * failures are observed rather than assumed.
 */
describeDatabase("durable bulk listing changes", { timeout: 60_000 }, () => {
  let admin: ReturnType<typeof postgres>
  let google: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []
  const listings = new Map<
    string,
    {
      specialHours?: { specialHourPeriods: unknown[] }
      regularHours?: unknown
      patchStatus?: number
      applyPatch?: boolean
    }
  >()
  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 2 })
    google = await startGoogleStub()
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: google.baseUrl,
      PUBLISH_ENABLED: "true",
      JOBS_ENABLED: "true",
      GBP_PROFILE_WRITES_ENABLED: "true",
    })
  })
  afterAll(async () => {
    await server.stop()
    await google.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })
  beforeEach(() => {
    listings.clear()
    google.reset()
    const nameOf = (path: string) =>
      new URL(path, "https://stub.test").pathname.replace(/^\/v1\//, "")
    google.respond({ method: "GET", pathIncludes: "readMask=" }, (call) => {
      const state = listings.get(nameOf(call.path))
      return state
        ? {
            status: 200,
            json: {
              specialHours: state.specialHours,
              regularHours: state.regularHours,
            },
          }
        : { status: 404, json: {} }
    })
    google.respond(
      { method: "PATCH", pathIncludes: "updateMask=specialHours" },
      (call) => {
        const state = listings.get(nameOf(call.path))
        if (!state) return { status: 404, json: {} }
        if (state.patchStatus && state.patchStatus !== 200)
          return {
            status: state.patchStatus,
            json: {
              error: { status: "INVALID_ARGUMENT", message: "rejected" },
            },
          }
        if (state.applyPatch !== false)
          state.specialHours = (
            call.body as { specialHours: { specialHourPeriods: unknown[] } }
          ).specialHours
        return { status: 200, json: { specialHours: state.specialHours } }
      }
    )
  })
  const patches = (name?: string) =>
    google.calls.filter(
      (call) => call.method === "PATCH" && (!name || call.path.includes(name))
    )
  const tick = async () => {
    const response = await fetch(`${server.baseUrl}/api/jobs/run`, {
      method: "POST",
      headers: CRON,
    })
    expect(response.status, await response.clone().text()).toBe(200)
  }
  const christmas = {
    startDate: d("2026-12-25"),
    endDate: d("2026-12-25"),
    closed: true,
  }
  const input = {
    operation: "special_hours",
    dates: [
      {
        action: "open",
        date: "2026-12-24",
        opensAt: "10:00",
        closesAt: "15:00",
      },
    ],
  }

  async function tenant(count = 3) {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const linked: Awaited<ReturnType<typeof seedLinkedLocation>>[] = []
    for (let index = 0; index < count; index += 1) {
      const location = await seedLinkedLocation(admin, {
        organisationId: owner.organisationId,
        ...connection,
      })
      listings.set(location.googleLocationName, {
        specialHours: { specialHourPeriods: [christmas] },
      })
      linked.push(location)
    }
    const api = (path: string, body?: unknown, cookie = owner.cookie) =>
      fetch(`${server.baseUrl}/api/listings/bulk${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { cookie, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    const read = async (response: Response) => {
      expect(response.status, await response.clone().text()).toBeLessThan(300)
      return bulkOperationResponseSchema.parse(await response.json()).operation
    }
    const preview = async (
      ids = linked.map((l) => l.locationId),
      cookie = owner.cookie
    ) => read(await api("/preview", { locationIds: ids, input }, cookie))
    const approve = (
      op: BulkOperationView,
      acknowledgeSkipped = false,
      cookie = owner.cookie
    ) =>
      api(
        `/${op.id}/approve`,
        { expectedPreviewHash: op.previewHash, acknowledgeSkipped },
        cookie
      )
    const status = async (op: BulkOperationView) => read(await api(`/${op.id}`))
    return { owner, connection, linked, api, read, preview, approve, status }
  }

  it("merges only the chosen date per listing, skips an already-applied one with acknowledgement, and confirms by readback", async () => {
    const t = await tenant()
    const done = {
      startDate: d("2026-12-24"),
      endDate: d("2026-12-24"),
      openTime: { hours: 10 },
      closeTime: { hours: 15 },
    }
    listings.get(t.linked[2].googleLocationName)!.specialHours = {
      specialHourPeriods: [christmas, done],
    }
    const op = await t.preview()
    expect(op.children.map((c) => c.eligibility).sort()).toEqual([
      "eligible",
      "eligible",
      "skipped",
    ])
    expect(op.children.find((c) => c.eligibility === "skipped")).toMatchObject({
      skipReason: "already_applied",
    })
    const unacknowledged = await t.approve(op)
    expect(unacknowledged.status).toBe(409)
    expect(await unacknowledged.json()).toMatchObject({
      error: "bulk_skipped_unacknowledged",
    })
    await t.read(await t.approve(op, true))
    const started = await t.api(`/${op.id}/execute`, {})
    expect(started.status).toBe(202)
    await tick()
    const after = await t.status(op)
    expect(after.status).toBe("completed")
    expect(
      after.children
        .filter((c) => c.status === "succeeded")
        .every((c) => c.confirmationState === "confirmed")
    ).toBe(true)
    expect(patches()).toHaveLength(2)
    expect(
      listings.get(t.linked[0].googleLocationName)!.specialHours!
        .specialHourPeriods
    ).toEqual([
      // Sorted by date; Christmas is the untouched existing period.
      {
        startDate: d("2026-12-24"),
        endDate: d("2026-12-24"),
        openTime: { hours: 10, minutes: 0 },
        closeTime: { hours: 15, minutes: 0 },
        closed: false,
      },
      christmas,
    ])
    await tick()
    expect(patches()).toHaveLength(2)
  })

  it("keeps successes on partial provider failure and retries only the failed listing", async () => {
    const t = await tenant(2)
    listings.get(t.linked[1].googleLocationName)!.patchStatus = 400
    const op = await t.preview()
    await t.read(await t.approve(op))
    await t.api(`/${op.id}/execute`, {})
    await tick()
    const partial = await t.status(op)
    expect(partial.status).toBe("completed_with_failures")
    expect(partial.children.map((c) => c.status).sort()).toEqual([
      "failed",
      "succeeded",
    ])
    const [incident] =
      await admin`select kind, location_id from notification_incident where organisation_id = ${t.owner.organisationId} and kind = 'bulk_completed_with_failures'`
    expect(incident).toMatchObject({ location_id: null })
    listings.get(t.linked[1].googleLocationName)!.patchStatus = 200
    await t.read(await t.api(`/${op.id}/retry`, {}))
    await tick()
    expect((await t.status(op)).status).toBe("completed")
    expect(patches(t.linked[0].googleLocationName)).toHaveLength(1)
    expect(patches(t.linked[1].googleLocationName)).toHaveLength(2)
  })

  it("turns a changed Google baseline into a conflict and revoked access into a failure, without writing", async () => {
    const t = await tenant(2)
    const manager = await seedMemberUser(admin, {
      organisationId: t.owner.organisationId,
      canPublish: true,
    })
    await admin`update member set role = 'admin' where user_id = ${manager.userId}`
    const op = await t.preview()
    await t.read(await t.approve(op, false, manager.cookie))
    await t.api(`/${op.id}/execute`, {})
    listings.get(t.linked[0].googleLocationName)!.specialHours = {
      specialHourPeriods: [
        christmas,
        { startDate: d("2026-12-31"), endDate: d("2026-12-31"), closed: true },
      ],
    }
    await admin`update member set role = 'viewer', can_publish = false where user_id = ${manager.userId}`
    await tick()
    const after = await t.status(op)
    expect(
      after.children.map((c) => `${c.status}:${c.resultCode}`).sort()
    ).toEqual(["failed:permission_revoked", "failed:permission_revoked"])
    expect(patches()).toHaveLength(0)
    const t2 = await tenant(1)
    const second = await t2.preview()
    await t2.read(await t2.approve(second))
    await t2.api(`/${second.id}/execute`, {})
    listings.get(t2.linked[0].googleLocationName)!.specialHours = {
      specialHourPeriods: [],
    }
    await tick()
    expect((await t2.status(second)).children[0]).toMatchObject({
      status: "conflict",
      resultCode: "google_baseline_changed",
    })
    expect(patches()).toHaveLength(0)
  })

  it("cancels unstarted listings without rolling back and settles an interrupted child from readback", async () => {
    const t = await tenant(2)
    const op = await t.preview()
    await t.read(await t.approve(op))
    await t.api(`/${op.id}/execute`, {})
    const cancelled = await t.read(await t.api(`/${op.id}/cancel`, {}))
    expect(cancelled.status).toBe("cancelled")
    expect(cancelled.children.map((c) => c.status)).toEqual([
      "cancelled",
      "cancelled",
    ])
    await tick()
    expect(patches()).toHaveLength(0)
    const t2 = await tenant(1)
    const interrupted = await t2.preview()
    await t2.read(await t2.approve(interrupted))
    await t2.api(`/${interrupted.id}/execute`, {})
    // A worker that died after sending: the write landed, the lease expired.
    listings.get(t2.linked[0].googleLocationName)!.specialHours = {
      specialHourPeriods: [
        christmas,
        {
          startDate: d("2026-12-24"),
          endDate: d("2026-12-24"),
          openTime: { hours: 10 },
          closeTime: { hours: 15 },
        },
      ],
    }
    await admin`update bulk_listing_child set status = 'running', attempts = 1, lease_expires_at = now() - interval '1 minute' where operation_id = ${interrupted.id}`
    await tick()
    expect((await t2.status(interrupted)).children[0]).toMatchObject({
      status: "ambiguous",
      resultCode: "execution_interrupted",
    })
    await t2.read(await t2.api(`/${interrupted.id}/retry`, {}))
    await tick()
    expect((await t2.status(interrupted)).children[0]).toMatchObject({
      status: "succeeded",
      confirmationState: "confirmed",
    })
    expect(patches()).toHaveLength(0)
  })

  it("defers a listing on quota pressure instead of failing it", async () => {
    const t = await tenant(1)
    listings.get(t.linked[0].googleLocationName)!.patchStatus = 429
    const op = await t.preview()
    await t.read(await t.approve(op))
    await t.api(`/${op.id}/execute`, {})
    await tick()
    const [child] =
      await admin`select status, result_code from bulk_listing_child where operation_id = ${op.id}`
    expect(child).toMatchObject({
      status: "queued",
      result_code: "google_rate_limited",
    })
  })

  it("refuses a batch naming a hidden listing without saying which, and more than 100 listings", async () => {
    const t = await tenant(2)
    const member = await seedMemberUser(admin, {
      organisationId: t.owner.organisationId,
      canPublish: true,
      assignLocationId: t.linked[0].locationId,
    })
    const hidden = await t.api(
      "/preview",
      { locationIds: t.linked.map((l) => l.locationId), input },
      member.cookie
    )
    expect(hidden.status).toBe(404)
    expect(await hidden.json()).toMatchObject({
      error: "bulk_targets_unavailable",
    })
    const tooMany = await t.api("/preview", {
      locationIds: Array.from({ length: 101 }, () => crypto.randomUUID()),
      input,
    })
    expect(tooMany.status).toBe(400)
    const other = await createTestTenant(admin)
    organisations.push(other.organisationId)
    const foreign = await t.api(
      "/preview",
      { locationIds: [t.linked[0].locationId], input },
      other.cookie
    )
    expect(foreign.status).toBe(404)
  })
})
