import { describe, expect, it } from "vitest"

import {
  expectBootFailure,
  startAppServer,
} from "./helpers/app-server"

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
