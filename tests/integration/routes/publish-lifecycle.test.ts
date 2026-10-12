import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { sha256 } from "@/lib/server/crypto"

import moderationFixtures from "../../fixtures/google/review-reply-states.json"
import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  saveHumanDraft,
  seedGoogleConnection,
  seedLinkedReview,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

type Fixture = {
  owner: Awaited<ReturnType<typeof createTestTenant>>
  connectionId: string
  review: Awaited<ReturnType<typeof seedLinkedReview>>
  draft: Awaited<ReturnType<typeof saveHumanDraft>>
  body: string
}

describeDatabase("durable publish lifecycle", () => {
  let admin: ReturnType<typeof postgres>
  let stub: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    stub = await startGoogleStub()
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: stub.baseUrl,
    })
  })

  afterAll(async () => {
    await server.stop()
    await stub.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  async function createFixture(
    body = "Thank you for sharing your thoughtful feedback."
  ): Promise<Fixture> {
    stub.reset()
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const review = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    const draft = await saveHumanDraft(
      server.baseUrl,
      owner.cookie,
      review.reviewId,
      body
    )
    return {
      owner,
      connectionId: connection.connectionId,
      review,
      draft,
      body,
    }
  }

  function publish(fixture: Fixture) {
    return fetch(
      `${server.baseUrl}/api/reviews/${fixture.review.reviewId}/publish`,
      {
        method: "POST",
        headers: {
          cookie: fixture.owner.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          draftId: fixture.draft.draftId,
          expectedReviewUpdateTime: fixture.draft.expectedReviewUpdateTime,
        }),
      }
    )
  }

  async function waitFor<T>(
    read: () => Promise<T> | T,
    ready: (value: T) => boolean,
    timeoutMs = 15_000
  ) {
    const deadline = Date.now() + timeoutMs
    let value = await read()
    while (!ready(value) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25))
      value = await read()
    }
    return value
  }

  function runJobs() {
    return fetch(`${server.baseUrl}/api/jobs/run`, {
      method: "POST",
      headers: {
        authorization: "Bearer route-harness-cron-secret",
        "content-type": "application/json",
      },
      body: "{}",
    })
  }

  async function seedPublishAttempt(
    fixture: Fixture,
    input: {
      status: "started" | "ambiguous" | "retryable"
      startedAt?: Date
      nextAttemptAt?: Date
      /**
       * Who authorised it (0106). Defaults to the owner, at security
       * version 1, through the fixture's connection; null fields model a
       * row queued before 0106.
       */
      authorisation?: {
        userId?: string | null
        securityVersion?: number | null
        connectionId?: string | null
        /**
         * The approval policy it was queued under. Defaults to the
         * organisation's current one; null models a row with none recorded.
         */
        policy?: {
          approvalRequired: boolean
          requireTwoPersonApproval: boolean
        } | null
      }
    }
  ) {
    const authorisation = {
      userId: fixture.owner.userId,
      securityVersion: 1,
      connectionId: fixture.connectionId,
      ...input.authorisation,
    }
    const [current] = await admin<
      { approvalRequired: boolean; requireTwoPersonApproval: boolean }[]
    >`
      select
        approval_required as "approvalRequired",
        require_two_person_approval as "requireTwoPersonApproval"
      from organisation where id = ${fixture.owner.organisationId}
    `
    const policy =
      input.authorisation?.policy === undefined
        ? current
        : input.authorisation.policy
    const bodyHash = sha256(fixture.body)
    const idempotencyKey = sha256(
      `${fixture.owner.organisationId}:${fixture.review.reviewId}:0:${bodyHash}`
    )
    const [reply] = await admin<{ id: string }[]>`
      insert into review_reply (
        organisation_id,
        review_id,
        current_body,
        publish_status
      )
      values (
        ${fixture.owner.organisationId},
        ${fixture.review.reviewId},
        ${fixture.body},
        'accepted'
      )
      returning id::text as id
    `
    const [attempt] = await admin<{ id: string }[]>`
      insert into publish_attempt (
        organisation_id,
        review_reply_id,
        draft_id,
        idempotency_key,
        request_body_hash,
        status,
        attempt_no,
        operation,
        intended_body,
        started_at,
        next_attempt_at,
        publish_generation,
        authorised_by,
        authorised_aal,
        authorised_security_version,
        authorised_connection_id,
        authorised_approval_required,
        authorised_two_person_approval
      )
      values (
        ${fixture.owner.organisationId},
        ${reply.id},
        ${fixture.draft.draftId},
        ${idempotencyKey},
        ${bodyHash},
        ${input.status},
        1,
        'publish',
        ${fixture.body},
        ${input.startedAt ?? new Date()},
        ${input.nextAttemptAt ?? null},
        0,
        ${authorisation.userId},
        ${authorisation.userId ? "aal1" : null},
        ${authorisation.securityVersion},
        ${authorisation.connectionId},
        ${policy?.approvalRequired ?? null},
        ${policy?.requireTwoPersonApproval ?? null}
      )
      returning id::text as id
    `
    await admin`
      update review
      set workflow_status = 'publish_requested'
      where id = ${fixture.review.reviewId}
    `
    return { attemptId: attempt.id, idempotencyKey }
  }

  function respondWithGoogleReply(comment: string | null) {
    stub.respond({ method: "GET", pathIncludes: "/reviews/" }, () => ({
      status: 200,
      json:
        comment === null
          ? { reviewId: "stub" }
          : {
              reviewId: "stub",
              reviewReply: {
                comment,
                updateTime: "2026-08-20T10:00:00.000Z",
              },
            },
    }))
  }

  it("records durable intent before calling Google", async () => {
    const fixture = await createFixture()
    stub.respond({ method: "PUT", pathIncludes: "/reply" }, () => ({
      status: 200,
      json: {
        comment: fixture.body,
        updateTime: "2026-08-20T10:00:00.000Z",
      },
      delayMs: 750,
    }))

    const publishPromise = publish(fixture)
    const inflight = await waitFor(
      async () => {
        const [attempt] = await admin<{ status: string; operation: string }[]>`
          select pa.status, pa.operation
          from publish_attempt pa
          join review_reply rr on rr.id = pa.review_reply_id
          where pa.organisation_id = ${fixture.owner.organisationId}
            and rr.review_id = ${fixture.review.reviewId}
          order by pa.started_at desc
          limit 1
        `
        return attempt
      },
      (attempt) => attempt?.status === "started"
    )
    const response = await publishPromise

    expect(inflight).toEqual({
      status: "started",
      operation: "publish",
    })
    expect(response.status, await response.clone().text()).toBe(200)
    // The intent records the approval policy it passed (0106), so a retry
    // can tell when it changed.
    const [recorded] = await admin<
      { matches: boolean; approvalRequired: boolean | null }[]
    >`
      select
        pa.authorised_approval_required = o.approval_required
          and pa.authorised_two_person_approval = o.require_two_person_approval
          as matches,
        pa.authorised_approval_required as "approvalRequired"
      from publish_attempt pa
      join review_reply rr on rr.id = pa.review_reply_id
      join organisation o on o.id = pa.organisation_id
      where rr.review_id = ${fixture.review.reviewId}
      order by pa.started_at desc
      limit 1
    `
    expect(recorded.approvalRequired).not.toBeNull()
    expect(recorded.matches).toBe(true)
    const [settled] = await admin<{ status: string }[]>`
      select pa.status
      from publish_attempt pa
      join review_reply rr on rr.id = pa.review_reply_id
      where rr.review_id = ${fixture.review.reviewId}
      order by pa.started_at desc
      limit 1
    `
    expect(settled.status).toBe("succeeded")
  }, 20_000)

  it("holds no open transaction during the Google call", async () => {
    const fixture = await createFixture()
    stub.respond({ method: "PUT", pathIncludes: "/reply" }, () => ({
      status: 200,
      json: {
        comment: fixture.body,
        updateTime: "2026-08-20T10:00:00.000Z",
      },
      delayMs: 750,
    }))

    const publishPromise = publish(fixture)
    await waitFor(
      () => stub.calls.some((call) => call.method === "PUT"),
      Boolean
    )
    const [{ count }] = await admin<{ count: number }[]>`
      select count(*)::int as count
      from pg_stat_activity
      where state = 'idle in transaction'
        and usename = 'naba_test_runtime'
    `
    const response = await publishPromise

    expect(count).toBe(0)
    expect(response.status, await response.clone().text()).toBe(200)
  }, 20_000)

  it("marks the attempt ambiguous when Google times out", async () => {
    const fixture = await createFixture()
    stub.respond({ method: "PUT", pathIncludes: "/reply" }, () => ({
      status: 200,
      json: {},
      delayMs: 25_000,
    }))

    const response = await publish(fixture)
    expect(response.status, await response.clone().text()).toBe(502)
    expect((await response.json()).error).toBe("google_mutation_ambiguous")
    const [attempt] = await admin<{ status: string }[]>`
        select pa.status
        from publish_attempt pa
        join review_reply rr on rr.id = pa.review_reply_id
        where rr.review_id = ${fixture.review.reviewId}
        order by pa.started_at desc
        limit 1
      `
    expect(attempt.status).toBe("ambiguous")
  }, 35_000)

  it("marks a 500 response ambiguous without retrying", async () => {
    const fixture = await createFixture()
    stub.respond({ method: "PUT", pathIncludes: "/reply" }, () => ({
      status: 500,
    }))

    const response = await publish(fixture)
    expect(response.status, await response.clone().text()).toBe(502)
    expect((await response.json()).error).toBe("google_mutation_ambiguous")
    expect(stub.calls.filter((call) => call.method === "PUT")).toHaveLength(1)
  })

  it("short-circuits a retried identical request", async () => {
    const fixture = await createFixture()
    const first = await publish(fixture)
    expect(first.status).toBe(200)
    const putsAfterFirst = stub.calls.filter(
      (call) => call.method === "PUT"
    ).length

    const second = await publish(fixture)
    expect(second.status).toBe(200)
    expect((await second.json()).idempotent).toBe(true)
    expect(stub.calls.filter((call) => call.method === "PUT")).toHaveLength(
      putsAfterFirst
    )
  })

  it("supersedes a queued delete when newer text is published", async () => {
    const fixture = await createFixture("Thank you for the note about parking.")
    expect((await publish(fixture)).status).toBe(200)

    // The delete is rate-limited, so it parks as 'retryable' with the DELETE
    // still armed for the next tick.
    stub.respond({ method: "DELETE", pathIncludes: "/reply" }, () => ({
      status: 429,
      json: { error: { status: "RESOURCE_EXHAUSTED", message: "slow down" } },
    }))
    const deleted = await fetch(
      `${server.baseUrl}/api/reviews/${fixture.review.reviewId}/reply`,
      { method: "DELETE", headers: { cookie: fixture.owner.cookie } }
    )
    expect(deleted.status, await deleted.clone().text()).toBe(429)
    const [queued] = await admin<{ id: string; status: string }[]>`
      select pa.id::text as id, pa.status
      from publish_attempt pa
      join review_reply rr on rr.id = pa.review_reply_id
      where rr.review_id = ${fixture.review.reviewId}
        and pa.operation = 'delete'
    `
    expect(queued.status).toBe("retryable")

    const newBody = "Thank you - we have added two more parking bays since."
    const detailResponse = await fetch(
      `${server.baseUrl}/api/reviews/${fixture.review.reviewId}`,
      { headers: { cookie: fixture.owner.cookie } }
    )
    const detail = (await detailResponse.json()) as {
      review: { updateTime: string }
    }
    const secondDraft = await saveHumanDraft(
      server.baseUrl,
      fixture.owner.cookie,
      fixture.review.reviewId,
      newBody
    )
    const deletesBeforeRepublish = stub.calls.filter(
      (call) => call.method === "DELETE"
    ).length
    const republish = await fetch(
      `${server.baseUrl}/api/reviews/${fixture.review.reviewId}/publish`,
      {
        method: "POST",
        headers: {
          cookie: fixture.owner.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          draftId: secondDraft.draftId,
          expectedReviewUpdateTime: detail.review.updateTime,
        }),
      }
    )
    expect(republish.status, await republish.clone().text()).toBe(200)

    // The armed delete is retired rather than left for the runner: replaying
    // it would remove the reply that was just published.
    const [retired] = await admin<
      { status: string; provider_error_code: string | null }[]
    >`
      select status, provider_error_code
      from publish_attempt
      where id = ${queued.id}
    `
    expect(retired).toEqual({
      status: "superseded",
      provider_error_code: "superseded_by_publish",
    })
    expect(stub.calls.filter((call) => call.method === "DELETE")).toHaveLength(
      deletesBeforeRepublish
    )
    const [live] = await admin<
      { current_body: string; publish_status: string }[]
    >`
      select current_body, publish_status
      from review_reply
      where review_id = ${fixture.review.reviewId}
    `
    expect(live).toEqual({
      current_body: newBody,
      publish_status: "published",
    })
  })

  it("refuses to publish a draft for a restricted review", async () => {
    const fixture = await createFixture()
    await admin`
      update review
      set restricted_at = now()
      where id = ${fixture.review.reviewId}
    `

    const response = await publish(fixture)
    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe("review_restricted")
    expect(stub.calls.filter((call) => call.method === "PUT")).toHaveLength(0)
  })

  it("kills a queued retry when the review is restricted after it is queued", async () => {
    const fixture = await createFixture()
    const seeded = await seedPublishAttempt(fixture, {
      status: "retryable",
      nextAttemptAt: new Date(Date.now() - 60_000),
    })
    await admin`
        update review
        set restricted_at = now()
        where id = ${fixture.review.reviewId}
      `
    // Any attempt left over from an earlier case recovers harmlessly
    // against this readback; the assertions below are scoped to this
    // review's own resource name.
    stub.reset()
    stub.respond({ method: "GET", pathIncludes: "/reviews/" }, () => ({
      status: 200,
      json: { reviewId: "stub" },
    }))

    const ran = await runJobs()
    expect(ran.status, await ran.clone().text()).toBe(200)

    expect(
      stub.calls.filter(
        (call) =>
          call.method === "PUT" && call.path.includes(fixture.review.reviewId)
      )
    ).toHaveLength(0)
    const [settled] = await admin<
      {
        status: string
        provider_error_code: string | null
        publish_status: string
        workflow_status: string
      }[]
    >`
        select
          pa.status,
          pa.provider_error_code,
          rr.publish_status,
          r.workflow_status
        from publish_attempt pa
        join review_reply rr on rr.id = pa.review_reply_id
        join review r on r.id = rr.review_id
        where pa.id = ${seeded.attemptId}
      `
    expect(settled).toEqual({
      status: "failed",
      provider_error_code: "review_restricted",
      publish_status: "failed",
      workflow_status: "failed",
    })
  }, 30_000)

  describe("a queued retry rechecks who authorised it (P02-S9)", () => {
    async function runRetry(
      fixture: Fixture,
      seeded: { attemptId: string }
    ) {
      stub.reset()
      stub.respond({ method: "GET", pathIncludes: "/reviews/" }, () => ({
        status: 200,
        json: { reviewId: "stub" },
      }))
      stub.respond({ method: "PUT", pathIncludes: "/reply" }, () => ({
        status: 200,
        json: { comment: fixture.body, updateTime: "2026-08-20T10:00:00.000Z" },
      }))
      const ran = await runJobs()
      expect(ran.status, await ran.clone().text()).toBe(200)
      const puts = stub.calls.filter(
        (call) =>
          call.method === "PUT" && call.path.includes(fixture.review.reviewId)
      )
      const [settled] = await admin<
        {
          status: string
          code: string | null
          publishStatus: string
          reason: string | null
        }[]
      >`
        select
          pa.status,
          pa.provider_error_code as code,
          rr.publish_status as "publishStatus",
          (
            select e.payload->>'reason'
            from publish_attempt_event e
            where e.publish_attempt_id = pa.id
              and e.event_type = 'completed'
            order by e.created_at desc
            limit 1
          ) as reason
        from publish_attempt pa
        join review_reply rr on rr.id = pa.review_reply_id
        where pa.id = ${seeded.attemptId}
      `
      return { puts, settled }
    }

    async function queued(
      authorisation?: Parameters<typeof seedPublishAttempt>[1]["authorisation"]
    ) {
      const fixture = await createFixture()
      const seeded = await seedPublishAttempt(fixture, {
        status: "retryable",
        nextAttemptAt: new Date(Date.now() - 60_000),
        authorisation,
      })
      return { fixture, seeded }
    }

    it("replays when the authorisation still holds", async () => {
      const { fixture, seeded } = await queued()
      const { puts, settled } = await runRetry(fixture, seeded)
      expect(puts).toHaveLength(1)
      expect(settled.status).toBe("succeeded")
    }, 30_000)

    it("refuses a person removed from the organisation", async () => {
      const fixture = await createFixture()
      const leaver = randomUUID()
      await admin`
        insert into app_user (id, email, display_name, default_organisation_id)
        values (
          ${leaver}, ${`harness-${leaver.slice(0, 8)}@nabapresence.test`},
          'Leaver', ${fixture.owner.organisationId}
        )
      `
      await admin`
        insert into member (organisation_id, user_id, role, can_publish)
        values (${fixture.owner.organisationId}, ${leaver}, 'admin', true)
      `
      const seeded = await seedPublishAttempt(fixture, {
        status: "retryable",
        nextAttemptAt: new Date(Date.now() - 60_000),
        authorisation: { userId: leaver },
      })
      await admin`
        delete from member
        where organisation_id = ${fixture.owner.organisationId}
          and user_id = ${leaver}
      `
      const { puts, settled } = await runRetry(fixture, seeded)
      expect(puts).toHaveLength(0)
      expect(settled).toEqual({
        status: "failed",
        code: "authorisation_revoked",
        publishStatus: "failed",
        reason: "actor_not_member",
      })
    }, 30_000)

    it("refuses a person who lost the publish grant", async () => {
      // A second publisher, so demoting them leaves the owner in place
      // (the last owner cannot be demoted).
      const fixture = await createFixture()
      const publisher = randomUUID()
      await admin`
        insert into app_user (id, email, display_name, default_organisation_id)
        values (
          ${publisher}, ${`harness-${publisher.slice(0, 8)}@nabapresence.test`},
          'Publisher', ${fixture.owner.organisationId}
        )
      `
      await admin`
        insert into member (organisation_id, user_id, role, can_publish)
        values (${fixture.owner.organisationId}, ${publisher}, 'admin', true)
      `
      const seeded = await seedPublishAttempt(fixture, {
        status: "retryable",
        nextAttemptAt: new Date(Date.now() - 60_000),
        authorisation: { userId: publisher },
      })
      await admin`
        update member set role = 'viewer', can_publish = false
        where organisation_id = ${fixture.owner.organisationId}
          and user_id = ${publisher}
      `
      const { puts, settled } = await runRetry(fixture, seeded)
      expect(puts).toHaveLength(0)
      expect(settled).toMatchObject({
        status: "failed",
        code: "authorisation_revoked",
        reason: "action_denied",
      })
    }, 30_000)

    it("refuses when the location moved to another Google connection", async () => {
      const { fixture, seeded } = await queued({ connectionId: randomUUID() })
      const { puts, settled } = await runRetry(fixture, seeded)
      expect(puts).toHaveLength(0)
      expect(settled).toMatchObject({
        status: "failed",
        code: "authorisation_revoked",
        reason: "connection_changed",
      })
    }, 30_000)

    it("refuses after the person's security version was bumped", async () => {
      const { fixture, seeded } = await queued()
      await admin`
        update app_user set security_version = security_version + 1
        where id = ${fixture.owner.userId}
      `
      const { puts, settled } = await runRetry(fixture, seeded)
      expect(puts).toHaveLength(0)
      expect(settled).toMatchObject({
        status: "failed",
        code: "authorisation_revoked",
        reason: "security_version_changed",
      })
    }, 30_000)

    it("refuses a publish queued before approval was turned on", async () => {
      const { fixture, seeded } = await queued({
        policy: { approvalRequired: false, requireTwoPersonApproval: false },
      })
      await admin`
        update organisation
        set approval_required = true
        where id = ${fixture.owner.organisationId}
      `
      const { puts, settled } = await runRetry(fixture, seeded)
      expect(puts).toHaveLength(0)
      expect(settled).toEqual({
        status: "failed",
        code: "authorisation_revoked",
        publishStatus: "failed",
        reason: "policy_changed",
      })
    }, 30_000)

    it("refuses a publish queued before two-person approval was turned on", async () => {
      const { fixture, seeded } = await queued()
      await admin`
        update organisation
        set require_two_person_approval = not require_two_person_approval
        where id = ${fixture.owner.organisationId}
      `
      const { puts, settled } = await runRetry(fixture, seeded)
      expect(puts).toHaveLength(0)
      expect(settled).toMatchObject({
        status: "failed",
        code: "authorisation_revoked",
        reason: "policy_changed",
      })
    }, 30_000)

    it("refuses a publish with no approval policy recorded", async () => {
      const { fixture, seeded } = await queued({ policy: null })
      const { puts, settled } = await runRetry(fixture, seeded)
      expect(puts).toHaveLength(0)
      expect(settled).toMatchObject({
        status: "failed",
        code: "authorisation_unverifiable",
        reason: "policy_missing",
      })
    }, 30_000)

    it("rechecks and replays a row queued before 0106 once backfilled", async () => {
      const { fixture, seeded } = await queued({
        userId: null,
        securityVersion: null,
        connectionId: null,
        policy: null,
      })
      await admin`
        insert into audit_log (
          organisation_id, actor_user_id, action, subject_type, subject_id,
          metadata
        )
        values (
          ${fixture.owner.organisationId}, ${fixture.owner.userId},
          'review.reply.publish_requested', 'review',
          ${fixture.review.reviewId},
          ${admin.json({ publishAttemptId: seeded.attemptId })}
        )
      `
      // The live-row backfill exactly as 0106 runs it.
      const migration = readFileSync(
        join(process.cwd(), "supabase/migrations/0106_authorised_dispatch.sql"),
        "utf8"
      )
      const start = migration.indexOf("update publish_attempt pa")
      const backfill = migration.slice(start, migration.indexOf(";", start))
      expect(start).toBeGreaterThan(0)
      await admin.unsafe(backfill)
      const [row] = await admin<
        {
          by: string | null
          connection: string | null
          version: number | null
          policyRecorded: boolean
        }[]
      >`
        select authorised_by::text as by,
          authorised_connection_id::text as connection,
          authorised_security_version as version,
          authorised_approval_required is not null
            and authorised_two_person_approval is not null as "policyRecorded"
        from publish_attempt where id = ${seeded.attemptId}
      `
      expect(row).toEqual({
        by: fixture.owner.userId,
        connection: fixture.connectionId,
        version: null,
        policyRecorded: true,
      })
      const { puts, settled } = await runRetry(fixture, seeded)
      expect(puts).toHaveLength(1)
      expect(settled.status).toBe("succeeded")
    }, 30_000)

    it("refuses a row queued before authorisations were recorded", async () => {
      const { fixture, seeded } = await queued({
        userId: null,
        securityVersion: null,
        connectionId: null,
      })
      const { puts, settled } = await runRetry(fixture, seeded)
      expect(puts).toHaveLength(0)
      expect(settled).toMatchObject({
        status: "failed",
        code: "authorisation_unverifiable",
        reason: "authorised_by_missing",
      })
    }, 30_000)
  })

  it("permits republishing identical text after a delete", async () => {
    const body = "Thank you for the kind words about our breakfast."
    const fixture = await createFixture(body)

    const first = await publish(fixture)
    expect(first.status).toBe(200)
    const [firstReply] = await admin<{ firstPublishedAt: Date }[]>`
      select first_published_at as "firstPublishedAt"
      from review_reply
      where review_id = ${fixture.review.reviewId}
    `
    const deleted = await fetch(
      `${server.baseUrl}/api/reviews/${fixture.review.reviewId}/reply`,
      {
        method: "DELETE",
        headers: { cookie: fixture.owner.cookie },
      }
    )
    expect(deleted.status).toBe(200)
    const detailResponse = await fetch(
      `${server.baseUrl}/api/reviews/${fixture.review.reviewId}`,
      { headers: { cookie: fixture.owner.cookie } }
    )
    const detail = (await detailResponse.json()) as {
      review: { updateTime: string }
    }
    const secondDraft = await saveHumanDraft(
      server.baseUrl,
      fixture.owner.cookie,
      fixture.review.reviewId,
      body
    )
    const republish = await fetch(
      `${server.baseUrl}/api/reviews/${fixture.review.reviewId}/publish`,
      {
        method: "POST",
        headers: {
          cookie: fixture.owner.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          draftId: secondDraft.draftId,
          expectedReviewUpdateTime: detail.review.updateTime,
        }),
      }
    )

    expect(republish.status).toBe(200)
    expect(stub.calls.filter((call) => call.method === "PUT")).toHaveLength(2)
    const [republishedReply] = await admin<{ firstPublishedAt: Date }[]>`
      select first_published_at as "firstPublishedAt"
      from review_reply
      where review_id = ${fixture.review.reviewId}
    `
    expect(republishedReply.firstPublishedAt.toISOString()).toBe(
      firstReply.firstPublishedAt.toISOString()
    )
    const attempts = await admin<
      { idempotency_key: string; operation: string; status: string }[]
    >`
      select
        pa.idempotency_key,
        pa.operation,
        pa.status
      from publish_attempt pa
      join review_reply rr on rr.id = pa.review_reply_id
      where rr.review_id = ${fixture.review.reviewId}
      order by pa.started_at
    `
    expect(attempts).toHaveLength(3)
    expect(attempts.map((attempt) => attempt.operation)).toEqual([
      "publish",
      "delete",
      "publish",
    ])
    expect(attempts[0].idempotency_key).not.toBe(attempts[2].idempotency_key)
  })

  it("rejects publish without expectedReviewUpdateTime", async () => {
    const fixture = await createFixture()
    const response = await fetch(
      `${server.baseUrl}/api/reviews/${fixture.review.reviewId}/publish`,
      {
        method: "POST",
        headers: {
          cookie: fixture.owner.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ draftId: fixture.draft.draftId }),
      }
    )

    expect(response.status).toBe(400)
  })

  it("rejects publish when the review version changed after drafting", async () => {
    const fixture = await createFixture()
    await admin`
      update review
      set update_time = now(), review_text = 'edited!'
      where id = ${fixture.review.reviewId}
    `

    const response = await publish(fixture)
    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe("review_changed")
  })

  it("rejects publish when the server-side evidence hash changed", async () => {
    const fixture = await createFixture()
    const detailResponse = await fetch(
      `${server.baseUrl}/api/reviews/${fixture.review.reviewId}`,
      { headers: { cookie: fixture.owner.cookie } }
    )
    const detail = (await detailResponse.json()) as {
      review: { updateTime: string }
    }
    await admin`
      update review
      set review_text = 'silently different'
      where id = ${fixture.review.reviewId}
    `

    const response = await fetch(
      `${server.baseUrl}/api/reviews/${fixture.review.reviewId}/publish`,
      {
        method: "POST",
        headers: {
          cookie: fixture.owner.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          draftId: fixture.draft.draftId,
          expectedReviewUpdateTime: detail.review.updateTime,
        }),
      }
    )
    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe("stale_draft_evidence")
  })

  it("records a provider-rejected publish without counting it as published", async () => {
    const fixture = await createFixture()
    stub.respond({ method: "PUT", pathIncludes: "/reply" }, () => ({
      status: 200,
      json: {
        comment: fixture.body,
        updateTime: "2026-08-20T10:00:00.000Z",
        state: "REJECTED",
        policyViolation: "SPAM",
      },
    }))

    const response = await publish(fixture)
    expect(response.status).toBe(200)
    expect((await response.json()).googleReplyState).toBe("REJECTED")
    const [state] = await admin<
      {
        publish_status: string
        first_published_at: Date | null
        workflow_status: string
      }[]
    >`
      select
        rr.publish_status,
        rr.first_published_at,
        r.workflow_status
      from review_reply rr
      join review r on r.id = rr.review_id
      where rr.review_id = ${fixture.review.reviewId}
    `
    expect(state).toEqual({
      publish_status: "rejected",
      first_published_at: null,
      workflow_status: "rejected",
    })
  })

  it("ingests review-level moderation state from a backfill", async () => {
    const fixture = await createFixture()
    stub.respond({ method: "GET", pathIncludes: "/reviews" }, () => ({
      status: 200,
      json: {
        reviews: [
          {
            ...moderationFixtures.rejected,
            name: fixture.review.googleReviewName,
          },
        ],
      },
    }))

    const response = await fetch(`${server.baseUrl}/api/sync/backfill`, {
      method: "POST",
      headers: {
        cookie: fixture.owner.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        externalLocationIds: [fixture.review.externalLocationId],
        maxPagesPerLocation: 1,
      }),
    })
    expect(response.status, await response.clone().text()).toBe(200)
    const [reply] = await admin<
      { google_reply_state: string; publish_status: string }[]
    >`
      select google_reply_state, publish_status
      from review_reply
      where review_id = ${fixture.review.reviewId}
    `
    expect(reply).toEqual({
      google_reply_state: "REJECTED",
      publish_status: "rejected",
    })
  })

  it("settles an ambiguous attempt when Google has the intended reply", async () => {
    const fixture = await createFixture()
    const seeded = await seedPublishAttempt(fixture, {
      status: "ambiguous",
    })
    respondWithGoogleReply(fixture.body)

    const response = await publish(fixture)
    expect(response.status, await response.clone().text()).toBe(200)
    expect(stub.calls.filter((call) => call.method === "GET")).toHaveLength(1)
    expect(stub.calls.filter((call) => call.method === "PUT")).toHaveLength(0)
    const [attempt] = await admin<{ status: string }[]>`
      select status from publish_attempt where id = ${seeded.attemptId}
    `
    expect(attempt.status).toBe("succeeded")
  })

  it("keeps a rejection Google returned to the recovery readback", async () => {
    const fixture = await createFixture()
    const seeded = await seedPublishAttempt(fixture, { status: "ambiguous" })
    // Google applied the reply and then rejected it: the comment matches, so
    // the recovery succeeds, but the moderation verdict has to survive.
    stub.respond({ method: "GET", pathIncludes: "/reviews/" }, () => ({
      status: 200,
      json: {
        reviewId: "stub",
        reviewReply: {
          comment: fixture.body,
          updateTime: "2026-08-20T10:00:00.000Z",
          policyViolation: "SPAM",
        },
        reviewReplyState: "REJECTED",
      },
    }))

    const response = await publish(fixture)
    expect(response.status, await response.clone().text()).toBe(200)
    expect((await response.json()).status).toBe("rejected")
    expect(stub.calls.filter((call) => call.method === "PUT")).toHaveLength(0)
    const [attempt] = await admin<{ status: string }[]>`
      select status from publish_attempt where id = ${seeded.attemptId}
    `
    expect(attempt.status).toBe("succeeded")
    const [settled] = await admin<
      {
        publish_status: string
        google_reply_state: string
        first_published_at: Date | null
        workflow_status: string
      }[]
    >`
      select
        rr.publish_status,
        rr.google_reply_state,
        rr.first_published_at,
        r.workflow_status
      from review_reply rr
      join review r on r.id = rr.review_id
      where rr.review_id = ${fixture.review.reviewId}
    `
    expect(settled).toEqual({
      publish_status: "rejected",
      google_reply_state: "REJECTED",
      first_published_at: null,
      workflow_status: "rejected",
    })
  })

  it("re-sends once when an ambiguous publish was not applied", async () => {
    const fixture = await createFixture()
    await seedPublishAttempt(fixture, { status: "ambiguous" })
    respondWithGoogleReply(null)

    const response = await publish(fixture)
    expect(response.status).toBe(200)
    expect(stub.calls.filter((call) => call.method === "GET")).toHaveLength(1)
    expect(stub.calls.filter((call) => call.method === "PUT")).toHaveLength(1)
  })

  it("fails safely when the provider reply diverged", async () => {
    const fixture = await createFixture()
    const seeded = await seedPublishAttempt(fixture, {
      status: "ambiguous",
    })
    respondWithGoogleReply("A different reply is live.")

    const response = await publish(fixture)
    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe("reply_diverged")
    expect(stub.calls.filter((call) => call.method === "PUT")).toHaveLength(0)
    const [attempt] = await admin<{ status: string }[]>`
      select status from publish_attempt where id = ${seeded.attemptId}
    `
    expect(attempt.status).toBe("failed")
  })

  it("recovers a crashed publish after Google already applied it", async () => {
    const fixture = await createFixture()
    const seeded = await seedPublishAttempt(fixture, {
      status: "started",
      startedAt: new Date(Date.now() - 10 * 60 * 1000),
    })
    respondWithGoogleReply(fixture.body)

    const response = await publish(fixture)
    expect(response.status, await response.clone().text()).toBe(200)
    expect(stub.calls.filter((call) => call.method === "GET")).toHaveLength(1)
    expect(stub.calls.filter((call) => call.method === "PUT")).toHaveLength(0)
    const [attempt] = await admin<{ status: string }[]>`
      select status from publish_attempt where id = ${seeded.attemptId}
    `
    expect(attempt.status).toBe("succeeded")
  })

  it("does not interfere with a fresh in-flight publish", async () => {
    const fixture = await createFixture()
    await seedPublishAttempt(fixture, { status: "started" })

    const response = await publish(fixture)
    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe("publish_in_progress")
    expect(stub.calls).toHaveLength(0)
  })

  it("leaves an ambiguous attempt unresolved when the recovery GET times out", async () => {
    const fixture = await createFixture()
    const seeded = await seedPublishAttempt(fixture, {
      status: "ambiguous",
    })
    stub.respond({ method: "GET", pathIncludes: "/reviews/" }, () => ({
      status: 200,
      json: {},
      delayMs: 20_000,
    }))

    const response = await publish(fixture)
    expect(response.status).toBe(502)
    expect((await response.json()).error).toBe("google_mutation_ambiguous")
    expect(stub.calls.filter((call) => call.method === "GET")).toHaveLength(1)
    expect(stub.calls.filter((call) => call.method === "PUT")).toHaveLength(0)
    const [attempt] = await admin<{ status: string }[]>`
        select status from publish_attempt where id = ${seeded.attemptId}
      `
    expect(attempt.status).toBe("ambiguous")
  }, 25_000)
})
