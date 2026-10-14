import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  hoursStateSchema,
  type HoursState,
} from "@/lib/contracts/location-hours"
import type { GoogleLocationHours } from "@/lib/domain/hours"
import { mixedHoursFixture } from "../../fixtures/hours-preservation"
import { startAppServer } from "../helpers/app-server"
import {
  startGoogleStub,
  type GoogleStub,
  type GoogleStubCall,
} from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedReview,
} from "../helpers/tenant"

const describeDatabase =
  process.env.RUN_DB_TESTS === "true" ? describe : describe.skip

// The hours publish through its Google write session (W4-01 / WP-02,
// lib/server/google-write-session.ts): what the person sees when the lock
// connection dies after Google applied the write, when the hours lock is
// busy, and when too little time is left to send the write.
describeDatabase("hours publish write session", () => {
  let admin: ReturnType<typeof postgres>
  let google: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  // A mutation timeout longer than what is left after a slow validate.
  let slowServer: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 2 })
    google = await startGoogleStub({ port: 0 })
    const env = {
      GOOGLE_API_PROXY_BASE: google.baseUrl,
      GBP_PROFILE_WRITES_ENABLED: "true",
      PUBLISH_ENABLED: "true",
    }
    server = await startAppServer(env)
    slowServer = await startAppServer({
      ...env,
      GOOGLE_MUTATION_TIMEOUT_MS: "45000",
    })
  }, 60_000)

  afterAll(async () => {
    await server?.stop()
    await slowServer?.stop()
    await google?.stop()
    if (admin) {
      await destroyTenants(admin, organisations)
      await admin.end()
    }
  })

  async function fixture(
    onPatch: (call: GoogleStubCall, validateOnly: boolean) => Promise<void>
  ) {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const linked = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    let location: GoogleLocationHours = {
      ...structuredClone(mixedHoursFixture),
      name: linked.googleLocationName,
      categories: { primaryCategory: { name: `gcid:${linked.locationId}` } },
    }
    google.respond(
      { method: "GET", pathIncludes: `/v1/${linked.googleLocationName}` },
      () => ({ status: 200, json: location })
    )
    google.respond(
      {
        method: "GET",
        pathIncludes: encodeURIComponent(`gcid:${linked.locationId}`),
      },
      () => ({
        status: 200,
        json: {
          categories: [
            {
              name: `gcid:${linked.locationId}`,
              moreHoursTypes: [
                { hoursTypeId: "KITCHEN", displayName: "Kitchen" },
                { hoursTypeId: "BAR", displayName: "Synthetic bar" },
              ],
            },
          ],
        },
      })
    )
    const patches: { validateOnly: boolean }[] = []
    google.respond(
      { method: "PATCH", pathIncludes: `/v1/${linked.googleLocationName}` },
      async (call) => {
        const validateOnly =
          new URL(call.path, google.baseUrl).searchParams.get(
            "validateOnly"
          ) === "true"
        patches.push({ validateOnly })
        await onPatch(call, validateOnly)
        if (!validateOnly) {
          location = { ...location, ...(call.body as GoogleLocationHours) }
        }
        return { status: 200, json: location }
      }
    )
    const path = `/api/locations/${linked.locationId}/hours`
    const headers = { cookie: owner.cookie, "content-type": "application/json" }
    /** Saves a changed Monday and returns the state to publish. */
    const reviewed = async (): Promise<HoursState> => {
      const read = async () => {
        const response = await fetch(`${server.baseUrl}${path}`, { headers })
        expect(response.status, await response.clone().text()).toBe(200)
        return hoursStateSchema.parse((await response.json()).hours)
      }
      const initial = await read()
      initial.canonical.regular[1].periods[0].opensAt = "10:30"
      const saved = await fetch(`${server.baseUrl}${path}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          expectedCanonicalRevision: initial.canonicalResource.revision,
          hours: initial.canonical,
        }),
      })
      expect(saved.status, await saved.clone().text()).toBe(200)
      return read()
    }
    const publish = (state: HoursState, intentId: string, base = server) =>
      fetch(`${base.baseUrl}${path}`, {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": intentId },
        body: JSON.stringify({
          confirmation: "publish_nabapresence_hours_to_google",
          expectedCanonicalRevision: state.canonicalResource.revision,
          expectedCanonicalHash: state.canonicalHash,
          expectedGoogleHash: state.googleHash,
          approvedUpdateMask: state.updateMask,
          confirmOverwriteGoogleChanges: false,
        }),
      })
    const attempts = () =>
      admin<{ status: string }[]>`
        select status from hours_sync_attempt
        where organisation_id = ${owner.organisationId}`
    const receipt = async (intentId: string) => {
      const [row] = await admin<{ state: string }[]>`
        select state from mutation_operation
        where organisation_id = ${owner.organisationId}
          and intent_id = ${intentId}`
      return row?.state ?? null
    }
    const lockKey = `${owner.organisationId}:${linked.locationId}:hours`
    const lockIsFree = () =>
      admin.begin(async (sql) => {
        const [row] = await sql<{ acquired: boolean }[]>`
          select pg_try_advisory_xact_lock(hashtextextended(${lockKey}, 0)) as acquired`
        return row.acquired
      })
    return {
      reviewed,
      publish,
      patches,
      attempts,
      receipt,
      lockKey,
      lockIsFree,
    }
  }

  it("answers 200 with the settled outcome when the lock connection dies after Google applied the write", async () => {
    const f = await fixture(async (_call, validateOnly) => {
      if (validateOnly) return
      // The idle-in-transaction kill, or any other loss of the lock
      // backend, while Google is applying the write.
      const killed = await admin<{ killed: boolean }[]>`
        select pg_terminate_backend(pid) as killed
        from pg_stat_activity
        where datname = current_database()
          and state = 'idle in transaction'
          and query like '%pg_advisory_xact_lock%'`
      expect(killed.map((row) => row.killed)).toContain(true)
    })
    const state = await f.reviewed()
    const intentId = randomUUID()
    const response = await f.publish(state, intentId)
    const body = await response.json()
    expect(response.status, JSON.stringify(body)).toBe(200)
    expect(body).toMatchObject({ status: "published", idempotent: false })
    expect(f.patches.filter((patch) => !patch.validateOnly)).toHaveLength(1)
    expect(await f.attempts()).toEqual([{ status: "succeeded" }])
    expect(await f.receipt(intentId)).toBe("confirmed_applied")
    expect(await f.lockIsFree()).toBe(true)
  }, 30_000)

  it("answers a busy hours lock with 409 google_write_busy, not a 30 s statement timeout", async () => {
    const f = await fixture(async () => {})
    const state = await f.reviewed()
    const holder = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    let release!: () => void
    const released = new Promise<void>((resolve) => (release = resolve))
    let locked!: () => void
    const held = new Promise<void>((resolve) => (locked = resolve))
    // A bulk hours child that holds the lock past the lock budget.
    const holding = holder.begin(async (sql) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${f.lockKey}, 0))`
      locked()
      await released
    })
    try {
      await held
      const startedAt = performance.now()
      const response = await f.publish(state, randomUUID())
      const elapsed = performance.now() - startedAt
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({
        error: "google_write_busy",
        retryable: true,
      })
      // The 10 s lock budget, well inside the role's 30 s statement timeout.
      expect(elapsed).toBeGreaterThan(9_000)
      expect(elapsed).toBeLessThan(20_000)
      expect(f.patches).toHaveLength(0)
      expect(await f.attempts()).toEqual([])
    } finally {
      release()
      await holding
      await holder.end()
    }
  }, 40_000)

  it("refuses a write it could not wait for in time, with nothing sent and the receipt failed", async () => {
    // The validate stalls 8 s; 45 s of mutation timeout no longer fits the
    // remaining budget, so the PATCH is refused before it is sent.
    const f = await fixture(async (_call, validateOnly) => {
      if (validateOnly)
        await new Promise((resolve) => setTimeout(resolve, 8_000))
    })
    const state = await f.reviewed()
    const intentId = randomUUID()
    const response = await f.publish(state, intentId, slowServer)
    const body = await response.json()
    expect(response.status, JSON.stringify(body)).toBe(503)
    expect(body).toMatchObject({
      error: "google_write_budget_exhausted",
      retryable: true,
    })
    expect(f.patches).toEqual([{ validateOnly: true }])
    expect(await f.attempts()).toEqual([{ status: "failed" }])
    expect(await f.receipt(intentId)).toBe("failed")
    expect(await f.lockIsFree()).toBe(true)
  }, 40_000)
})
