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

  it("boots with webhooks enabled once the audience is set", async () => {
    const server = await startAppServer({
      WEBHOOKS_ENABLED: "true",
      GOOGLE_PUBSUB_AUDIENCE:
        "https://harness.invalid/api/webhooks/google/pubsub",
    })
    await server.stop()
  })
})
