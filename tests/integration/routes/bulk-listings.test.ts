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
      /** The next real PATCH lands but answers 503; reads then fail until cleared. */
      lostResponse?: boolean
      readsFail?: boolean
    }
  >()
  let readDelayMs = 0
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
    readDelayMs = 0
    google.respond({ method: "GET", pathIncludes: "readMask=" }, (call) => {
      const state = listings.get(nameOf(call.path))
      if (state?.readsFail)
        return { status: 503, json: { error: { status: "UNAVAILABLE" } } }
      return state
        ? {
            status: 200,
            delayMs: readDelayMs,
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
        const validateOnly =
          new URL(call.path, "https://stub.test").searchParams.get(
            "validateOnly"
          ) === "true"
        if (state.lostResponse && !validateOnly) {
          state.lostResponse = false
          state.readsFail = true
          state.specialHours = (
            call.body as { specialHours: { specialHourPeriods: unknown[] } }
          ).specialHours
          return { status: 503, json: { error: { status: "UNAVAILABLE" } } }
        }
        if (state.patchStatus && state.patchStatus !== 200)
          return {
            status: state.patchStatus,
            json: {
              error: { status: "INVALID_ARGUMENT", message: "rejected" },
            },
          }
        if (state.applyPatch !== false && !validateOnly)
          state.specialHours = (
            call.body as { specialHours: { specialHourPeriods: unknown[] } }
          ).specialHours
        return { status: 200, json: { specialHours: state.specialHours } }
      }
    )
  })
  /** Real writes: the hours publish path validates first (validateOnly). */
  const patches = (name?: string) =>
    google.calls.filter(
      (call) =>
        call.method === "PATCH" &&
        !call.path.includes("validateOnly=true") &&
        (!name || call.path.includes(name))
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

  const setFeature = (organisationId: string, enabled: boolean) => admin`
    insert into organisation_feature (organisation_id, feature, enabled, changed_by)
    values (${organisationId}, 'bulk_actions', ${enabled}, 'test')
    on conflict (organisation_id, feature) do update set enabled = excluded.enabled`

  async function tenant(count = 3, options: { feature?: boolean } = {}) {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    if (options.feature !== false) await setFeature(owner.organisationId, true)
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
    // Google refused the first attempt at validation, so only the retry wrote.
    expect(patches(t.linked[1].googleLocationName)).toHaveLength(1)
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
    // The date the batch sets changed on Google after the preview. (A change
    // to any other date is not a conflict: it is written back as it is.)
    listings.get(t2.linked[0].googleLocationName)!.specialHours = {
      specialHourPeriods: [
        christmas,
        { startDate: d("2026-12-24"), endDate: d("2026-12-24"), closed: true },
      ],
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

  it("refuses a batch naming a hidden listing without saying which, and more than 50 listings", async () => {
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
      locationIds: Array.from({ length: 51 }, () => crypto.randomUUID()),
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
  const execute = async (
    t: Awaited<ReturnType<typeof tenant>>,
    op: BulkOperationView
  ) => {
    await t.read(await t.approve(op))
    const started = await t.api(`/${op.id}/execute`, {})
    expect(started.status, await started.clone().text()).toBe(202)
  }
  const childRows = (operationId: string) =>
    admin<{ status: string; result_code: string | null }[]>`
      select status, result_code from bulk_listing_child where operation_id = ${operationId} order by id`

  it("is invisible without the organisation's bulk_actions feature, and never claims a switched-off organisation's children", async () => {
    const t = await tenant(1, { feature: false })
    const refused = await t.api("/preview", {
      locationIds: [t.linked[0].locationId],
      input,
    })
    expect(refused.status).toBe(404)
    expect(await refused.json()).toMatchObject({ error: "feature_disabled" })
    expect((await t.api("")).status).toBe(404)
    await setFeature(t.owner.organisationId, true)
    const op = await t.preview()
    await execute(t, op)
    await setFeature(t.owner.organisationId, false)
    expect((await t.api(`/${op.id}`)).status).toBe(404)
    expect((await t.api(`/${op.id}/cancel`, {})).status).toBe(404)
    await tick()
    expect(await childRows(op.id)).toEqual([
      { status: "queued", result_code: null },
    ])
    expect(patches()).toHaveLength(0)
  })

  it("expires a preview after 15 minutes and dispatch 24 hours after approval, per child, without writing", async () => {
    const t = await tenant(2)
    const stale = await t.preview()
    const window = (op: BulkOperationView) =>
      Date.parse(op.previewExpiresAt) - Date.parse(op.createdAt)
    // The window runs from the Google reads, which precede the insert.
    expect(window(stale)).toBeLessThanOrEqual(15 * 60_000 + 250)
    expect(window(stale)).toBeGreaterThan(15 * 60_000 - 10_000)
    expect(stale.dispatchExpiresAt).toBeNull()
    // Slow Google reads come out of the 15 minutes, not on top of them.
    readDelayMs = 2_000
    const slow = await t.preview()
    readDelayMs = 0
    expect(window(slow)).toBeLessThanOrEqual(15 * 60_000 - 1_500)
    await admin`update bulk_listing_operation set preview_expires_at = now() - interval '1 second' where id = ${stale.id}`
    expect((await t.status(stale)).status).toBe("expired")
    const late = await t.approve(stale)
    expect(late.status).toBe(409)
    expect(await late.json()).toMatchObject({ error: "approval_expired" })

    const op = await t.preview()
    const approved = await t.read(await t.approve(op))
    const dispatchWindow =
      Date.parse(approved.dispatchExpiresAt!) - Date.now() - 24 * 3_600_000
    expect(Math.abs(dispatchWindow)).toBeLessThan(60_000)
    await t.api(`/${op.id}/execute`, {})
    await admin`update bulk_listing_operation set dispatch_expires_at = now() - interval '1 second' where id = ${op.id}`
    // Before any sweep, a reader already sees the closed window per listing.
    const unswept = await t.status(op)
    expect(unswept.status).toBe("running")
    expect(unswept.counts).toEqual({ expired: 2 })
    expect(unswept.children.map((c) => `${c.status}:${c.resultCode}`)).toEqual([
      "expired:dispatch_expired",
      "expired:dispatch_expired",
    ])
    const listed = (await (await t.api("")).json()) as {
      operations: { id: string; counts: Record<string, number> }[]
    }
    expect(listed.operations.find((o) => o.id === op.id)?.counts).toEqual({
      expired: 2,
    })
    await tick()
    const after = await t.status(op)
    expect(after.status).toBe("completed_with_failures")
    expect(after.children.map((c) => `${c.status}:${c.resultCode}`)).toEqual([
      "expired:dispatch_expired",
      "expired:dispatch_expired",
    ])
    expect(patches()).toHaveLength(0)
    const retry = await t.api(`/${op.id}/retry`, {})
    expect(retry.status).toBe(409)
    expect(await retry.json()).toMatchObject({ error: "approval_expired" })
    const [incident] =
      await admin`select kind from notification_incident where organisation_id = ${t.owner.organisationId} and kind = 'bulk_completed_with_failures'`
    expect(incident).toBeDefined()
    // The sweep also records an expired approval that was never started.
    const unstarted = await t.preview()
    await t.read(await t.approve(unstarted))
    await admin`update bulk_listing_operation set dispatch_expires_at = now() - interval '1 second' where id = ${unstarted.id}`
    await tick()
    const [row] =
      await admin`select status, finished_at from bulk_listing_operation where id = ${unstarted.id}`
    expect(row.status).toBe("expired")
    expect(row.finished_at).not.toBeNull()
    expect(await childRows(unstarted.id)).toEqual([
      { status: "expired", result_code: "dispatch_expired" },
      { status: "expired", result_code: "dispatch_expired" },
    ])
    // A preview that was never approved says so, not the 24-hour window.
    expect(await childRows(stale.id)).toEqual([
      { status: "expired", result_code: "preview_expired" },
      { status: "expired", result_code: "preview_expired" },
    ])
    // Each operation the sweep expired is finished and audited once; a
    // second tick adds nothing.
    await tick()
    const [staleRow] =
      await admin`select finished_at from bulk_listing_operation where id = ${stale.id}`
    expect(staleRow.finished_at).not.toBeNull()
    const audits =
      await admin`select subject_id, actor_user_id::text as actor, metadata from audit_log
        where organisation_id = ${t.owner.organisationId} and action = 'bulk_listing.expired' order by subject_id`
    // The running batch is finished by the runner instead
    // (completed_with_failures above); the slow preview is still open.
    expect(
      audits.map((a) => ({
        id: a.subject_id,
        stage: a.metadata.stage,
        actor: a.actor,
      }))
    ).toEqual(
      [
        { id: stale.id, stage: "preview", actor: null },
        { id: unstarted.id, stage: "dispatch", actor: t.owner.userId },
      ].sort((a, b) => (a.id < b.id ? -1 : 1))
    )
  })

  it("keeps the 50-listing cap for every batch the migration did not grandfather", async () => {
    const t = await tenant(1)
    const op = await t.preview()
    await expect(
      admin`update bulk_listing_operation set legacy_over_cap = true where id = ${op.id}`
    ).rejects.toThrow(/legacy_over_cap is set only by migration 0260/)
    await expect(
      admin`insert into bulk_listing_operation (organisation_id, operation, input, target_location_ids, preview_hash, requested_by, require_two_person_approval, legacy_over_cap)
        select organisation_id, operation, input, array_fill(target_location_ids[1], array[51]), preview_hash, requested_by, false, true
        from bulk_listing_operation where id = ${op.id}`
    ).rejects.toThrow(/legacy_over_cap is set only by migration 0260/)
    await expect(
      admin`insert into bulk_listing_operation (organisation_id, operation, input, target_location_ids, preview_hash, requested_by, require_two_person_approval)
        select organisation_id, operation, input, array_fill(target_location_ids[1], array[51]), preview_hash, requested_by, false
        from bulk_listing_operation where id = ${op.id}`
    ).rejects.toThrow(/bulk_listing_operation_target_cap/)
  })

  it("runs at most two children per organisation and one per listing resource, across batches", async () => {
    const t = await tenant(3)
    const first = await t.preview()
    await execute(t, first)
    const second = await t.read(
      await t.api("/preview", {
        locationIds: [t.linked[0].locationId],
        input: {
          operation: "special_hours",
          dates: [{ action: "closed", date: "2026-12-23" }],
        },
      })
    )
    await execute(t, second)
    const claim = async () =>
      (
        await admin<{ organisation_id: string; child_id: string }[]>`
          select organisation_id::text, child_id::text from claim_due_bulk_children(500, 60, 5)`
      ).filter((row) => row.organisation_id === t.owner.organisationId)
    const claimed = await claim()
    expect(claimed).toHaveLength(2)
    const locations = await admin<{ location_id: string }[]>`
      select location_id::text from bulk_listing_child where id in ${admin(claimed.map((row) => row.child_id))}`
    expect(new Set(locations.map((row) => row.location_id)).size).toBe(2)
    expect(await claim()).toHaveLength(0)
    // The interrupted claim goes back to the queue; one tick drains both
    // batches two at a time. The listing both batches name is written twice,
    // one after the other: each batch changes its own date and writes the
    // other's back as Google holds it, so neither undoes the other.
    await admin`update bulk_listing_child set status = 'queued', attempts = 0, lease_expires_at = null, started_at = null where id in ${admin(claimed.map((row) => row.child_id))}`
    await tick()
    const statuses = [
      ...(await t.status(first)).children,
      ...(await t.status(second)).children,
    ].map((c) => c.status)
    expect(statuses).toEqual([
      "succeeded",
      "succeeded",
      "succeeded",
      "succeeded",
    ])
    expect(patches(t.linked[0].googleLocationName)).toHaveLength(2)
    const dates = (
      listings.get(t.linked[0].googleLocationName)!.specialHours!
        .specialHourPeriods as { startDate: { day: number } }[]
    ).map((period) => period.startDate.day)
    expect(dates).toEqual([23, 24, 25])
  })

  it("defers while an editor holds the listing's resource lock, and refuses a reconnected Google target", async () => {
    const t = await tenant(1)
    const op = await t.preview()
    await execute(t, op)
    const key = `${t.owner.organisationId}:${t.linked[0].locationId}:hours`
    await admin.begin(async (lock) => {
      await lock`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`
      await tick()
    })
    expect(await childRows(op.id)).toEqual([
      { status: "queued", result_code: "resource_busy" },
    ])
    expect(patches()).toHaveLength(0)
    await admin`update google_connection set credential_generation = credential_generation + 1 where id = ${t.connection.connectionId}`
    await admin`update bulk_listing_child set next_attempt_at = now() where operation_id = ${op.id}`
    await tick()
    expect(await childRows(op.id)).toEqual([
      { status: "failed", result_code: "google_target_changed" },
    ])
    expect(patches()).toHaveLength(0)
  })
  it("holds the resource lock from the baseline read, so an editor write between claim and dispatch ends in a conflict and nothing is sent", async () => {
    // The editor closes the very date the batch opens.
    const editorValue = {
      specialHourPeriods: [
        { startDate: d("2026-12-24"), endDate: d("2026-12-24"), closed: true },
        christmas,
      ],
    }
    // An editor write lands after the claim: the editor holds the lock and
    // writes, the child defers, and the next run reads the new baseline.
    const t = await tenant(1)
    const op = await t.preview()
    await execute(t, op)
    const name = t.linked[0].googleLocationName
    const key = `${t.owner.organisationId}:${t.linked[0].locationId}:hours`
    await admin.begin(async (lock) => {
      await lock`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`
      listings.get(name)!.specialHours = editorValue
      await tick()
    })
    expect(await childRows(op.id)).toEqual([
      { status: "queued", result_code: "resource_busy" },
    ])
    await admin`update bulk_listing_child set next_attempt_at = now() where operation_id = ${op.id}`
    await tick()
    expect(await childRows(op.id)).toEqual([
      { status: "conflict", result_code: "google_baseline_changed" },
    ])
    expect(patches()).toHaveLength(0)
    expect(listings.get(name)!.specialHours).toEqual(editorValue)

    // An editor arriving while the child reads its baseline cannot take the
    // lock, so it cannot write between that read and the provider call.
    const t2 = await tenant(1)
    const second = await t2.preview()
    await execute(t2, second)
    const name2 = t2.linked[0].googleLocationName
    const key2 = `${t2.owner.organisationId}:${t2.linked[0].locationId}:hours`
    const editorAttempts: boolean[] = []
    google.respond({ method: "GET", pathIncludes: name2 }, async () => {
      const state = listings.get(name2)!
      const response = {
        status: 200,
        json: {
          specialHours: state.specialHours,
          regularHours: state.regularHours,
        },
      }
      if (editorAttempts.length === 0) {
        const acquired = await admin.begin(async (sql) => {
          const [row] = await sql<{ acquired: boolean }[]>`
            select pg_try_advisory_xact_lock(hashtextextended(${key2}, 0)) as acquired`
          if (row?.acquired) state.specialHours = editorValue
          return row?.acquired ?? false
        })
        editorAttempts.push(acquired)
      }
      return response
    })
    await tick()
    expect(editorAttempts).toEqual([false])
    expect(await childRows(second.id)).toEqual([
      { status: "succeeded", result_code: null },
    ])
    expect(patches(name2)).toHaveLength(1)
  })

  it("blocks a child whose listing was relinked to another Google connection, without writing", async () => {
    const t = await tenant(1)
    const op = await t.preview()
    await execute(t, op)
    // The same Google location, now reached through someone else's
    // connection: the frozen connection no longer backs the link.
    const other = await seedGoogleConnection(admin, {
      organisationId: t.owner.organisationId,
    })
    await admin`update external_location set google_connection_id = ${other.connectionId}, google_account_name = ${other.googleAccountName}
      where id = ${t.linked[0].externalLocationId}`
    await tick()
    expect(await childRows(op.id)).toEqual([
      { status: "failed", result_code: "google_target_changed" },
    ])
    expect(patches()).toHaveLength(0)
  })

  it("needs a second approver under two-person approval, in the route and in the table, and rechecks both people before sending", async () => {
    const t = await tenant(2)
    await admin`update organisation set require_two_person_approval = true where id = ${t.owner.organisationId}`
    const manager = await seedMemberUser(admin, {
      organisationId: t.owner.organisationId,
      canPublish: true,
    })
    await admin`update member set role = 'admin' where user_id = ${manager.userId}`
    // The admin prepares the batch; only the owner may approve it.
    const op = await t.preview(undefined, manager.cookie)
    expect(op.requiresSecondApprover).toBe(true)
    expect(op.canApprove).toBe(false)
    const self = await t.approve(op, false, manager.cookie)
    expect(self.status).toBe(409)
    expect(await self.json()).toMatchObject({
      error: "second_approver_required",
    })
    // No writer can record a self-approval either (0261).
    await expect(
      admin`update bulk_listing_operation set status = 'approved', approved_by = requested_by, approved_at = now()
        where id = ${op.id}`
    ).rejects.toMatchObject({
      constraint_name: "bulk_listing_operation_second_approver",
    })
    await expect(
      admin`update bulk_listing_operation set legacy_self_approved = true where id = ${op.id}`
    ).rejects.toMatchObject({ code: "23514" })
    await execute(t, op)
    // The requester lost the right to ask for listing changes after the
    // approval: nothing they prepared is sent.
    await admin`update member set role = 'viewer' where user_id = ${manager.userId}`
    await tick()
    expect(await childRows(op.id)).toEqual([
      { status: "failed", result_code: "permission_revoked" },
      { status: "failed", result_code: "permission_revoked" },
    ])
    expect(patches()).toHaveLength(0)
    await admin`update member set role = 'admin' where user_id = ${manager.userId}`

    // An approver security version the recheck cannot verify yet (stream A
    // records it) fails closed instead of being ignored.
    const second = await t.preview([t.linked[0].locationId], manager.cookie)
    await execute(t, second)
    await admin`update bulk_listing_operation set approver_aal = 'aal2', authorised_security_version = 1 where id = ${second.id}`
    await tick()
    expect(await childRows(second.id)).toEqual([
      { status: "failed", result_code: "security_version_unverifiable" },
    ])
    expect(patches()).toHaveLength(0)
  })
  const receiptOf = async (
    t: Awaited<ReturnType<typeof tenant>>,
    operationId: string
  ) => {
    const response = await fetch(
      `${server.baseUrl}/api/mutations/${operationId}`,
      {
        headers: { cookie: t.owner.cookie },
      }
    )
    expect(response.status, await response.clone().text()).toBe(200)
    return ((await response.json()) as { operation: Record<string, unknown> })
      .operation
  }

  it("publishes bulk hours through the hours editor's path: a new canonical revision, a selective attempt and a receipt", async () => {
    const t = await tenant(1)
    const op = await t.preview()
    await execute(t, op)
    await tick()
    const [child] = (await t.status(op)).children
    expect(child).toMatchObject({
      status: "succeeded",
      confirmationState: "confirmed",
    })
    expect(child.mutationOperationId).toMatch(/^[0-9a-f-]{36}$/)
    expect(await receiptOf(t, child.mutationOperationId!)).toMatchObject({
      surface: "hours",
      action: "publish",
      locationId: t.linked[0].locationId,
      outcome: "confirmed_applied",
    })
    const [receipt] = await admin<
      { approvalRef: string; attemptTable: string; attemptId: string }[]
    >`select approval_ref as "approvalRef", attempt_table as "attemptTable", attempt_id::text as "attemptId"
      from mutation_operation where id = ${child.mutationOperationId!}`
    expect(receipt).toMatchObject({
      approvalRef: `bulk_listing_operation:${op.id}`,
      attemptTable: "hours_sync_attempt",
    })
    const [attempt] = await admin<
      { status: string; selection: unknown; updateMask: string[] }[]
    >`select status, selection, update_mask as "updateMask" from hours_sync_attempt where id = ${receipt.attemptId}`
    expect(attempt).toMatchObject({
      status: "succeeded",
      selection: { specialDates: ["2026-12-24"] },
      updateMask: ["specialHours"],
    })
    // The saved schedule moved with Google: a new revision holding the date.
    const [canonical] = await admin<
      {
        revision: string
        payload: {
          special: { effectiveDate: string; opensAt: string | null }[]
        }
      }[]
    >`select revision::text as revision, payload from presence_canonical_resource
      where location_id = ${t.linked[0].locationId} and resource_type = 'hours'`
    expect(Number(canonical.revision)).toBeGreaterThan(1)
    expect(
      canonical.payload.special.map((entry) => [
        entry.effectiveDate,
        entry.opensAt,
      ])
    ).toEqual([
      ["2026-12-24", "10:00"],
      ["2026-12-25", null],
    ])
    expect(patches()).toHaveLength(1)
  })

  it("leaves an uncertain child to recovery: retry does not re-send it, and the recovered receipt settles it", async () => {
    const t = await tenant(1)
    const name = t.linked[0].googleLocationName
    listings.get(name)!.lostResponse = true
    const op = await t.preview()
    await execute(t, op)
    await tick()
    const [unresolved] = (await t.status(op)).children
    expect(unresolved).toMatchObject({
      status: "ambiguous",
      resultCode: "readback_failed",
      confirmationState: "unresolved",
    })
    expect(unresolved.mutationOperationId).toBeTruthy()
    expect(await receiptOf(t, unresolved.mutationOperationId!)).toMatchObject({
      outcome: "uncertain",
    })
    expect((await t.status(op)).status).toBe("completed_with_failures")
    // While recovery is reading it back, retry leaves it alone.
    await t.read(await t.api(`/${op.id}/retry`, {}))
    expect(await childRows(op.id)).toEqual([
      { status: "ambiguous", result_code: "readback_failed" },
    ])
    await tick()
    expect(patches(name)).toHaveLength(1)
    // Google is readable again and the recovery job is due.
    listings.get(name)!.readsFail = false
    await admin`update mutation_operation set next_recovery_at = now() - interval '1 second'
      where id = ${unresolved.mutationOperationId!}`
    await tick()
    await tick()
    expect(await receiptOf(t, unresolved.mutationOperationId!)).toMatchObject({
      outcome: "confirmed_applied",
    })
    const after = await t.status(op)
    expect(after.children[0]).toMatchObject({
      status: "succeeded",
      confirmationState: "confirmed",
      resultCode: null,
    })
    expect(after.status).toBe("completed")
    // Sent once, at the start; recovery and the runner only read.
    expect(patches(name)).toHaveLength(1)
    const [audit] =
      await admin`select metadata from audit_log where organisation_id = ${t.owner.organisationId} and action = 'bulk_listing.child_reconciled'`
    expect(audit.metadata).toMatchObject({
      outcome: "succeeded",
      receiptState: "confirmed_applied",
    })
  })

  it("writes attributes through the pipeline with a receipt, sending [false] as an answer", async () => {
    const t = await tenant(1)
    const name = t.linked[0].googleLocationName
    let attributes: unknown[] = [
      { name: "attributes/has_wifi", values: [true] },
      { name: "attributes/has_seating_outdoors", values: [true] },
    ]
    google.respond({ method: "GET", pathIncludes: "/v1/attributes?" }, () => ({
      status: 200,
      json: {
        attributeMetadata: [
          { parent: "attributes/has_wifi", valueType: "BOOL" },
          { parent: "attributes/has_seating_outdoors", valueType: "BOOL" },
        ],
      },
    }))
    google.respond(
      { method: "GET", pathIncludes: `${name}/attributes` },
      () => ({ status: 200, json: { name: `${name}/attributes`, attributes } })
    )
    google.respond(
      { method: "PATCH", pathIncludes: `${name}/attributes` },
      (call) => {
        const mask = (
          new URL(call.path, "https://stub.test").searchParams.get(
            "attributeMask"
          ) ?? ""
        ).split(",")
        const sent = (call.body as { attributes: { name: string }[] })
          .attributes
        attributes = [
          ...(attributes as { name: string }[]).filter(
            (attribute) => !mask.includes(attribute.name)
          ),
          ...sent,
        ]
        return { status: 200, json: { attributes } }
      }
    )
    const op = await t.read(
      await t.api("/preview", {
        locationIds: [t.linked[0].locationId],
        input: {
          operation: "attributes",
          changes: [
            { name: "attributes/has_wifi", values: [false] },
            { name: "attributes/has_seating_outdoors", values: [] },
          ],
        },
      })
    )
    expect(op.children[0]).toMatchObject({
      eligibility: "eligible",
      updateMask: ["attributes/has_seating_outdoors", "attributes/has_wifi"],
      proposedValue: [{ name: "attributes/has_wifi", values: [false] }],
    })
    await execute(t, op)
    await tick()
    const [child] = (await t.status(op)).children
    expect(child).toMatchObject({
      status: "succeeded",
      confirmationState: "confirmed",
    })
    expect(attributes).toEqual([
      { name: "attributes/has_wifi", values: [false] },
    ])
    expect(await receiptOf(t, child.mutationOperationId!)).toMatchObject({
      surface: "attributes",
      action: "update",
      outcome: "confirmed_applied",
    })
    const [attempt] = await admin<{ status: string; family: string }[]>`
      select a.status, a.family from bulk_listing_write_attempt a
      join mutation_operation m on m.attempt_id = a.id
      where m.id = ${child.mutationOperationId!}`
    expect(attempt).toEqual({ status: "succeeded", family: "attributes" })
  })
})
