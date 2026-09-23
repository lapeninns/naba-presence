import { createHmac, randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"

import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import { createTestTenant, destroyTenants } from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

const CALLBACK_PATH = "/api/auth/callback/google"
// The value `app-server.ts` boots the harness with; the state cookie is signed
// with it, so a test can mint one the route accepts.
const HARNESS_SECRET = "route-harness-secret-value-32-characters!"

type StoredCookie = { name: string; value: string; path: string }

function cookieAttribute(attributes: string[], name: string) {
  const match = attributes.find((attribute) =>
    attribute.trim().toLowerCase().startsWith(`${name}=`)
  )
  return match?.slice(match.indexOf("=") + 1).trim()
}

/**
 * A cookie store that honours Path, unlike the `set-cookie.split(";")[0]`
 * shortcut the rest of the suite uses. The OAuth state cookie is scoped to the
 * callback path, so a clearing `Set-Cookie` emitted on `Path=/` addresses a
 * different cookie and leaves the real one in place - a naive jar reads that
 * as a successful delete, which is how a replayable OAuth state stayed green.
 */
function acceptCookies(jar: Map<string, StoredCookie>, response: Response) {
  for (const raw of response.headers.getSetCookie()) {
    const [pair, ...attributes] = raw.split(";")
    const separator = pair.indexOf("=")
    const name = pair.slice(0, separator).trim()
    const value = pair.slice(separator + 1).trim()
    const path = cookieAttribute(attributes, "path") ?? "/"
    const expires = cookieAttribute(attributes, "expires")
    const maxAge = cookieAttribute(attributes, "max-age")
    const key = `${name}\u0000${path}`
    const expired =
      maxAge === "0" ||
      (expires !== undefined && Date.parse(expires) <= Date.now())
    if (expired) jar.delete(key)
    else jar.set(key, { name, value, path })
  }
}

function cookieHeader(
  jar: Map<string, StoredCookie>,
  path: string,
  session?: string
) {
  const stored = [...jar.values()]
    .filter((cookie) => path.startsWith(cookie.path))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
  return [session, ...stored].filter(Boolean).join("; ")
}

/** The signed-cookie form `connect/start` writes, for forged-state cases. */
function signedState(payload: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const signature = createHmac("sha256", HARNESS_SECRET)
    .update(encoded)
    .digest("base64url")
  return `naba_google_oauth=${encoded}.${signature}`
}

describeDatabase("automatic Google review setup", () => {
  let admin: ReturnType<typeof postgres>
  let stub: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>> | undefined
  const organisations: string[] = []

  beforeAll(async () => {
    const directDatabaseUrl = process.env.DIRECT_DATABASE_URL
    if (!directDatabaseUrl) {
      throw new TypeError("DIRECT_DATABASE_URL is required")
    }
    admin = postgres(directDatabaseUrl, { max: 1 })
    stub = await startGoogleStub()
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: stub.baseUrl,
      GOOGLE_CLIENT_ID: "automatic-setup-client",
      GOOGLE_CLIENT_SECRET: "automatic-setup-secret",
      GOOGLE_REQUESTS_PER_SECOND: "100",
      GOOGLE_TIMEOUT_MS: "3000",
      SYNC_ENABLED: "false",
    })
  })

  afterAll(async () => {
    if (server) await server.stop()
    await stub.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  it("activates, links, and queues reviews when Google returns one account and one location", async () => {
    // Given: an owner completes OAuth for one manageable Business Profile.
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    stub.reset()
    stub.respond({ method: "POST", pathEndsWith: "/token" }, () => ({
      status: 200,
      json: {
        access_token: "automatic-access-token",
        expires_in: 3600,
        refresh_token: "automatic-refresh-token",
        scope: "openid email profile business.manage",
        token_type: "Bearer",
      },
    }))
    stub.respond({ method: "GET", pathEndsWith: "/v1/userinfo" }, () => ({
      status: 200,
      json: {
        sub: `automatic-${owner.organisationId}`,
        email: owner.email,
        email_verified: true,
      },
    }))
    stub.respond({ method: "GET", pathIncludes: "/v1/accounts" }, () => ({
      status: 200,
      json: {
        accounts: [
          {
            name: "accounts/automatic",
            accountName: "Automatic account",
            type: "PERSONAL",
            role: "OWNER",
            permissionLevel: "OWNER_LEVEL",
          },
        ],
      },
    }))
    stub.respond(
      { method: "GET", pathIncludes: "/accounts/automatic/locations" },
      () => ({
        status: 200,
        json: {
          locations: [
            {
              name: "locations/automatic",
              title: "Automatic Inn",
              storefrontAddress: {
                addressLines: ["1 Automatic Lane"],
                locality: "Cambridge",
                postalCode: "CB1 1AA",
              },
              metadata: { hasVoiceOfMerchant: true },
            },
          ],
        },
      })
    )
    if (!server) throw new Error("Integration server did not start")
    const start = await fetch(`${server.baseUrl}/api/google/connect/start`, {
      method: "POST",
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      body: "{}",
    })
    const { authorizationUrl } = z
      .object({
        authorizationUrl: z.url(),
      })
      .parse(await start.json())
    const oauthCookie = start.headers.get("set-cookie")?.split(";", 1)[0]
    if (!oauthCookie) throw new TypeError("OAuth cookie was not set")

    // When: Google returns to the callback.
    const callback = await fetch(`${server.baseUrl}/api/auth/callback/google`, {
      method: "POST",
      headers: {
        cookie: `${owner.cookie}; ${oauthCookie}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        code: "automatic-code",
        state: new URL(authorizationUrl).searchParams.get("state"),
      }),
    })

    // Then: no further account, location, or sync action is required.
    expect(callback.status, await callback.clone().text()).toBe(200)
    expect(await callback.json()).toMatchObject({
      setup: {
        kind: "automatic",
        accountName: "accounts/automatic",
        locationName: "locations/automatic",
      },
    })
    const [state] = await admin<
      {
        active: boolean
        linkId: string | null
        checkpointStatus: string | null
      }[]
    >`
      select
        ga.is_active as active,
        ll.id::text as "linkId",
        sc.status as "checkpointStatus"
      from google_account ga
      join external_location e
        on e.organisation_id = ga.organisation_id
       and e.google_account_name = ga.google_account_name
      left join location_link ll
        on ll.external_location_id = e.id
       and ll.is_active = true
      left join sync_checkpoint sc
        on sc.external_location_id = e.id
       and sc.sync_type = 'backfill'
      where ga.organisation_id = ${owner.organisationId}
    `
    expect(state).toMatchObject({
      active: true,
      linkId: expect.any(String),
      checkpointStatus: "pending",
    })
  })

  /**
   * A consent that Google would answer successfully: a token, a profile, and
   * an account list with nothing in it, so the callback reaches its writes
   * without pulling the automatic-linking path in.
   */
  function respondToConsent(subject: string) {
    stub.reset()
    stub.respond({ method: "POST", pathEndsWith: "/token" }, () => ({
      status: 200,
      json: {
        access_token: "state-access-token",
        expires_in: 3600,
        refresh_token: "state-refresh-token",
        scope: "openid email profile business.manage",
        token_type: "Bearer",
      },
    }))
    stub.respond({ method: "GET", pathEndsWith: "/v1/userinfo" }, () => ({
      status: 200,
      json: {
        sub: subject,
        email: `${subject}@example.test`,
        email_verified: true,
      },
    }))
    stub.respond({ method: "GET", pathIncludes: "/v1/accounts" }, () => ({
      status: 200,
      json: { accounts: [] },
    }))
  }

  async function beginConnect(
    cookie: string,
    body: Record<string, unknown> = {}
  ) {
    if (!server) throw new Error("Integration server did not start")
    const start = await fetch(`${server.baseUrl}/api/google/connect/start`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    expect(start.status, await start.clone().text()).toBe(200)
    const { authorizationUrl } = z
      .object({ authorizationUrl: z.url() })
      .parse(await start.json())
    return {
      start,
      nonce: new URL(authorizationUrl).searchParams.get("state"),
    }
  }

  function postCallback(cookie: string, body: Record<string, unknown>) {
    if (!server) throw new Error("Integration server did not start")
    return fetch(`${server.baseUrl}${CALLBACK_PATH}`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  }

  /** Start and finish one consent for `cookie`, carrying the state cookie. */
  async function completeConsent(
    cookie: string,
    code: string,
    startBody: Record<string, unknown> = {}
  ) {
    const jar = new Map<string, StoredCookie>()
    const { start, nonce } = await beginConnect(cookie, startBody)
    acceptCookies(jar, start)
    return postCallback(cookieHeader(jar, CALLBACK_PATH, cookie), {
      code,
      state: nonce,
    })
  }

  /** A manageable account in the shape the discovery schema accepts. */
  function manageableAccount(name: string) {
    return {
      name,
      accountName: `${name} account`,
      type: "PERSONAL",
      role: "OWNER",
      permissionLevel: "OWNER_LEVEL",
    }
  }

  async function activeConnectionCount(organisationId: string) {
    const [row] = await admin<{ count: number }[]>`
      select count(*)::int as count
      from google_connection
      where organisation_id = ${organisationId}
        and status = 'active'
    `
    return row.count
  }

  it("clears the state cookie on its own path, so the callback cannot be replayed", async () => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    respondToConsent(`replay-${owner.organisationId}`)
    const jar = new Map<string, StoredCookie>()

    const { start, nonce } = await beginConnect(owner.cookie)
    acceptCookies(jar, start)
    expect(cookieHeader(jar, CALLBACK_PATH)).toContain("naba_google_oauth=")

    const first = await postCallback(
      cookieHeader(jar, CALLBACK_PATH, owner.cookie),
      { code: "replay-code", state: nonce }
    )
    expect(first.status, await first.clone().text()).toBe(200)
    // The clearing Set-Cookie has to carry the path `connect/start` used.
    // `Path=/` names a different cookie, so the browser keeps the spent nonce
    // and the PKCE verifier for the full ten-minute maxAge.
    expect(
      first.headers
        .getSetCookie()
        .some(
          (cookie) =>
            cookie.startsWith("naba_google_oauth=") &&
            cookie.includes(`Path=${CALLBACK_PATH}`)
        )
    ).toBe(true)
    acceptCookies(jar, first)
    expect(cookieHeader(jar, CALLBACK_PATH)).toBe("")

    // What a Back button or a reload sends: the same code and state, with
    // whatever the browser still holds. Without the clear this re-ran the
    // authorization code at Google.
    const replay = await postCallback(
      cookieHeader(jar, CALLBACK_PATH, owner.cookie),
      { code: "replay-code", state: nonce }
    )
    expect(replay.status).toBe(400)
    expect((await replay.json()).error).toBe("invalid_oauth_state")
  })

  it("refuses a tampered signature and an expired state", async () => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    respondToConsent(`tampered-${owner.organisationId}`)
    const jar = new Map<string, StoredCookie>()
    const { start, nonce } = await beginConnect(owner.cookie)
    acceptCookies(jar, start)

    const authentic = cookieHeader(jar, CALLBACK_PATH)
    expect(authentic.startsWith("naba_google_oauth=")).toBe(true)
    // One flipped character in the HMAC: everything else about the state is
    // genuine, so only the signature check can reject it.
    const forged = `${authentic.slice(0, -1)}${authentic.endsWith("A") ? "B" : "A"}`
    const tampered = await postCallback(`${owner.cookie}; ${forged}`, {
      code: "tampered-code",
      state: nonce,
    })
    expect(tampered.status).toBe(400)
    expect((await tampered.json()).error).toBe("invalid_oauth_state")

    // Correctly signed, addressed to this session, and ten minutes stale: the
    // signature alone is not what makes a state usable.
    const stale = signedState({
      nonce: "stale-nonce",
      verifier: "v".repeat(64),
      organisationId: owner.organisationId,
      userId: owner.userId,
      expiresAt: Date.now() - 60_000,
    })
    const expired = await postCallback(`${owner.cookie}; ${stale}`, {
      code: "stale-code",
      state: "stale-nonce",
    })
    expect(expired.status).toBe(400)
    expect((await expired.json()).error).toBe("invalid_oauth_state")
    // Neither attempt may reach Google: the state gate is upstream of the
    // token exchange.
    expect(stub.calls.filter((call) => call.path.endsWith("/token"))).toEqual(
      []
    )
  })

  it("refuses a state minted for another organisation's session", async () => {
    const owner = await createTestTenant(admin)
    const outsider = await createTestTenant(admin)
    organisations.push(owner.organisationId, outsider.organisationId)
    respondToConsent(`switched-${owner.organisationId}`)
    const jar = new Map<string, StoredCookie>()
    const { start, nonce } = await beginConnect(owner.cookie)
    acceptCookies(jar, start)

    // Same browser, a different tenant signed in by the time Google came
    // back: the connection must not land in the session that happens to be
    // active, and the first session's state must survive for its owner.
    const switched = await postCallback(
      cookieHeader(jar, CALLBACK_PATH, outsider.cookie),
      { code: "switched-code", state: nonce }
    )
    expect(switched.status).toBe(403)
    expect((await switched.json()).error).toBe("oauth_session_changed")
    // The state is spent only after it has been matched to its own session,
    // so a bystander cannot burn the owner's pending connect.
    expect(
      switched.headers
        .getSetCookie()
        .filter((cookie) => cookie.startsWith("naba_google_oauth="))
    ).toEqual([])
    const [connections] = await admin<{ count: number }[]>`
      select count(*)::int as count
      from google_connection
      where organisation_id = ${outsider.organisationId}
    `
    expect(connections.count).toBe(0)

    const rightful = await postCallback(
      cookieHeader(jar, CALLBACK_PATH, owner.cookie),
      { code: "switched-code", state: nonce }
    )
    expect(rightful.status, await rightful.clone().text()).toBe(200)
  })

  it("reports a denied consent, a malformed callback, and a failed exchange", async () => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    respondToConsent(`denied-${owner.organisationId}`)

    const denied = await postCallback(owner.cookie, { error: "access_denied" })
    expect(denied.status).toBe(400)
    expect((await denied.json()).error).toBe("google_oauth_denied")

    const malformed = await postCallback(owner.cookie, { state: "orphan" })
    expect(malformed.status).toBe(400)
    expect((await malformed.json()).error).toBe("invalid_oauth_callback")

    // A rotated client secret, or a code already redeemed: Google answers the
    // exchange with an OAuth error and the browser must land on the
    // connections page carrying the status and the correlation id.
    const jar = new Map<string, StoredCookie>()
    const { start, nonce } = await beginConnect(owner.cookie)
    acceptCookies(jar, start)
    stub.respond({ method: "POST", pathEndsWith: "/token" }, () => ({
      status: 400,
      json: { error: "invalid_grant", error_description: "Bad code." },
    }))
    if (!server) throw new Error("Integration server did not start")
    const redirected = await fetch(
      `${server.baseUrl}${CALLBACK_PATH}?code=dead-code&state=${nonce}`,
      {
        headers: { cookie: cookieHeader(jar, CALLBACK_PATH, owner.cookie) },
        redirect: "manual",
      }
    )
    expect([303, 307]).toContain(redirected.status)
    const location = new URL(redirected.headers.get("location")!)
    // The callback now returns to the step the operator left, via the
    // signed state. Without a readable state — which is often what failed —
    // it falls back to the connections page directly rather than through the
    // legacy alias.
    expect(location.pathname).toBe("/settings/connections")
    expect(location.searchParams.get("google")).toBe("error")
    expect(location.searchParams.get("status")).toBe("502")
    expect(location.searchParams.get("rid")).toBeTruthy()
    // The state was spent on the attempt, so the dead code cannot be retried
    // against Google by reloading.
    acceptCookies(jar, redirected)
    expect(cookieHeader(jar, CALLBACK_PATH)).toBe("")
  })

  /**
   * Discovery links for the user only when Google leaves exactly one choice.
   * Every other answer has to hand back to manual linking with the connection
   * intact: the tokens are committed before discovery runs and are live at
   * Google whatever it answers, so failing the connect would send the owner
   * back through consent for a connection that already works.
   */
  it("hands back to manual linking without losing the connection", async () => {
    const ambiguous = await createTestTenant(admin)
    organisations.push(ambiguous.organisationId)
    respondToConsent(`accounts-${ambiguous.organisationId}`)
    // Two manageable accounts, and nothing in the payload says which one this
    // organisation means.
    stub.respond({ method: "GET", pathIncludes: "/v1/accounts" }, () => ({
      status: 200,
      json: {
        accounts: [
          manageableAccount("accounts/one"),
          manageableAccount("accounts/two"),
        ],
      },
    }))
    const accounts = await completeConsent(ambiguous.cookie, "accounts-code")
    expect(accounts.status, await accounts.clone().text()).toBe(200)
    expect(await accounts.json()).toMatchObject({
      setup: { kind: "manual_accounts", accountCount: 2 },
    })
    expect(await activeConnectionCount(ambiguous.organisationId)).toBe(1)

    const unlocated = await createTestTenant(admin)
    organisations.push(unlocated.organisationId)
    respondToConsent(`locations-${unlocated.organisationId}`)
    // One account, but no location on it yet: the account is unambiguous, the
    // location is the part a person still has to supply.
    stub.respond({ method: "GET", pathIncludes: "/v1/accounts" }, () => ({
      status: 200,
      json: { accounts: [manageableAccount("accounts/sole")] },
    }))
    stub.respond(
      { method: "GET", pathIncludes: "/accounts/sole/locations" },
      () => ({ status: 200, json: { locations: [] } })
    )
    const locations = await completeConsent(unlocated.cookie, "locations-code")
    expect(locations.status, await locations.clone().text()).toBe(200)
    expect(await locations.json()).toMatchObject({
      setup: {
        kind: "manual_locations",
        accountName: "accounts/sole",
        locationCount: 0,
      },
    })
    expect(await activeConnectionCount(unlocated.organisationId)).toBe(1)

    const broken = await createTestTenant(admin)
    organisations.push(broken.organisationId)
    respondToConsent(`error-${broken.organisationId}`)
    // An account Google will not name: discovery throws instead of answering,
    // which is the only way into the manual_error arm.
    stub.respond({ method: "GET", pathIncludes: "/v1/accounts" }, () => ({
      status: 200,
      json: { accounts: [{ accountName: "Nameless" }] },
    }))
    const failed = await completeConsent(broken.cookie, "error-code")
    expect(failed.status, await failed.clone().text()).toBe(200)
    expect(await failed.json()).toMatchObject({
      setup: { kind: "manual_error" },
    })
    expect(await activeConnectionCount(broken.organisationId)).toBe(1)
    // Nothing half-written: the account row is only ever inserted for the
    // candidate discovery actually chose.
    const [stored] = await admin<{ count: number }[]>`
      select count(*)::int as count
      from google_account
      where organisation_id = ${broken.organisationId}
    `
    expect(stored.count).toBe(0)
  }, 60_000)

  it("moves setup past Connect for a login with several accounts and locations", async () => {
    // Given: an operator setting up a client whose Google login manages
    // two Business Profile accounts, so nothing can be linked automatically.
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const [client] = await admin<{ id: string }[]>`
      insert into client (organisation_id, name, slug)
      values (${owner.organisationId}, 'Lapen Inns', 'lapen-inns')
      returning id::text as id
    `
    // Another client's login and account in the same organisation, already
    // chosen. Setting up this client must not switch it off.
    const otherConnection = randomUUID()
    const [otherAccount] = await admin<{ id: string }[]>`
      with connection as (
        insert into google_connection (id, organisation_id, google_subject, status, scope)
        values (${otherConnection}, ${owner.organisationId}, ${`other-${otherConnection}`},
          'active', 'business.manage')
        returning id
      )
      insert into google_account (
        organisation_id, google_connection_id, google_account_name, account_name, is_active
      )
      select ${owner.organisationId}, id, 'accounts/other-client', 'Other client', true
      from connection
      returning id::text as id
    `
    respondToConsent(`several-${owner.organisationId}`)
    stub.respond({ method: "GET", pathIncludes: "/v1/accounts" }, () => ({
      status: 200,
      json: {
        accounts: [
          manageableAccount("accounts/pubs"),
          manageableAccount("accounts/restaurants"),
        ],
      },
    }))

    // When: Google returns to the callback for this client.
    const callback = await completeConsent(owner.cookie, "several-code", {
      clientId: client!.id,
      returnTo: `/setup?client=${client!.id}&step=account`,
    })
    expect(callback.status, await callback.clone().text()).toBe(200)
    expect(await callback.json()).toMatchObject({
      setup: { kind: "manual_accounts", accountCount: 2 },
    })

    // Then: the wizard moves on to choosing accounts instead of looping back
    // to Connect, although no location is linked yet.
    if (!server) throw new Error("Integration server did not start")
    const readSetup = async () => {
      const response = await fetch(
        `${server!.baseUrl}/api/clients/${client!.id}/setup`,
        { headers: { cookie: owner.cookie } }
      )
      expect(response.status, await response.clone().text()).toBe(200)
      return (
        (await response.json()) as {
          setup: {
            nextStep: string
            connection: { id: string; status: string } | null
            accountsActive: number
          }
        }
      ).setup
    }
    const afterConnect = await readSetup()
    expect(afterConnect.connection?.status).toBe("active")
    expect(afterConnect.nextStep).toBe("account")
    // The other client's active account is not this client's.
    expect(afterConnect.accountsActive).toBe(0)
    const connectionId = afterConnect.connection!.id

    // Discover the accounts, then choose one for this client.
    const discovered = await fetch(
      `${server.baseUrl}/api/google/accounts?connection_id=${connectionId}`,
      { headers: { cookie: owner.cookie } }
    )
    expect(discovered.status, await discovered.clone().text()).toBe(200)
    const { accounts } = (await discovered.json()) as {
      accounts: {
        id: string
        googleAccountName: string
        googleConnectionId: string | null
      }[]
    }
    const pubs = accounts.find((row) => row.googleAccountName === "accounts/pubs")
    expect(pubs?.googleConnectionId).toBe(connectionId)

    const patch = (accountIds: string[]) =>
      fetch(`${server!.baseUrl}/api/google/accounts`, {
        method: "PATCH",
        headers: { cookie: owner.cookie, "content-type": "application/json" },
        body: JSON.stringify({ accountIds, clientId: client!.id, connectionId }),
      })

    // An account this login does not reach is refused, not silently kept.
    const outside = await patch([pubs!.id, otherAccount!.id])
    expect(outside.status).toBe(400)
    expect(await outside.json()).toMatchObject({
      error: "account_out_of_scope",
    })

    const chosen = await patch([pubs!.id])
    expect(chosen.status, await chosen.clone().text()).toBe(200)

    const states = await admin<{ name: string; active: boolean }[]>`
      select google_account_name as name, is_active as active
      from google_account
      where organisation_id = ${owner.organisationId}
      order by google_account_name
    `
    expect(states).toEqual([
      { name: "accounts/other-client", active: true },
      { name: "accounts/pubs", active: true },
      { name: "accounts/restaurants", active: false },
    ])
    expect((await readSetup()).nextStep).toBe("locations")
  }, 60_000)
})
