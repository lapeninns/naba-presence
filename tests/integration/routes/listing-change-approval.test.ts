import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedReview,
  seedMemberUser,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

/**
 * Two-person approval for direct listing writes (plan P02-S2b), exercised on
 * photos added by web address: with the organisation's policy and feature on, a
 * publisher's write parks as a frozen change request and nothing reaches
 * Google until a different publisher approves that exact request; policy or
 * feature off, the write goes straight out as before.
 */
describeDatabase("listing writes - two-person change approval", () => {
  let admin: ReturnType<typeof postgres>
  let google: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    google = await startGoogleStub()
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: google.baseUrl,
      GBP_MEDIA_ENABLED: "true",
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

  async function tenant(options: { twoPerson: boolean; feature: boolean }) {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    await admin`
      update organisation
      set require_two_person_approval = ${options.twoPerson}
      where id = ${owner.organisationId}
    `
    if (options.feature) {
      await admin`
        insert into organisation_feature (organisation_id, feature, enabled, changed_by)
        values (${owner.organisationId}, 'listing_change_approvals', true, 'test')
      `
    }
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const linked = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    const second = await seedMemberUser(admin, {
      organisationId: owner.organisationId,
      role: "member",
      canPublish: true,
    })
    const parent = `${connection.googleAccountName}/${linked.googleLocationName}`
    const items: Array<Record<string, unknown>> = []
    google.respond({ method: "GET", pathIncludes: "/media?" }, () => ({
      status: 200,
      json: { mediaItems: items },
    }))
    google.respond({ method: "GET", pathIncludes: "/media/merchant-" }, (call) => ({
      status: 200,
      json: items.find((item) => call.path.endsWith(String(item.name))) ?? {},
    }))
    google.respond({ method: "POST", pathIncludes: "/media" }, (call) => {
      const created = {
        name: `${parent}/media/merchant-${items.length}`,
        ...(call.body as Record<string, unknown>),
        googleUrl: `https://google.example/merchant-${items.length}.jpg`,
        createTime: "2026-10-10T10:00:00Z",
      }
      items.push(created)
      return { status: 200, json: created }
    })
    const base = `${server.baseUrl}/api/locations/${linked.locationId}`
    return { owner, second, linked, base, parent }
  }

  const createBody = (
    sourceUrl = "https://images.example.com/two-person.jpg"
  ) => ({
    confirmation: "create_google_media",
    mediaFormat: "PHOTO",
    category: "INTERIOR",
    sourceUrl,
  })

  function send(
    cookie: string,
    method: string,
    url: string,
    body: unknown,
    intentId: string = randomUUID()
  ) {
    return fetch(url, {
      method,
      headers: {
        cookie,
        "content-type": "application/json",
        "Idempotency-Key": intentId,
      },
      body: JSON.stringify(body),
    })
  }

  const googleWrites = () =>
    google.calls.filter(
      (call) => call.method !== "GET" && call.path.includes("/media")
    )

  async function stored(id: string) {
    const [row] = await admin<
      {
        state: string
        errorCode: string | null
        approvalRef: string | null
        attemptId: string | null
      }[]
    >`
      select state, error_code as "errorCode", approval_ref as "approvalRef",
             attempt_id::text as "attemptId"
      from mutation_operation where id = ${id}
    `
    return row
  }

  it("parks a publisher's write and sends it only on a second publisher's approval of that request", async () => {
    const { owner, second, base } = await tenant({
      twoPerson: true,
      feature: true,
    })

    const intentId = randomUUID()
    const parked = await send(
      owner.cookie,
      "POST",
      `${base}/media`,
      createBody(),
      intentId
    )
    expect(parked.status, await parked.clone().text()).toBe(202)
    const parkedBody = await parked.json()
    expect(parkedBody).toMatchObject({
      status: "awaiting_approval",
      changeRequest: {
        kind: "media_create",
        isOwn: true,
        outcome: "awaiting_approval",
      },
      operation: { outcome: "awaiting_approval" },
    })
    const changeId = parkedBody.changeRequest.id as string
    const payloadHash = parkedBody.changeRequest.payloadHash as string
    expect(googleWrites()).toHaveLength(0)

    // The same intent answers with the same request; other content under it is a conflict.
    const replay = await send(
      owner.cookie,
      "POST",
      `${base}/media`,
      createBody(),
      intentId
    )
    expect(replay.status).toBe(202)
    expect((await replay.json()).changeRequest.id).toBe(changeId)
    const conflict = await send(
      owner.cookie,
      "POST",
      `${base}/media`,
      createBody("https://images.example.com/other.jpg"),
      intentId
    )
    expect(conflict.status).toBe(409)
    expect((await conflict.json()).error).toBe("intent_conflict")

    // The receipt answers for the parked request like any other write.
    const receipt = await fetch(`${server.baseUrl}/api/mutations/${intentId}`, {
      headers: { cookie: owner.cookie },
    })
    expect((await receipt.json()).operation).toMatchObject({
      id: changeId,
      outcome: "awaiting_approval",
    })

    // Listed for both; only the second publisher may decide.
    const ownerList = await (
      await fetch(`${base}/change-requests`, {
        headers: { cookie: owner.cookie },
      })
    ).json()
    expect(ownerList.changeRequests).toMatchObject([
      { id: changeId, isOwn: true, canDecide: false },
    ])
    const secondList = await (
      await fetch(`${base}/change-requests`, {
        headers: { cookie: second.cookie },
      })
    ).json()
    expect(secondList.changeRequests).toMatchObject([
      { id: changeId, isOwn: false, canDecide: true },
    ])

    const self = await send(
      owner.cookie,
      "POST",
      `${base}/change-requests/${changeId}`,
      {
        decision: "approve",
        payloadHash,
      }
    )
    expect(self.status).toBe(403)
    expect((await self.json()).error).toBe("listing_second_approver_required")

    const wrongHash = await send(
      second.cookie,
      "POST",
      `${base}/change-requests/${changeId}`,
      {
        decision: "approve",
        payloadHash: "0".repeat(64),
      }
    )
    expect(wrongHash.status).toBe(409)
    expect((await wrongHash.json()).error).toBe("change_request_changed")
    expect(googleWrites()).toHaveLength(0)

    const approve = await send(
      second.cookie,
      "POST",
      `${base}/change-requests/${changeId}`,
      {
        decision: "approve",
        payloadHash,
      }
    )
    expect(approve.status, await approve.clone().text()).toBe(200)
    const approved = await approve.json()
    expect(["confirmed_applied", "awaiting_confirmation"]).toContain(
      approved.operation.outcome
    )
    expect(googleWrites()).toHaveLength(1)
    expect(googleWrites()[0]?.body).toMatchObject({
      sourceUrl: "https://images.example.com/two-person.jpg",
    })

    const row = await stored(changeId)
    expect(row?.attemptId).not.toBeNull()
    const [decision] = await admin<
      { decidedBy: string; requestedBy: string; decision: string }[]
    >`
      select decided_by::text as "decidedBy", requested_by::text as "requestedBy", decision
      from mutation_approval_decision where operation_id = ${changeId}
    `
    expect(decision).toEqual({
      decidedBy: second.userId,
      requestedBy: owner.userId,
      decision: "approved",
    })
    expect(row?.approvalRef).not.toBeNull()

    // Spent: a second approval sends nothing.
    const again = await send(
      second.cookie,
      "POST",
      `${base}/change-requests/${changeId}`,
      {
        decision: "approve",
        payloadHash,
      }
    )
    expect(again.status).toBe(409)
    expect((await again.json()).error).toBe("change_request_not_pending")
    expect(googleWrites()).toHaveLength(1)
  }, 60_000)

  it("rejects, withdraws and supersedes without sending anything", async () => {
    const { owner, second, base } = await tenant({
      twoPerson: true,
      feature: true,
    })

    const first = await (
      await send(owner.cookie, "POST", `${base}/media`, createBody())
    ).json()
    const rejected = await send(
      second.cookie,
      "POST",
      `${base}/change-requests/${first.changeRequest.id}`,
      {
        decision: "reject",
        payloadHash: first.changeRequest.payloadHash,
      }
    )
    expect(rejected.status, await rejected.clone().text()).toBe(200)
    expect(await stored(first.changeRequest.id)).toMatchObject({
      state: "failed",
      errorCode: "approval_rejected",
    })

    const mine = await (
      await send(owner.cookie, "POST", `${base}/media`, createBody())
    ).json()
    const withdrawn = await send(
      owner.cookie,
      "POST",
      `${base}/change-requests/${mine.changeRequest.id}`,
      {
        decision: "reject",
        payloadHash: mine.changeRequest.payloadHash,
      }
    )
    expect(withdrawn.status).toBe(200)
    expect(await stored(mine.changeRequest.id)).toMatchObject({
      state: "failed",
      errorCode: "approval_withdrawn",
    })

    // Two different creates are two photos: both stay pending.
    const bookA = await (
      await send(
        owner.cookie,
        "POST",
        `${base}/media`,
        createBody("https://images.example.com/a.jpg")
      )
    ).json()
    const bookB = await (
      await send(
        owner.cookie,
        "POST",
        `${base}/media`,
        createBody("https://images.example.com/b.jpg")
      )
    ).json()
    expect(await stored(bookA.changeRequest.id)).toMatchObject({
      state: "awaiting_approval",
    })
    expect(await stored(bookB.changeRequest.id)).toMatchObject({
      state: "awaiting_approval",
    })
    // The same create again replaces the identical pending one.
    const bookAAgain = await (
      await send(
        owner.cookie,
        "POST",
        `${base}/media`,
        createBody("https://images.example.com/a.jpg")
      )
    ).json()
    expect(await stored(bookA.changeRequest.id)).toMatchObject({
      state: "failed",
      errorCode: "approval_superseded",
    })
    // A newer change to the same photo supersedes the older one.
    const mediaId = randomUUID()
    const updateBody = (category: string) => ({
      confirmation: "update_google_media",
      category,
      expectedGoogleHash: "0".repeat(64),
    })
    const olderUpdate = await (
      await send(
        owner.cookie,
        "PATCH",
        `${base}/media/${mediaId}`,
        updateBody("EXTERIOR")
      )
    ).json()
    const newerUpdate = await (
      await send(
        owner.cookie,
        "PATCH",
        `${base}/media/${mediaId}`,
        updateBody("FOOD_AND_DRINK")
      )
    ).json()
    expect(await stored(olderUpdate.changeRequest.id)).toMatchObject({
      state: "failed",
      errorCode: "approval_superseded",
    })
    expect(await stored(newerUpdate.changeRequest.id)).toMatchObject({
      state: "awaiting_approval",
    })
    const list = await (
      await fetch(`${base}/change-requests`, {
        headers: { cookie: second.cookie },
      })
    ).json()
    expect(
      list.changeRequests.map((change: { id: string }) => change.id).sort()
    ).toEqual(
      [
        bookB.changeRequest.id,
        bookAAgain.changeRequest.id,
        newerUpdate.changeRequest.id,
      ].sort()
    )
    // The approver reads the values each request sends.
    const shown = list.changeRequests.find(
      (change: { id: string }) => change.id === bookB.changeRequest.id
    )
    expect(shown.details).toContainEqual({
      label: "Source web address",
      value: "https://images.example.com/b.jpg",
    })

    // A retry of a decided intent says how it ended, never "sent for approval".
    const intentId = randomUUID()
    const doomed = await (
      await send(
        owner.cookie,
        "POST",
        `${base}/media`,
        createBody("https://images.example.com/e.jpg"),
        intentId
      )
    ).json()
    await send(
      second.cookie,
      "POST",
      `${base}/change-requests/${doomed.changeRequest.id}`,
      { decision: "reject", payloadHash: doomed.changeRequest.payloadHash }
    )
    const retried = await send(
      owner.cookie,
      "POST",
      `${base}/media`,
      createBody("https://images.example.com/e.jpg"),
      intentId
    )
    expect(retried.status).toBe(409)
    expect(await retried.json()).toMatchObject({
      error: "approval_rejected",
      details: { outcome: "failed" },
    })
    expect(googleWrites()).toHaveLength(0)
  }, 60_000)

  // Nothing is checked against Google when a request parks; the surface's own
  // checks run at dispatch, against what holds then, and a refusal there
  // settles the request with the surface's code and sends nothing.
  it("refuses at dispatch a request the surface no longer accepts, and records why", async () => {
    const { owner, second, base } = await tenant({
      twoPerson: true,
      feature: true,
    })
    // The author's update names a photo and a Google hash that no longer hold.
    google.respond({ method: "PATCH", pathIncludes: "/media/" }, () => ({
      status: 200,
      json: {},
    }))
    const seededId = randomUUID()
    const parked = await send(
      owner.cookie,
      "PATCH",
      `${base}/media/${seededId}`,
      {
        confirmation: "update_google_media",
        category: "EXTERIOR",
        expectedGoogleHash: "0".repeat(64),
      }
    )
    expect(parked.status, await parked.clone().text()).toBe(202)
    const change = (await parked.json()).changeRequest
    expect(change).toMatchObject({
      kind: "media_update",
      target: seededId,
    })

    const approve = await send(
      second.cookie,
      "POST",
      `${base}/change-requests/${change.id}`,
      {
        decision: "approve",
        payloadHash: change.payloadHash,
      }
    )
    expect(approve.status).toBeGreaterThanOrEqual(400)
    expect(approve.status).toBeLessThan(500)
    const row = await stored(change.id)
    expect(row?.state).toBe("failed")
    expect(row?.errorCode).toBe((await approve.json()).error)
    expect(google.calls.filter((call) => call.method === "PATCH")).toHaveLength(
      0
    )
  }, 60_000)

  it.each([
    { twoPerson: true, feature: false },
    { twoPerson: false, feature: true },
  ])(
    "sends straight to Google when %o",
    async (options) => {
      const { owner, base } = await tenant(options)
      const created = await send(
        owner.cookie,
        "POST",
        `${base}/media`,
        createBody()
      )
      expect(created.status, await created.clone().text()).toBe(201)
      expect(await created.json()).toMatchObject({ status: "succeeded" })
      expect(googleWrites()).toHaveLength(1)
      const list = await (
        await fetch(`${base}/change-requests`, {
          headers: { cookie: owner.cookie },
        })
      ).json()
      expect(list.changeRequests).toEqual([])
    },
    60_000
  )

  it("requires the authoring route's roles of a decider", async () => {
    const { owner, second, base } = await tenant({
      twoPerson: true,
      feature: true,
    })
    // A profile publish is an owner/admin write (its route's roles).
    const parked = await send(owner.cookie, "POST", `${base}/profile`, {
      direction: "to_google",
      confirmation: "publish_nabapresence_profile_to_google",
      selectedFields: ["name"],
      expectedCanonicalRevision: "1",
      expectedCanonicalHash: "0".repeat(64),
      expectedGoogleHash: "0".repeat(64),
    })
    expect(parked.status, await parked.clone().text()).toBe(202)
    const change = (await parked.json()).changeRequest
    expect(change.details).toContainEqual({
      label: "Saved version",
      value: "1",
    })

    // A member publisher may not make this write, so may not approve it.
    const list = await (
      await fetch(`${base}/change-requests`, {
        headers: { cookie: second.cookie },
      })
    ).json()
    expect(list.changeRequests).toMatchObject([
      { id: change.id, canDecide: false },
    ])
    for (const decision of ["approve", "reject"]) {
      const refused = await send(
        second.cookie,
        "POST",
        `${base}/change-requests/${change.id}`,
        { decision, payloadHash: change.payloadHash }
      )
      expect(refused.status).toBe(403)
      expect((await refused.json()).error).toBe("permission_denied")
    }
    const decisions = await admin`
      select 1 from mutation_approval_decision where operation_id = ${change.id}
    `
    expect(decisions).toHaveLength(0)
    expect(await stored(change.id)).toMatchObject({
      state: "awaiting_approval",
    })
  }, 60_000)

  it("refuses an upload while approval applies", async () => {
    const { owner, base } = await tenant({ twoPerson: true, feature: true })
    const form = new FormData()
    form.set(
      "file",
      new File([new Uint8Array([1, 2, 3])], "a.jpg", { type: "image/jpeg" })
    )
    form.set("mediaFormat", "PHOTO")
    form.set("category", "INTERIOR")
    form.set("confirmation", "create_google_media")
    const refused = await fetch(`${base}/media`, {
      method: "POST",
      headers: { cookie: owner.cookie, "Idempotency-Key": randomUUID() },
      body: form,
    })
    expect(refused.status).toBe(409)
    expect((await refused.json()).error).toBe(
      "listing_change_upload_unsupported"
    )
    expect(google.calls.filter((call) => call.method !== "GET")).toHaveLength(0)
  }, 60_000)

  it("settles an approval interrupted before its dispatch claimed an attempt", async () => {
    const { owner, second, base } = await tenant({
      twoPerson: true,
      feature: true,
    })
    const parked = await (
      await send(owner.cookie, "POST", `${base}/media`, createBody())
    ).json()
    // What a killed approval leaves: decided and `sent`, nothing linked.
    await admin`
      update mutation_operation
      set state = 'sent', receipt = '{"dispatchIntentId":"x"}'::jsonb,
        updated_at = now() - interval '10 minutes'
      where id = ${parked.changeRequest.id}
    `
    const receipt = await fetch(
      `${server.baseUrl}/api/mutations/${parked.changeRequest.id}`,
      { headers: { cookie: second.cookie } }
    )
    expect((await receipt.json()).operation).toMatchObject({
      outcome: "failed",
      errorCode: "approval_dispatch_interrupted",
    })
  }, 60_000)

  it("links the request to its dispatch attempt before anything is sent", async () => {
    const { owner, second, base, parent } = await tenant({
      twoPerson: true,
      feature: true,
    })
    const parked = await (
      await send(owner.cookie, "POST", `${base}/media`, createBody())
    ).json()
    // Google holds the create open, so the state while it is in flight --
    // what an approval killed now would leave -- can be read. The readback
    // then finds the item the create named, so the approval settles applied.
    const slow = {
      name: `${parent}/media/merchant-slow`,
      mediaFormat: "PHOTO",
      locationAssociation: { category: "INTERIOR" },
      googleUrl: "https://google.example/merchant-slow.jpg",
    }
    google.respond({ method: "POST", pathIncludes: "/media" }, (call) => ({
      status: 200,
      delayMs: 2_000,
      json: { ...slow, ...(call.body as Record<string, unknown>) },
    }))
    google.respond(
      { method: "GET", pathIncludes: "/media/merchant-slow" },
      () => ({ status: 200, json: slow })
    )
    const approving = send(
      second.cookie,
      "POST",
      `${base}/change-requests/${parked.changeRequest.id}`,
      { decision: "approve", payloadHash: parked.changeRequest.payloadHash }
    )
    const deadline = Date.now() + 20_000
    while (googleWrites().length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(googleWrites()).toHaveLength(1)
    const [inFlight] = await admin<
      {
        attemptId: string | null
        state: string
        dispatchAttempt: string | null
      }[]
    >`
      select c.attempt_id::text as "attemptId", c.state,
        d.attempt_id::text as "dispatchAttempt"
      from mutation_operation c
      join mutation_operation d
        on d.organisation_id = c.organisation_id
       and d.intent_id::text = c.receipt ->> 'dispatchIntentId'
      where c.id = ${parked.changeRequest.id}
    `
    expect(inFlight?.state).toBe("sent")
    expect(inFlight?.attemptId).not.toBeNull()
    expect(inFlight?.attemptId).toBe(inFlight?.dispatchAttempt)
    expect((await approving).status).toBe(200)
  }, 60_000)

  it("refuses an approval of a paused surface before recording a decision", async () => {
    const { owner, second, base } = await tenant({
      twoPerson: true,
      feature: true,
    })
    const paused = await startAppServer({
      GOOGLE_API_PROXY_BASE: google.baseUrl,
      GBP_MEDIA_ENABLED: "false",
      PUBLISH_ENABLED: "true",
    })
    try {
      const pausedBase = base.replace(server.baseUrl, paused.baseUrl)
      const parked = await (
        await send(
          owner.cookie,
          "POST",
          `${pausedBase}/media`,
          createBody()
        )
      ).json()
      const refused = await send(
        second.cookie,
        "POST",
        `${pausedBase}/change-requests/${parked.changeRequest.id}`,
        { decision: "approve", payloadHash: parked.changeRequest.payloadHash }
      )
      expect(refused.status).toBe(503)
      const decisions = await admin`
        select 1 from mutation_approval_decision
        where operation_id = ${parked.changeRequest.id}
      `
      expect(decisions).toHaveLength(0)
      expect(await stored(parked.changeRequest.id)).toMatchObject({
        state: "awaiting_approval",
      })
      expect(googleWrites()).toHaveLength(0)
    } finally {
      await paused.stop()
    }
  }, 60_000)
})
