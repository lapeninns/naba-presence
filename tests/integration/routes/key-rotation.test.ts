import {
  createCipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import { createTestTenant, destroyTenants } from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

const CRON_BEARER = "Bearer route-harness-cron-secret"
const OLD_KEY =
  process.env.TOKEN_ENCRYPTION_KEY ?? "route-harness-token-key-32-characters!!"
const NEW_KEY = "rotation-harness-new-key-with-32-chars!!"

function legacyCiphertext(value: string) {
  const key = createHash("sha256").update(OLD_KEY, "utf8").digest()
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), body])
}

/**
 * A rotation end to end, in the three deploys the runbook describes:
 *   1. before       TOKEN_ENCRYPTION_KEY = old
 *   2. during       TOKEN_ENCRYPTION_KEYS = new,old (new encrypts, both read)
 *   3. after        only the new key configured
 * The tenant's connection keeps working through all three and nobody is
 * asked to reconnect. The pass is scoped to this test's tenant: the harness
 * shares the development database, whose other rows use the real dev key.
 */
describeDatabase("token encryption key rotation", () => {
  let admin: ReturnType<typeof postgres>
  let stub: GoogleStub
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    stub = await startGoogleStub()
    stub.respond({ method: "POST", pathEndsWith: "/token" }, () => ({
      status: 200,
      json: {
        access_token: "rotated-era-access-token",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/business.manage",
        token_type: "Bearer",
      },
    }))
    stub.respond({ method: "GET", pathIncludes: "/v1/accounts" }, () => ({
      status: 200,
      json: { accounts: [] },
    }))
  })

  afterAll(async () => {
    await stub.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  const googleEnv = () => ({
    GOOGLE_API_PROXY_BASE: stub.baseUrl,
    GOOGLE_CLIENT_ID: "rotation-client",
    GOOGLE_CLIENT_SECRET: "rotation-secret",
  })

  it("keeps a connection working before, during and after a rotation", async () => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connectionId = randomUUID()
    await admin`
      insert into google_connection (
        id, organisation_id, google_subject, google_email, scope, status,
        access_token_ciphertext, refresh_token_ciphertext, access_token_expires_at
      )
      values (
        ${connectionId}, ${owner.organisationId}, ${`rotation-${connectionId}`},
        'rotation@example.test', 'https://www.googleapis.com/auth/business.manage',
        'active', ${legacyCiphertext("stale-access")},
        ${legacyCiphertext("1//rotation-refresh-token")}, now() - interval '1 hour'
      )
    `
    const discover = (baseUrl: string) =>
      fetch(`${baseUrl}/api/google/accounts?connection_id=${connectionId}`, {
        headers: { cookie: owner.cookie },
      })

    // 2. During: new key encrypts, the old one still reads.
    const during = await startAppServer({
      ...googleEnv(),
      TOKEN_ENCRYPTION_KEY: OLD_KEY,
      TOKEN_ENCRYPTION_KEYS: `${NEW_KEY},${OLD_KEY}`,
    })
    try {
      // The stored refresh token is still old-format; the refresh reads it
      // and writes the new access token under the new key.
      const refreshed = await discover(during.baseUrl)
      expect(refreshed.status, await refreshed.clone().text()).toBe(200)
      const [mixed] = await admin<{ access: Buffer; refresh: Buffer }[]>`
        select access_token_ciphertext as access, refresh_token_ciphertext as refresh
        from google_connection where id = ${connectionId}
      `
      expect(mixed.access[0]).toBe(2)
      expect(mixed.refresh[0]).toBe(1)

      const rotate = (dryRun: boolean) =>
        fetch(`${during.baseUrl}/api/operations/reencrypt`, {
          method: "POST",
          headers: {
            authorization: CRON_BEARER,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            dryRun,
            organisationIds: [owner.organisationId],
          }),
        }).then(
          (response) =>
            response.json() as Promise<{
              complete: boolean
              rewritten: number
              fingerprinted: number
              remaining: Record<string, number>
            }>
        )

      const before = await rotate(true)
      expect(before.complete).toBe(false)
      expect(before.remaining.google_connection).toBeGreaterThan(0)

      const pass = await rotate(false)
      expect(pass.rewritten).toBeGreaterThan(0)
      expect(pass.complete).toBe(true)
      // The RISC fingerprint for the pre-existing token came with the pass.
      expect(pass.fingerprinted).toBe(1)
      expect((await rotate(true)).complete).toBe(true)
    } finally {
      await during.stop()
    }

    // 3. After: the old key is gone entirely.
    const after = await startAppServer({
      ...googleEnv(),
      TOKEN_ENCRYPTION_KEY: NEW_KEY,
      TOKEN_ENCRYPTION_KEYS: NEW_KEY,
    })
    try {
      await admin`
        update google_connection set access_token_expires_at = now() - interval '1 hour'
        where id = ${connectionId}
      `
      const response = await discover(after.baseUrl)
      expect(response.status, await response.clone().text()).toBe(200)
    } finally {
      await after.stop()
    }
    const [state] = await admin<{ status: string; tasks: number }[]>`
      select status,
        (select count(*)::int from connection_task where google_connection_id = ${connectionId}) as tasks
      from google_connection where id = ${connectionId}
    `
    expect(state).toEqual({ status: "active", tasks: 0 })
  }, 180_000)
})
