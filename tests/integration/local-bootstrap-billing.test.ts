import { createHash } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const cookieJar = new Map<string, string>()
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name)
      return value === undefined ? undefined : { name, value }
    },
    set: (name: string, value: string) => {
      cookieJar.set(name, value)
    },
    delete: (name: string) => {
      cookieJar.delete(name)
    },
  }),
}))

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

const LOCAL_ORGANISATION_ID = "00000000-0000-4000-8000-000000000001"

/**
 * The local bootstrap (provision_local_bootstrap, migration 0005) creates
 * its organisation outside lib/server/provisioning.ts. It must still get an
 * explicit pilot billing record, or the local owner derives read-only.
 */
describeDatabase("local bootstrap billing", () => {
  let admin: ReturnType<typeof postgres>

  beforeAll(() => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    process.env.DATABASE_URL = process.env.TEST_RUNTIME_DATABASE_URL!
    process.env.NEXTAUTH_SECRET =
      "bootstrap-billing-test-session-secret-32-chars"
    process.env.TOKEN_ENCRYPTION_KEY =
      "bootstrap-billing-test-token-key-32-characters"
    process.env.CRON_SECRET = "bootstrap-billing-test-cron-secret"
  })

  afterAll(async () => {
    for (const token of cookieJar.values()) {
      const hash = createHash("sha256").update(token).digest("hex")
      await admin`delete from app_session where token_hash = ${hash}`
    }
    await admin.end()
  })

  it("gives the bootstrap organisation a pilot record and full access", async () => {
    // Start from an organisation without a record (a database migrated
    // before the bootstrap organisation existed has none).
    await admin`
      delete from organisation_billing
      where organisation_id = ${LOCAL_ORGANISATION_ID}
        and state = 'pilot'
    `
    const { ensureDevelopmentSession } = await import("@/lib/server/session")
    const session = await ensureDevelopmentSession()
    expect(session.organisationId).toBe(LOCAL_ORGANISATION_ID)
    expect(session.access).toMatchObject({ mode: "full", reason: "pilot" })
    const rows = await admin<{ state: string }[]>`
      select state from organisation_billing
      where organisation_id = ${LOCAL_ORGANISATION_ID}
    `
    expect(rows).toEqual([{ state: "pilot" }])
  })
})
