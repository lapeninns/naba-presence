import { describe, expect, it } from "vitest"
import { lifecycleHarness } from "../helpers/google-lifecycle"
import {
  createTestTenant,
  seedLinkedLocation,
  seedMemberUser,
} from "../helpers/tenant"
import { placeActionInputSchema } from "@/lib/contracts/location-place-actions"
import {
  placeActionAttemptResponseSchema,
  placeActionReviewResponseSchema,
  type ReviewedPlaceActionRequest,
} from "@/lib/contracts/place-action-review"
import { placeActionWorkflowsResponseSchema } from "@/lib/contracts/place-action-workflows"
import { lifecycleReviewResponseSchema } from "@/lib/contracts/google-lifecycle-review"

const describeDatabase =
  process.env.RUN_DB_TESTS === "true" ? describe : describe.skip
describeDatabase(
  "reviewed Place Actions integrity",
  { timeout: 45_000 },
  () => {
    const harness = lifecycleHarness({ GBP_PLACE_ACTIONS_ENABLED: "true" })
    const payload = placeActionInputSchema.parse({
      uri: "https://shop.example.test/catalogue",
      placeActionType: "SHOP_ONLINE",
      isPreferred: false,
    })
    async function fixture() {
      const base = await harness.fixture()
      const state: {
        links: Array<Record<string, unknown>>
        supported: string[]
        status: number
        apply: boolean
        delayMs: number
        page: ((token: string | null) => Record<string, unknown>) | null
      } = {
        links: [],
        supported: ["SHOP_ONLINE"],
        status: 200,
        apply: true,
        delayMs: 0,
        page: null,
      }
      base.provider.respond(
        { method: "GET", pathIncludes: "/placeActionTypeMetadata" },
        () => ({
          status: 200,
          json: {
            placeActionTypeMetadata: state.supported.map((placeActionType) => ({
              placeActionType,
            })),
          },
        })
      )
      base.provider.respond(
        { method: "GET", pathIncludes: "/placeActionLinks" },
        (call) => ({
          status: 200,
          json: state.page
            ? state.page(
                new URL(call.path, "https://fixture.test").searchParams.get(
                  "pageToken"
                )
              )
            : { placeActionLinks: state.links },
        })
      )
      base.provider.respond(
        { method: "POST", pathIncludes: "/placeActionLinks" },
        (call) => {
          const link = {
            name: `${base.linked.googleLocationName}/placeActionLinks/link${state.links.length + 1}`,
            providerType: "MERCHANT",
            isEditable: true,
            ...placeActionInputSchema.parse(call.body),
          }
          if (state.apply && state.status === 200) state.links.push(link)
          return {
            status: state.status,
            json:
              state.status === 200
                ? link
                : {
                    error: {
                      status:
                        state.status === 400
                          ? "INVALID_ARGUMENT"
                          : "UNAVAILABLE",
                    },
                  },
            delayMs: state.delayMs,
          }
        }
      )
      base.provider.respond(
        { method: "PATCH", pathIncludes: "/placeActionLinks/" },
        (call) => {
          const name = new URL(
            call.path,
            "https://fixture.test"
          ).pathname.replace(/^\/v1\//, "")
          if (state.apply)
            state.links = state.links.map((link) =>
              link.name === name
                ? { ...link, ...placeActionInputSchema.parse(call.body) }
                : link
            )
          return {
            status: state.status,
            json: state.links.find((link) => link.name === name) ?? {},
          }
        }
      )
      const root = `${base.baseUrl}/api/locations/${base.linked.locationId}/place-action-reviews`
      const request = (
        path = "",
        method = "GET",
        body?: unknown,
        cookie = base.owner.cookie
      ) =>
        fetch(`${root}${path}`, {
          method,
          headers: { cookie, "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        })
      async function preview(
        requested: ReviewedPlaceActionRequest = {
          operation: "create",
          payload,
        },
        cookie = base.owner.cookie
      ) {
        const response = await request("", "POST", requested, cookie)
        expect(response.status, await response.clone().text()).toBe(200)
        return placeActionReviewResponseSchema.parse(await response.json())
          .review
      }
      async function approved(requested?: ReviewedPlaceActionRequest) {
        const review = await preview(requested)
        const response = await request(`/${review.changeSet.id}`, "POST", {
          expectedPayloadHash: review.changeSet.payloadHash,
        })
        expect(response.status, await response.clone().text()).toBe(200)
        return placeActionReviewResponseSchema.parse(await response.json())
          .review
      }
      const send = (
        review: { changeSet: { id: string; payloadHash: string } },
        cookie = base.owner.cookie
      ) =>
        request(
          `/${review.changeSet.id}/execute`,
          "POST",
          { expectedPayloadHash: review.changeSet.payloadHash },
          cookie
        )
      const writes = () =>
        base.provider.calls.filter(
          (call) =>
            ["POST", "PATCH", "DELETE"].includes(call.method) &&
            call.path.includes("placeActionLinks")
        )
      const manager = async () => {
        const member = await seedMemberUser(harness.database(), {
          organisationId: base.owner.organisationId,
        })
        await harness.database()`update member set role = 'admin' where organisation_id = ${base.owner.organisationId} and user_id = ${member.userId}`
        return member
      }
      return {
        ...base,
        state,
        request,
        preview,
        approved,
        send,
        writes,
        manager,
      }
    }
    const link = (
      f: { linked: { googleLocationName: string } },
      id: string,
      extra: Record<string, unknown> = {}
    ) => ({
      name: `${f.linked.googleLocationName}/placeActionLinks/${id}`,
      providerType: "MERCHANT",
      isEditable: true,
      ...payload,
      uri: `https://shop.example.test/${id}`,
      ...extra,
    })

    it("requires a different current manager under two-person policy and blocks send after that approver is revoked", async () => {
      const f = await fixture(),
        database = harness.database()
      await database`update organisation set require_two_person_approval = true where id = ${f.owner.organisationId}`
      const review = await f.preview(),
        body = { expectedPayloadHash: review.changeSet.payloadHash }
      expect(review.changeSet).toMatchObject({
        requiresSecondApprover: true,
        canApprove: false,
      })
      const self = await f.request(`/${review.changeSet.id}`, "POST", body)
      expect(self.status).toBe(409)
      expect(await self.json()).toMatchObject({
        error: "second_approver_required",
      })
      const second = await f.manager()
      const approval = await f.request(
        `/${review.changeSet.id}`,
        "POST",
        body,
        second.cookie
      )
      expect(approval.status, await approval.clone().text()).toBe(200)
      await database`update member set role = 'viewer' where organisation_id = ${f.owner.organisationId} and user_id = ${second.userId}`
      const sent = await f.send(review)
      expect(sent.status).toBe(409)
      expect(await sent.json()).toMatchObject({
        error: "approval_actor_access_changed",
      })
      expect(f.writes()).toHaveLength(0)
    })

    it("blocks send when the requester loses access or the approval policy changes after approval", async () => {
      const f = await fixture(),
        database = harness.database(),
        requester = await f.manager()
      const review = await f.preview(
        { operation: "create", payload },
        requester.cookie
      )
      expect(
        (
          await f.request(`/${review.changeSet.id}`, "POST", {
            expectedPayloadHash: review.changeSet.payloadHash,
          })
        ).status
      ).toBe(200)
      await database`update member set role = 'member' where organisation_id = ${f.owner.organisationId} and user_id = ${requester.userId}`
      const revoked = await f.send(review)
      expect(revoked.status).toBe(409)
      expect(await revoked.json()).toMatchObject({
        error: "approval_actor_access_changed",
      })
      const policy = await f.approved({
        operation: "create",
        payload: { ...payload, uri: "https://shop.example.test/policy" },
      })
      await database`update organisation set require_two_person_approval = true where id = ${f.owner.organisationId}`
      const changed = await f.send(policy)
      expect(changed.status).toBe(409)
      expect(await changed.json()).toMatchObject({
        error: "approval_policy_changed",
      })
      expect(f.writes()).toHaveLength(0)
    })

    it("keeps a confirmed outcome settled after later Google edits and emits its canonical audit exactly once", async () => {
      const f = await fixture(),
        review = await f.approved()
      const sent = placeActionAttemptResponseSchema.parse(
        await (await f.send(review)).json()
      ).attempt
      expect(sent).toMatchObject({
        executionState: "accepted",
        confirmationState: "confirmed",
      })
      f.state.links = f.state.links.map((row) => ({
        ...row,
        uri: "https://shop.example.test/edited-in-google",
      }))
      const reads = f.provider.calls.length
      for (let index = 0; index < 2; index += 1) {
        const refreshed = await f.request(
          `/${review.changeSet.id}/execute`,
          "PATCH",
          {}
        )
        expect(
          placeActionAttemptResponseSchema.parse(await refreshed.json()).attempt
        ).toMatchObject({ id: sent.id, confirmationState: "confirmed" })
      }
      expect(f.provider.calls).toHaveLength(reads)
      const audits =
        await harness.database()`select action from audit_log where organisation_id = ${f.owner.organisationId} and action = 'place_action.created'`
      expect(audits).toHaveLength(1)
      const next = await f.approved({
        operation: "create",
        payload: { ...payload, uri: "https://shop.example.test/next" },
      })
      expect((await f.send(next)).status).toBe(200)
      expect(f.writes()).toHaveLength(2)
    })

    it("records a provider rejection without confirmation and does not block the next reviewed change", async () => {
      const f = await fixture(),
        review = await f.approved()
      f.state.status = 400
      const rejected = placeActionAttemptResponseSchema.parse(
        await (await f.send(review)).json()
      ).attempt
      expect(rejected).toMatchObject({
        executionState: "rejected",
        confirmationState: "unrecorded",
        errorCode: "place_action_provider_rejected",
      })
      const retry = placeActionAttemptResponseSchema.parse(
        await (await f.send(review)).json()
      ).attempt
      expect(retry).toMatchObject({
        id: rejected.id,
        executionState: "rejected",
        idempotent: true,
      })
      const refreshed = await f.request(
        `/${review.changeSet.id}/execute`,
        "PATCH",
        {}
      )
      expect(
        placeActionAttemptResponseSchema.parse(await refreshed.json()).attempt
          .executionState
      ).toBe("rejected")
      expect(f.writes()).toHaveLength(1)
      f.state.status = 200
      const next = await f.approved({
        operation: "create",
        payload: {
          ...payload,
          uri: "https://shop.example.test/after-rejection",
        },
      })
      expect(
        placeActionAttemptResponseSchema.parse(
          await (await f.send(next)).json()
        ).attempt.confirmationState
      ).toBe("confirmed")
    })

    it("keeps future-type links read-only in the reviewed baseline and treats their drift as stale", async () => {
      const f = await fixture(),
        future = link(f, "future", {
          placeActionType: "FUTURE_ACTION_TYPE",
          providerType: "AGGREGATOR_3P",
          isEditable: false,
        })
      f.state.links.push(future)
      const review = await f.approved()
      expect(review.changeSet.baseline).toMatchObject({
        unsupportedLinks: [
          { name: future.name, placeActionType: "FUTURE_ACTION_TYPE" },
        ],
      })
      const edit = await f.request("", "POST", {
        operation: "delete",
        name: future.name,
      })
      expect(edit.status).toBe(409)
      expect(await edit.json()).toMatchObject({
        error: "place_action_not_editable",
      })
      f.state.links = [
        { ...future, uri: "https://provider.example.test/changed" },
      ]
      const stale = await f.send(review)
      expect(stale.status).toBe(409)
      expect(await stale.json()).toMatchObject({
        error: "google_baseline_stale",
      })
      const state = await fetch(
        `${f.baseUrl}/api/locations/${f.linked.locationId}/place-actions`,
        { headers: { cookie: f.owner.cookie } }
      )
      expect(state.status, await state.clone().text()).toBe(200)
      expect(await state.json()).toMatchObject({
        placeActions: {
          links: [],
          unsupportedLinks: [
            { name: future.name, uri: "https://provider.example.test/changed" },
          ],
        },
      })
      expect(f.writes()).toHaveLength(0)
    })

    it("fails closed on malformed rows and repeated page tokens without saving a review", async () => {
      const f = await fixture()
      f.state.links = [
        {
          name: `${f.linked.googleLocationName}/placeActionLinks/broken`,
          placeActionType: "SHOP_ONLINE",
        },
      ]
      const malformed = await f.request("", "POST", {
        operation: "create",
        payload,
      })
      expect(malformed.status).toBe(502)
      expect(await malformed.json()).toMatchObject({
        error: "place_action_observation_unreadable",
      })
      f.state.links = []
      f.state.page = () => ({ placeActionLinks: [], nextPageToken: "same" })
      const looped = await f.request("", "POST", {
        operation: "create",
        payload,
      })
      expect(looped.status).toBe(502)
      expect(await looped.json()).toMatchObject({
        error: "google_place_action_page_limit",
      })
      f.state.page = (token) =>
        token === null
          ? { placeActionLinks: [link(f, "a")], nextPageToken: "p2" }
          : { placeActionLinks: [link(f, "a")] }
      const duplicate = await f.request("", "POST", {
        operation: "create",
        payload,
      })
      expect(duplicate.status).toBe(502)
      const saved =
        await harness.database()`select id from gbp_change_set where location_id = ${f.linked.locationId} and resource_type = 'place_action'`
      expect(saved).toHaveLength(0)
      expect(f.writes()).toHaveLength(0)
      f.state.page = (token) =>
        token === null
          ? { placeActionLinks: [link(f, "a")], nextPageToken: "p2" }
          : { placeActionLinks: [link(f, "b")] }
      const complete = await f.preview()
      expect(
        (complete.changeSet.baseline as { links: unknown[] }).links
      ).toHaveLength(2)
    })

    it("serialises concurrent sends on one Google account so only one mutation is in flight", async () => {
      const f = await fixture()
      const first = await f.approved(),
        second = await f.approved({
          operation: "create",
          payload: { ...payload, uri: "https://shop.example.test/second" },
        })
      f.state.delayMs = 1_500
      const [a, b] = await Promise.all([f.send(first), f.send(second)])
      const statuses = [a.status, b.status].sort()
      expect(statuses).toEqual([200, 409])
      const blocked = a.status === 409 ? a : b
      expect(await blocked.json()).toMatchObject({
        error: "administration_in_progress",
      })
      expect(f.writes()).toHaveLength(1)
    })

    it("blocks a lifecycle send while an action link outcome is unresolved on the same account", async () => {
      const f = await fixture(),
        action = await f.approved()
      f.state.status = 503
      f.state.apply = false
      expect(
        placeActionAttemptResponseSchema.parse(
          await (await f.send(action)).json()
        ).attempt.confirmationState
      ).toBe("unresolved")
      const lifecycleRoot = `${f.baseUrl}/api/locations/${f.linked.locationId}/administration-lifecycle-reviews`
      const headers = {
        cookie: f.owner.cookie,
        "content-type": "application/json",
      }
      const reviewed = await fetch(lifecycleRoot, {
        method: "POST",
        headers,
        body: JSON.stringify({
          operation: "transfer_location",
          payload: { destinationAccount: f.destinationAccount },
        }),
      })
      expect(reviewed.status, await reviewed.clone().text()).toBe(200)
      const lifecycle = lifecycleReviewResponseSchema.parse(
        await reviewed.json()
      ).review
      const body = JSON.stringify({
        expectedPayloadHash: lifecycle.changeSet.payloadHash,
      })
      expect(
        (
          await fetch(`${lifecycleRoot}/${lifecycle.changeSet.id}`, {
            method: "POST",
            headers,
            body,
          })
        ).status
      ).toBe(200)
      const sent = await fetch(
        `${lifecycleRoot}/${lifecycle.changeSet.id}/execute`,
        { method: "POST", headers, body }
      )
      expect(sent.status).toBe(409)
      expect(await sent.json()).toMatchObject({
        error: "google_confirmation_unresolved",
      })
      expect(f.writes()).toHaveLength(1)
      expect(
        f.provider.calls.filter((call) => call.path.endsWith(":transfer"))
      ).toHaveLength(0)
    })

    it("pages the saved index for managers only and rejects a cursor from another location", async () => {
      const f = await fixture()
      for (const suffix of ["one", "two", "three"])
        await f.preview({
          operation: "create",
          payload: { ...payload, uri: `https://shop.example.test/${suffix}` },
        })
      const first = placeActionWorkflowsResponseSchema.parse(
        await (await f.request("?limit=2")).json()
      )
      expect(first.items).toHaveLength(2)
      expect(first.nextCursor).not.toBeNull()
      const second = placeActionWorkflowsResponseSchema.parse(
        await (
          await f.request(
            `?limit=2&cursor=${encodeURIComponent(first.nextCursor ?? "")}`
          )
        ).json()
      )
      expect(second.items).toHaveLength(1)
      expect(second.nextCursor).toBeNull()
      expect(
        new Set(
          [...first.items, ...second.items].map((item) => item.changeSet.id)
        ).size
      ).toBe(3)
      const viewer = await seedMemberUser(harness.database(), {
        organisationId: f.owner.organisationId,
        role: "viewer",
      })
      expect(
        (await f.request("", "GET", undefined, viewer.cookie)).status
      ).toBe(403)
      const other = await seedLinkedLocation(harness.database(), {
        organisationId: f.owner.organisationId,
        ...f.connection,
      })
      const foreign = await fetch(
        `${f.baseUrl}/api/locations/${other.locationId}/place-action-reviews?cursor=${encodeURIComponent(first.nextCursor ?? "")}`,
        { headers: { cookie: f.owner.cookie } }
      )
      expect(foreign.status).toBe(400)
      const tenant = await createTestTenant(harness.database())
      try {
        expect(
          (await f.request("", "GET", undefined, tenant.cookie)).status
        ).toBe(404)
      } finally {
        await harness.database()`delete from organisation where id = ${tenant.organisationId}`
      }
    })

    it("refuses to observe an interrupted request early and never resends it", async () => {
      const f = await fixture(),
        review = await f.approved()
      f.state.status = 503
      f.state.apply = false
      const sent = placeActionAttemptResponseSchema.parse(
        await (await f.send(review)).json()
      ).attempt
      await harness.database()`update place_action_mutation set status = 'started', execution_state = 'pending', confirmation_state = 'pending', finished_at = null where id = ${sent.id}`
      const early = await f.request(
        `/${review.changeSet.id}/execute`,
        "PATCH",
        {}
      )
      expect(early.status).toBe(409)
      expect(await early.json()).toMatchObject({
        error: "place_action_not_ready",
      })
      const saved = placeActionAttemptResponseSchema.parse(
        await (await f.send(review)).json()
      ).attempt
      expect(saved).toMatchObject({
        id: sent.id,
        executionState: "pending",
        idempotent: true,
      })
      const other = await f.approved({
        operation: "create",
        payload: { ...payload, uri: "https://shop.example.test/blocked" },
      })
      expect((await f.send(other)).status).toBe(409)
      expect(f.writes()).toHaveLength(1)
    }
  )

  it("reports unresolved, confirmed and rejected outcomes as operational incidents", async () => {
    const f = await fixture(), review = await f.approved()
    f.state.status = 503; f.state.apply = false
    const sent = placeActionAttemptResponseSchema.parse(await (await f.send(review)).json()).attempt
    const incidents = () => harness.database()<{ kind: string; status: string; location_id: string; reason: string | null }[]>`
      select kind, status, location_id::text as location_id, reason from notification_incident
      where organisation_id = ${f.owner.organisationId} and subject_id like ${`%:attempt:links:${sent.id}`} order by opened_at`
    expect(await incidents()).toEqual([{ kind: "publication_unresolved", status: "open", location_id: f.linked.locationId, reason: "response_ambiguous" }])
    await f.request(`/${review.changeSet.id}/execute`, "PATCH", {})
    expect(await incidents()).toHaveLength(1)
    f.state.links.push({ ...payload, name: `${f.linked.googleLocationName}/placeActionLinks/recovered`, providerType: "MERCHANT", isEditable: true })
    await f.request(`/${review.changeSet.id}/execute`, "PATCH", {})
    expect(await incidents()).toMatchObject([{ kind: "publication_unresolved", status: "resolved" }])
    f.state.status = 400; f.state.apply = true
    const rejected = placeActionAttemptResponseSchema.parse(await (await f.send(await f.approved({ operation: "create", payload: { ...payload, uri: "https://shop.example.test/rejected" } }))).json()).attempt
    const [failure] = await harness.database()`select kind, status, reason from notification_incident where subject_id like ${`%:attempt:links:${rejected.id}`}`
    expect(failure).toMatchObject({ kind: "publication_failed", status: "open", reason: "provider_rejected" })
  })
})
