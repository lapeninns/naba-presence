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
})
