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

// The tenant helper keeps its copy private and never seeds a refresh token;
// every case here needs one, because the defect only shows on the refresh path.
function encryptHarnessSecret(value: string) {
  const key = createHash("sha256")
    .update(
      process.env.TOKEN_ENCRYPTION_KEY ??
        "route-harness-token-key-32-characters!!",
      "utf8"
    )
    .digest()
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ])
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), ciphertext])
}

describeDatabase("google connection failure handling", () => {
  let admin: ReturnType<typeof postgres>
  let stub: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    stub = await startGoogleStub()
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: stub.baseUrl,
      GOOGLE_CLIENT_ID: "connection-failure-client",
      GOOGLE_CLIENT_SECRET: "connection-failure-secret",
      GOOGLE_REQUESTS_PER_SECOND: "100",
      GOOGLE_TIMEOUT_MS: "5000",
    })
  })

  afterAll(async () => {
    await server.stop()
    await stub.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  /** An owner whose connection needs a refresh on the very next Google call. */
  async function seedRefreshableTenant(
    status: "active" | "expired" = "active"
  ) {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connectionId = randomUUID()
    const marker = randomUUID()
    const googleAccountName = `accounts/failure-${marker}`
    const googleSubject = `failure-subject-${marker}`
    await admin`
      insert into google_connection (
        id,
        organisation_id,
        google_subject,
        google_email,
        scope,
        status,
        last_error_code,
        access_token_ciphertext,
        refresh_token_ciphertext,
        access_token_expires_at
      )
      values (
        ${connectionId},
        ${owner.organisationId},
        ${googleSubject},
        'stub@example.test',
        'business.manage',
        ${status},
        ${status === "expired" ? "internal_failure" : null},
        ${encryptHarnessSecret("stale-access-token")},
        ${encryptHarnessSecret("stub-refresh-token")},
        now() - interval '1 hour'
      )
    `
    await admin`
      insert into google_account (
        organisation_id,
        google_connection_id,
        google_account_name,
        account_name,
        is_active
      )
      values (
        ${owner.organisationId},
        ${connectionId},
        ${googleAccountName},
        'Failure stub account',
        true
      )
    `
    return { owner, connectionId, googleAccountName, googleSubject }
  }

  function connectionState(connectionId: string) {
    return admin<{ status: string; lastErrorCode: string | null }[]>`
      select status, last_error_code as "lastErrorCode"
      from google_connection
      where id = ${connectionId}
    `
  }

  function reconnectTasks(connectionId: string) {
    return admin<
      { status: string; reasonCode: string | null; resolvedAt: Date | null }[]
    >`
      select status, reason_code as "reasonCode", resolved_at as "resolvedAt"
      from connection_task
      where google_connection_id = ${connectionId}
        and task_type = 'reconnect'
    `
  }

  /** Marks a connection as needing the reconnect a customer would then do. */
  async function openReconnectTask(
    organisationId: string,
    connectionId: string
  ) {
    await admin`
      update google_connection
      set status = 'revoked', last_error_code = 'invalid_grant'
      where id = ${connectionId}
    `
    await admin`
      insert into connection_task (
        organisation_id,
        google_connection_id,
        task_type,
        status,
        reason_code
      )
      values (
        ${organisationId},
        ${connectionId},
        'reconnect',
        'open',
        'invalid_grant'
      )
    `
  }

  /** Drives the real OAuth flow: start (for the signed state cookie), callback. */
  async function completeOAuth(
    owner: Awaited<ReturnType<typeof createTestTenant>>,
    googleSubject: string,
    scope = "openid email profile https://www.googleapis.com/auth/business.manage"
  ) {
    stub.respond({ method: "POST", pathEndsWith: "/token" }, () => ({
      status: 200,
      json: {
        access_token: "callback-access-token",
        expires_in: 3600,
        refresh_token: "callback-refresh-token",
        scope,
        token_type: "Bearer",
      },
    }))
    stub.respond({ method: "GET", pathEndsWith: "/v1/userinfo" }, () => ({
      status: 200,
      json: { sub: googleSubject, email: owner.email, email_verified: true },
    }))
    stub.respond({ method: "GET", pathIncludes: "/v1/accounts" }, () => ({
      status: 200,
      json: { accounts: [] },
    }))
    const start = await fetch(`${server.baseUrl}/api/google/connect/start`, {
      method: "POST",
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      body: "{}",
    })
    const { authorizationUrl } = (await start.json()) as {
      authorizationUrl: string
    }
    const oauthCookie = start.headers.get("set-cookie")?.split(";", 1)[0]
    if (!oauthCookie) throw new TypeError("OAuth state cookie was not set")
    return fetch(`${server.baseUrl}/api/auth/callback/google`, {
      method: "POST",
      headers: {
        cookie: `${owner.cookie}; ${oauthCookie}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        code: "callback-code",
        state: new URL(authorizationUrl).searchParams.get("state"),
      }),
    })
  }

  it("keeps the revoked status and reconnect task after a rejected refresh", async () => {
    const { owner, connectionId } = await seedRefreshableTenant()
    stub.reset()
    stub.respond({ method: "POST", pathEndsWith: "/token" }, () => ({
      status: 400,
      json: { error: "invalid_grant" },
    }))

    const response = await fetch(
      `${server.baseUrl}/api/google/accounts?connection_id=${connectionId}`,
      { headers: { cookie: owner.cookie } }
    )

    expect(response.status, await response.clone().text()).toBe(401)
    expect(await response.json()).toMatchObject({
      error: "google_reconnect_required",
    })
    // The 401 leaves the handler's tenant transaction; before the fix that
    // rollback erased all three of these and the banner never appeared.
    const [connection] = await connectionState(connectionId)
    expect(connection).toMatchObject({
      status: "revoked",
      lastErrorCode: "invalid_grant",
    })
    const tasks = await reconnectTasks(connectionId)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      status: "open",
      reasonCode: "invalid_grant",
    })
    const [audit] = await admin<{ count: number }[]>`
      select count(*)::int as count
      from audit_log
      where subject_id = ${connectionId}
        and action = 'google.connection.reconnect_required'
    `
    expect(audit.count).toBe(1)
  })

  it("leaves the connection usable when the token endpoint is transiently down", async () => {
    const { owner, connectionId } = await seedRefreshableTenant()
    stub.reset()
    stub.respond({ method: "POST", pathEndsWith: "/token" }, () => ({
      status: 503,
      json: { error: "internal_failure" },
    }))

    const response = await fetch(
      `${server.baseUrl}/api/google/accounts?connection_id=${connectionId}`,
      { headers: { cookie: owner.cookie } }
    )

    expect(response.status, await response.clone().text()).toBe(503)
    expect(await response.json()).toMatchObject({
      error: "google_token_unavailable",
    })
    const [connection] = await connectionState(connectionId)
    expect(connection).toMatchObject({
      status: "active",
      lastErrorCode: "internal_failure",
    })
    expect(await reconnectTasks(connectionId)).toHaveLength(0)
  })

  it("brings an expired connection back once Google answers again", async () => {
    const { owner, connectionId, googleAccountName } =
      await seedRefreshableTenant("expired")
    stub.reset()
    stub.respond({ method: "POST", pathEndsWith: "/token" }, () => ({
      status: 200,
      json: {
        access_token: "recovered-access-token",
        expires_in: 3600,
        scope: "business.manage",
        token_type: "Bearer",
      },
    }))
    stub.respond(
      { method: "GET", pathIncludes: `${googleAccountName}/locations` },
      () => ({ status: 200, json: { locations: [] } })
    )

    const response = await fetch(
      `${server.baseUrl}/api/google/locations?account_name=${encodeURIComponent(googleAccountName)}`,
      { headers: { cookie: owner.cookie } }
    )

    expect(response.status, await response.clone().text()).toBe(200)
    const [connection] = await connectionState(connectionId)
    expect(connection).toMatchObject({ status: "active", lastErrorCode: null })
  })

  it("closes a stale reconnect task once a refresh succeeds", async () => {
    // A task opened on a non-credential answer leaves the row `expired`, which
    // stays loadable. The refresh then proves the grant is fine, so the task
    // must not outlive it: before this it did, and the shell banner stayed up
    // until the tenant re-consented for no reason.
    const { owner, connectionId, googleAccountName } =
      await seedRefreshableTenant("expired")
    await admin`
      insert into connection_task (
        organisation_id,
        google_connection_id,
        task_type,
        status,
        reason_code
      )
      values (
        ${owner.organisationId},
        ${connectionId},
        'reconnect',
        'open',
        'internal_failure'
      )
    `
    stub.reset()
    stub.respond({ method: "POST", pathEndsWith: "/token" }, () => ({
      status: 200,
      json: {
        access_token: "recovered-access-token",
        expires_in: 3600,
        scope: "business.manage",
        token_type: "Bearer",
      },
    }))
    stub.respond(
      { method: "GET", pathIncludes: `${googleAccountName}/locations` },
      () => ({ status: 200, json: { locations: [] } })
    )

    const response = await fetch(
      `${server.baseUrl}/api/google/locations?account_name=${encodeURIComponent(googleAccountName)}`,
      { headers: { cookie: owner.cookie } }
    )

    expect(response.status, await response.clone().text()).toBe(200)
    const tasks = await reconnectTasks(connectionId)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      status: "completed",
      reasonCode: "internal_failure",
    })
    expect(tasks[0]?.resolvedAt).toBeInstanceOf(Date)
    const [audit] = await admin<{ metadata: Record<string, unknown> }[]>`
      select metadata
      from audit_log
      where subject_id = ${connectionId}
        and action = 'google.connection.refresh_restored'
    `
    expect(audit?.metadata).toMatchObject({
      closedReconnectTasks: 1,
      reasonCodes: ["internal_failure"],
    })
  })

  it("closes the reconnect task when the same Google account re-consents", async () => {
    const { owner, connectionId, googleSubject } = await seedRefreshableTenant()
    await openReconnectTask(owner.organisationId, connectionId)
    stub.reset()

    const response = await completeOAuth(owner, googleSubject)

    expect(response.status, await response.clone().text()).toBe(200)
    const [connection] = await connectionState(connectionId)
    expect(connection).toMatchObject({ status: "active", lastErrorCode: null })
    const tasks = await reconnectTasks(connectionId)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].status).toBe("completed")
    expect(tasks[0].resolvedAt).not.toBeNull()
  })

  it("supersedes the old task when a different Google account is connected", async () => {
    const { owner, connectionId } = await seedRefreshableTenant()
    await openReconnectTask(owner.organisationId, connectionId)
    stub.reset()

    const response = await completeOAuth(owner, `replacement-${connectionId}`)

    expect(response.status, await response.clone().text()).toBe(200)
    // The old row's work (relink or disconnect it) is real, so the task stays
    // open - but it is marked, and the shell banner scopes itself to the live
    // connection rather than warning on every page forever.
    const tasks = await reconnectTasks(connectionId)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      status: "open",
      reasonCode: "superseded_by_reconnect",
    })
    const [replacement] = await admin<{ count: number }[]>`
      select count(*)::int as count
      from google_connection
      where organisation_id = ${owner.organisationId}
        and status = 'active'
    `
    expect(replacement.count).toBe(1)
  })

  it("never activates a consent that left out business.manage", async () => {
    // A brand-new login: nothing may be stored at all.
    const fresh = await createTestTenant(admin)
    organisations.push(fresh.organisationId)
    stub.reset()
    const refused = await completeOAuth(
      fresh,
      `scopeless-${fresh.organisationId}`,
      "openid https://www.googleapis.com/auth/userinfo.email"
    )
    expect(refused.status, await refused.clone().text()).toBe(403)
    expect(await refused.json()).toMatchObject({ error: "google_scope_missing" })
    const [stored] = await admin<{ count: number }[]>`
      select count(*)::int as count
      from google_connection
      where organisation_id = ${fresh.organisationId}
    `
    expect(stored.count).toBe(0)

    // A re-consent for a login that needs reconnecting keeps it that way,
    // rather than overwriting its tokens with ones that cannot manage anything.
    const { owner, connectionId, googleSubject } = await seedRefreshableTenant()
    await openReconnectTask(owner.organisationId, connectionId)
    stub.reset()
    const partial = await completeOAuth(owner, googleSubject, "openid email profile")
    expect(partial.status).toBe(403)
    const [connection] = await connectionState(connectionId)
    expect(connection.status).toBe("revoked")
    expect((await reconnectTasks(connectionId))[0].status).toBe("open")
  })

  it("marks the connection for reconnect when Google answers 401", async () => {
    const { owner, connectionId } = await seedRefreshableTenant()
    stub.reset()
    stub.respond({ method: "POST", pathEndsWith: "/token" }, () => ({
      status: 200,
      json: {
        access_token: "refused-access-token",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/business.manage",
        token_type: "Bearer",
      },
    }))
    stub.respond({ method: "GET", pathIncludes: "/v1/accounts" }, () => ({
      status: 401,
      json: { error: { code: 401, status: "UNAUTHENTICATED", message: "Invalid Credentials" } },
    }))

    const response = await fetch(
      `${server.baseUrl}/api/google/accounts?connection_id=${connectionId}`,
      { headers: { cookie: owner.cookie } }
    )

    expect(response.status, await response.clone().text()).toBe(401)
    expect(await response.json()).toMatchObject({ error: "google_reconnect_required" })
    const [connection] = await connectionState(connectionId)
    // Expired, not revoked: the next call refreshes, and a refresh that works
    // closes the task on its own.
    expect(connection).toMatchObject({
      status: "expired",
      lastErrorCode: "google_unauthenticated",
    })
    const tasks = await reconnectTasks(connectionId)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ status: "open", reasonCode: "google_unauthenticated" })
  })

  it("revokes on a 403 for missing scopes, and ignores a 403 for one resource", async () => {
    const scoped = await seedRefreshableTenant()
    stub.reset()
    stub.respond({ method: "POST", pathEndsWith: "/token" }, () => ({
      status: 200,
      json: {
        access_token: "narrow-access-token",
        expires_in: 3600,
        scope: "openid",
        token_type: "Bearer",
      },
    }))
    stub.respond({ method: "GET", pathIncludes: "/v1/accounts" }, () => ({
      status: 403,
      json: {
        error: {
          code: 403,
          status: "PERMISSION_DENIED",
          message: "Request had insufficient authentication scopes.",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.ErrorInfo",
              reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
            },
          ],
        },
      },
    }))
    const narrow = await fetch(
      `${server.baseUrl}/api/google/accounts?connection_id=${scoped.connectionId}`,
      { headers: { cookie: scoped.owner.cookie } }
    )
    expect(narrow.status, await narrow.clone().text()).toBe(401)
    expect((await connectionState(scoped.connectionId))[0]).toMatchObject({
      status: "revoked",
      lastErrorCode: "insufficient_scope",
    })

    const denied = await seedRefreshableTenant()
    stub.reset()
    stub.respond({ method: "POST", pathEndsWith: "/token" }, () => ({
      status: 200,
      json: {
        access_token: "denied-access-token",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/business.manage",
        token_type: "Bearer",
      },
    }))
    stub.respond({ method: "GET", pathIncludes: "/v1/accounts" }, () => ({
      status: 403,
      json: {
        error: {
          code: 403,
          status: "PERMISSION_DENIED",
          message: "The caller does not have permission",
        },
      },
    }))
    const forbidden = await fetch(
      `${server.baseUrl}/api/google/accounts?connection_id=${denied.connectionId}`,
      { headers: { cookie: denied.owner.cookie } }
    )
    expect(forbidden.status).toBe(403)
    expect((await connectionState(denied.connectionId))[0].status).toBe("active")
    expect(await reconnectTasks(denied.connectionId)).toHaveLength(0)
  })

  async function waitForTokenCall() {
    const deadline = Date.now() + 5_000
    while (!stub.calls.some((call) => call.path.endsWith("/token"))) {
      if (Date.now() > deadline) throw new Error("No token request reached the stub")
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }

  function storedTokens(connectionId: string) {
    return admin<
      {
        status: string
        accessToken: Buffer | null
        refreshToken: Buffer | null
        refreshTokenExpiresAt: Date | null
      }[]
    >`
      select
        status,
        access_token_ciphertext as "accessToken",
        refresh_token_ciphertext as "refreshToken",
        refresh_token_expires_at as "refreshTokenExpiresAt"
      from google_connection
      where id = ${connectionId}
    `
  }

  function disconnect(cookie: string, connectionId: string) {
    return fetch(
      `${server.baseUrl}/api/google/connections/${connectionId}/disconnect`,
      { method: "POST", headers: { cookie } }
    )
  }

  it("stays disconnected when a refresh succeeds after the disconnect", async () => {
    const { owner, connectionId } = await seedRefreshableTenant()
    stub.reset()
    stub.respond({ method: "POST", pathEndsWith: "/token" }, () => ({
      status: 200,
      delayMs: 1_000,
      json: {
        access_token: "late-access-token",
        expires_in: 3600,
        refresh_token: "late-refresh-token",
        scope: "business.manage",
        token_type: "Bearer",
      },
    }))
    stub.respond({ method: "GET", pathIncludes: "/v1/accounts" }, () => ({
      status: 200,
      json: { accounts: [] },
    }))

    // A request that needs a refresh is waiting on Google...
    const inFlight = fetch(
      `${server.baseUrl}/api/google/accounts?connection_id=${connectionId}`,
      { headers: { cookie: owner.cookie } }
    )
    await waitForTokenCall()
    // ...when the owner disconnects.
    const disconnected = await disconnect(owner.cookie, connectionId)
    expect(disconnected.status, await disconnected.clone().text()).toBe(200)

    const late = await inFlight
    expect(late.status, await late.clone().text()).toBe(404)
    const [row] = await storedTokens(connectionId)
    expect(row).toMatchObject({
      status: "disconnected",
      accessToken: null,
      refreshToken: null,
    })
    expect(
      (await reconnectTasks(connectionId)).filter((task) => task.status === "open")
    ).toHaveLength(0)
  })

  it("stays disconnected when a refresh is rejected after the disconnect", async () => {
    const { owner, connectionId } = await seedRefreshableTenant()
    stub.reset()
    stub.respond({ method: "POST", pathEndsWith: "/token" }, () => ({
      status: 400,
      delayMs: 1_000,
      json: { error: "invalid_grant" },
    }))

    const inFlight = fetch(
      `${server.baseUrl}/api/google/accounts?connection_id=${connectionId}`,
      { headers: { cookie: owner.cookie } }
    )
    await waitForTokenCall()
    const disconnected = await disconnect(owner.cookie, connectionId)
    expect(disconnected.status, await disconnected.clone().text()).toBe(200)
    await inFlight

    const [row] = await storedTokens(connectionId)
    expect(row).toMatchObject({
      status: "disconnected",
      accessToken: null,
      refreshToken: null,
    })
    // No reconnect banner for a connection the owner removed on purpose.
    expect(
      (await reconnectTasks(connectionId)).filter((task) => task.status === "open")
    ).toHaveLength(0)
    const [audit] = await admin<{ count: number }[]>`
      select count(*)::int as count
      from audit_log
      where subject_id = ${connectionId}
        and action = 'google.connection.reconnect_required'
    `
    expect(audit.count).toBe(0)
  })

  it("refreshes an expired token once for 20 concurrent requests across two servers", async () => {
    const { owner, connectionId } = await seedRefreshableTenant()
    const [before] = await storedTokens(connectionId)
    stub.reset()
    stub.respond({ method: "POST", pathEndsWith: "/token" }, () => ({
      status: 200,
      // Slow enough that every request arrives while the refresh is running.
      delayMs: 500,
      json: {
        access_token: "single-flight-access-token",
        expires_in: 3600,
        refresh_token: "rotated-refresh-token",
        refresh_token_expires_in: 604_800,
        scope: "business.manage",
        token_type: "Bearer",
      },
    }))
    stub.respond({ method: "GET", pathIncludes: "/v1/accounts" }, () => ({
      status: 200,
      json: { accounts: [] },
    }))
    // A second process: the in-process guard alone cannot see its requests,
    // so only the database lock keeps this to one refresh.
    const second = await startAppServer({
      GOOGLE_API_PROXY_BASE: stub.baseUrl,
      GOOGLE_CLIENT_ID: "connection-failure-client",
      GOOGLE_CLIENT_SECRET: "connection-failure-secret",
      GOOGLE_REQUESTS_PER_SECOND: "100",
      GOOGLE_TIMEOUT_MS: "5000",
    })
    try {
      const responses = await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          fetch(
            `${(index % 2 === 0 ? server : second).baseUrl}/api/google/accounts?connection_id=${connectionId}`,
            { headers: { cookie: owner.cookie } }
          )
        )
      )
      for (const response of responses) {
        expect(response.status, await response.clone().text()).toBe(200)
      }
    } finally {
      await second.stop()
    }

    expect(stub.calls.filter((call) => call.path.endsWith("/token"))).toHaveLength(1)
    // Google rotated the refresh token; the new one is kept, with its expiry.
    const [after] = await storedTokens(connectionId)
    expect(after.status).toBe("active")
    expect(Buffer.compare(after.refreshToken!, before.refreshToken!)).not.toBe(0)
    expect(after.refreshTokenExpiresAt).toBeInstanceOf(Date)
  }, 60_000)

  it("revokes the grant at Google when an owner disconnects", async () => {
    const { owner, connectionId } = await seedRefreshableTenant()
    stub.reset()
    stub.respond({ method: "POST", pathEndsWith: "/revoke" }, () => ({
      status: 200,
      json: {},
    }))

    const response = await fetch(
      `${server.baseUrl}/api/google/connections/${connectionId}/disconnect`,
      { method: "POST", headers: { cookie: owner.cookie } }
    )

    expect(response.status, await response.clone().text()).toBe(200)
    const revokes = stub.calls.filter((call) => call.path.endsWith("/revoke"))
    expect(revokes).toHaveLength(1)
    // The refresh token, so every access token issued from it dies with it.
    expect(revokes[0].body).toEqual({ token: "stub-refresh-token" })
    const [row] = await admin<
      { status: string; access: Buffer | null; refresh: Buffer | null }[]
    >`
      select status, access_token_ciphertext as access, refresh_token_ciphertext as refresh
      from google_connection where id = ${connectionId}
    `
    expect(row).toEqual({ status: "disconnected", access: null, refresh: null })
  })

  it("still disconnects, and records it, when Google will not revoke", async () => {
    const { owner, connectionId } = await seedRefreshableTenant()
    stub.reset()
    stub.respond({ method: "POST", pathEndsWith: "/revoke" }, () => ({
      status: 503,
      json: { error: "backend_error" },
    }))

    const response = await fetch(
      `${server.baseUrl}/api/google/connections/${connectionId}/disconnect`,
      { method: "POST", headers: { cookie: owner.cookie } }
    )

    expect(response.status, await response.clone().text()).toBe(200)
    expect((await connectionState(connectionId))[0].status).toBe("disconnected")
    const [audit] = await admin<{ metadata: { status: number; error: string } }[]>`
      select metadata from audit_log
      where subject_id = ${connectionId}
        and action = 'google.connection.revoke_failed'
    `
    expect(audit?.metadata).toMatchObject({ status: 503, error: "backend_error" })
  })
})
