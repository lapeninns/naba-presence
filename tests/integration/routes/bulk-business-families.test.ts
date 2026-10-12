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
} from "../helpers/tenant"

const describeDatabase =
  process.env.RUN_DB_TESTS === "true" ? describe : describe.skip
const CRON = { authorization: "Bearer route-harness-cron-secret" }

type Listing = {
  location: Record<string, unknown>
  attributes: Array<{ name: string; values?: unknown[] }>
  /** Absent: Google keeps no lodging resource for the listing (404). */
  lodging?: Record<string, unknown>
  /** The next real location PATCH lands but answers 503, and reads fail until cleared. */
  lostResponse?: boolean
  readsFail?: boolean
}

const url = (path: string) => new URL(path, "https://stub.test")
const nameOf = (path: string) =>
  url(path)
    .pathname.replace(/^\/v1\//, "")
    .replace(/\/(attributes|lodging)$/, "")

/** Writes `value` (or removes the key, for undefined) at a dotted path. */
function setPath(
  target: Record<string, unknown>,
  path: string,
  value: unknown
) {
  const parts = path.split(".")
  let node = target
  for (const part of parts.slice(0, -1)) {
    node[part] = (node[part] as Record<string, unknown> | undefined) ?? {}
    node = node[part] as Record<string, unknown>
  }
  const last = parts[parts.length - 1]
  if (value === undefined) delete node[last]
  else node[last] = value
}
const getPath = (value: unknown, path: string) =>
  path
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === "object"
          ? (node as Record<string, unknown>)[part]
          : undefined,
      value
    )

/**
 * P09-R5 through real routes and the real job tick: business information
 * (field-mask patch with explicit clears), categories (by stable ID, before
 * the attributes that depend on them) and lodging (typed paths), against a
 * loopback Google stub that applies field masks the way Google does.
 */
describeDatabase(
  "bulk business information, categories and lodging",
  { timeout: 60_000 },
  () => {
    let admin: ReturnType<typeof postgres>
    let google: GoogleStub
    let server: Awaited<ReturnType<typeof startAppServer>>
    const organisations: string[] = []
    const listings = new Map<string, Listing>()
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
      google.respond({ method: "GET", pathIncludes: "readMask=" }, (call) => {
        const state = listings.get(nameOf(call.path))
        if (!state) return { status: 404, json: {} }
        if (state.readsFail)
          return { status: 503, json: { error: { status: "UNAVAILABLE" } } }
        return { status: 200, json: state.location }
      })
      google.respond(
        { method: "PATCH", pathIncludes: "updateMask=" },
        (call) => {
          const state = listings.get(nameOf(call.path))
          if (!state) return { status: 404, json: {} }
          const params = url(call.path).searchParams
          if (params.get("validateOnly") === "true")
            return { status: 200, json: state.location }
          const body = call.body as Record<string, unknown>
          for (const mask of (params.get("updateMask") ?? "").split(","))
            setPath(state.location, mask, getPath(body, mask))
          if (state.lostResponse) {
            state.lostResponse = false
            state.readsFail = true
            return { status: 503, json: { error: { status: "UNAVAILABLE" } } }
          }
          return { status: 200, json: state.location }
        }
      )
      google.respond(
        { method: "GET", pathIncludes: "categories:batchGet" },
        (call) => ({
          status: 200,
          json: {
            categories: url(call.path)
              .searchParams.getAll("names")
              .filter((name) => !name.endsWith(":unknown"))
              .map((name) => ({
                name,
                ...(name === "categories/gcid:gastropub"
                  ? { moreHoursTypes: [{ hoursTypeId: "HAPPY_HOURS" }] }
                  : {}),
              })),
          },
        })
      )
      google.respond({ method: "GET", pathIncludes: "/attributes" }, (call) => {
        const state = listings.get(nameOf(call.path))
        return state
          ? { status: 200, json: { attributes: state.attributes } }
          : { status: 404, json: {} }
      })
      // Attribute metadata: the gastropub category offers a beer garden,
      // every listing (under its current categories) offers only wifi.
      google.respond(
        { method: "GET", pathIncludes: "/v1/attributes?" },
        (call) => {
          const offered = ["attributes/has_wifi"]
          if (
            url(call.path).searchParams.get("categoryName") ===
            "categories/gcid:gastropub"
          )
            offered.push("attributes/has_beer_garden")
          return {
            status: 200,
            json: {
              attributeMetadata: offered.map((parent) => ({
                parent,
                valueType: "BOOL",
              })),
            },
          }
        }
      )
      google.respond(
        { method: "PATCH", pathIncludes: "/attributes?" },
        (call) => {
          const state = listings.get(nameOf(call.path))!
          const mask = (
            url(call.path).searchParams.get("attributeMask") ?? ""
          ).split(",")
          state.attributes = [
            ...state.attributes.filter((entry) => !mask.includes(entry.name)),
            ...(call.body as { attributes: Listing["attributes"] }).attributes,
          ]
          return { status: 200, json: { attributes: state.attributes } }
        }
      )
      google.respond({ method: "GET", pathIncludes: "/lodging" }, (call) => {
        const state = listings.get(nameOf(call.path))
        if (state?.readsFail)
          return { status: 503, json: { error: { status: "UNAVAILABLE" } } }
        return state?.lodging
          ? { status: 200, json: state.lodging }
          : { status: 404, json: { error: { status: "NOT_FOUND" } } }
      })
      google.respond({ method: "PATCH", pathIncludes: "/lodging" }, (call) => {
        const state = listings.get(nameOf(call.path))
        if (!state?.lodging) return { status: 404, json: {} }
        for (const mask of (
          url(call.path).searchParams.get("updateMask") ?? ""
        ).split(","))
          setPath(state.lodging, mask, getPath(call.body, mask))
        if (state.lostResponse) {
          state.lostResponse = false
          state.readsFail = true
          return { status: 503, json: { error: { status: "UNAVAILABLE" } } }
        }
        return { status: 200, json: state.lodging }
      })
    })

    const realPatches = (fragment: string) =>
      google.calls.filter(
        (call) =>
          call.method === "PATCH" &&
          !call.path.includes("validateOnly=true") &&
          call.path.includes(fragment)
      )
    const tick = async () => {
      const response = await fetch(`${server.baseUrl}/api/jobs/run`, {
        method: "POST",
        headers: CRON,
      })
      expect(response.status, await response.clone().text()).toBe(200)
    }

    async function tenant(count: number) {
      const owner = await createTestTenant(admin)
      organisations.push(owner.organisationId)
      await admin`
        insert into organisation_feature (organisation_id, feature, enabled, changed_by)
        values (${owner.organisationId}, 'bulk_actions', true, 'test')`
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
          location: {
            name: location.googleLocationName,
            title: `Listing ${index}`,
            websiteUri: "https://old.example",
            profile: { description: "Old words" },
            openInfo: { status: "OPEN" },
            languageCode: "en",
            storefrontAddress: { regionCode: "GB", addressLines: ["1 Road"] },
            categories: {
              primaryCategory: { name: "categories/gcid:pub" },
              additionalCategories: [{ name: "categories/gcid:bar" }],
            },
          },
          attributes: [{ name: "attributes/has_wifi", values: [true] }],
        })
        linked.push(location)
      }
      const api = (path: string, body?: unknown) =>
        fetch(`${server.baseUrl}/api/listings/bulk${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers: { cookie: owner.cookie, "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        })
      const read = async (response: Response) => {
        expect(response.status, await response.clone().text()).toBeLessThan(300)
        return bulkOperationResponseSchema.parse(await response.json())
          .operation
      }
      const preview = async (items: unknown[], ids = linked) =>
        read(
          await api("/preview", {
            locationIds: ids.map((entry) => entry.locationId),
            items,
          })
        )
      const run = async (op: BulkOperationView, acknowledgeSkipped = false) => {
        await read(
          await api(`/${op.id}/approve`, {
            expectedPreviewHash: op.previewHash,
            acknowledgeSkipped,
          })
        )
        expect((await api(`/${op.id}/execute`, {})).status).toBe(202)
      }
      const status = async (op: BulkOperationView) =>
        read(await api(`/${op.id}`))
      const receipt = async (id: string) => {
        const response = await fetch(`${server.baseUrl}/api/mutations/${id}`, {
          headers: { cookie: owner.cookie },
        })
        expect(response.status).toBe(200)
        return (
          (await response.json()) as { operation: Record<string, unknown> }
        ).operation
      }
      return { owner, linked, api, preview, run, status, receipt }
    }

    it("patches only the named business fields, clears explicitly, and leaves the rest untouched", async () => {
      const t = await tenant(2)
      const [first, second] = t.linked.map((l) => l.googleLocationName)
      // The second listing already shows the change.
      Object.assign(listings.get(second)!.location, {
        websiteUri: undefined,
        profile: { description: "New words" },
      })
      delete listings.get(second)!.location.websiteUri
      const op = await t.preview([
        {
          operation: "business_info",
          changes: [
            { field: "websiteUri", action: "clear" },
            { field: "profile.description", action: "set", value: "New words" },
          ],
        },
      ])
      const byName = new Map(
        op.children.map((child) => [
          t.linked.find((l) => l.locationId === child.locationId)!
            .googleLocationName,
          child,
        ])
      )
      expect(byName.get(first)).toMatchObject({
        eligibility: "eligible",
        updateMask: ["profile", "websiteUri"],
        currentValue: {
          "profile.description": "Old words",
          websiteUri: "https://old.example",
        },
        proposedValue: { "profile.description": "New words", websiteUri: null },
      })
      expect(byName.get(second)).toMatchObject({
        eligibility: "skipped",
        skipReason: "already_applied",
      })
      await t.run(op, true)
      // An edit on Google to a field the batch does not change is not a conflict.
      listings.get(first)!.location.title = "Renamed on Google"
      await tick()
      const after = await t.status(op)
      expect(after.status).toBe("completed")
      const child = after.children.find((c) => c.eligibility === "eligible")!
      expect(child).toMatchObject({
        status: "succeeded",
        confirmationState: "confirmed",
      })
      const location = listings.get(first)!.location
      expect(location.websiteUri).toBeUndefined()
      expect(location.profile).toEqual({ description: "New words" })
      expect(location.title).toBe("Renamed on Google")
      expect(location.categories).toBeDefined()
      const [patch] = realPatches(first)
      expect(url(patch.path).searchParams.get("updateMask")).toBe(
        "profile,websiteUri"
      )
      expect(patch.body).toEqual({
        name: first,
        profile: { description: "New words" },
      })
      expect(
        google.calls.some(
          (call) =>
            call.method === "PATCH" && call.path.includes("validateOnly=true")
        )
      ).toBe(true)
      expect(await t.receipt(child.mutationOperationId!)).toMatchObject({
        surface: "business_info",
        outcome: "confirmed_applied",
      })
      await tick()
      expect(realPatches(first)).toHaveLength(1)
    })

    it("turns a moved business field into a conflict without writing", async () => {
      const t = await tenant(1)
      const name = t.linked[0].googleLocationName
      const op = await t.preview([
        {
          operation: "business_info",
          changes: [
            {
              field: "openInfo.status",
              action: "set",
              value: "CLOSED_TEMPORARILY",
            },
          ],
        },
      ])
      await t.run(op)
      listings.get(name)!.location.openInfo = { status: "CLOSED_PERMANENTLY" }
      await tick()
      expect((await t.status(op)).children[0]).toMatchObject({
        status: "conflict",
        resultCode: "google_baseline_changed",
      })
      expect(realPatches(name)).toHaveLength(0)
      // A permanently closed listing is skipped at preview, never reopened.
      const again = await t.preview([
        {
          operation: "business_info",
          changes: [{ field: "openInfo.status", action: "set", value: "OPEN" }],
        },
      ])
      expect(again.children[0]).toMatchObject({
        eligibility: "skipped",
        skipReason: "permanently_closed",
      })
    })

    it("refuses provider-owned fields and a category change listed after its dependants", async () => {
      const t = await tenant(1)
      const refused = await t.api("/preview", {
        locationIds: [t.linked[0].locationId],
        items: [
          {
            operation: "business_info",
            changes: [{ field: "metadata", action: "set", value: "x" }],
          },
        ],
      })
      expect(refused.status).toBe(400)
      const misordered = await t.api("/preview", {
        locationIds: [t.linked[0].locationId],
        items: [
          {
            operation: "attributes",
            changes: [{ name: "attributes/has_wifi", values: [false] }],
          },
          {
            operation: "categories",
            primaryCategory: "categories/gcid:gastropub",
          },
        ],
      })
      expect(misordered.status).toBe(400)
      expect(google.calls).toHaveLength(0)
    })

    it("changes categories first and plans dependent attributes and service hours under the new categories", async () => {
      const t = await tenant(2)
      const [first, second] = t.linked.map((l) => l.googleLocationName)
      // The second listing would have more than 9 additional categories.
      listings.get(second)!.location.categories = {
        primaryCategory: { name: "categories/gcid:pub" },
        additionalCategories: Array.from({ length: 9 }, (_, i) => ({
          name: `categories/gcid:c${i}`,
        })),
      }
      const op = await t.preview([
        {
          operation: "categories",
          primaryCategory: "categories/gcid:gastropub",
          addAdditional: ["categories/gcid:restaurant"],
        },
        {
          operation: "attributes",
          changes: [{ name: "attributes/has_beer_garden", values: [true] }],
        },
        {
          operation: "more_hours",
          hoursTypeId: "HAPPY_HOURS",
          periods: [{ dayOfWeek: 5, opensAt: "17:00", closesAt: "19:00" }],
        },
      ])
      const of = (name: string) =>
        op.children
          .filter(
            (child) =>
              t.linked.find((l) => l.locationId === child.locationId)!
                .googleLocationName === name
          )
          .sort((a, b) => a.seq - b.seq)
      const [categories, attributes, hours] = of(first)
      expect(categories).toMatchObject({
        eligibility: "eligible",
        updateMask: ["categories"],
        proposedValue: {
          primary: "categories/gcid:gastropub",
          additional: ["categories/gcid:bar", "categories/gcid:restaurant"],
        },
      })
      // Offered only under the new primary category.
      expect(attributes).toMatchObject({ eligibility: "eligible" })
      expect(attributes.dependsOn).toEqual([categories.id])
      expect(hours.skipReason).toBeNull()
      expect(hours).toMatchObject({ eligibility: "eligible" })
      expect(hours.dependsOn).toEqual([categories.id, attributes.id])
      expect(
        google.calls.some(
          (call) =>
            call.path.includes("/v1/attributes?") &&
            call.path.includes("categoryName=categories%2Fgcid%3Agastropub")
        )
      ).toBe(true)
      // The second listing's category change is skipped, so its dependants
      // are planned under its current categories, which offer neither.
      expect(of(second).map((c) => c.skipReason)).toEqual([
        "too_many_categories",
        "attribute_not_offered",
        "hours_type_not_supported",
      ])
      const [requires] = await admin<{ requires: string[] }[]>`
        select array(select r::text from unnest(requires_applied) r) as requires
        from bulk_listing_child where id = ${attributes.id}`
      expect(requires.requires).toEqual([categories.id])

      // Each listing's changes run in list order: the attributes only after
      // the categories applied.
      await t.run(op, true)
      await tick()
      const firstTick = await t.status(op)
      const settled = (id: string) =>
        firstTick.children.find((c) => c.id === id)!.status
      expect(settled(categories.id)).toBe("succeeded")
      expect(listings.get(first)!.location.categories).toEqual({
        primaryCategory: { name: "categories/gcid:gastropub" },
        additionalCategories: [
          { name: "categories/gcid:bar" },
          { name: "categories/gcid:restaurant" },
        ],
      })
      // The attribute write, if the tick got to it, went out after the
      // category write landed.
      const order = (fragment: string) =>
        google.calls.findIndex(
          (call) =>
            call.method === "PATCH" &&
            !call.path.includes("validateOnly=true") &&
            call.path.includes(fragment)
        )
      const attributeWrite = order("/attributes?")
      expect(order("updateMask=categories")).toBeGreaterThanOrEqual(0)
      if (attributeWrite >= 0)
        expect(attributeWrite).toBeGreaterThan(order("updateMask=categories"))
      for (let i = 0; i < 4; i += 1) await tick()
      const after = await t.status(op)
      expect(after.children.find((c) => c.id === attributes.id)).toMatchObject({
        status: "succeeded",
      })
      expect(listings.get(first)!.attributes).toContainEqual({
        name: "attributes/has_beer_garden",
        values: [true],
      })
      // The service hours offered only under the new primary category are
      // written after it, and land.
      expect(after.children.find((c) => c.id === hours.id)).toMatchObject({
        status: "succeeded",
        confirmationState: "confirmed",
      })
      expect(order("updateMask=moreHours")).toBeGreaterThan(
        order("updateMask=categories")
      )
      expect(listings.get(first)!.location.moreHours).toEqual([
        expect.objectContaining({ hoursTypeId: "HAPPY_HOURS" }),
      ])
      const categoryReceipt = after.children.find(
        (c) => c.id === categories.id
      )!.mutationOperationId!
      expect(await t.receipt(categoryReceipt)).toMatchObject({
        surface: "business_info",
        action: "update_categories",
        outcome: "confirmed_applied",
      })
    })

    it("skips categories Google does not offer in the listing's country", async () => {
      const t = await tenant(1)
      const op = await t.preview([
        { operation: "categories", addAdditional: ["categories/gcid:unknown"] },
      ])
      expect(op.children[0]).toMatchObject({
        eligibility: "skipped",
        skipReason: "category_not_available",
      })
    })

    it("does not send a category change again when its response was lost: recovery settles it", async () => {
      const t = await tenant(1)
      const name = t.linked[0].googleLocationName
      listings.get(name)!.lostResponse = true
      const op = await t.preview([
        { operation: "categories", removeAdditional: ["categories/gcid:bar"] },
      ])
      await t.run(op)
      await tick()
      const [unresolved] = (await t.status(op)).children
      expect(unresolved.status).toBe("ambiguous")
      expect(unresolved.mutationOperationId).not.toBeNull()
      // Retry leaves it to recovery.
      await t.api(`/${op.id}/retry`, {})
      listings.get(name)!.readsFail = false
      await admin`update mutation_operation set next_recovery_at = now() - interval '1 second'
        where id = ${unresolved.mutationOperationId!}`
      await tick()
      await tick()
      expect((await t.status(op)).children[0]).toMatchObject({
        status: "succeeded",
      })
      expect(await t.receipt(unresolved.mutationOperationId!)).toMatchObject({
        outcome: "confirmed_applied",
      })
      expect(realPatches(name)).toHaveLength(1)
    })

    it("patches typed lodging paths, keeping false distinct from unset, and skips listings without lodging", async () => {
      const t = await tenant(2)
      const [hotel, pub] = t.linked.map((l) => l.googleLocationName)
      listings.get(hotel)!.lodging = {
        name: `${hotel}/lodging`,
        pools: { pool: true, wavePool: true },
        policies: { checkinTime: { hours: 15 } },
      }
      const op = await t.preview([
        {
          operation: "lodging",
          updateMask: ["pools.pool", "pools.wavePool"],
          clear: ["pools.wavePool"],
          payload: { pools: { pool: false } },
        },
      ])
      const byName = (name: string) =>
        op.children.find(
          (c) =>
            t.linked.find((l) => l.locationId === c.locationId)!
              .googleLocationName === name
        )!
      expect(byName(pub)).toMatchObject({
        eligibility: "skipped",
        skipReason: "lodging_not_available",
      })
      expect(byName(hotel)).toMatchObject({
        eligibility: "eligible",
        currentValue: { "pools.pool": true, "pools.wavePool": true },
        proposedValue: { "pools.pool": false, "pools.wavePool": null },
      })
      await t.run(op, true)
      await tick()
      const child = (await t.status(op)).children.find(
        (c) => c.eligibility === "eligible"
      )!
      expect(child).toMatchObject({
        status: "succeeded",
        confirmationState: "confirmed",
      })
      const lodging = listings.get(hotel)!.lodging!
      expect(lodging.pools).toEqual({ pool: false })
      expect(lodging.policies).toEqual({ checkinTime: { hours: 15 } })
      const [patch] = realPatches("/lodging")
      expect(url(patch.path).searchParams.get("updateMask")).toBe(
        "metadata.updateTime,pools.pool,pools.wavePool"
      )
      expect(
        typeof (patch.body as { metadata?: { updateTime?: string } }).metadata
          ?.updateTime
      ).toBe("string")
      expect(await t.receipt(child.mutationOperationId!)).toMatchObject({
        surface: "lodging",
        outcome: "confirmed_applied",
      })
      const [attempt] = await admin<{ family: string; status: string }[]>`
        select a.family, a.status from bulk_listing_write_attempt a
        join mutation_operation m on m.attempt_id = a.id
        where m.id = ${child.mutationOperationId!}`
      expect(attempt).toEqual({ family: "lodging", status: "succeeded" })
    })

    // A lost response for each Google surface the new families write:
    // recovery reads the listing back and settles the child, never resending.
    for (const family of ["business_info", "lodging"] as const)
      it(`does not send a ${family} change again when its response was lost: recovery settles it`, async () => {
        const t = await tenant(1)
        const name = t.linked[0].googleLocationName
        const state = listings.get(name)!
        state.lodging = { name: `${name}/lodging`, pools: { pool: true } }
        state.lostResponse = true
        const op = await t.preview([
          family === "business_info"
            ? {
                operation: "business_info",
                changes: [
                  {
                    field: "websiteUri",
                    action: "set",
                    value: "https://new.example",
                  },
                ],
              }
            : {
                operation: "lodging",
                updateMask: ["pools.pool"],
                payload: { pools: { pool: false } },
              },
        ])
        await t.run(op)
        await tick()
        const [unresolved] = (await t.status(op)).children
        expect(unresolved.status).toBe("ambiguous")
        expect(unresolved.mutationOperationId).not.toBeNull()
        const [receipt] = await admin<{ surface: string; family: string }[]>`
          select m.surface, a.family from mutation_operation m
          join bulk_listing_write_attempt a on a.id = m.attempt_id
          where m.id = ${unresolved.mutationOperationId!}`
        expect(receipt).toEqual({ surface: family, family })
        await t.api(`/${op.id}/retry`, {})
        state.readsFail = false
        await admin`update mutation_operation set next_recovery_at = now() - interval '1 second'
          where id = ${unresolved.mutationOperationId!}`
        await tick()
        await tick()
        expect((await t.status(op)).children[0]).toMatchObject({
          status: "succeeded",
        })
        expect(await t.receipt(unresolved.mutationOperationId!)).toMatchObject({
          outcome: "confirmed_applied",
        })
        expect(
          realPatches(family === "lodging" ? "/lodging" : "updateMask=")
        ).toHaveLength(1)
      })

    it("replaces a lodging group whole: a listing holding another field of the group is not already applied", async () => {
      const t = await tenant(1)
      const name = t.linked[0].googleLocationName
      listings.get(name)!.lodging = {
        name: `${name}/lodging`,
        pools: { pool: true, hotTub: true },
      }
      const op = await t.preview([
        {
          operation: "lodging",
          updateMask: ["pools"],
          payload: { pools: { pool: true } },
        },
      ])
      expect(op.children[0]).toMatchObject({
        eligibility: "eligible",
        currentValue: { pools: { pool: true, hotTub: true } },
        proposedValue: { pools: { pool: true } },
      })
      await t.run(op)
      await tick()
      expect((await t.status(op)).children[0]).toMatchObject({
        status: "succeeded",
        confirmationState: "confirmed",
      })
      expect(listings.get(name)!.lodging!.pools).toEqual({ pool: true })
      expect(realPatches("/lodging")).toHaveLength(1)
    })

    it("publishes a profile under the business-information lock bulk children take", async () => {
      const t = await tenant(1)
      const [linked] = t.linked
      const root = `${server.baseUrl}/api/locations/${linked.locationId}/profile`
      const headers = (key: string) => ({
        cookie: t.owner.cookie,
        "content-type": "application/json",
        "x-request-id": key,
      })
      const load = async () => {
        const response = await fetch(root, {
          headers: { cookie: t.owner.cookie },
        })
        expect(response.status, await response.clone().text()).toBe(200)
        return (
          (await response.json()) as {
            profile: {
              canonicalResource: { revision: string }
              canonicalHash: string
              googleHash: string
            }
          }
        ).profile
      }
      const initial = await load()
      const saved = await fetch(root, {
        method: "PUT",
        headers: headers("save-profile"),
        body: JSON.stringify({
          expectedCanonicalRevision: initial.canonicalResource.revision,
          values: { website: "https://profile.example" },
        }),
      })
      expect(saved.status, await saved.clone().text()).toBe(200)
      const reviewed = await load()
      const key = `${t.owner.organisationId}:${linked.locationId}:business_info`
      const holder = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
      let release!: () => void
      const released = new Promise<void>((resolve) => {
        release = resolve
      })
      let locked!: () => void
      const held = new Promise<void>((resolve) => {
        locked = resolve
      })
      // A bulk business-information child holds the lock.
      const holding = holder.begin(async (lock) => {
        await lock`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`
        locked()
        await released
      })
      try {
        await held
        let settled = false
        const publishing = fetch(root, {
          method: "POST",
          headers: headers("publish-profile"),
          body: JSON.stringify({
            direction: "to_google",
            confirmation: "publish_nabapresence_profile_to_google",
            selectedFields: ["website"],
            expectedCanonicalRevision: reviewed.canonicalResource.revision,
            expectedCanonicalHash: reviewed.canonicalHash,
            expectedGoogleHash: reviewed.googleHash,
            confirmOverwriteGoogleChanges: false,
            confirmOverwriteCanonicalChanges: false,
          }),
        }).then((response) => {
          settled = true
          return response
        })
        try {
          await new Promise((resolve) => setTimeout(resolve, 1_500))
          // Nothing is read or written while the bulk child holds the lock.
          expect(settled).toBe(false)
          expect(realPatches("updateMask=")).toHaveLength(0)
        } finally {
          release()
          await holding
        }
        const published = await publishing
        expect(published.status, await published.clone().text()).toBe(200)
        expect(
          listings.get(linked.googleLocationName)!.location.websiteUri
        ).toBe("https://profile.example")
      } finally {
        release()
        await holder.end()
      }
    })

    it("holds the new families to the table's checks", async () => {
      const t = await tenant(1)
      const op = await t.preview([
        {
          operation: "business_info",
          changes: [{ field: "labels", action: "set", value: ["a"] }],
        },
      ])
      const [row] = await admin<{ resource_key: string }[]>`
        select resource_key from bulk_listing_child where operation_id = ${op.id}`
      expect(row.resource_key).toBe("business_info")
      await expect(
        admin`update bulk_listing_child set resource_key = 'healthcare' where operation_id = ${op.id}`
      ).rejects.toThrow(/bulk_listing_child_resource_key_check/)
      await expect(
        admin`update bulk_listing_operation set operation = 'healthcare_services' where id = ${op.id}`
      ).rejects.toThrow(/bulk_listing_operation_operation_check/)
    })
  }
)
