import { createHash, randomUUID } from "node:crypto"

import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

const CLIENT_ID = "risc-harness-client.apps.googleusercontent.com"
const ISSUER = "https://accounts.google.com/"
const EVENTS = {
  tokenRevoked:
    "https://schemas.openid.net/secevent/oauth/event-type/token-revoked",
  tokensRevoked:
    "https://schemas.openid.net/secevent/oauth/event-type/tokens-revoked",
  verification:
    "https://schemas.openid.net/secevent/risc/event-type/verification",
}

/**
 * The RISC receiver against a stand-in for Google's discovery document and
 * signing keys. This proves verification and routing; receiving REAL events
 * additionally needs the stream registered with Google (docs/runbook.md,
 * "RISC"), which no test here can do.
 */
describeDatabase("Google RISC receiver", () => {
  let admin: ReturnType<typeof postgres>
  let stub: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  let privateKey: CryptoKey
  let otherKey: CryptoKey
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    const pair = await generateKeyPair("RS256")
    privateKey = pair.privateKey as CryptoKey
    otherKey = (await generateKeyPair("RS256")).privateKey as CryptoKey
    const jwk: JWK = {
      ...(await exportJWK(pair.publicKey)),
      kid: "risc-key",
      alg: "RS256",
      use: "sig",
    }
    stub = await startGoogleStub()
    stub.respond(
      { method: "GET", pathEndsWith: "/.well-known/risc-configuration" },
      () => ({
        status: 200,
        json: {
          issuer: ISSUER,
          jwks_uri: "https://www.googleapis.com/risc-harness/jwks",
        },
      })
    )
    stub.respond({ method: "GET", pathEndsWith: "/risc-harness/jwks" }, () => ({
      status: 200,
      json: { keys: [jwk] },
    }))
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: stub.baseUrl,
      GOOGLE_CLIENT_ID: CLIENT_ID,
      GOOGLE_CLIENT_SECRET: "risc-harness-secret",
    })
  })

  afterAll(async () => {
    await server.stop()
    await stub.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  function sign(
    events: Record<string, unknown>,
    options: { key?: CryptoKey; audience?: string; jti?: string } = {}
  ) {
    return new SignJWT({ events })
      .setProtectedHeader({
        alg: "RS256",
        kid: "risc-key",
        typ: "secevent+jwt",
      })
      .setIssuer(ISSUER)
      .setAudience(options.audience ?? CLIENT_ID)
      .setIssuedAt()
      .setJti(options.jti ?? randomUUID())
      .sign(options.key ?? privateKey)
  }

  function deliver(token: string) {
    return fetch(`${server.baseUrl}/api/webhooks/google/risc`, {
      method: "POST",
      headers: { "content-type": "application/secevent+jwt" },
      body: token,
    })
  }

  async function connection() {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const seeded = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const [row] = await admin<{ subject: string }[]>`
      select google_subject as subject from google_connection where id = ${seeded.connectionId}
    `
    return { owner, connectionId: seeded.connectionId, subject: row.subject }
  }

  function state(connectionId: string) {
    return admin<{ status: string; code: string | null; openTasks: number }[]>`
      select
        gc.status,
        gc.last_error_code as code,
        (select count(*)::int from connection_task ct
          where ct.google_connection_id = gc.id and ct.status = 'open') as "openTasks"
      from google_connection gc where gc.id = ${connectionId}
    `
  }

  it("marks every connection of the account for reconnect on tokens-revoked", async () => {
    const target = await connection()
    const bystander = await connection()
    const response = await deliver(
      await sign({
        [EVENTS.tokensRevoked]: {
          subject: {
            subject_type: "iss-sub",
            iss: ISSUER,
            sub: target.subject,
          },
        },
      })
    )
    expect(response.status, await response.clone().text()).toBe(202)
    expect(await state(target.connectionId)).toEqual([
      { status: "revoked", code: "google_token_revoked", openTasks: 1 },
    ])
    expect((await state(bystander.connectionId))[0].status).toBe("active")
  })

  it("matches token-revoked by the stored double hash of the refresh token", async () => {
    const target = await connection()
    const refreshToken = `1//risc-${randomUUID()}`
    const inner = createHash("sha512").update(refreshToken, "utf8").digest()
    const hash = createHash("sha512").update(inner).digest("base64")
    await admin`
      update google_connection set refresh_token_sha512x2 = ${hash}
      where id = ${target.connectionId}
    `
    const response = await deliver(
      await sign({
        [EVENTS.tokenRevoked]: {
          subject: {
            subject_type: "oauth_token",
            token_type: "refresh_token",
            token_identifier_alg: "hash_base64_sha512_sha512",
            token: hash,
          },
        },
      })
    )
    expect(response.status).toBe(202)
    expect((await state(target.connectionId))[0]).toMatchObject({
      status: "revoked",
      openTasks: 1,
    })
  })

  it("ignores a replayed event", async () => {
    const target = await connection()
    const jti = randomUUID()
    const token = await sign(
      {
        [EVENTS.tokensRevoked]: {
          subject: {
            subject_type: "iss-sub",
            iss: ISSUER,
            sub: target.subject,
          },
        },
      },
      { jti }
    )
    expect((await deliver(token)).status).toBe(202)
    const replay = await deliver(token)
    expect(replay.status).toBe(202)
    await expect(replay.json()).resolves.toMatchObject({ duplicate: true })
    const [audits] = await admin<{ count: number }[]>`
      select count(*)::int as count from audit_log
      where subject_id = ${target.connectionId}
        and action = 'google.connection.reconnect_required'
    `
    expect(audits.count).toBe(1)
  })

  it("applies a redelivered event whose first delivery stopped part-way", async () => {
    const target = await connection()
    const jti = randomUUID()
    // The first delivery recorded the jti, then failed before applying.
    await admin`
      insert into risc_event (jti, event_types, outcome, received_at)
      values (${jti}, ${[EVENTS.tokensRevoked]}, 'received', now() - interval '5 minutes')
    `
    const retry = await deliver(
      await sign(
        {
          [EVENTS.tokensRevoked]: {
            subject: {
              subject_type: "iss-sub",
              iss: ISSUER,
              sub: target.subject,
            },
          },
        },
        { jti }
      )
    )
    expect(retry.status, await retry.clone().text()).toBe(202)
    await expect(retry.json()).resolves.toMatchObject({ duplicate: false })
    expect((await state(target.connectionId))[0].status).toBe("revoked")
  })

  it("accepts a verification event without changing anything", async () => {
    const target = await connection()
    const response = await deliver(
      await sign({ [EVENTS.verification]: { state: "ping" } })
    )
    expect(response.status).toBe(202)
    expect((await state(target.connectionId))[0].status).toBe("active")
  })

  it("rejects a token signed by anyone else, or meant for another client", async () => {
    const target = await connection()
    const event = {
      [EVENTS.tokensRevoked]: {
        subject: { subject_type: "iss-sub", iss: ISSUER, sub: target.subject },
      },
    }
    expect((await deliver(await sign(event, { key: otherKey }))).status).toBe(
      400
    )
    expect(
      (await deliver(await sign(event, { audience: "someone-else" }))).status
    ).toBe(400)
    expect((await deliver("not-a-token")).status).toBe(400)
    expect((await state(target.connectionId))[0].status).toBe("active")
  })

  it("leaves a deliberately disconnected connection disconnected", async () => {
    const target = await connection()
    await admin`
      update google_connection
      set status = 'disconnected', access_token_ciphertext = null, refresh_token_ciphertext = null
      where id = ${target.connectionId}
    `
    const response = await deliver(
      await sign({
        [EVENTS.tokensRevoked]: {
          subject: {
            subject_type: "iss-sub",
            iss: ISSUER,
            sub: target.subject,
          },
        },
      })
    )
    expect(response.status).toBe(202)
    expect(await state(target.connectionId)).toEqual([
      { status: "disconnected", code: null, openTasks: 0 },
    ])
  })
})
