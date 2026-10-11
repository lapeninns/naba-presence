import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { createTestTenant, destroyTenants } from "./helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

/**
 * Readiness reads a fixed handful of platform rows: no tenant walk. Counted
 * at the pool, through the real reads (schedulerLiveness, the pause
 * snapshot, the migration ledger and the incident aggregate included), with
 * the fleet as it is and with more organisations added.
 */
describeDatabase("readiness is bounded", () => {
  const savedEnv = { ...process.env }
  let admin: ReturnType<typeof postgres>
  let pool: ReturnType<typeof postgres>
  let statements = 0
  const created: string[] = []

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_RUNTIME_DATABASE_URL!
    process.env.NEXTAUTH_URL = "http://127.0.0.1:3000"
    process.env.NEXTAUTH_SECRET = "readiness-bounded-secret-32-characters!!"
    process.env.TOKEN_ENCRYPTION_KEY = "readiness-bounded-token-key-32-chars!!"
    process.env.CRON_SECRET = "readiness-bounded-cron-secret"
    process.env.LOCAL_BOOTSTRAP_ENABLED = "false"
    process.env.WEBHOOKS_ENABLED = "false"
    process.env.PASSWORD_AUTH_ENABLED = "false"
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    pool = postgres(process.env.TEST_RUNTIME_DATABASE_URL!, {
      max: 4,
      prepare: false,
    })
    // Every tagged-template call on the shared pool, wherever it is made.
    globalThis.__nabaSql = new Proxy(pool, {
      apply(target, thisArg, args) {
        statements += 1
        return Reflect.apply(target, thisArg, args)
      },
    })
  })

  afterAll(async () => {
    await destroyTenants(admin, created)
    globalThis.__nabaSql = undefined
    await pool?.end()
    await admin?.end()
    process.env = savedEnv
    vi.resetModules()
  })

  async function countReadiness() {
    const { readiness } = await import("@/lib/server/readiness")
    const { invalidatePauseCache } = await import("@/lib/server/pause-controls")
    invalidatePauseCache()
    statements = 0
    const answer = await readiness()
    expect(answer.database.reachable).toBe(true)
    return statements
  }

  it("issues the same statements however many organisations there are", async () => {
    const before = await countReadiness()
    expect(before).toBeGreaterThan(0)
    for (let index = 0; index < 5; index += 1) {
      const tenant = await createTestTenant(admin)
      created.push(tenant.organisationId)
    }
    expect(await countReadiness()).toBe(before)
  })
})
