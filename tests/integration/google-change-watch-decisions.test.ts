import { randomUUID } from "node:crypto"

import postgres from "postgres"
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import type { NormalizedHours } from "@/lib/domain/hours"

import { startGoogleStub, type GoogleStub } from "./helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedLocation,
} from "./helpers/tenant"

vi.mock("server-only", () => ({}))

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

type Period = {
  openDay: string
  openTime: Record<string, number>
  closeDay: string
  closeTime: Record<string, number>
}

const period = (day: string, opens: number, closes: number): Period => ({
  openDay: day,
  openTime: { hours: opens },
  closeDay: day,
  closeTime: { hours: closes },
})

/**
 * The Google change watch's server functions in process, against a real
 * schema through the runtime role and the in-repo Google stub: the reads
 * "Check Google now" makes (which record the observations), the watch run on
 * them, and the decisions. The route suite
 * (routes/google-change-watch.test.ts) covers the same paths over HTTP on a
 * standalone build; these cover a saved value that moves while a change
 * waits, and our own bulk writes.
 */
describeDatabase("google change watch: saved values and bulk writes", () => {
  let admin: ReturnType<typeof postgres>
  let google: GoogleStub
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    google = await startGoogleStub({ port: 0 })
    process.env.DATABASE_URL = process.env.TEST_RUNTIME_DATABASE_URL!
    process.env.DATABASE_SESSION_URL = process.env.TEST_RUNTIME_DATABASE_URL!
    process.env.NEXTAUTH_SECRET = "google-watch-test-secret-32-characters!!"
    process.env.CRON_SECRET = "google-watch-test-cron-secret"
    process.env.TOKEN_ENCRYPTION_KEY ??=
      "route-harness-token-key-32-characters!!"
    process.env.GOOGLE_API_PROXY_BASE = google.baseUrl
    process.env.GOOGLE_RATE_BUDGET_ENABLED = "false"
  })

  beforeEach(() => google.reset())

  afterAll(async () => {
    delete process.env.GOOGLE_API_PROXY_BASE
    await google?.stop()
    await destroyTenants(admin, organisations)
    await admin?.end()
  })

  /** A linked listing whose Google location the test edits in place. */
  async function listing() {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const linked = await seedLinkedLocation(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    const location: Record<string, unknown> = {
      name: linked.googleLocationName,
      title: "Old Crown",
      profile: { description: "Village pub" },
      phoneNumbers: { primaryPhone: "+44 1223 000000" },
      websiteUri: "https://old-crown.example",
      categories: {
        primaryCategory: { name: "gcid:pub", displayName: "Pub" },
      },
      regularHours: {
        periods: [period("FRIDAY", 12, 23), period("SATURDAY", 12, 23)],
      },
      metadata: {},
    }
    const session = {
      sessionId: randomUUID(),
      userId: owner.userId,
      organisationId: owner.organisationId,
      organisationName: "Harness tenant",
      workspaceMode: "agency" as const,
      displayName: "Harness",
      email: owner.email,
      role: "owner" as const,
      canPublish: true,
    }
    return { owner, linked, location, session }
  }

  type Listing = Awaited<ReturnType<typeof listing>>

  function stubGoogle(target: Listing) {
    const name = target.linked.googleLocationName
    google.respond({ method: "GET", pathIncludes: `/v1/${name}` }, () => ({
      status: 200,
      json: target.location,
    }))
    google.respond(
      { method: "GET", pathIncludes: `/v1/${name}/attributes` },
      () => ({ status: 200, json: { attributes: [], attributeMetadata: [] } })
    )
    google.respond({ method: "GET", pathIncludes: "/v1/attributes?" }, () => ({
      status: 200,
      json: { attributeMetadata: [] },
    }))
    google.respond(
      { method: "GET", pathIncludes: "/categories:batchGet" },
      (call) => ({
        status: 200,
        json: {
          categories: new URL(call.path, google.baseUrl).searchParams
            .getAll("names")
            .map((category) => ({
              name: category,
              displayName: category.replace("gcid:", ""),
            })),
        },
      })
    )
  }

  /** "Check Google now": both reads (recording observations), then the watch. */
  async function check(target: Listing) {
    stubGoogle(target)
    const { readProfileStateBundle } = await import("@/lib/server/profile")
    const { getHoursState } = await import("@/lib/server/hours")
    const { watchGoogleChanges, listGoogleChanges } =
      await import("@/lib/server/google-change-watch")
    await readProfileStateBundle(target.session, target.linked.locationId, {
      refresh: true,
    })
    await getHoursState(target.session, target.linked.locationId, {
      refresh: true,
    })
    const outcome = await watchGoogleChanges({
      organisationId: target.owner.organisationId,
      locationId: target.linked.locationId,
    })
    const { changes } = await listGoogleChanges(
      target.session,
      target.linked.locationId
    )
    return { ...outcome, changes }
  }

  async function openChange(target: Listing, field: string) {
    const { changes } = await check(target)
    const change = changes.find(
      (row) => row.field === field && row.status === "open"
    )
    expect(change, JSON.stringify(changes)).toBeDefined()
    return change!
  }

  async function decide(
    target: Listing,
    change: { id: string; googleHash: string },
    action: "accept_google" | "put_ours_back"
  ) {
    const { decideGoogleChange } =
      await import("@/lib/server/google-change-watch-actions")
    return decideGoogleChange({
      session: target.session,
      locationId: target.linked.locationId,
      changeId: change.id,
      action,
      expectedGoogleHash: change.googleHash,
      requestId: `google-watch-${randomUUID()}`,
    })
  }

  async function refusal(promise: Promise<unknown>) {
    const { ApiError } = await import("@/lib/server/http")
    const error = await promise.then(
      () => null,
      (caught: unknown) => caught
    )
    expect(error).toBeInstanceOf(ApiError)
    return error as InstanceType<typeof ApiError>
  }

  async function savedHours(target: Listing) {
    const { getHoursState } = await import("@/lib/server/hours")
    stubGoogle(target)
    const state = await getHoursState(
      target.session,
      target.linked.locationId,
      { refresh: false }
    )
    return {
      revision: state.canonicalResource.revision,
      hours: state.canonical as NormalizedHours,
    }
  }

  /** Saves new Friday hours in our own copy, as the hours editor does. */
  async function saveFriday(
    target: Listing,
    opensAt: string,
    closesAt: string
  ) {
    const { saveCanonicalHours } = await import("@/lib/server/hours")
    const { revision, hours } = await savedHours(target)
    await saveCanonicalHours({
      session: target.session,
      locationId: target.linked.locationId,
      expectedCanonicalRevision: revision,
      hours: {
        ...hours,
        moreHours: hours.moreHours ?? [],
        regular: hours.regular.map((day) =>
          day.dayOfWeek === 5
            ? { ...day, isClosed: false, periods: [{ opensAt, closesAt }] }
            : day
        ),
      },
      requestId: `google-watch-${randomUUID()}`,
    })
  }

  const friday = (hours: NormalizedHours) =>
    hours.regular.find((day) => day.dayOfWeek === 5)?.periods

  it("refuses to keep Google's hours over hours saved after the change was spotted, until a check takes them", async () => {
    const target = await listing()
    expect((await check(target)).found).toBe(0)
    target.location.regularHours = {
      periods: [period("FRIDAY", 12, 22), period("SATURDAY", 12, 23)],
    }
    const change = await openChange(target, "regularHours")
    expect(change.regularDays).toEqual([5])

    // Someone saves new Friday hours after the change was spotted.
    await saveFriday(target, "11:00", "21:00")
    const stale = await refusal(decide(target, change, "accept_google"))
    expect(stale.status).toBe(409)
    expect(stale.code).toBe("google_change_ours_changed")
    // Their hours stand, and the change is open for a fresh decision.
    expect(friday((await savedHours(target)).hours)).toMatchObject([
      { opensAt: "11:00", closesAt: "21:00" },
    ])
    const [row] = await admin<{ status: string }[]>`
      select status from listing_google_change where id = ${change.id}
    `
    expect(row?.status).toBe("open")

    // Checking again brings the change up to date with the saved hours:
    // the same change, now compared against them, and keeping Google's works.
    const rechecked = await openChange(target, "regularHours")
    expect(rechecked.id).toBe(change.id)
    expect(rechecked.googleHash).toBe(change.googleHash)
    expect(rechecked.localEdits).toBe(true)
    const accepted = await decide(target, rechecked, "accept_google")
    expect(accepted.outcome).toBe("accepted")
    expect(friday((await savedHours(target)).hours)).toMatchObject([
      { opensAt: "12:00", closesAt: "22:00" },
    ])
    expect(google.calls.some((call) => call.method === "PATCH")).toBe(false)
  }, 60_000)

  it("takes a profile value saved while its change is open, so either decision works after a check, and resolves once ours matches Google's", async () => {
    const { saveCanonicalProfile } = await import("@/lib/server/profile")
    const { readCanonicalResource } =
      await import("@/lib/server/canonical-resources")
    const { withTenant } = await import("@/lib/server/db")
    const target = await listing()
    expect((await check(target)).found).toBe(0)
    target.location.title = "Old Crown Inn"
    const change = await openChange(target, "name")
    expect(change.ours).toEqual({ field: "name", value: "Old Crown" })

    const saveName = async (name: string) => {
      const resource = await withTenant(target.owner.organisationId, (sql) =>
        readCanonicalResource({
          sql,
          organisationId: target.owner.organisationId,
          locationId: target.linked.locationId,
          resourceType: "profile",
        })
      )
      await saveCanonicalProfile({
        session: target.session,
        locationId: target.linked.locationId,
        expectedCanonicalRevision: resource!.revision,
        values: { name },
        requestId: `google-watch-${randomUUID()}`,
      })
    }

    await saveName("The Old Crown")
    const stale = await refusal(decide(target, change, "accept_google"))
    expect(stale.code).toBe("google_change_ours_changed")

    // Reload and check again: the same change now shows the saved value.
    const rechecked = await openChange(target, "name")
    expect(rechecked.id).toBe(change.id)
    expect(rechecked.ours).toEqual({ field: "name", value: "The Old Crown" })
    expect(rechecked.localEdits).toBe(true)
    const [row] = await admin<{ oursHash: string }[]>`
      select ours_hash as "oursHash" from listing_google_change
      where id = ${change.id}
    `
    const { watchedValueHash } =
      await import("@/lib/domain/google-change-watch")
    expect(row?.oursHash).toBe(
      watchedValueHash({ field: "name", value: "The Old Crown" })
    )

    // Our saved value now matches Google's: nothing is left to decide.
    await saveName("Old Crown Inn")
    const caughtUp = await check(target)
    expect(caughtUp.found).toBe(0)
    expect(caughtUp.changes.find((c) => c.id === change.id)).toMatchObject({
      status: "resolved",
      resolution: "google_restored",
    })
    expect(caughtUp.changes.some((c) => c.status === "open")).toBe(false)
  }, 60_000)

  it("keeps Google's profile value after a check took a newer saved value", async () => {
    const { saveCanonicalProfile } = await import("@/lib/server/profile")
    const { readCanonicalResource } =
      await import("@/lib/server/canonical-resources")
    const { withTenant } = await import("@/lib/server/db")
    const target = await listing()
    expect((await check(target)).found).toBe(0)
    target.location.title = "Old Crown Inn"
    await openChange(target, "name")
    const resource = await withTenant(target.owner.organisationId, (sql) =>
      readCanonicalResource({
        sql,
        organisationId: target.owner.organisationId,
        locationId: target.linked.locationId,
        resourceType: "profile",
      })
    )
    await saveCanonicalProfile({
      session: target.session,
      locationId: target.linked.locationId,
      expectedCanonicalRevision: resource!.revision,
      values: { name: "The Old Crown" },
      requestId: `google-watch-${randomUUID()}`,
    })
    const rechecked = await openChange(target, "name")
    const accepted = await decide(target, rechecked, "accept_google")
    expect(accepted.outcome).toBe("accepted")
    const [profile] = await admin<{ name: string | null }[]>`
      select payload ->> 'name' as name from presence_canonical_resource
      where location_id = ${target.linked.locationId} and resource_type = 'profile'
    `
    expect(profile?.name).toBe("Old Crown Inn")
  }, 60_000)

  /** A bulk child's write, recorded as runBulkWrite records it. */
  async function bulkWrite(
    target: Listing,
    input: {
      family: "business_info" | "categories"
      intended: Record<string, unknown>
      status: "succeeded" | "failed" | "ambiguous"
      finishedAt?: string
    }
  ) {
    const { organisationId, userId } = target.owner
    const { locationId, googleLocationName } = target.linked
    const [operation] = await admin<{ id: string }[]>`
      insert into bulk_listing_operation (
        organisation_id, operation, input, items, target_location_ids,
        preview_hash, requested_by, require_two_person_approval
      ) values (
        ${organisationId}, ${input.family}, ${admin.json({ marker: randomUUID() })},
        ${admin.json([{ marker: randomUUID() }])}, ${[locationId]}::uuid[],
        ${"b".repeat(64)}, ${userId}, false
      )
      returning id::text as id
    `
    const [child] = await admin<{ id: string }[]>`
      insert into bulk_listing_child (
        operation_id, organisation_id, location_id, eligibility, status,
        resource_key, seq, item_key, input
      ) values (
        ${operation!.id}, ${organisationId}, ${locationId}, 'eligible',
        ${input.status}, 'business_info', 0, ${`0:${input.family}`},
        ${admin.json({ operation: input.family })}
      )
      returning id::text as id
    `
    await admin`
      insert into bulk_listing_write_attempt (
        organisation_id, child_id, location_id, family, idempotency_key, status,
        actor_user_id, google_location_name, intended, finished_at
      ) values (
        ${organisationId}, ${child!.id}, ${locationId}, ${input.family},
        ${`bulk-test-${randomUUID()}`}, ${input.status}, ${userId},
        ${googleLocationName}, ${admin.json(input.intended as never)},
        ${input.finishedAt ?? new Date().toISOString()}
      )
    `
  }

  it("does not report our own bulk website, description and category writes as changes on Google", async () => {
    const target = await listing()
    expect((await check(target)).found).toBe(0)

    // A bulk change sends a new website, description and primary category;
    // Google shows them.
    await bulkWrite(target, {
      family: "business_info",
      status: "succeeded",
      intended: {
        changes: [
          {
            field: "websiteUri",
            action: "set",
            value: "https://oldcrown-girton.example",
          },
          {
            field: "profile.description",
            action: "set",
            value: "Thatched village pub",
          },
        ],
      },
    })
    await bulkWrite(target, {
      family: "categories",
      status: "succeeded",
      intended: { categories: { primary: "gcid:bar", additional: [] } },
    })
    // A later bulk write that failed never reached Google: not ours.
    await bulkWrite(target, {
      family: "business_info",
      status: "failed",
      intended: {
        changes: [
          {
            field: "websiteUri",
            action: "set",
            value: "https://never.example",
          },
        ],
      },
      finishedAt: new Date(Date.now() + 60_000).toISOString(),
    })
    target.location.websiteUri = "https://oldcrown-girton.example"
    target.location.profile = { description: "Thatched village pub" }
    target.location.categories = {
      primaryCategory: { name: "gcid:bar", displayName: "Bar" },
    }
    const after = await check(target)
    expect(after.found).toBe(0)
    expect(after.changes).toEqual([])

    // Google then changes them: ours is what the bulk change published.
    target.location.websiteUri = "https://crown-pub.example"
    target.location.profile = { description: "Pub" }
    target.location.categories = {
      primaryCategory: { name: "gcid:restaurant", displayName: "Restaurant" },
    }
    const changed = await check(target)
    expect(changed.found).toBe(3)
    const byField = Object.fromEntries(
      changed.changes.map((change) => [change.field, change])
    )
    expect(byField.website).toMatchObject({
      ours: { field: "website", value: "https://oldcrown-girton.example" },
      google: { field: "website", value: "https://crown-pub.example" },
    })
    expect(byField.description).toMatchObject({
      ours: { field: "description", value: "Thatched village pub" },
      google: { field: "description", value: "Pub" },
    })
    expect(byField.primaryCategory?.ours.value).toMatchObject({
      name: "gcid:bar",
    })
  }, 60_000)

  it("reads only this listing's bulk writes", async () => {
    const target = await listing()
    const other = await listing()
    expect((await check(target)).found).toBe(0)
    // Another organisation's bulk write naming this listing is not ours.
    await bulkWrite(other, {
      family: "business_info",
      status: "succeeded",
      intended: {
        changes: [
          {
            field: "websiteUri",
            action: "set",
            value: "https://elsewhere.example",
          },
        ],
      },
    })
    await admin`
      update bulk_listing_write_attempt set location_id = ${target.linked.locationId}
      where organisation_id = ${other.owner.organisationId}
    `
    target.location.websiteUri = "https://elsewhere.example"
    const after = await check(target)
    expect(after.changes.map((change) => change.field)).toEqual(["website"])
  }, 60_000)
})
