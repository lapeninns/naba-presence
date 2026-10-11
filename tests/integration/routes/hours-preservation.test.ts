import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  hoursStateSchema,
  type HoursState,
} from "@/lib/contracts/location-hours"
import { hoursSelectionRequest } from "@/lib/editors/hours-presentation"
import {
  hoursSelectionKeys,
  legacyHoursHash,
  normalizeGoogleHours,
  reconcileLegacyHoursBoundaries,
  type GoogleLocationHours,
  type HoursSelection,
  type NormalizedHours,
} from "@/lib/domain/hours"
import { mixedHoursFixture } from "../../fixtures/hours-preservation"
import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedReview,
} from "../helpers/tenant"

const describeDatabase =
  process.env.RUN_DB_TESTS === "true" ? describe : describe.skip

describeDatabase("hours legacy transition and replacement routes", () => {
  let admin: ReturnType<typeof postgres>
  let google: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    if (!process.env.DIRECT_DATABASE_URL)
      throw new TypeError("Disposable database URL is required")
    admin = postgres(process.env.DIRECT_DATABASE_URL, { max: 1 })
    google = await startGoogleStub()
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: google.baseUrl,
      GBP_PROFILE_WRITES_ENABLED: "true",
      PUBLISH_ENABLED: "true",
    })
  })
  afterAll(async () => {
    await server?.stop()
    await google?.stop()
    if (admin) {
      await destroyTenants(admin, organisations)
      await admin.end()
    }
  })

  async function fixture(metadataFailure = false) {
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
    let location: GoogleLocationHours = {
      ...structuredClone(mixedHoursFixture),
      name: linked.googleLocationName,
      categories: { primaryCategory: { name: `gcid:${linked.locationId}` } },
    }
    google.respond(
      { method: "GET", pathIncludes: `/v1/${linked.googleLocationName}` },
      () => ({ status: 200, json: location })
    )
    google.respond(
      {
        method: "GET",
        pathIncludes: encodeURIComponent(`gcid:${linked.locationId}`),
      },
      () =>
        metadataFailure
          ? {
              status: 403,
              json: { error: { message: "Synthetic category lookup failure" } },
            }
          : {
              status: 200,
              json: {
                categories: [
                  {
                    name: `gcid:${linked.locationId}`,
                    moreHoursTypes: [
                      { hoursTypeId: "KITCHEN", displayName: "Kitchen" },
                      { hoursTypeId: "BAR", displayName: "Synthetic bar" },
                    ],
                  },
                ],
              },
            }
    )
    google.respond(
      { method: "PATCH", pathIncludes: `/v1/${linked.googleLocationName}` },
      (call) => {
        if (
          new URL(call.path, google.baseUrl).searchParams.get(
            "validateOnly"
          ) !== "true"
        ) {
          const normalized = normalizeGoogleHours(
            call.body as GoogleLocationHours
          )
          // A selective publish that leaves services out sends none.
          if ((call.body as GoogleLocationHours).moreHours)
            expect(
              normalized.moreHours.map((entry) => entry.hoursTypeId)
            ).toEqual(["BAR", "KITCHEN"])
          location = { ...location, ...(call.body as GoogleLocationHours) }
        }
        return { status: 200, json: location }
      }
    )
    const url = `${server.baseUrl}/api/locations/${linked.locationId}/hours`
    const headers = { cookie: owner.cookie, "content-type": "application/json" }
    const read = async () => {
      const response = await fetch(url, { headers })
      expect(response.status, await response.clone().text()).toBe(200)
      return hoursStateSchema.parse((await response.json()).hours)
    }
    const save = (state: HoursState, hours: NormalizedHours) =>
      fetch(url, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          expectedCanonicalRevision: state.canonicalResource.revision,
          hours,
        }),
      })
    const publish = (state: HoursState) =>
      fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          confirmation: "publish_nabapresence_hours_to_google",
          expectedCanonicalRevision: state.canonicalResource.revision,
          expectedCanonicalHash: state.canonicalHash,
          expectedGoogleHash: state.googleHash,
          approvedUpdateMask: state.updateMask,
          confirmOverwriteGoogleChanges: false,
        }),
      })
    const publishParts = (
      state: HoursState,
      selection: HoursSelection,
      options: { confirm?: boolean } = {}
    ) => {
      const request = hoursSelectionRequest(
        state,
        hoursSelectionKeys(selection)
      )
      return fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          confirmation: "publish_nabapresence_hours_to_google",
          expectedCanonicalRevision: state.canonicalResource.revision,
          expectedCanonicalHash: state.canonicalHash,
          expectedGoogleHash: state.googleHash,
          confirmOverwriteGoogleChanges: options.confirm ?? false,
          ...request,
        }),
      })
    }
    const setProvider = (next: GoogleLocationHours) => {
      location = next
    }
    return {
      owner,
      linked,
      read,
      save,
      publish,
      publishParts,
      setProvider,
      provider: () => location,
    }
  }

  it("publishes only the selected parts, keeps the rest as Google holds it, and classifies what is left as local", async () => {
    const f = await fixture()
    const initial = await f.read()
    expect(initial.status).toBe("in_sync")
    const edited = structuredClone(initial.canonical)
    edited.regular[1].periods[0].opensAt = "10:00"
    edited.special.push({
      effectiveDate: "2026-12-25",
      endDate: "2026-12-25",
      isClosed: true,
      opensAt: null,
      closesAt: null,
    })
    edited.moreHours = edited.moreHours.map((entry) =>
      entry.hoursTypeId === "KITCHEN"
        ? {
            ...entry,
            periods: entry.periods.map((period) => ({
              ...period,
              closesAt: "16:00",
            })),
          }
        : entry
    )
    expect((await f.save(initial, edited)).status).toBe(200)
    const reviewed = await f.read()
    expect(reviewed.status).toBe("core_dirty")
    expect(reviewed.partStatus).toEqual({
      "more:KITCHEN": "core_dirty",
      "regular:1": "core_dirty",
      "special:2026-12-25": "core_dirty",
    })

    // Google changes an unselected day after review: the special-hours
    // publish is not stale, and that day is written back untouched.
    const before = structuredClone(f.provider())
    const tuesday = {
      openDay: "TUESDAY",
      closeDay: "TUESDAY",
      openTime: { hours: 12, minutes: 0 },
      closeTime: { hours: 13, minutes: 0 },
    }
    f.setProvider({
      ...before,
      regularHours: {
        periods: [...(before.regularHours?.periods ?? []), tuesday],
      },
    })
    const changedOnGoogle = structuredClone(f.provider())
    const patchesBefore = google.calls.length
    const published = await f.publishParts(reviewed, {
      specialDates: ["2026-12-25"],
    })
    expect(published.status, await published.clone().text()).toBe(200)
    const patches = google.calls
      .slice(patchesBefore)
      .filter(
        (call) =>
          call.method === "PATCH" &&
          call.path.includes(f.linked.googleLocationName)
      )
    expect(patches.length).toBeGreaterThan(0)
    for (const call of patches) {
      expect(
        new URL(call.path, google.baseUrl).searchParams.get("updateMask")
      ).toBe("specialHours")
      // The request names the location; the only hours field is the selected one.
      expect(
        Object.keys(call.body as object).filter((key) => key !== "name")
      ).toEqual(["specialHours"])
    }
    const after = f.provider()
    expect(after.regularHours).toEqual(changedOnGoogle.regularHours)
    expect(after.moreHours).toEqual(before.moreHours)
    expect(
      normalizeGoogleHours(after).special.map((entry) => entry.effectiveDate)
    ).toEqual(["2026-12-25", "2026-12-31"])
    const [attempt] =
      await admin`select status, update_mask, selection from hours_sync_attempt where organisation_id = ${f.owner.organisationId} and location_id = ${f.linked.locationId} order by created_at desc limit 1`
    expect(attempt).toEqual({
      status: "succeeded",
      update_mask: ["specialHours"],
      selection: { specialDates: ["2026-12-25"] },
    })

    // What was left out stays a local change; only Google's Tuesday edit
    // reads as a Google change.
    const settled = await f.read()
    expect(settled.partStatus).toEqual({
      "more:KITCHEN": "core_dirty",
      "regular:1": "core_dirty",
      "regular:2": "google_dirty",
    })
    expect(settled.status).toBe("conflict")

    // Publishing a local-only part needs no overwrite confirmation even
    // though the schedule as a whole has a Google change.
    const kitchen = await f.publishParts(settled, {
      moreHoursTypes: ["KITCHEN"],
    })
    expect(kitchen.status, await kitchen.clone().text()).toBe(200)
    expect(f.provider().regularHours).toEqual(changedOnGoogle.regularHours)

    // A stale pin on a selected part is refused; the Google-changed part
    // needs an explicit overwrite confirmation.
    const current = await f.read()
    expect(current.partStatus).toEqual({
      "regular:1": "core_dirty",
      "regular:2": "google_dirty",
    })
    f.setProvider({
      ...f.provider(),
      regularHours: {
        periods: (f.provider().regularHours?.periods ?? []).map((period) =>
          period.openDay === "TUESDAY" && period.closeDay === "TUESDAY"
            ? { ...period, closeTime: { hours: 14, minutes: 0 } }
            : period
        ),
      },
    })
    const stale = await f.publishParts(
      current,
      { regularDays: [2] },
      { confirm: true }
    )
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ error: "hours_snapshot_stale" })
    const latest = await f.read()
    expect(latest.partStatus?.["regular:2"]).toBe("google_dirty")
    const unconfirmed = await f.publishParts(latest, { regularDays: [2] })
    expect(unconfirmed.status).toBe(409)
    expect(await unconfirmed.json()).toMatchObject({
      error: "google_hours_overwrite_confirmation_required",
    })
    const confirmed = await f.publishParts(
      latest,
      { regularDays: [2] },
      { confirm: true }
    )
    expect(confirmed.status, await confirmed.clone().text()).toBe(200)
    const final = await f.read()
    expect(final.partStatus).toEqual({ "regular:1": "core_dirty" })
    expect(final.status).toBe("core_dirty")
    expect(final.google.regular[2]).toEqual(final.canonical.regular[2])
    expect(final.google.regular[1]).toEqual(initial.google.regular[1])
  }, 30_000)

  it("keeps a Google edit needing confirmation after a first selective publish from no part baseline", async () => {
    const f = await fixture()
    const initial = await f.read()
    expect(initial.status).toBe("in_sync")
    const edited = structuredClone(initial.canonical)
    edited.regular[1].periods[0].opensAt = "10:00"
    expect((await f.save(initial, edited)).status).toBe(200)
    // A location compared before part baselines existed has only the whole
    // hashes.
    await admin`update presence_resource_reconcile_state set comparison_part_hashes = null where organisation_id = ${f.owner.organisationId} and location_id = ${f.linked.locationId} and resource = 'hours'`
    const before = f.provider()
    f.setProvider({
      ...before,
      regularHours: {
        periods: [
          ...(before.regularHours?.periods ?? []),
          {
            openDay: "TUESDAY",
            closeDay: "TUESDAY",
            openTime: { hours: 12, minutes: 0 },
            closeTime: { hours: 13, minutes: 0 },
          },
        ],
      },
    })
    const reviewed = await f.read()
    expect(reviewed.partStatus).toBeUndefined()
    expect(reviewed.status).toBe("conflict")

    const monday = await f.publishParts(
      reviewed,
      { regularDays: [1] },
      { confirm: true }
    )
    expect(monday.status, await monday.clone().text()).toBe(200)
    const settled = await f.read()
    // Tuesday's Google edit is not reclassified as a local change.
    expect(settled.partStatus).toEqual({ "regular:2": "conflict" })
    expect(settled.status).toBe("conflict")
    const unconfirmed = await f.publishParts(settled, { regularDays: [2] })
    expect(unconfirmed.status).toBe(409)
    expect(await unconfirmed.json()).toMatchObject({
      error: "google_hours_overwrite_confirmation_required",
    })

    // Monday already matches Google: a Monday-only publish sends nothing
    // and says the selection, not the schedule, is in sync.
    const patchesBefore = google.calls.length
    const noop = await f.publishParts(settled, { regularDays: [1] })
    expect(noop.status, await noop.clone().text()).toBe(200)
    expect(await noop.json()).toEqual({
      status: "selection_in_sync",
      idempotent: true,
    })
    expect(
      google.calls.slice(patchesBefore).filter((c) => c.method === "PATCH")
    ).toEqual([])
  }, 30_000)

  it("reconciles legacy boundaries explicitly, preserves local edits and old baselines, and rejects old reviews", async () => {
    const f = await fixture()
    const initialized = await f.read()
    expect(
      initialized.supportedHoursTypes?.map((entry) => entry.hoursTypeId)
    ).toEqual(["KITCHEN", "BAR"])
    const legacy = structuredClone(initialized.canonical)
    for (const day of legacy.regular)
      for (const period of day.periods) delete period.closeDayOfWeek
    for (const entry of legacy.moreHours)
      for (const period of entry.periods) delete period.closeDayOfWeek
    for (const period of legacy.special) delete period.endDate
    const oldHash = legacyHoursHash(legacy)
    await admin`update presence_canonical_resource set payload = ${admin.json(legacy)}, baseline_canonical_hash = ${oldHash}, baseline_google_hash = ${oldHash} where organisation_id = ${f.owner.organisationId} and location_id = ${f.linked.locationId} and resource_type = 'hours'`

    const reviewed = await f.read()
    expect(reviewed.status).toBe("core_dirty")
    expect(reviewed.reconciliationRequired).toBe(true)
    expect(reviewed.publicationBlocked).toBe(true)
    const preTransition = await f.publish({ ...reviewed, googleHash: oldHash })
    expect(preTransition.status).toBe(409)
    expect(await preTransition.json()).toMatchObject({
      error: "hours_snapshot_stale",
    })

    legacy.regular[1].periods[1].opensAt = "19:00"
    const reconciled = reconcileLegacyHoursBoundaries(legacy, reviewed.google)
    expect(reconciled.regular[1].periods[1]).toEqual({
      opensAt: "19:00",
      closesAt: "02:00",
    })
    expect((await f.save(reviewed, reconciled)).status).toBe(200)
    const unresolved = await f.read()
    expect(unresolved.canonical.regular[1].periods[1].opensAt).toBe("19:00")
    expect(unresolved.reconciliationRequired).toBe(true)
    const blocked = await f.publish(unresolved)
    expect(blocked.status).toBe(409)
    expect(await blocked.json()).toMatchObject({
      error: "hours_reconciliation_required",
    })

    unresolved.canonical.regular[1].periods[1].closeDayOfWeek = 2
    expect((await f.save(unresolved, unresolved.canonical)).status).toBe(200)
    const resolved = await f.read()
    expect(resolved.status).toBe("core_dirty")
    expect(resolved.reconciliationRequired).toBe(false)
    const [baseline] =
      await admin`select baseline_canonical_hash, baseline_google_hash from presence_canonical_resource where organisation_id = ${f.owner.organisationId} and location_id = ${f.linked.locationId} and resource_type = 'hours'`
    expect(baseline).toEqual({
      baseline_canonical_hash: oldHash,
      baseline_google_hash: oldHash,
    })
    const stale = await f.publish(unresolved)
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ error: "hours_snapshot_stale" })
    const published = await f.publish(resolved)
    expect(published.status, await published.clone().text()).toBe(200)
    expect(normalizeGoogleHours(f.provider()).regular[1].periods[1]).toEqual({
      opensAt: "19:00",
      closesAt: "02:00",
      closeDayOfWeek: 2,
    })
    expect((await f.read()).status).toBe("in_sync")
  }, 30_000)

  it("keeps legacy same-day hashes in sync and reconciles boundary-only differences without changing publication baselines", async () => {
    const f = await fixture()
    const initialized = await f.read()
    const legacy = structuredClone(initialized.canonical)
    for (const day of legacy.regular)
      for (const period of day.periods) delete period.closeDayOfWeek
    for (const entry of legacy.moreHours)
      for (const period of entry.periods) delete period.closeDayOfWeek
    for (const period of legacy.special) delete period.endDate
    const oldHash = legacyHoursHash(legacy)
    await admin`update presence_canonical_resource set payload = ${admin.json(legacy)}, baseline_canonical_hash = ${oldHash}, baseline_google_hash = ${oldHash} where organisation_id = ${f.owner.organisationId} and location_id = ${f.linked.locationId} and resource_type = 'hours'`
    const before = await f.read()
    expect(before.reconciliationRequired).toBe(true)
    expect(
      (
        await f.save(
          before,
          reconcileLegacyHoursBoundaries(before.canonical, before.google)
        )
      ).status
    ).toBe(200)
    const after = await f.read()
    expect(after.status).toBe("in_sync")
    expect(after.reconciliationRequired).toBe(false)
    const [baseline] =
      await admin`select baseline_canonical_hash, baseline_google_hash from presence_canonical_resource where organisation_id = ${f.owner.organisationId} and location_id = ${f.linked.locationId} and resource_type = 'hours'`
    expect(baseline).toEqual({
      baseline_canonical_hash: oldHash,
      baseline_google_hash: oldHash,
    })
    expect(
      google.calls.filter(
        (call) =>
          call.method === "PATCH" &&
          call.path.includes(f.linked.googleLocationName)
      )
    ).toHaveLength(0)

    const sameDayGoogle = {
      regularHours: {
        periods: [
          {
            openDay: "MONDAY",
            closeDay: "MONDAY",
            openTime: { hours: 11 },
            closeTime: { hours: 23 },
          },
        ],
      },
    }
    google.respond(
      { method: "GET", pathIncludes: `/v1/${f.linked.googleLocationName}` },
      () => ({ status: 200, json: sameDayGoogle })
    )
    const sameDay = normalizeGoogleHours(sameDayGoogle)
    delete sameDay.regular[1].periods[0].closeDayOfWeek
    const sameDayHash = legacyHoursHash(sameDay)
    await admin`update presence_canonical_resource set payload = ${admin.json(sameDay)}, baseline_canonical_hash = ${sameDayHash}, baseline_google_hash = ${sameDayHash} where organisation_id = ${f.owner.organisationId} and location_id = ${f.linked.locationId} and resource_type = 'hours'`
    const unchanged = await f.read()
    expect(unchanged.status).toBe("in_sync")
    expect(unchanged.canonicalHash).toBe(sameDayHash)
    expect(unchanged.googleHash).toBe(sameDayHash)
    expect(unchanged.reconciliationRequired).toBe(false)
  }, 30_000)

  it("preserves unknown service hours when category metadata fails and only venue hours change", async () => {
    const f = await fixture(true)
    const initial = await f.read()
    expect(initial.supportedHoursTypes).toEqual([])
    expect(
      initial.canonical.moreHours.map((entry) => entry.hoursTypeId)
    ).toEqual(["BAR", "KITCHEN"])
    initial.canonical.regular[1].periods[0].opensAt = "10:00"
    expect((await f.save(initial, initial.canonical)).status).toBe(200)
    const reviewed = await f.read()
    const published = await f.publish(reviewed)
    expect(published.status, await published.clone().text()).toBe(200)
    expect(f.provider().moreHours).toEqual([
      mixedHoursFixture.moreHours?.[1],
      mixedHoursFixture.moreHours?.[0],
    ])
  }, 30_000)

  it("publishes under the location's hours lock, the key bulk hours children take", async () => {
    const f = await fixture()
    const initial = await f.read()
    initial.canonical.regular[1].periods[0].opensAt = "10:30"
    expect((await f.save(initial, initial.canonical)).status).toBe(200)
    const reviewed = await f.read()
    const key = `${f.owner.organisationId}:${f.linked.locationId}:hours`
    const holder = postgres(process.env.DIRECT_DATABASE_URL as string, {
      max: 1,
    })
    let release!: () => void
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    let locked!: () => void
    const held = new Promise<void>((resolve) => {
      locked = resolve
    })
    // A bulk child (or any other hours writer) holds the lock.
    const holding = holder.begin(async (lock) => {
      await lock`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`
      locked()
      await released
    })
    const patchCount = () =>
      google.calls.filter((call) => call.method === "PATCH").length
    try {
      await held
      const patchesBefore = patchCount()
      let settled = false
      const publishing = f.publish(reviewed).then((response) => {
        settled = true
        return response
      })
      try {
        await new Promise((resolve) => setTimeout(resolve, 1_500))
        // Nothing is written while another writer holds the lock.
        expect(settled).toBe(false)
        expect(patchCount()).toBe(patchesBefore)
      } finally {
        release()
        await holding
      }
      const published = await publishing
      expect(published.status, await published.clone().text()).toBe(200)
      expect(patchCount()).toBeGreaterThan(patchesBefore)
    } finally {
      release()
      await holder.end()
    }
  }, 30_000)

  it("saves an existing local schedule while Google reads are unavailable", async () => {
    const f = await fixture()
    const initial = await f.read()
    google.respond(
      { method: "GET", pathIncludes: `/v1/${f.linked.googleLocationName}` },
      () => ({ status: 503, json: { error: { message: "Synthetic outage" } } })
    )
    const callsBeforeSave = google.calls.length
    initial.canonical.regular[1].periods[0].opensAt = "09:00"
    const saved = await f.save(initial, initial.canonical)
    expect(saved.status, await saved.clone().text()).toBe(200)
    expect(google.calls.length).toBe(callsBeforeSave)
    const [row] =
      await admin`select payload from presence_canonical_resource where organisation_id = ${f.owner.organisationId} and location_id = ${f.linked.locationId} and resource_type = 'hours'`
    expect(row.payload.regular[1].periods[0].opensAt).toBe("09:00")
  })
})
