import { randomUUID } from "node:crypto"

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

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

/**
 * Fault injection for the AI draft's credit ordering (W3-4 / R2B-05,
 * WP-04): the customer is charged only in the transaction that stores the
 * draft. A failure after the provider has answered, or a function killed
 * between the provider call and that transaction, leaves the balance as it
 * was and no settled charge behind. The faults are injected while the
 * verification call is in flight, which is exactly the window the audit
 * found charged-with-no-draft.
 */
describeDatabase("AI draft credit ordering", () => {
  let admin: ReturnType<typeof postgres>
  let stub: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const tenants: string[] = []
  /** Runs while the verification call is held open; set per test. */
  let duringVerification: (() => Promise<void>) | null = null

  const DRAFT = {
    reply: "Thank you for your kind review. We hope to welcome you back soon.",
    language: "en",
  }

  async function tenantWithReview() {
    const owner = await createTestTenant(admin)
    tenants.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const review = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    return { owner, review }
  }

  function draft(cookie: string, reviewId: string, intent: string) {
    return fetch(`${server.baseUrl}/api/reviews/${reviewId}/drafts`, {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        "idempotency-key": intent,
      },
      body: JSON.stringify({ tone: "warm_professional" }),
    })
  }

  async function draftLedger(organisationId: string) {
    return admin<
      {
        status: string
        credits: number
        inputTokens: number | null
        settledAt: Date | null
      }[]
    >`
      select status, credits, input_tokens as "inputTokens",
        settled_at as "settledAt"
      from ai_usage
      where organisation_id = ${organisationId} and kind = 'draft'
    `
  }

  async function draftCount(organisationId: string) {
    const [row] = await admin<{ count: number }[]>`
      select count(*)::integer as count from draft
      where organisation_id = ${organisationId}
    `
    return row.count
  }

  async function creditsUsed(cookie: string) {
    const response = await fetch(`${server.baseUrl}/api/ai/credits`, {
      headers: { cookie },
    })
    return ((await response.json()) as { used: number }).used
  }

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    stub = await startGoogleStub()
    stub.respond(
      { method: "POST", pathIncludes: "/v1/responses" },
      async (call) => {
        const isVerification = JSON.stringify(call.body).includes(
          "review_reply_verification"
        )
        if (isVerification && duringVerification) await duringVerification()
        return {
          status: 200,
          json: {
            status: "completed",
            output_text: JSON.stringify(
              isVerification
                ? {
                    unsupportedClaims: [],
                    unsafeEscalation: false,
                    toneMismatch: false,
                  }
                : DRAFT
            ),
            usage: { input_tokens: 100, output_tokens: 20 },
          },
        }
      }
    )
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: stub.baseUrl,
      OPENAI_API_KEY: "route-harness-dummy-openai-key",
      OPENAI_BASE_URL: stub.baseUrl,
    })
  })

  afterAll(async () => {
    await server.stop()
    await stub.stop()
    await destroyTenants(admin, tenants)
    await admin.end()
  })

  it("charges nothing when the draft cannot be stored after generation", async () => {
    const { owner, review } = await tenantWithReview()
    const usedBefore = await creditsUsed(owner.cookie)
    // The review is restricted while the reply is being verified, so phase
    // three refuses to store the draft (409 review_restricted).
    duringVerification = async () => {
      await admin`
        update review set restricted_at = now() where id = ${review.reviewId}
      `
    }
    try {
      const response = await draft(owner.cookie, review.reviewId, randomUUID())
      const body = (await response.json()) as { error?: string }
      expect(response.status, JSON.stringify(body)).toBe(409)
      expect(body.error).toBe("review_restricted")
    } finally {
      duringVerification = null
    }

    expect(await draftCount(owner.organisationId)).toBe(0)
    // Released, not settled: no credit, but the provider's tokens are kept
    // for the token backstop.
    expect(await draftLedger(owner.organisationId)).toEqual([
      expect.objectContaining({
        status: "released",
        credits: 0,
        inputTokens: 100,
      }),
    ])
    expect(await creditsUsed(owner.cookie)).toBe(usedBefore)
  }, 30_000)

  it("never charges a draft whose function is killed before it is stored", async () => {
    const { owner, review } = await tenantWithReview()
    const usedBefore = await creditsUsed(owner.cookie)
    let arrived!: () => void
    const verificationArrived = new Promise<void>((resolve) => {
      arrived = resolve
    })
    let proceed!: () => void
    const proceedGate = new Promise<void>((resolve) => {
      proceed = resolve
    })
    duringVerification = async () => {
      arrived()
      await proceedGate
    }
    try {
      const pending = draft(owner.cookie, review.reviewId, randomUUID())
      await verificationArrived

      // Generation has been paid for and the request is between provider
      // calls: the credit is only held, nothing is settled, no draft exists.
      // This is the moment a platform kill used to leave a charge behind.
      const [held] = await draftLedger(owner.organisationId)
      expect(held).toMatchObject({ status: "reserved", credits: 1 })
      expect(held.settledAt).toBeNull()
      expect(await draftCount(owner.organisationId)).toBe(0)

      // The function dies here; the job tick's reaper finds the reservation
      // once it is stale and releases it rather than settling it.
      await admin`
        update ai_usage set created_at = created_at - interval '11 minutes'
        where organisation_id = ${owner.organisationId} and kind = 'draft'
      `
      const [reaped] = await admin<{ released: number }[]>`
        select release_stale_ai_reservations(10) as released
      `
      expect(reaped.released).toBeGreaterThanOrEqual(1)
      expect(await draftLedger(owner.organisationId)).toEqual([
        expect.objectContaining({ status: "released", credits: 0 }),
      ])
      expect(await creditsUsed(owner.cookie)).toBe(usedBefore)

      // A killed function never comes back. Ours is still alive, so let it
      // end the way a dead one would have: without storing a draft.
      await admin`
        update review set restricted_at = now() where id = ${review.reviewId}
      `
      proceed()
      expect((await pending).status).toBe(409)
    } finally {
      duringVerification = null
      proceed()
    }

    expect(await draftCount(owner.organisationId)).toBe(0)
    expect(await draftLedger(owner.organisationId)).toEqual([
      expect.objectContaining({ status: "released", credits: 0 }),
    ])
    expect(await creditsUsed(owner.cookie)).toBe(usedBefore)
  }, 30_000)

  it("releases an abandoned generation when it is retried, so it is not charged", async () => {
    const { owner, review } = await tenantWithReview()
    const intent = randomUUID()
    let arrived!: () => void
    const verificationArrived = new Promise<void>((resolve) => {
      arrived = resolve
    })
    let proceed!: () => void
    const proceedGate = new Promise<void>((resolve) => {
      proceed = resolve
    })
    duringVerification = async () => {
      arrived()
      await proceedGate
    }
    try {
      const pending = draft(owner.cookie, review.reviewId, intent)
      await verificationArrived
      // The first request has outlived any function limit (it was killed):
      // a retry under the same key releases it and says so.
      await admin`
        update ai_usage set created_at = created_at - interval '3 minutes'
        where organisation_id = ${owner.organisationId} and kind = 'draft'
      `
      const retry = await draft(owner.cookie, review.reviewId, intent)
      const body = (await retry.json()) as { error?: string }
      expect(retry.status, JSON.stringify(body)).toBe(409)
      expect(body.error).toBe("generation_not_repeatable")
      expect(await draftLedger(owner.organisationId)).toEqual([
        expect.objectContaining({ status: "released", credits: 0 }),
      ])

      await admin`
        update review set restricted_at = now() where id = ${review.reviewId}
      `
      proceed()
      expect((await pending).status).toBe(409)
    } finally {
      duringVerification = null
      proceed()
    }
    expect(await draftCount(owner.organisationId)).toBe(0)
    expect(await creditsUsed(owner.cookie)).toBe(0)
  }, 30_000)

  it("still charges exactly one credit for a draft that is stored", async () => {
    const { owner, review } = await tenantWithReview()
    const response = await draft(owner.cookie, review.reviewId, randomUUID())
    expect(response.status, await response.clone().text()).toBe(201)
    expect(await draftCount(owner.organisationId)).toBe(1)
    expect(await draftLedger(owner.organisationId)).toEqual([
      expect.objectContaining({ status: "settled", credits: 1 }),
    ])
    expect(await creditsUsed(owner.cookie)).toBe(1)
  }, 30_000)
})
