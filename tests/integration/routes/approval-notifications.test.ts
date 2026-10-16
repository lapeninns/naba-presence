import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  notificationListResponseSchema,
  notificationPreferencesResponseSchema,
} from "@/lib/contracts/operational-notifications"

import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  saveHumanDraft,
  seedGoogleConnection,
  seedLinkedLocation,
  seedLinkedReview,
  seedMemberUser,
} from "../helpers/tenant"

const describeDatabase =
  process.env.RUN_DB_TESTS === "true" ? describe : describe.skip
const CRON = { authorization: "Bearer route-harness-cron-secret" }

/**
 * INB-05 (D2, 0149): a reply parked for approval tells the people who could
 * approve it, and a reply sent back tells the person who asked. Nobody else
 * sees either, owners included.
 */
describeDatabase("approval notifications", { timeout: 60_000 }, () => {
  let admin: ReturnType<typeof postgres>
  let stub: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 2 })
    stub = await startGoogleStub()
    server = await startAppServer({ GOOGLE_API_PROXY_BASE: stub.baseUrl })
  })
  afterAll(async () => {
    await server.stop()
    await stub.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  const api = (cookie: string, path: string, init: RequestInit = {}) =>
    fetch(`${server.baseUrl}${path}`, {
      ...init,
      headers: { cookie, "content-type": "application/json" },
    })

  async function fixture() {
    stub.reset()
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const { organisationId } = owner
    const connection = await seedGoogleConnection(admin, { organisationId })
    const review = await seedLinkedReview(admin, {
      organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    const elsewhere = await seedLinkedLocation(admin, {
      organisationId,
      ...connection,
    })
    const draft = await saveHumanDraft(
      server.baseUrl,
      owner.cookie,
      review.reviewId,
      "Thank you for sharing your experience."
    )
    const people = {
      requester: await seedMemberUser(admin, { organisationId }),
      publisher: await seedMemberUser(admin, {
        organisationId,
        canPublish: true,
      }),
      assignedPublisher: await seedMemberUser(admin, {
        organisationId,
        canPublish: true,
        assignLocationId: review.locationId,
      }),
      otherLocationPublisher: await seedMemberUser(admin, {
        organisationId,
        canPublish: true,
        assignLocationId: elsewhere.locationId,
      }),
      editor: await seedMemberUser(admin, { organisationId }),
      viewer: await seedMemberUser(admin, { organisationId, role: "viewer" }),
    }
    return { owner, review, draft, people }
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>

  const publish = (f: Fixture, cookie: string) =>
    api(cookie, `/api/reviews/${f.review.reviewId}/publish`, {
      method: "POST",
      body: JSON.stringify({
        draftId: f.draft.draftId,
        expectedReviewUpdateTime: f.draft.expectedReviewUpdateTime,
      }),
    })
  const decide = (f: Fixture, cookie: string, decision: "approve" | "reject") =>
    api(cookie, `/api/reviews/${f.review.reviewId}/approval`, {
      method: "POST",
      body: JSON.stringify({ decision }),
    })
  async function list(cookie: string) {
    const response = await api(cookie, "/api/notifications?filter=all")
    expect(response.status, await response.clone().text()).toBe(200)
    return notificationListResponseSchema.parse(await response.json())
  }
  const kinds = async (cookie: string) =>
    (await list(cookie)).items
      .filter((item) =>
        ["approval_requested", "reply_sent_back"].includes(item.kind)
      )
      .map((item) => `${item.kind}:${item.status}`)
  const incidents = (f: Fixture) =>
    admin<{ kind: string; status: string; recipients: string[] | null }[]>`
      select i.kind, i.status,
        (select array_agg(nr.user_id::text order by nr.user_id) from notification_incident_recipient nr
          where nr.incident_id = i.id) as recipients
      from notification_incident i
      where i.organisation_id = ${f.owner.organisationId}
        and i.kind in ('approval_requested', 'reply_sent_back')
      order by i.opened_at, i.kind`

  it("tells everyone who could approve a parked reply, and nobody else", async () => {
    const f = await fixture()
    expect((await publish(f, f.people.requester.cookie)).status).toBe(202)

    const [request] = await incidents(f)
    expect(request.kind).toBe("approval_requested")
    expect(request.status).toBe("open")
    expect(request.recipients).toEqual(
      [
        f.owner.userId,
        f.people.publisher.userId,
        f.people.assignedPublisher.userId,
      ].sort()
    )

    const page = await list(f.owner.cookie)
    const item = page.items.find((row) => row.kind === "approval_requested")!
    expect(item.locationId).toBe(f.review.locationId)
    expect(item.summary.reviewId).toBe(f.review.reviewId)
    // It clears when the reply is decided, not by a person.
    expect(item.canResolve).toBe(false)
    expect(page.unreadCount).toBeGreaterThanOrEqual(1)
    expect(await kinds(f.people.publisher.cookie)).toEqual([
      "approval_requested:open",
    ])
    expect(await kinds(f.people.assignedPublisher.cookie)).toEqual([
      "approval_requested:open",
    ])
    for (const person of [
      f.people.requester,
      f.people.otherLocationPublisher,
      f.people.editor,
      f.people.viewer,
    ]) {
      expect(await kinds(person.cookie)).toEqual([])
    }
  })

  it("closes the request on a send-back and tells only the person who asked", async () => {
    const f = await fixture()
    expect((await publish(f, f.people.requester.cookie)).status).toBe(202)
    expect((await decide(f, f.owner.cookie, "reject")).status).toBe(200)

    const [request, sentBack] = await incidents(f)
    expect(request).toMatchObject({
      kind: "approval_requested",
      status: "resolved",
    })
    expect(sentBack).toEqual({
      kind: "reply_sent_back",
      status: "open",
      recipients: [f.people.requester.userId],
    })
    expect(await kinds(f.people.requester.cookie)).toEqual([
      "reply_sent_back:open",
    ])
    // The owner decided it; the send-back is not theirs to read.
    expect(await kinds(f.owner.cookie)).toEqual(["approval_requested:resolved"])

    // Submitting again answers the send-back and asks the approvers anew.
    expect((await publish(f, f.people.requester.cookie)).status).toBe(202)
    const after = await incidents(f)
    expect(after.map((row) => `${row.kind}:${row.status}`)).toEqual([
      "approval_requested:resolved",
      "reply_sent_back:resolved",
      "approval_requested:open",
    ])
  })

  it("closes the request when it is approved, and sends nothing back", async () => {
    const f = await fixture()
    expect((await publish(f, f.people.requester.cookie)).status).toBe(202)
    expect((await decide(f, f.owner.cookie, "approve")).status).toBe(200)
    expect(
      (await incidents(f)).map((row) => `${row.kind}:${row.status}`)
    ).toEqual(["approval_requested:resolved"])
  })

  it("never asks the requester or the draft's author under two-person approval", async () => {
    const f = await fixture()
    await admin`
      update organisation set require_two_person_approval = true
      where id = ${f.owner.organisationId}`
    // The owner wrote the draft and asks; their own approval would not count.
    expect((await publish(f, f.owner.cookie)).status).toBe(202)
    const [request] = await incidents(f)
    expect(request.recipients).toEqual(
      [f.people.publisher.userId, f.people.assignedPublisher.userId].sort()
    )
    expect(await kinds(f.owner.cookie)).toEqual([])
  })

  it("resolves a request the reply has moved past by another route", async () => {
    const f = await fixture()
    expect((await publish(f, f.people.requester.cookie)).status).toBe(202)
    // As if the reply left approval without a decision (here, by hand).
    await admin`
      update review set workflow_status = 'drafted' where id = ${f.review.reviewId}`
    const tick = await fetch(`${server.baseUrl}/api/cron/health`, {
      method: "POST",
      headers: CRON,
    })
    expect(tick.status, await tick.clone().text()).toBe(200)
    expect(
      (await incidents(f)).map((row) => `${row.kind}:${row.status}`)
    ).toEqual(["approval_requested:resolved"])
  })

  it("offers the approval kinds as preferences to members, not to viewers", async () => {
    const f = await fixture()
    const offered = async (cookie: string) => {
      const response = await api(cookie, "/api/notifications/preferences")
      expect(response.status).toBe(200)
      const body = notificationPreferencesResponseSchema.parse(
        await response.json()
      )
      return [...new Set(body.preferences.map((row) => row.kind))].filter(
        (kind) => kind === "approval_requested" || kind === "reply_sent_back"
      )
    }
    expect(await offered(f.people.requester.cookie)).toEqual([
      "approval_requested",
      "reply_sent_back",
    ])
    expect(await offered(f.people.viewer.cookie)).toEqual([])
    // In-app on by default; email only once chosen.
    const response = await api(
      f.people.requester.cookie,
      "/api/notifications/preferences"
    )
    const body = notificationPreferencesResponseSchema.parse(
      await response.json()
    )
    expect(
      body.preferences
        .filter((row) => row.kind === "reply_sent_back")
        .map((row) => `${row.channel}:${row.mode}`)
    ).toEqual(["in_app:immediate", "email:off"])
  })

  it("emails a send-back only to a requester who chose it", async () => {
    const f = await fixture()
    expect(
      (
        await api(f.people.requester.cookie, "/api/notifications/preferences", {
          method: "PUT",
          body: JSON.stringify({
            changes: [
              { kind: "reply_sent_back", channel: "email", mode: "immediate" },
            ],
          }),
        })
      ).status
    ).toBe(200)
    expect((await publish(f, f.people.requester.cookie)).status).toBe(202)
    expect((await decide(f, f.owner.cookie, "reject")).status).toBe(200)
    const deliveries = await admin<{ kind: string; userId: string }[]>`
      select i.kind, d.recipient_user_id::text as "userId"
      from notification_delivery d join notification_incident i on i.id = d.incident_id
      where d.organisation_id = ${f.owner.organisationId}
        and i.kind in ('approval_requested', 'reply_sent_back')`
    expect(deliveries).toEqual([
      { kind: "reply_sent_back", userId: f.people.requester.userId },
    ])
  })

  const tick = async () => {
    const response = await fetch(`${server.baseUrl}/api/cron/health`, {
      method: "POST",
      headers: CRON,
    })
    expect(response.status, await response.clone().text()).toBe(200)
  }
  const optIn = async (
    cookie: string,
    kind: "approval_requested" | "reply_sent_back"
  ) =>
    expect(
      (
        await api(cookie, "/api/notifications/preferences", {
          method: "PUT",
          body: JSON.stringify({
            changes: [{ kind, channel: "email", mode: "immediate" }],
          }),
        })
      ).status
    ).toBe(200)

  it("opens a new request when an edited reply is submitted again", async () => {
    const f = await fixture()
    await optIn(f.people.publisher.cookie, "approval_requested")
    expect((await publish(f, f.people.requester.cookie)).status).toBe(202)
    // Editing the draft takes the reply out of approval without a decision.
    const edited = await saveHumanDraft(
      server.baseUrl,
      f.people.requester.cookie,
      f.review.reviewId,
      "Thank you, we have passed this on to the kitchen."
    )
    const resubmitted = await api(
      f.people.requester.cookie,
      `/api/reviews/${f.review.reviewId}/publish`,
      {
        method: "POST",
        body: JSON.stringify({
          draftId: edited.draftId,
          expectedReviewUpdateTime: edited.expectedReviewUpdateTime,
        }),
      }
    )
    expect(resubmitted.status, await resubmitted.clone().text()).toBe(202)
    expect(
      (await incidents(f)).map((row) => `${row.kind}:${row.status}`)
    ).toEqual(["approval_requested:resolved", "approval_requested:open"])
    // One email per park; the first is never sent because it was superseded.
    await tick()
    const sent = await admin<{ status: string; code: string | null }[]>`
      select d.status, d.last_error_code as code
      from notification_delivery d join notification_incident i on i.id = d.incident_id
      where d.recipient_user_id = ${f.people.publisher.userId}
        and i.kind = 'approval_requested'
      order by i.opened_at`
    expect(sent).toHaveLength(2)
    expect(sent[0]).toEqual({ status: "suppressed", code: "incident_resolved" })
    expect(sent[1].code).not.toBe("incident_resolved")
  })

  it("does not email a request that was decided before the email went out", async () => {
    const f = await fixture()
    await optIn(f.people.publisher.cookie, "approval_requested")
    expect((await publish(f, f.people.requester.cookie)).status).toBe(202)
    expect((await decide(f, f.owner.cookie, "approve")).status).toBe(200)
    await tick()
    const [delivery] = await admin<{ status: string; code: string | null }[]>`
      select d.status, d.last_error_code as code
      from notification_delivery d join notification_incident i on i.id = d.incident_id
      where d.recipient_user_id = ${f.people.publisher.userId}
        and i.kind = 'approval_requested'`
    expect(delivery).toEqual({ status: "suppressed", code: "incident_resolved" })
  })

  it("resolves a send-back once the review no longer needs a reply", async () => {
    const f = await fixture()
    expect((await publish(f, f.people.requester.cookie)).status).toBe(202)
    expect((await decide(f, f.owner.cookie, "reject")).status).toBe(200)
    await admin`update review set triaged_at = now() where id = ${f.review.reviewId}`
    await tick()
    expect(
      (await incidents(f)).map((row) => `${row.kind}:${row.status}`)
    ).toEqual(["approval_requested:resolved", "reply_sent_back:resolved"])
  })

  it("lets nobody but a recipient mark an addressed notification read", async () => {
    const f = await fixture()
    expect((await publish(f, f.people.requester.cookie)).status).toBe(202)
    expect((await decide(f, f.owner.cookie, "reject")).status).toBe(200)
    const [sentBack] = await admin<{ id: string }[]>`
      select id::text as id from notification_incident
      where organisation_id = ${f.owner.organisationId} and kind = 'reply_sent_back'`
    const mark = (cookie: string) =>
      api(cookie, "/api/notifications/read", {
        method: "POST",
        body: JSON.stringify({ incidentIds: [sentBack.id], read: true }),
      }).then((response) => response.json())
    expect(await mark(f.owner.cookie)).toEqual({ updated: 0 })
    expect(await mark(f.people.requester.cookie)).toEqual({ updated: 1 })
  })
})
