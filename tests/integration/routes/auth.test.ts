import { randomBytes } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { sha256 } from "@/lib/server/crypto"

import { startAppServer } from "../helpers/app-server"
import {
  createTestTenant,
  destroyTenants,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

describeDatabase("route auth", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    server = await startAppServer()
  })

  afterAll(async () => {
    await server.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  it("returns a null session when signed out (production mode)", async () => {
    const response = await fetch(`${server.baseUrl}/api/session`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ session: null })
  })

  it("rejects the inbox without a session", async () => {
    const response = await fetch(`${server.baseUrl}/api/reviews`)
    expect(response.status).toBe(401)
    expect((await response.json()).error).toBe(
      "authentication_required"
    )
  })

  it("returns the session for a minted cookie", async () => {
    const tenant = await createTestTenant(admin)
    organisations.push(tenant.organisationId)
    const response = await fetch(`${server.baseUrl}/api/session`, {
      headers: { cookie: tenant.cookie },
    })
    const { session } = await response.json()
    expect(session.organisationId).toBe(tenant.organisationId)
    expect(session.role).toBe("owner")
  })

  it("signs this browser out and says so when signing out everywhere fails", async () => {
    const tenant = await createTestTenant(admin)
    organisations.push(tenant.organisationId)
    // The same person on another device.
    const phoneToken = randomBytes(32).toString("base64url")
    await admin`
      insert into app_session (token_hash, user_id, organisation_id, expires_at)
      values (${sha256(phoneToken)}, ${tenant.userId}, ${tenant.organisationId},
        now() + interval '1 hour')
    `
    const sessionFor = (cookie: string) =>
      fetch(`${server.baseUrl}/api/session`, { headers: { cookie } }).then(
        (response) => response.json() as Promise<{ session: unknown }>
      )

    // Force the revoke to fail: the runtime role loses execute for the
    // duration of one request. Integration files run one at a time.
    await admin`
      revoke execute on function revoke_user_sessions(text) from naba_app_runtime
    `
    let response: Response
    try {
      response = await fetch(`${server.baseUrl}/api/session?scope=all`, {
        method: "DELETE",
        headers: { cookie: tenant.cookie },
      })
    } finally {
      await admin`
        grant execute on function revoke_user_sessions(text) to naba_app_runtime
      `
    }

    expect(response.status).toBe(503)
    expect((await response.json()).error).toBe("sign_out_everywhere_failed")
    // The browser was told to forget its cookie...
    expect(response.headers.get("set-cookie")).toMatch(
      /naba_session=;.*(Expires=Thu, 01 Jan 1970|Max-Age=0)/i
    )
    // ...and its own session row is gone, so the old token is dead.
    expect((await sessionFor(tenant.cookie)).session).toBeNull()
    // The other device was not signed out, which is what the 503 admits.
    expect((await sessionFor(`naba_session=${phoneToken}`)).session).not.toBeNull()
  })
})
