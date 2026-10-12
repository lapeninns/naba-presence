import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { expectBootFailure, startAppServer } from "./helpers/app-server"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

describeDatabase("startup safety assertion", () => {
  it("boots on the runtime role", async () => {
    const server = await startAppServer()
    await server.stop()
  })

  it("refuses to boot with an RLS-bypassing admin identity", async () => {
    const message = await expectBootFailure({
      DATABASE_URL: process.env.DIRECT_DATABASE_URL!,
    })
    expect(message).toContain("BYPASSRLS")
  })

  it("refuses to boot with webhooks enabled and no OIDC audience", async () => {
    const message = await expectBootFailure({
      WEBHOOKS_ENABLED: "true",
    })
    expect(message).toContain("GOOGLE_PUBSUB_AUDIENCE")
  })

  it("refuses to boot with an audience but no service-account pin", async () => {
    const message = await expectBootFailure({
      WEBHOOKS_ENABLED: "true",
      GOOGLE_PUBSUB_AUDIENCE:
        "https://harness.invalid/api/webhooks/google/pubsub",
    })
    expect(message).toContain("GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL")
  })

  it("boots with webhooks enabled once the audience and pin are set", async () => {
    const server = await startAppServer({
      WEBHOOKS_ENABLED: "true",
      GOOGLE_PUBSUB_AUDIENCE:
        "https://harness.invalid/api/webhooks/google/pubsub",
      GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL:
        "pubsub-push@harness.iam.gserviceaccount.com",
    })
    await server.stop()
  })
})

describeDatabase("startup schema compatibility", () => {
  const savedEnv = { ...process.env }

  beforeAll(() => {
    process.env.DATABASE_URL = process.env.TEST_RUNTIME_DATABASE_URL!
    process.env.NEXTAUTH_URL = "http://127.0.0.1:3000"
    process.env.NEXTAUTH_SECRET = "schema-compat-test-secret-32-characters!"
    process.env.TOKEN_ENCRYPTION_KEY = "schema-compat-test-token-key-32-chars!!"
    process.env.CRON_SECRET = "schema-compat-test-cron-secret"
    process.env.LOCAL_BOOTSTRAP_ENABLED = "false"
    process.env.WEBHOOKS_ENABLED = "false"
    process.env.PASSWORD_AUTH_ENABLED = "false"
  })

  afterAll(async () => {
    await globalThis.__nabaSql?.end()
    globalThis.__nabaSql = undefined
    // getServerEnv caches the parsed env in its module, so drop the modules
    // too: a later test must not inherit the runtime-role URL and secrets.
    process.env = savedEnv
    vi.resetModules()
  })

  it("reads every shipped migration through the runtime role", async () => {
    const { readAppliedMigrations } = await import("@/lib/server/schema-compat")
    const { REQUIRED_MIGRATIONS } = await import("@/lib/server/schema-manifest")
    const applied = await readAppliedMigrations()
    expect(REQUIRED_MIGRATIONS.filter((v) => !applied.has(v))).toEqual([])
  })

  it("passes on the migrated database", async () => {
    const { assertProductionSafety } = await import("@/lib/server/startup")
    await expect(
      assertProductionSafety({ enforce: true })
    ).resolves.toBeUndefined()
  })

  it("refuses a build that needs a migration the database lacks", async () => {
    const { assertProductionSafety } = await import("@/lib/server/startup")
    const { REQUIRED_MIGRATIONS } = await import("@/lib/server/schema-manifest")
    await expect(
      assertProductionSafety({
        enforce: true,
        requiredMigrations: [...REQUIRED_MIGRATIONS, "9999_future_schema"],
      })
    ).rejects.toThrow("9999_future_schema")
  })
})
