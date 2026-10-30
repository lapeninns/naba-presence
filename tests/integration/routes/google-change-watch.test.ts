import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { z } from "zod"

import {
  googleChangeDecisionResponseSchema,
  googleChangeSchema,
  googleWatchSettingsResponseSchema,
  type GoogleChange,
} from "@/lib/contracts/google-change-watch"
import { gbpChangeSetResponseSchema } from "@/lib/contracts/gbp-change-set"
import {
  CLIENT_CAPABILITIES_HEADER,
  clientCapabilityHeaders,
} from "@/lib/contracts/client-capabilities"
import {
  normalizeGoogleHours,
  type GoogleLocationHours,
} from "@/lib/domain/hours"

import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedLocation,
  seedMemberUser,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

// The fields this suite asserts; other fields the response carries are
// left to the contract's own tests.
const changesResponseSchema = z.object({
  changes: z.array(googleChangeSchema),
  canDecide: z.boolean(),
})
const checkResponseSchema = changesResponseSchema.extend({ found: z.number() })

const WATCHED = [
  "name",
  "description",
  "phone",
  "website",
  "primaryCategory",
  "regularHours",
  "specialHours",
]

type Period = {
  openDay: string
  openTime: Record<string, number>
  closeDay: string
  closeTime: Record<string, number>
}

const period = (
  day: string,
  opens: number,
  closes: Record<string, number>,
  closeDay = day
): Period => ({
  openDay: day,
  openTime: { hours: opens },
  closeDay,
  closeTime: closes,
})

/**
 * The Google change watch (S5): protected listing fields that move on Google
 * off the value we last published are recorded, alerted and decided ("Put
 * ours back" through the reviewed change paths, or "Accept Google's").
 */
describeDatabase("google change watch", () => {
  let admin: ReturnType<typeof postgres>
  let google: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    google = await startGoogleStub()
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: google.baseUrl,
      GBP_PROFILE_WRITES_ENABLED: "true",
      PUBLISH_ENABLED: "true",
    })
  })

  beforeEach(() => google.reset())

  afterAll(async () => {
    await server.stop()
    await google.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  /**
   * A linked listing whose Google location the test edits in place. Owner,
   * a member who sees every listing, and a member assigned only elsewhere.
   */
  async function listing(
    options: { twoPerson?: boolean; feature?: boolean; hours?: Period[] } = {}
  ) {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    if (options.twoPerson) {
      await admin`update organisation set require_two_person_approval = true where id = ${owner.organisationId}`
    }
    if (options.feature) {
      await admin`
        insert into organisation_feature (organisation_id, feature, enabled, changed_by)
        values (${owner.organisationId}, 'listing_change_approvals', true, 'test')
      `
    }
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const linked = await seedLinkedLocation(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    const elsewhere = await seedLinkedLocation(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    const member = await seedMemberUser(admin, {
      organisationId: owner.organisationId,
      role: "member",
      canPublish: true,
    })
    const outsider = await seedMemberUser(admin, {
      organisationId: owner.organisationId,
      role: "member",
      assignLocationId: elsewhere.locationId,
    })
    const location: Record<string, unknown> & {
      regularHours: { periods: Period[] }
    } = {
      name: linked.googleLocationName,
      title: "Old Crown",
      profile: { description: "Village pub" },
      phoneNumbers: { primaryPhone: "+44 1223 000000" },
      websiteUri: "https://old-crown.example",
      categories: {
        primaryCategory: { name: "gcid:pub", displayName: "Pub" },
      },
      regularHours: {
        periods: options.hours ?? [
          period("FRIDAY", 12, { hours: 23 }),
          period("SATURDAY", 12, { hours: 23 }),
        ],
      },
      metadata: {},
    }
    const writes: Array<Record<string, unknown>> = []
    google.respond(
      { method: "GET", pathIncludes: `/v1/${linked.googleLocationName}` },
      () => ({ status: 200, json: location })
    )
    google.respond(
      {
        method: "GET",
        pathIncludes: `/v1/${linked.googleLocationName}/attributes`,
      },
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
            .map((name) => ({ name, displayName: name.replace("gcid:", "") })),
        },
      })
    )
    google.respond(
      { method: "PATCH", pathIncludes: `/v1/${linked.googleLocationName}` },
      (call) => {
        const body = call.body as Record<string, unknown>
        if (
          new URL(call.path, google.baseUrl).searchParams.get(
            "validateOnly"
          ) !== "true"
        ) {
          writes.push(body)
          Object.assign(location, body)
        }
        return { status: 200, json: location }
      }
    )
    const base = `${server.baseUrl}/api/locations/${linked.locationId}`
    return { owner, member, outsider, linked, location, writes, base }
  }

  type Listing = Awaited<ReturnType<typeof listing>>

  /** A second owner/admin of the listing's organisation. */
  async function secondAdmin(owner: Listing["owner"]) {
    const reviewer = await createTestTenant(admin)
    organisations.push(reviewer.organisationId)
    await admin`insert into member (organisation_id, user_id, role) values (${owner.organisationId}, ${reviewer.userId}, 'admin')`
    await admin`update app_session set organisation_id = ${owner.organisationId} where user_id = ${reviewer.userId}`
    return reviewer
  }

  const googlePatches = () =>
    google.calls.filter((call) => call.method === "PATCH")

  async function check(target: Listing, cookie = target.owner.cookie) {
    const response = await send(
      cookie,
      "POST",
      `${target.base}/google-changes/check`,
      {}
    )
    expect(response.status, await response.clone().text()).toBe(200)
    return checkResponseSchema.parse(await response.json())
  }

  async function changes(target: Listing, cookie = target.owner.cookie) {
    const response = await fetch(`${target.base}/google-changes`, {
      headers: { cookie },
    })
    expect(response.status, await response.clone().text()).toBe(200)
    return changesResponseSchema.parse(await response.json())
  }

  function decide(
    target: Listing,
    change: Pick<GoogleChange, "id" | "googleHash">,
    action: "put_ours_back" | "accept_google",
    cookie = target.owner.cookie,
    expectedGoogleHash = change.googleHash
  ) {
    return send(cookie, "POST", `${target.base}/google-changes/${change.id}`, {
      action,
      expectedGoogleHash,
    })
  }

  async function incidents(locationId: string) {
    return admin<
      {
        id: string
        subjectId: string
        subjectType: string
        status: string
        locationId: string
        recipients: string[]
      }[]
    >`
      select i.id::text as id, i.subject_id as "subjectId",
        i.subject_type as "subjectType", i.status,
        i.location_id::text as "locationId",
        coalesce((
          select array_agg(r.user_id::text order by r.user_id)
          from notification_incident_recipient r where r.incident_id = i.id
        ), '{}') as recipients
      from notification_incident i
      where i.location_id = ${locationId} and i.kind = 'listing_google_changed'
      order by i.opened_at, i.id
    `
  }

  const incidentFor = async (locationId: string, changeId: string) =>
    (await incidents(locationId)).filter((incident) =>
      incident.subjectId.endsWith(`:google_change:${changeId}`)
    )

  async function changeRows(locationId: string) {
    return admin<{ id: string; field: string; status: string }[]>`
      select id::text as id, field, status from listing_google_change
      where location_id = ${locationId} order by detected_at, id
    `
  }

  /** Baselines from a first check, then a Google edit and a second check. */
  async function detected(
    target: Listing,
    edit: (location: Listing["location"]) => void,
    field: GoogleChange["field"]
  ) {
    const first = await check(target)
    expect(first.found).toBe(0)
    edit(target.location)
    const second = await check(target)
    const change = second.changes.find(
      (candidate) => candidate.field === field && candidate.status === "open"
    )
    expect(change, JSON.stringify(second.changes)).toBeDefined()
    return change!
  }

  it("defaults to every field and the owners and admins, and only owners and admins change who is alerted", async () => {
    const target = await listing()
    const url = `${target.base}/google-watch`
    const read = async (cookie: string) => {
      const response = await fetch(url, { headers: { cookie } })
      expect(response.status, await response.clone().text()).toBe(200)
      return googleWatchSettingsResponseSchema.parse(await response.json())
    }

    const initial = await read(target.owner.cookie)
    expect(initial.settings).toEqual({
      protectedFields: WATCHED,
      alertMode: "managers",
      recipientIds: [],
      updatedAt: null,
      updatedBy: null,
    })
    expect(initial.canManage).toBe(true)
    expect(initial.people.map((person) => person.userId).sort()).toEqual(
      [target.owner.userId, target.member.userId].sort()
    )
    const asMember = await read(target.member.cookie)
    expect(asMember).toMatchObject({ canManage: false, people: [] })

    const memberPut = await send(target.member.cookie, "PUT", url, {
      protectedFields: ["name"],
      alertMode: "everyone",
      recipientIds: [],
    })
    expect(memberPut.status).toBe(403)

    const nobodyChosen = await send(target.owner.cookie, "PUT", url, {
      protectedFields: WATCHED,
      alertMode: "chosen",
      recipientIds: [],
    })
    expect(nobodyChosen.status).toBe(400)

    const cannotSee = await send(target.owner.cookie, "PUT", url, {
      protectedFields: WATCHED,
      alertMode: "chosen",
      recipientIds: [target.outsider.userId],
    })
    expect(cannotSee.status).toBe(400)
    expect(await cannotSee.json()).toMatchObject({
      error: "recipient_not_allowed",
    })
    expect(
      await admin`select 1 from listing_google_watch where location_id = ${target.linked.locationId}`
    ).toHaveLength(0)

    const saved = await send(target.owner.cookie, "PUT", url, {
      protectedFields: ["name", "phone"],
      alertMode: "chosen",
      recipientIds: [target.member.userId],
    })
    expect(saved.status, await saved.clone().text()).toBe(200)
    const savedBody = googleWatchSettingsResponseSchema.parse(
      await saved.json()
    )
    expect(savedBody.settings).toMatchObject({
      protectedFields: ["name", "phone"],
      alertMode: "chosen",
      recipientIds: [target.member.userId],
    })
    expect(savedBody.settings.updatedAt).not.toBeNull()
    expect(await read(target.owner.cookie)).toMatchObject({
      settings: savedBody.settings,
    })
    const audits = await admin<{ actor: string; subjectId: string }[]>`
      select actor_user_id::text as actor, subject_id as "subjectId"
      from audit_log
      where organisation_id = ${target.owner.organisationId}
        and action = 'listing.google_watch.updated'
    `
    expect(audits).toEqual([
      { actor: target.owner.userId, subjectId: target.linked.locationId },
    ])

    // Chosen people only: the alert reaches the member, not the owner.
    await detected(
      target,
      (location) => {
        location.title = "Old Crown Inn"
      },
      "name"
    )
    const [incident] = await incidents(target.linked.locationId)
    expect(incident.recipients).toEqual([target.member.userId])
    // Settings and reads never reached Google beyond the two checks' reads.
    expect(googlePatches()).toHaveLength(0)
  }, 30_000)

  it("sets baselines silently, then records one change and one incident per field Google moved, once", async () => {
    const target = await listing()
    const first = await check(target)
    expect(first).toMatchObject({ found: 0, changes: [], canDecide: true })
    const [watch] = await admin<{ categoryBaseline: string | null }[]>`
      select category_baseline as "categoryBaseline" from listing_google_watch
      where location_id = ${target.linked.locationId}
    `
    expect(watch?.categoryBaseline).toBe("gcid:pub")

    // Representation-only edits (UK phone format, website scheme/www/slash)
    // are not changes; the name and the primary category are.
    target.location.title = "Old Crown Inn"
    target.location.phoneNumbers = { primaryPhone: "01223 000000" }
    target.location.websiteUri = "http://www.old-crown.example/"
    target.location.categories = {
      primaryCategory: { name: "gcid:bar", displayName: "Bar" },
    }
    const second = await check(target)
    expect(second.found).toBe(2)
    expect(second.changes.map((change) => change.field).sort()).toEqual([
      "name",
      "primaryCategory",
    ])
    const name = second.changes.find((change) => change.field === "name")!
    expect(name).toMatchObject({
      status: "open",
      resolution: null,
      ours: { field: "name", value: "Old Crown" },
      google: { field: "name", value: "Old Crown Inn" },
      localEdits: false,
      decidedAt: null,
      revert: null,
    })
    expect(name.googleHash).toMatch(/^[0-9a-f]{64}$/)
    const category = second.changes.find(
      (change) => change.field === "primaryCategory"
    )!
    expect(category.ours.value).toMatchObject({ name: "gcid:pub" })
    expect(category.google.value).toMatchObject({ name: "gcid:bar" })

    const opened = await incidents(target.linked.locationId)
    expect(opened).toHaveLength(2)
    for (const incident of opened) {
      expect(incident).toMatchObject({
        subjectType: "google_change",
        status: "open",
        locationId: target.linked.locationId,
      })
      // The default alerts the owners and admins, not the members who
      // can only see the listing.
      expect(incident.recipients).toEqual([target.owner.userId])
    }
    expect(
      (await incidentFor(target.linked.locationId, name.id))[0]?.status
    ).toBe("open")

    // The same Google values again: no second row and no second incident.
    const third = await check(target)
    expect(third.found).toBe(0)
    expect(third.changes.map((change) => change.id).sort()).toEqual(
      second.changes.map((change) => change.id).sort()
    )
    expect(await changeRows(target.linked.locationId)).toHaveLength(2)
    expect(await incidents(target.linked.locationId)).toHaveLength(2)

    // Listing the changes reads only the database.
    const callsBefore = google.calls.length
    const listed = await changes(target)
    expect(listed.canDecide).toBe(true)
    expect(listed.changes.map((change) => change.id).sort()).toEqual(
      second.changes.map((change) => change.id).sort()
    )
    const asMember = await changes(target, target.member.cookie)
    expect(asMember.canDecide).toBe(false)
    expect(asMember.changes).toHaveLength(2)
    expect(google.calls).toHaveLength(callsBefore)
  }, 30_000)

  it("refuses a member, a value the person did not see, and a value Google has since moved off", async () => {
    const target = await listing()
    const change = await detected(
      target,
      (location) => {
        location.title = "Old Crown Inn"
      },
      "name"
    )

    const asMember = await decide(
      target,
      change,
      "put_ours_back",
      target.member.cookie
    )
    expect(asMember.status).toBe(403)
    const memberAccept = await decide(
      target,
      change,
      "accept_google",
      target.member.cookie
    )
    expect(memberAccept.status).toBe(403)

    const wrongHash = await decide(
      target,
      change,
      "put_ours_back",
      target.owner.cookie,
      "0".repeat(64)
    )
    expect(wrongHash.status).toBe(409)
    expect(await wrongHash.json()).toMatchObject({
      error: "google_change_moved",
    })

    // Google moved again before anyone checked: putting back reads Google
    // and refuses rather than reviewing against a value nobody saw.
    target.location.title = "The Crown"
    const moved = await decide(target, change, "put_ours_back")
    expect(moved.status).toBe(409)
    expect(await moved.json()).toMatchObject({ error: "google_change_moved" })
    expect(
      await admin`select 1 from gbp_change_set where location_id = ${target.linked.locationId}`
    ).toHaveLength(0)
    expect(
      (await changes(target)).changes.find((row) => row.id === change.id)
    ).toMatchObject({ status: "open" })
    expect(googlePatches()).toHaveLength(0)
  }, 30_000)

  it("supersedes a change when Google moves the field again, and resolves it when Google restores ours", async () => {
    const target = await listing()
    const change = await detected(
      target,
      (location) => {
        location.title = "Old Crown Inn"
      },
      "name"
    )

    target.location.title = "The Crown"
    const again = await check(target)
    expect(again.found).toBe(1)
    const replaced = again.changes.find((row) => row.id === change.id)
    expect(replaced?.status).toBe("superseded")
    const current = again.changes.find(
      (row) => row.field === "name" && row.status === "open"
    )!
    expect(current.id).not.toBe(change.id)
    expect(current.google).toEqual({ field: "name", value: "The Crown" })
    expect(current.googleHash).not.toBe(change.googleHash)
    expect(
      (await incidentFor(target.linked.locationId, change.id))[0]?.status
    ).toBe("resolved")
    expect(
      (await incidentFor(target.linked.locationId, current.id))[0]?.status
    ).toBe("open")

    target.location.title = "Old Crown"
    const restored = await check(target)
    expect(restored.found).toBe(0)
    expect(restored.changes.find((row) => row.id === current.id)).toMatchObject(
      {
        status: "resolved",
        resolution: "google_restored",
      }
    )
    expect(restored.changes.some((row) => row.status === "open")).toBe(false)
    expect(
      (await incidents(target.linked.locationId)).map(
        (incident) => incident.status
      )
    ).toEqual(["resolved", "resolved"])
  }, 30_000)

  it("resolves a live change as unwatched when its field is switched off", async () => {
    const target = await listing()
    const change = await detected(
      target,
      (location) => {
        location.phoneNumbers = { primaryPhone: "+44 1223 999999" }
      },
      "phone"
    )
    const saved = await send(
      target.owner.cookie,
      "PUT",
      `${target.base}/google-watch`,
      {
        protectedFields: WATCHED.filter((field) => field !== "phone"),
        alertMode: "everyone",
        recipientIds: [],
      }
    )
    expect(saved.status, await saved.clone().text()).toBe(200)
    const listed = await changes(target)
    expect(listed.changes.find((row) => row.id === change.id)).toMatchObject({
      status: "resolved",
      resolution: "unwatched",
    })
    expect(
      (await incidentFor(target.linked.locationId, change.id))[0]?.status
    ).toBe("resolved")
    const after = await check(target)
    expect(after.found).toBe(0)
    expect(after.changes.some((row) => row.status === "open")).toBe(false)
  }, 30_000)

  it("accepts Google's value as ours without writing to Google", async () => {
    const target = await listing()
    const change = await detected(
      target,
      (location) => {
        location.profile = { description: "Riverside pub and garden" }
      },
      "description"
    )

    const accepted = await decide(target, change, "accept_google")
    expect(accepted.status, await accepted.clone().text()).toBe(200)
    const body = googleChangeDecisionResponseSchema.parse(await accepted.json())
    expect(body.outcome).toBe("accepted")
    expect(body.change).toMatchObject({ id: change.id, status: "accepted" })
    expect(body.change.decidedAt).not.toBeNull()
    expect(body.change.decidedBy).not.toBeNull()
    expect(googlePatches()).toHaveLength(0)
    const [profile] = await admin<{ description: string | null }[]>`
      select payload ->> 'description' as description
      from presence_canonical_resource
      where location_id = ${target.linked.locationId} and resource_type = 'profile'
    `
    expect(profile?.description).toBe("Riverside pub and garden")
    expect(
      (await incidentFor(target.linked.locationId, change.id))[0]?.status
    ).toBe("resolved")

    const twice = await decide(target, change, "accept_google")
    expect(twice.status).toBe(409)
    expect(await twice.json()).toMatchObject({ error: "google_change_decided" })

    const later = await check(target)
    expect(later.found).toBe(0)
    expect(await changeRows(target.linked.locationId)).toHaveLength(1)
    expect(await incidents(target.linked.locationId)).toHaveLength(1)
  }, 30_000)

  it("puts ours back as a reviewed change set that a second person approves before it publishes", async () => {
    const target = await listing({ twoPerson: true })
    const reviewer = await secondAdmin(target.owner)
    const change = await detected(
      target,
      (location) => {
        location.title = "Old Crown Inn"
      },
      "name"
    )

    const reverted = await decide(target, change, "put_ours_back")
    expect(reverted.status, await reverted.clone().text()).toBe(200)
    const body = googleChangeDecisionResponseSchema.parse(await reverted.json())
    expect(body.outcome).toBe("review_created")
    expect(body.change.status).toBe("reverting")
    const revert = body.change.revert
    expect(revert?.kind).toBe("change_set")
    if (revert?.kind !== "change_set") throw new Error("expected a change set")
    expect(revert.dispatched).toBe(false)
    expect(revert.changeSet).toMatchObject({
      payload: { title: "Old Crown" },
      updateMask: ["title"],
      requiresSecondApprover: true,
      canApprove: false,
    })
    // Nothing was sent to Google; the alert stays open until ours is back.
    expect(googlePatches()).toHaveLength(0)
    expect(target.location.title).toBe("Old Crown Inn")
    expect(
      (await incidentFor(target.linked.locationId, change.id))[0]?.status
    ).toBe("open")

    const changeSet = revert.changeSet
    const url = `${target.base}/business-information`
    const approval = {
      changeSetId: changeSet.id,
      expectedPayloadHash: changeSet.payloadHash,
    }
    const self = await send(target.owner.cookie, "POST", url, approval)
    expect(self.status).toBe(409)
    expect(await self.json()).toMatchObject({
      error: "second_approver_required",
    })
    const approved = await send(reviewer.cookie, "POST", url, approval)
    expect(approved.status, await approved.clone().text()).toBe(200)
    gbpChangeSetResponseSchema.parse(await approved.json())

    const published = await send(target.owner.cookie, "PATCH", url, {
      operation: "update_location",
      confirmation: "publish_business_information_to_google",
      changeSetId: changeSet.id,
      payload: changeSet.payload,
      updateMask: changeSet.updateMask,
      expectedGoogleHash: changeSet.baselineHash,
    })
    expect(published.status, await published.clone().text()).toBe(200)
    expect(target.writes).toMatchObject([{ title: "Old Crown" }])
    expect(target.writes).toHaveLength(1)
    expect(target.location.title).toBe("Old Crown")

    const after = await check(target)
    expect(after.found).toBe(0)
    const settled = after.changes.find((row) => row.id === change.id)
    expect(settled).toMatchObject({
      status: "resolved",
      resolution: "published",
    })
    expect(settled?.revert).toMatchObject({
      kind: "change_set",
      dispatched: true,
    })
    // Kept open while ours was only on its way back; closed once it is on Google.
    expect(
      (await incidentFor(target.linked.locationId, change.id))[0]?.status
    ).toBe("resolved")
  }, 60_000)

  it("does not report our own business-information publish as a change on Google", async () => {
    const target = await listing()
    expect((await check(target)).found).toBe(0)
    const url = `${target.base}/business-information`
    const read = await fetch(`${url}?refresh=1`, {
      headers: { cookie: target.owner.cookie },
    })
    expect(read.status, await read.clone().text()).toBe(200)
    const { businessInformation } = (await read.json()) as {
      businessInformation: { locationHash: string }
    }
    // The business-information editor's own path: review, approve, publish.
    const reviewed = await send(target.owner.cookie, "PUT", url, {
      payload: { title: "The Old Crown, Girton" },
      updateMask: ["title"],
      expectedGoogleHash: businessInformation.locationHash,
    })
    expect(reviewed.status, await reviewed.clone().text()).toBe(200)
    const { changeSet } = gbpChangeSetResponseSchema.parse(
      await reviewed.json()
    )
    const approved = await send(target.owner.cookie, "POST", url, {
      changeSetId: changeSet.id,
      expectedPayloadHash: changeSet.payloadHash,
    })
    expect(approved.status, await approved.clone().text()).toBe(200)
    const published = await send(target.owner.cookie, "PATCH", url, {
      operation: "update_location",
      confirmation: "publish_business_information_to_google",
      changeSetId: changeSet.id,
      payload: changeSet.payload,
      updateMask: changeSet.updateMask,
      expectedGoogleHash: changeSet.baselineHash,
    })
    expect(published.status, await published.clone().text()).toBe(200)
    expect(target.location.title).toBe("The Old Crown, Girton")

    // Google now shows what we published: nothing to report.
    expect((await check(target)).found).toBe(0)

    // Google then changes it: ours is the value we last published.
    target.location.title = "Crown Pub"
    const after = await check(target)
    expect(after.found).toBe(1)
    expect(after.changes[0]).toMatchObject({
      field: "name",
      ours: { field: "name", value: "The Old Crown, Girton" },
      google: { field: "name", value: "Crown Pub" },
    })
  }, 60_000)

  it("refuses to publish a put-back change set once Google moved past its baseline", async () => {
    const target = await listing()
    const change = await detected(
      target,
      (location) => {
        location.title = "Old Crown Inn"
      },
      "name"
    )
    const reverted = await decide(target, change, "put_ours_back")
    expect(reverted.status, await reverted.clone().text()).toBe(200)
    const revert = googleChangeDecisionResponseSchema.parse(
      await reverted.json()
    ).change.revert
    if (revert?.kind !== "change_set") throw new Error("expected a change set")
    const changeSet = revert.changeSet
    const url = `${target.base}/business-information`
    const approved = await send(target.owner.cookie, "POST", url, {
      changeSetId: changeSet.id,
      expectedPayloadHash: changeSet.payloadHash,
    })
    expect(approved.status, await approved.clone().text()).toBe(200)

    // Google changed again after the change set was made.
    target.location.title = "Crown & Anchor"
    const published = await send(target.owner.cookie, "PATCH", url, {
      operation: "update_location",
      confirmation: "publish_business_information_to_google",
      changeSetId: changeSet.id,
      payload: changeSet.payload,
      updateMask: changeSet.updateMask,
      expectedGoogleHash: changeSet.baselineHash,
    })
    expect(published.status, await published.clone().text()).toBe(409)
    expect(["business_information_stale", "approval_stale"]).toContain(
      ((await published.json()) as { error: string }).error
    )
    expect(target.writes).toHaveLength(0)
    expect(target.location.title).toBe("Crown & Anchor")
  }, 60_000)

  it("raises nothing for hours that differ only by 24:00 against 00:00 the next day", async () => {
    const target = await listing({
      hours: [period("FRIDAY", 18, { hours: 24 })],
    })
    expect((await check(target)).found).toBe(0)

    target.location.regularHours = {
      periods: [period("FRIDAY", 18, {}, "SATURDAY")],
    }
    const midnight = await check(target)
    expect(midnight.found).toBe(0)
    expect(midnight.changes).toEqual([])

    // A real change on the same day is still caught.
    target.location.regularHours = {
      periods: [period("FRIDAY", 18, { hours: 23 })],
    }
    const real = await check(target)
    expect(real.found).toBe(1)
    expect(real.changes[0]).toMatchObject({
      field: "regularHours",
      status: "open",
      regularDays: [5],
      specialDates: [],
    })
    expect(googlePatches()).toHaveLength(0)
  }, 30_000)

  it("parks putting hours back for a second person under two-person approval", async () => {
    const target = await listing({ twoPerson: true, feature: true })
    const change = await detected(
      target,
      (location) => {
        location.regularHours = {
          periods: [
            period("FRIDAY", 12, { hours: 22 }),
            period("SATURDAY", 12, { hours: 23 }),
          ],
        }
      },
      "regularHours"
    )
    expect(change.regularDays).toEqual([5])

    const reverted = await decide(target, change, "put_ours_back")
    expect(reverted.status, await reverted.clone().text()).toBe(200)
    const body = googleChangeDecisionResponseSchema.parse(await reverted.json())
    expect(body.outcome).toBe("awaiting_approval")
    expect(body.change.status).toBe("reverting")
    expect(body.change.revert).toMatchObject({ kind: "change_request" })
    if (body.change.revert?.kind !== "change_request") {
      throw new Error("expected a change request")
    }
    const [operation] = await admin<{ kind: string | null }[]>`
      select change_request ->> 'kind' as kind from mutation_operation
      where id = ${body.change.revert.operationId}
    `
    expect(operation?.kind).toBe("hours_publish")
    expect(googlePatches()).toHaveLength(0)
  }, 60_000)

  it("publishes hours straight back without two-person approval", async () => {
    const target = await listing()
    const change = await detected(
      target,
      (location) => {
        location.regularHours = {
          periods: [
            period("FRIDAY", 12, { hours: 22 }),
            period("SATURDAY", 12, { hours: 23 }),
          ],
        }
      },
      "regularHours"
    )

    const reverted = await decide(target, change, "put_ours_back")
    expect(reverted.status, await reverted.clone().text()).toBe(200)
    const body = googleChangeDecisionResponseSchema.parse(await reverted.json())
    expect(body.outcome).toBe("published")
    expect(body.change).toMatchObject({
      status: "resolved",
      resolution: "published",
    })
    const friday = normalizeGoogleHours(target.location as GoogleLocationHours)
      .regular[5]
    expect(friday.periods).toMatchObject([
      { opensAt: "12:00", closesAt: "23:00" },
    ])
    expect(
      (await incidentFor(target.linked.locationId, change.id))[0]?.status
    ).toBe("resolved")
    expect((await check(target)).found).toBe(0)
  }, 60_000)

  it("raises the alert from the presence sweep, without anyone pressing Check", async () => {
    const target = await listing()
    // Baselines from a first check, as an operator's first look sets them.
    expect((await check(target)).found).toBe(0)
    const { organisationId } = target.owner
    // Only the watched listing is due, so the page walks just that one.
    await admin`
      insert into presence_resource_reconcile_state (
        organisation_id, location_id, resource, status, next_attempt_at
      )
      select ${organisationId}, l.id, r.resource, 'succeeded', now() + interval '1 hour'
      from location l
      cross join unnest(array['hours', 'profile', 'posts', 'media', 'foodMenus', 'placeActions']) as r(resource)
      where l.organisation_id = ${organisationId} and l.id <> ${target.linked.locationId}
    `
    target.location.title = "Old Crown Inn"
    const [before] = await admin<{ id: string }[]>`
      select organisation_id::text as id from organisation_job_route
      where organisation_id < ${organisationId}
      order by organisation_id desc limit 1`
    const response = await fetch(
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
          ...(before ? { organisationCursor: before.id } : {}),
        }),
      }
    )
    expect(response.status, await response.clone().text()).toBe(200)
    const swept = (await response.json()) as {
      outcomes: { locationId: string; resource: string; status: string }[]
    }
    expect(
      swept.outcomes
        .filter(
          (outcome) =>
            outcome.locationId === target.linked.locationId &&
            (outcome.resource === "profile" || outcome.resource === "hours")
        )
        .map((outcome) => outcome.status)
    ).toEqual(["succeeded", "succeeded"])
    const rows = await changeRows(target.linked.locationId)
    expect(rows).toMatchObject([{ field: "name", status: "open" }])
    const [incident] = await incidentFor(target.linked.locationId, rows[0]!.id)
    expect(incident).toMatchObject({
      status: "open",
      recipients: [target.owner.userId],
    })
  }, 60_000)

  it("names the alert only to a client that reads the Google change kind", async () => {
    const target = await listing()
    await detected(
      target,
      (location) => {
        location.title = "Old Crown Inn"
      },
      "name"
    )
    const kinds = async (path: string, capabilities: string) => {
      const response = await fetch(`${server.baseUrl}${path}`, {
        headers: {
          cookie: target.owner.cookie,
          ...(capabilities
            ? { [CLIENT_CAPABILITIES_HEADER]: capabilities }
            : {}),
        },
      })
      expect(response.status, await response.clone().text()).toBe(200)
      const body = (await response.json()) as {
        items?: { kind: string }[]
        preferences?: { kind: string }[]
        notifications?: { items: { kind: string }[] }
      }
      const rows =
        body.items ?? body.preferences ?? body.notifications?.items ?? []
      return rows.some((row) => row.kind === "listing_google_changed")
    }
    const current = clientCapabilityHeaders()[CLIENT_CAPABILITIES_HEADER]!
    for (const path of [
      "/api/notifications",
      "/api/notifications/preferences",
      "/api/shell-status",
    ]) {
      // This build: it reads the kind.
      expect(await kinds(path, current), path).toBe(true)
      // A build that reads the approval kinds (0149) but not this one.
      expect(await kinds(path, "notification-kinds-2"), path).toBe(false)
      // A build from before both.
      expect(await kinds(path, ""), path).toBe(false)
    }
  }, 60_000)
})

function send(cookie: string, method: string, url: string, body: unknown) {
  return fetch(url, {
    method,
    headers: {
      cookie,
      "content-type": "application/json",
      "x-request-id": `google-watch-${randomUUID()}`,
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify(body),
  })
}
