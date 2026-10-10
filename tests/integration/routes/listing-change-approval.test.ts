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
 * booking links: with the organisation's policy and feature on, a
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
      GBP_PLACE_ACTIONS_ENABLED: "true",
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
    const links: Array<Record<string, unknown>> = []
    google.respond(
      { method: "GET", pathIncludes: "/placeActionLinks/" },
      (call) => ({
        status: 200,
        json: links.find((link) => call.path.endsWith(String(link.name))) ?? {},
      })
    )
    google.respond(
      { method: "GET", pathIncludes: "/placeActionLinks" },
      () => ({
        status: 200,
        json: { placeActionLinks: links },
      })
    )
    google.respond(
      { method: "POST", pathIncludes: "/placeActionLinks" },
      (call) => {
        const created = {
          name: `${linked.googleLocationName}/placeActionLinks/merchant-${links.length}`,
          providerType: "MERCHANT",
          isEditable: true,
          ...(call.body as Record<string, unknown>),
          createTime: "2026-10-10T10:00:00Z",
          updateTime: "2026-10-10T10:00:00Z",
        }
        links.push(created)
        return { status: 200, json: created }
      }
    )
    const base = `${server.baseUrl}/api/locations/${linked.locationId}`
    return { owner, second, linked, base }
  }

  const createBody = (uri = "https://book.example.com/two-person") => ({
    confirmation: "create_google_place_action",
    uri,
    placeActionType: "DINING_RESERVATION",
    isPreferred: false,
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
      (call) => call.method !== "GET" && call.path.includes("placeActionLinks")
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
      `${base}/place-actions`,
      createBody(),
      intentId
    )
    expect(parked.status, await parked.clone().text()).toBe(202)
    const parkedBody = await parked.json()
    expect(parkedBody).toMatchObject({
      status: "awaiting_approval",
      changeRequest: {
        kind: "place_action_create",
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
      `${base}/place-actions`,
      createBody(),
      intentId
    )
    expect(replay.status).toBe(202)
    expect((await replay.json()).changeRequest.id).toBe(changeId)
    const conflict = await send(
      owner.cookie,
      "POST",
      `${base}/place-actions`,
      createBody("https://book.example.com/other"),
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
      uri: "https://book.example.com/two-person",
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
      await send(owner.cookie, "POST", `${base}/place-actions`, createBody())
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
      await send(owner.cookie, "POST", `${base}/place-actions`, createBody())
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

    const older = await (
      await send(
        owner.cookie,
        "POST",
        `${base}/place-actions`,
        createBody("https://book.example.com/a")
      )
    ).json()
    const newer = await (
      await send(
        owner.cookie,
        "POST",
        `${base}/place-actions`,
        createBody("https://book.example.com/b")
      )
    ).json()
    expect(await stored(older.changeRequest.id)).toMatchObject({
      state: "failed",
      errorCode: "approval_superseded",
    })
    expect(await stored(newer.changeRequest.id)).toMatchObject({
      state: "awaiting_approval",
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
    // The author's update names a link and a Google hash that no longer hold.
    google.respond(
      { method: "PATCH", pathIncludes: "/placeActionLinks/" },
      () => ({
        status: 200,
        json: {},
      })
    )
    const seededId = randomUUID()
    const parked = await send(
      owner.cookie,
      "PATCH",
      `${base}/place-actions/${seededId}`,
      {
        confirmation: "update_google_place_action",
        uri: "https://book.example.com/stale",
        placeActionType: "DINING_RESERVATION",
        isPreferred: false,
        expectedGoogleHash: "0".repeat(64),
      }
    )
    expect(parked.status, await parked.clone().text()).toBe(202)
    const change = (await parked.json()).changeRequest
    expect(change).toMatchObject({
      kind: "place_action_update",
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
        `${base}/place-actions`,
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
})
