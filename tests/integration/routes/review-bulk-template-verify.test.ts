import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

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
const CRON = { authorization: "Bearer route-harness-cron-secret" }

/**
 * Template replies with semantic verification on. Every child the job tick
 * runs shares the tick's request id, so each child's draft must reserve its
 * verification call under a key of its own: a shared key reserves nothing
 * for the second child, which must never be read as the token backstop and
 * let a reply reach Google without the semantic pass.
 */
describeDatabase(
  "bulk template replies with semantic verification",
  { timeout: 60_000 },
  () => {
    let admin: ReturnType<typeof postgres>
    let stub: GoogleStub
    let server: Awaited<ReturnType<typeof startAppServer>>
    const organisations: string[] = []

    beforeAll(async () => {
      admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 2 })
      stub = await startGoogleStub()
      stub.respond(
        { method: "POST", pathIncludes: "/ai/v1/chat/completions" },
        () => ({
          status: 200,
          json: {
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: JSON.stringify({
                    unsupportedClaims: [],
                    unsafeEscalation: false,
                    toneMismatch: false,
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 20 },
          },
        })
      )
      server = await startAppServer({
        GOOGLE_API_PROXY_BASE: stub.baseUrl,
        PUBLISH_ENABLED: "true",
        JOBS_ENABLED: "true",
        WORKERS_AI_API_TOKEN: "route-harness-dummy-workers-ai-token",
        WORKERS_AI_ACCOUNT_ID: "a".repeat(32),
        WORKERS_AI_BASE_URL: stub.baseUrl,
      })
    })
    afterAll(async () => {
      await server.stop()
      await stub.stop()
      await destroyTenants(admin, organisations)
      await admin.end()
    })

    it("runs and records the semantic pass for every template child of one organisation in one tick", async () => {
      const owner = await createTestTenant(admin)
      organisations.push(owner.organisationId)
      await admin`
        insert into organisation_feature (organisation_id, feature, enabled, changed_by)
        values (${owner.organisationId}, 'bulk_actions', true, 'test')`
      const connection = await seedGoogleConnection(admin, {
        organisationId: owner.organisationId,
      })
      const reviews = await Promise.all(
        [0, 1, 2].map(() =>
          seedLinkedReview(admin, {
            organisationId: owner.organisationId,
            connectionId: connection.connectionId,
            googleAccountName: connection.googleAccountName,
            text: "",
            rating: 5,
          })
        )
      )
      const reviewIds = reviews.map((review) => review.reviewId)
      const started = await fetch(`${server.baseUrl}/api/reviews/bulk`, {
        method: "POST",
        headers: { cookie: owner.cookie, "content-type": "application/json" },
        body: JSON.stringify({ action: "template_reply", reviewIds }),
      })
      expect(started.status, await started.clone().text()).toBe(200)

      const tick = await fetch(`${server.baseUrl}/api/jobs/run`, {
        method: "POST",
        headers: CRON,
      })
      expect(tick.status, await tick.clone().text()).toBe(200)

      const verifications = stub.calls.filter(
        (call) =>
          call.method === "POST" &&
          call.path.includes("/ai/v1/chat/completions") &&
          JSON.stringify(call.body).includes("review_reply_verification")
      )
      expect(verifications).toHaveLength(3)
      const usage = await admin<{ status: string; requestId: string }[]>`
        select status, request_id as "requestId" from ai_usage
        where organisation_id = ${owner.organisationId} and kind = 'verify'`
      expect(usage).toHaveLength(3)
      expect(usage.every((row) => row.status === "settled")).toBe(true)
      expect(new Set(usage.map((row) => row.requestId)).size).toBe(3)
      const checked = await admin<{ checks: string; verdict: string }[]>`
        select v.checks_version as checks, v.verdict
        from verification_result v join draft d on d.id = v.draft_id
        where d.review_id in ${admin(reviewIds)}`
      expect(checked).toHaveLength(3)
      for (const row of checked)
        expect(row).toEqual({
          checks: "deterministic-v1+semantic-v2",
          verdict: "pass",
        })
      expect(
        stub.calls.filter(
          (call) => call.method === "PUT" && call.path.endsWith("/reply")
        )
      ).toHaveLength(3)
    })
  }
)
