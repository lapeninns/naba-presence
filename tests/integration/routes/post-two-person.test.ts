import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

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

/**
 * Two-person approval on every post publication path (P02-S2): a publisher's
 * direct publish and a PATCH of a live post park for approval; an approval
 * names the exact revision it covers and is refused for the requester, the
 * author, a stale revision and a post that is not pending.
 */
describeDatabase(
  "posts - two-person approval bound to content revision",
  () => {
    let admin: ReturnType<typeof postgres>
    let google: GoogleStub
    let server: Awaited<ReturnType<typeof startAppServer>>
    const organisations: string[] = []

    beforeAll(async () => {
      admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
      google = await startGoogleStub()
      server = await startAppServer({
        GOOGLE_API_PROXY_BASE: google.baseUrl,
        GBP_POSTS_ENABLED: "true",
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

    /** An owner in two-person mode, a linked location and a live-post stub. */
    async function twoPersonTenant(options: { failCreate?: boolean } = {}) {
      const owner = await createTestTenant(admin)
      organisations.push(owner.organisationId)
      await admin`
      update organisation set require_two_person_approval = true
      where id = ${owner.organisationId}
    `
      const connection = await seedGoogleConnection(admin, {
        organisationId: owner.organisationId,
      })
      const linked = await seedLinkedLocation(admin, {
        organisationId: owner.organisationId,
        connectionId: connection.connectionId,
        googleAccountName: connection.googleAccountName,
      })
      const name = `${connection.googleAccountName}/${linked.googleLocationName}/localPosts/two-person`
      let live: Record<string, unknown> | null = null
      let failCreate = options.failCreate ?? false
      google.respond(
        { method: "POST", pathIncludes: "/localPosts" },
        (call) => {
          if (failCreate) {
            return {
              status: 400,
              json: { error: { status: "INVALID_ARGUMENT" } },
            }
          }
          live = { name, state: "LIVE", ...(call.body as object) }
          return { status: 200, json: live }
        }
      )
      google.respond(
        { method: "PATCH", pathIncludes: "/localPosts/two-person" },
        (call) => {
          live = { ...(live ?? {}), ...(call.body as object) }
          return { status: 200, json: live }
        }
      )
      google.respond(
        { method: "GET", pathIncludes: "/localPosts/two-person" },
        () => ({ status: 200, json: live ?? {} })
      )
      google.respond({ method: "GET", pathIncludes: "/localPosts?" }, () => ({
        status: 200,
        json: { localPosts: live ? [live] : [] },
      }))
      const second = await seedMemberUser(admin, {
        organisationId: owner.organisationId,
        role: "member",
        canPublish: true,
      })
      return {
        owner,
        second,
        locationId: linked.locationId,
        allowCreate: () => {
          failCreate = false
        },
      }
    }

    const url = (locationId: string, path = "") =>
      `${server.baseUrl}/api/locations/${locationId}/posts${path}`

    function send(
      cookie: string,
      method: string,
      target: string,
      body?: unknown
    ) {
      return fetch(target, {
        method,
        headers: { cookie, "content-type": "application/json" },
        body: body === undefined ? "{}" : JSON.stringify(body),
      })
    }

    async function createDraft(
      cookie: string,
      locationId: string,
      summary: string
    ) {
      const response = await send(
        cookie,
        "POST",
        url(locationId),
        standardPost(summary)
      )
      expect(response.status, await response.clone().text()).toBe(201)
      return (await response.json()).post.id as string
    }

    async function stored(postId: string) {
      const [row] = await admin<
        {
          status: string
          contentRevision: number
          approvalRequestedBy: string | null
          approvalRequestedRevision: number | null
          approvedBy: string | null
        }[]
      >`
      select status, content_revision::integer as "contentRevision",
        approval_requested_by::text as "approvalRequestedBy",
        approval_requested_revision::integer as "approvalRequestedRevision",
        approved_by::text as "approvedBy"
      from gbp_local_post where id = ${postId}
    `
      return row
    }

    const providerWrites = () =>
      google.calls.filter(
        (call) =>
          (call.method === "POST" || call.method === "PATCH") &&
          call.path.includes("/localPosts")
      )

    const decisions = (postId: string) =>
      admin<
        {
          decision: string
          decidedBy: string
          requestedBy: string | null
          authorId: string | null
          contentRevision: number
          contentHash: string
          authorisedAal: string | null
          authorisedSecurityVersion: number | null
        }[]
      >`
      select decision, decided_by::text as "decidedBy",
        authorised_aal as "authorisedAal",
        authorised_security_version as "authorisedSecurityVersion",
        requested_by::text as "requestedBy", author_id::text as "authorId",
        content_revision::integer as "contentRevision",
        content_hash as "contentHash"
      from post_approval_decision where post_id = ${postId}
      order by created_at
    `

    it("parks a publisher's direct publish and refuses self-approval", async () => {
      const { owner, locationId } = await twoPersonTenant()
      const postId = await createDraft(owner.cookie, locationId, "Quiz night")

      const published = await send(
        owner.cookie,
        "POST",
        url(locationId, `/${postId}/publish`)
      )
      expect(published.status, await published.clone().text()).toBe(202)
      expect(await published.json()).toEqual({ status: "awaiting_approval" })
      expect(providerWrites()).toHaveLength(0)
      expect(await stored(postId)).toMatchObject({
        status: "awaiting_approval",
        approvalRequestedBy: owner.userId,
        approvalRequestedRevision: 1,
      })

      const self = await send(
        owner.cookie,
        "POST",
        url(locationId, `/${postId}/approval`),
        { decision: "approve", expectedRevision: 1 }
      )
      expect(self.status).toBe(403)
      expect((await self.json()).error).toBe("second_approver_required")
      expect(providerWrites()).toHaveLength(0)
      expect(await decisions(postId)).toEqual([])
    })

    it("publishes through a different publisher and records the decision", async () => {
      const { owner, second, locationId } = await twoPersonTenant()
      const postId = await createDraft(owner.cookie, locationId, "Quiz night")
      await send(owner.cookie, "POST", url(locationId, `/${postId}/publish`))

      const missing = await send(
        second.cookie,
        "POST",
        url(locationId, `/${postId}/approval`),
        { decision: "approve" }
      )
      expect(missing.status).toBe(400)
      expect((await missing.json()).error).toBe("expected_revision_required")

      const approved = await send(
        second.cookie,
        "POST",
        url(locationId, `/${postId}/approval`),
        { decision: "approve", expectedRevision: 1 }
      )
      expect(approved.status, await approved.clone().text()).toBe(200)
      expect(await approved.json()).toMatchObject({ status: "published" })
      expect(providerWrites()).toHaveLength(1)

      const [decision] = await decisions(postId)
      expect(decision).toMatchObject({
        decision: "approved",
        decidedBy: second.userId,
        requestedBy: owner.userId,
        authorId: owner.userId,
        contentRevision: 1,
        // The assurance it was decided with (0201); MFA is off here.
        authorisedAal: "aal1",
        authorisedSecurityVersion: 1,
      })
      expect(decision.contentHash).toMatch(/^[0-9a-f]{64}$/)
      expect(await stored(postId)).toMatchObject({
        status: "published",
        approvedBy: second.userId,
      })
      const [attempt] = await admin<{ approvalDecisionId: string | null }[]>`
      select approval_decision_id::text as "approvalDecisionId"
      from gbp_local_post_attempt where post_id = ${postId}
    `
      expect(attempt.approvalDecisionId).not.toBeNull()
    })

    it("refuses an approval of a stale revision and of a post that is not pending", async () => {
      const { owner, second, locationId } = await twoPersonTenant()
      const postId = await createDraft(owner.cookie, locationId, "Quiz night")

      const notPending = await send(
        second.cookie,
        "POST",
        url(locationId, `/${postId}/approval`),
        { decision: "approve", expectedRevision: 1 }
      )
      expect(notPending.status).toBe(409)
      expect((await notPending.json()).error).toBe("approval_not_pending")

      await send(owner.cookie, "POST", url(locationId, `/${postId}/publish`))
      const stale = await send(
        second.cookie,
        "POST",
        url(locationId, `/${postId}/approval`),
        { decision: "approve", expectedRevision: 2 }
      )
      expect(stale.status).toBe(409)
      expect((await stale.json()).error).toBe("approval_post_changed")

      // An edit after the request withdraws it: the request was for other text.
      const edited = await send(
        owner.cookie,
        "PATCH",
        url(locationId, `/${postId}`),
        standardPost("Quiz night, now with prizes")
      )
      expect(edited.status, await edited.clone().text()).toBe(200)
      expect(await stored(postId)).toMatchObject({
        status: "draft",
        contentRevision: 2,
        approvalRequestedBy: null,
        approvalRequestedRevision: null,
      })
      const afterEdit = await send(
        second.cookie,
        "POST",
        url(locationId, `/${postId}/approval`),
        { decision: "approve", expectedRevision: 1 }
      )
      expect(afterEdit.status).toBe(409)
      expect(providerWrites()).toHaveLength(0)
      expect(await decisions(postId)).toEqual([])
    })

    it("refuses the content's author even when someone else asked", async () => {
      const { owner, second, locationId } = await twoPersonTenant()
      // `second` writes the post; the owner asks for it to be published.
      const postId = await createDraft(
        second.cookie,
        locationId,
        "Cask ale week"
      )
      await send(owner.cookie, "POST", url(locationId, `/${postId}/publish`))

      const byAuthor = await send(
        second.cookie,
        "POST",
        url(locationId, `/${postId}/approval`),
        { decision: "approve", expectedRevision: 1 }
      )
      expect(byAuthor.status).toBe(403)
      expect((await byAuthor.json()).error).toBe("second_approver_required")

      const third = await seedMemberUser(admin, {
        organisationId: owner.organisationId,
        role: "member",
        canPublish: true,
      })
      const approved = await send(
        third.cookie,
        "POST",
        url(locationId, `/${postId}/approval`),
        { decision: "approve", expectedRevision: 1 }
      )
      expect(approved.status, await approved.clone().text()).toBe(200)
    })

    it("routes a PATCH of a live post to approval", async () => {
      const { owner, second, locationId } = await twoPersonTenant()
      const postId = await createDraft(owner.cookie, locationId, "Sunday roast")
      await send(owner.cookie, "POST", url(locationId, `/${postId}/publish`))
      await send(
        second.cookie,
        "POST",
        url(locationId, `/${postId}/approval`),
        {
          decision: "approve",
          expectedRevision: 1,
        }
      )
      expect((await stored(postId)).status).toBe("published")
      google.calls.length = 0

      const patched = await send(
        owner.cookie,
        "PATCH",
        url(locationId, `/${postId}`),
        standardPost("Sunday roast, booking advised")
      )
      expect(patched.status, await patched.clone().text()).toBe(200)
      expect(await patched.json()).toEqual({ status: "awaiting_approval" })
      expect(providerWrites()).toHaveLength(0)
      expect(await stored(postId)).toMatchObject({
        status: "awaiting_approval",
        contentRevision: 2,
        approvalRequestedRevision: 2,
      })

      // The approval of revision 1 does not carry over to revision 2.
      const republish = await send(
        owner.cookie,
        "POST",
        url(locationId, `/${postId}/publish`)
      )
      expect(republish.status).toBe(202)
      expect(providerWrites()).toHaveLength(0)
    })

    it("lets an approved revision be retried after Google refused it", async () => {
      const { owner, second, locationId, allowCreate } = await twoPersonTenant({
        failCreate: true,
      })
      const postId = await createDraft(
        owner.cookie,
        locationId,
        "Beer festival"
      )
      await send(owner.cookie, "POST", url(locationId, `/${postId}/publish`))
      const approved = await send(
        second.cookie,
        "POST",
        url(locationId, `/${postId}/approval`),
        { decision: "approve", expectedRevision: 1 }
      )
      expect(approved.status).toBeGreaterThanOrEqual(400)
      expect((await stored(postId)).status).toBe("failed")

      // The approval of this exact revision stands, so the requester's retry
      // publishes without asking again.
      allowCreate()
      const retried = await send(
        owner.cookie,
        "POST",
        url(locationId, `/${postId}/publish`)
      )
      expect(retried.status, await retried.clone().text()).toBe(200)
      expect(await retried.json()).toMatchObject({ status: "published" })
      expect((await stored(postId)).approvedBy).toBe(second.userId)
    })

    it("does not let an approval stand once its approver was recovered", async () => {
      const { owner, second, locationId, allowCreate } = await twoPersonTenant({
        failCreate: true,
      })
      const postId = await createDraft(owner.cookie, locationId, "Quiz night")
      await send(owner.cookie, "POST", url(locationId, `/${postId}/publish`))
      await send(
        second.cookie,
        "POST",
        url(locationId, `/${postId}/approval`),
        { decision: "approve", expectedRevision: 1 }
      )
      expect((await stored(postId)).status).toBe("failed")

      // Operator MFA recovery (0201) bumps the approver's security version:
      // what they approved before it no longer counts, so the retry parks.
      await admin`
        update app_user set security_version = security_version + 1
        where id = ${second.userId}
      `
      allowCreate()
      const writesBefore = providerWrites().length
      const retried = await send(
        owner.cookie,
        "POST",
        url(locationId, `/${postId}/publish`)
      )
      expect(retried.status, await retried.clone().text()).toBe(202)
      expect(providerWrites()).toHaveLength(writesBefore)
      expect((await stored(postId)).status).toBe("awaiting_approval")
    })

    it("lets the approver retry the publish they approved", async () => {
      const { owner, second, locationId, allowCreate } = await twoPersonTenant({
        failCreate: true,
      })
      const postId = await createDraft(owner.cookie, locationId, "Cider fest")
      await send(owner.cookie, "POST", url(locationId, `/${postId}/publish`))
      const approved = await send(
        second.cookie,
        "POST",
        url(locationId, `/${postId}/approval`),
        { decision: "approve", expectedRevision: 1 }
      )
      expect(approved.status).toBeGreaterThanOrEqual(400)
      expect((await stored(postId)).status).toBe("failed")

      // The author is the first person and the approver the second, so the
      // approver's own retry goes out under their decision instead of
      // re-parking under them, where they could not approve it.
      allowCreate()
      const retried = await send(
        second.cookie,
        "POST",
        url(locationId, `/${postId}/publish`)
      )
      expect(retried.status, await retried.clone().text()).toBe(200)
      expect(await retried.json()).toMatchObject({ status: "published" })
      expect(await stored(postId)).toMatchObject({
        status: "published",
        approvedBy: second.userId,
      })
      expect(await decisions(postId)).toHaveLength(1)
    })

    it("does not let an older approval survive a rejection of the same revision", async () => {
      const { owner, second, locationId, allowCreate } = await twoPersonTenant({
        failCreate: true,
      })
      const postId = await createDraft(owner.cookie, locationId, "Gin tasting")
      await send(owner.cookie, "POST", url(locationId, `/${postId}/publish`))
      await send(
        second.cookie,
        "POST",
        url(locationId, `/${postId}/approval`),
        { decision: "approve", expectedRevision: 1 }
      )
      expect((await stored(postId)).status).toBe("failed")

      // Someone without publish rights parks the same revision again, and a
      // third publisher rejects it.
      const asker = await seedMemberUser(admin, {
        organisationId: owner.organisationId,
        role: "member",
        canPublish: false,
      })
      const reparked = await send(
        asker.cookie,
        "POST",
        url(locationId, `/${postId}/publish`)
      )
      expect(reparked.status, await reparked.clone().text()).toBe(202)
      const third = await seedMemberUser(admin, {
        organisationId: owner.organisationId,
        role: "member",
        canPublish: true,
      })
      const rejected = await send(
        third.cookie,
        "POST",
        url(locationId, `/${postId}/approval`),
        { decision: "reject", expectedRevision: 1 }
      )
      expect(rejected.status, await rejected.clone().text()).toBe(200)

      allowCreate()
      google.calls.length = 0
      const published = await send(
        owner.cookie,
        "POST",
        url(locationId, `/${postId}/publish`)
      )
      expect(published.status, await published.clone().text()).toBe(202)
      expect(await published.json()).toEqual({ status: "awaiting_approval" })
      expect(providerWrites()).toHaveLength(0)
      expect(
        (await decisions(postId)).map((row) => [row.decision, row.decidedBy])
      ).toEqual([
        ["approved", second.userId],
        ["rejected", third.userId],
      ])
    })

    it("records a rejection against its revision, and a withdrawal not at all", async () => {
      const { owner, second, locationId } = await twoPersonTenant()
      const postId = await createDraft(owner.cookie, locationId, "Pie night")
      await send(owner.cookie, "POST", url(locationId, `/${postId}/publish`))

      const withdrawn = await send(
        owner.cookie,
        "POST",
        url(locationId, `/${postId}/approval`),
        { decision: "reject", expectedRevision: 1 }
      )
      expect(withdrawn.status, await withdrawn.clone().text()).toBe(200)
      expect(await withdrawn.json()).toEqual({ status: "draft" })
      expect(await decisions(postId)).toEqual([])
      expect(await stored(postId)).toMatchObject({
        status: "draft",
        approvalRequestedBy: null,
      })

      await send(owner.cookie, "POST", url(locationId, `/${postId}/publish`))
      const rejected = await send(
        second.cookie,
        "POST",
        url(locationId, `/${postId}/approval`),
        { decision: "reject", expectedRevision: 1 }
      )
      expect(rejected.status, await rejected.clone().text()).toBe(200)
      const [decision, ...rest] = await decisions(postId)
      expect(rest).toEqual([])
      expect(decision).toMatchObject({
        decision: "rejected",
        decidedBy: second.userId,
        requestedBy: owner.userId,
        authorId: owner.userId,
        contentRevision: 1,
      })
      expect(decision.contentHash).toMatch(/^[0-9a-f]{64}$/)
      expect((await stored(postId)).status).toBe("draft")
      expect(providerWrites()).toHaveLength(0)
    })

    it("publishes a requester's own approval as a plain publish when the policy is off", async () => {
      const { owner, locationId } = await twoPersonTenant()
      const postId = await createDraft(owner.cookie, locationId, "Open mic")
      await send(owner.cookie, "POST", url(locationId, `/${postId}/publish`))
      expect((await stored(postId)).status).toBe("awaiting_approval")
      await admin`
        update organisation set require_two_person_approval = false
        where id = ${owner.organisationId}
      `

      const approved = await send(
        owner.cookie,
        "POST",
        url(locationId, `/${postId}/approval`),
        { decision: "approve", expectedRevision: 1 }
      )
      expect(approved.status, await approved.clone().text()).toBe(200)
      expect(await approved.json()).toMatchObject({ status: "published" })
      expect(providerWrites()).toHaveLength(1)
      // Nobody else looked at it, so no decision row claims they did.
      expect(await decisions(postId)).toEqual([])
      expect((await stored(postId)).approvedBy).toBeNull()
    })

    it("refuses the publish claim when the post changed after the decision committed", async () => {
      const { owner, second, locationId } = await twoPersonTenant()
      const postId = await createDraft(owner.cookie, locationId, "Wine flight")
      await send(owner.cookie, "POST", url(locationId, `/${postId}/publish`))

      // Hold the attempt table so the approval's decision commits but its
      // publish claim (which inserts the attempt first) waits; move the
      // revision on in that gap, then let the claim run.
      const holder = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
      try {
        let release!: () => void
        const released = new Promise<void>((resolve) => {
          release = resolve
        })
        let locked!: () => void
        const isLocked = new Promise<void>((resolve) => {
          locked = resolve
        })
        const holding = holder.begin(async (tx) => {
          await tx`lock table gbp_local_post_attempt in share mode`
          locked()
          await released
        })
        await isLocked

        const approving = send(
          second.cookie,
          "POST",
          url(locationId, `/${postId}/approval`),
          { decision: "approve", expectedRevision: 1 }
        )
        const deadline = Date.now() + 15_000
        while ((await decisions(postId)).length === 0) {
          if (Date.now() > deadline) throw new Error("decision never committed")
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        // An edit, as the PATCH route would write it: the trigger bumps the
        // revision and withdraws the request.
        await admin`
          update gbp_local_post set summary = 'Wine flight, now four glasses'
          where id = ${postId}
        `
        release()
        await holding

        const approved = await approving
        expect(approved.status, await approved.clone().text()).toBe(409)
        expect((await approved.json()).error).toBe("approval_post_changed")
      } finally {
        await holder.end()
      }
      expect(providerWrites()).toHaveLength(0)
      expect(await stored(postId)).toMatchObject({
        status: "draft",
        contentRevision: 2,
      })
      const [attempts] = await admin<{ count: number }[]>`
        select count(*)::integer as count from gbp_local_post_attempt
        where post_id = ${postId}
      `
      expect(attempts.count).toBe(0)
    })
  }
)

function standardPost(summary: string) {
  return {
    topicType: "STANDARD",
    languageCode: "en-GB",
    summary,
    media: [],
  }
}
