import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import { createTestTenant, destroyTenants } from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

const CRON_BEARER = "Bearer route-harness-cron-secret"
const SCOPE =
  "openid email profile https://www.googleapis.com/auth/business.manage"

/**
 * Acceptance: a Google login with 3 accounts and 9 locations completes the
 * setup wizard, and stopping at any step and coming back resumes at that
 * step. "Coming back" is a fresh read of the client's setup, exactly what
 * the wizard does on load: the step is derived from what exists, never from
 * a stored cursor, so a closed tab, a reload or a new day all land the same.
 */
describeDatabase(
  "onboarding a login with several accounts and locations",
  () => {
    let admin: ReturnType<typeof postgres>
    let stub: GoogleStub
    let server: Awaited<ReturnType<typeof startAppServer>>
    const organisations: string[] = []
    const marker = randomUUID().slice(0, 8)
    const accounts = [1, 2, 3].map((n) => `accounts/onboard-${marker}-${n}`)
    const locationsOf = (account: string) =>
      [1, 2, 3].map((n) => `locations/${account.split("/")[1]}-venue-${n}`)

    beforeAll(async () => {
      admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
      stub = await startGoogleStub()
      server = await startAppServer({
        GOOGLE_API_PROXY_BASE: stub.baseUrl,
        GOOGLE_CLIENT_ID: "onboarding-client",
        GOOGLE_CLIENT_SECRET: "onboarding-secret",
        GOOGLE_REQUESTS_PER_SECOND: "100",
      })
    })

    afterAll(async () => {
      await server.stop()
      await stub.stop()
      await destroyTenants(admin, organisations)
      await admin.end()
    })

    function stubGoogle(googleSubject: string, email: string) {
      stub.reset()
      stub.respond({ method: "POST", pathEndsWith: "/token" }, () => ({
        status: 200,
        json: {
          access_token: `onboarding-access-${googleSubject}`,
          expires_in: 3600,
          refresh_token: `onboarding-refresh-${googleSubject}`,
          scope: SCOPE,
          token_type: "Bearer",
        },
      }))
      stub.respond({ method: "GET", pathEndsWith: "/v1/userinfo" }, () => ({
        status: 200,
        json: { sub: googleSubject, email, email_verified: true },
      }))
      stub.respond({ method: "GET", pathIncludes: "/v1/accounts" }, (call) =>
        call.path.includes("/locations")
          ? {
              status: 200,
              json: {
                locations: locationsOf(
                  accounts.find((account) =>
                    call.path.includes(`${account}/locations`)
                  ) ?? accounts[0]
                ).map((name, index) => ({
                  name,
                  title: `${name.split("/")[1]} (${index + 1})`,
                  storefrontAddress: { locality: "Cambridge" },
                  metadata: { hasVoiceOfMerchant: true },
                })),
              },
            }
          : {
              status: 200,
              json: {
                accounts: accounts.map((name, index) => ({
                  name,
                  accountName: `Group account ${index + 1}`,
                  type: "LOCATION_GROUP",
                })),
              },
            }
      )
      stub.respond({ method: "GET", pathIncludes: "/reviews" }, () => ({
        status: 200,
        json: { reviews: [], totalReviewCount: 0 },
      }))
      stub.respond(
        { method: "PATCH", pathIncludes: "/notificationSetting" },
        (call) => ({
          status: 200,
          json: call.body as Record<string, unknown>,
        })
      )
    }

    const request = (path: string, cookie: string, init: RequestInit = {}) =>
      fetch(`${server.baseUrl}${path}`, {
        ...init,
        redirect: "manual",
        headers: {
          cookie,
          "content-type": "application/json",
          ...(init.headers ?? {}),
        },
      })

    async function client(owner: { organisationId: string }, name: string) {
      const [row] = await admin<{ id: string }[]>`
      insert into client (organisation_id, name, slug)
      values (${owner.organisationId}, ${name}, ${`${name.toLowerCase().replace(/\W+/g, "-")}-${randomUUID().slice(0, 6)}`})
      returning id::text as id
    `
      return row.id
    }

    async function setup(cookie: string, clientId: string) {
      const response = await request(`/api/clients/${clientId}/setup`, cookie)
      expect(response.status, await response.clone().text()).toBe(200)
      return (
        (await response.json()) as {
          setup: {
            nextStep: string
            connection: { id: string } | null
            accountsActive: number
            locationsLinked: number
            backfill: string
          }
        }
      ).setup
    }

    /** The browser half of OAuth: start, then Google's redirect to the callback. */
    async function connectGoogle(cookie: string, clientId: string) {
      const start = await request("/api/google/connect/start", cookie, {
        method: "POST",
        body: JSON.stringify({
          clientId,
          returnTo: `/setup?client=${clientId}&step=account`,
        }),
      })
      expect(start.status, await start.clone().text()).toBe(200)
      const { authorizationUrl } = (await start.json()) as {
        authorizationUrl: string
      }
      const oauthCookie = start.headers.get("set-cookie")!.split(";", 1)[0]
      const state = new URL(authorizationUrl).searchParams.get("state")!
      return request(
        `/api/auth/callback/google?code=onboarding-code&state=${encodeURIComponent(state)}`,
        `${cookie}; ${oauthCookie}`
      )
    }

    it("takes 3 accounts and 9 locations from connect to done, resuming at every step", async () => {
      const owner = await createTestTenant(admin)
      organisations.push(owner.organisationId)
      const clientId = await client(owner, "Lapen Inns")
      const subject = `onboarding-${marker}`
      stubGoogle(subject, "venues@lapen.example")

      // Stage 0: nothing yet.
      expect((await setup(owner.cookie, clientId)).nextStep).toBe("connect")

      // Stage 1: connect. Three accounts, so nothing is linked automatically,
      // and the wizard must still move on (this is the case that used to
      // send the operator back to Connect).
      const callback = await connectGoogle(owner.cookie, clientId)
      expect(callback.status).toBe(307)
      const landing = new URL(callback.headers.get("location")!)
      expect(landing.pathname).toBe("/setup")
      expect(landing.searchParams.get("client")).toBe(clientId)
      expect(landing.searchParams.get("step")).toBe("account")
      expect(landing.searchParams.get("google")).toBe("connected")
      const afterConnect = await setup(owner.cookie, clientId)
      expect(afterConnect).toMatchObject({
        nextStep: "account",
        locationsLinked: 0,
      })
      const connectionId = afterConnect.connection!.id
      // Interrupted here and back later: same step.
      expect((await setup(owner.cookie, clientId)).nextStep).toBe("account")

      // Stage 2: choose accounts.
      const discovered = await request(
        `/api/google/accounts?connection_id=${connectionId}`,
        owner.cookie
      )
      expect(discovered.status, await discovered.clone().text()).toBe(200)
      const { accounts: found } = (await discovered.json()) as {
        accounts: { id: string; googleAccountName: string }[]
      }
      const ours = found.filter((account) =>
        accounts.includes(account.googleAccountName)
      )
      expect(ours).toHaveLength(3)
      const chosen = await request("/api/google/accounts", owner.cookie, {
        method: "PATCH",
        body: JSON.stringify({
          clientId,
          connectionId,
          accountIds: ours.map((account) => account.id),
        }),
      })
      expect(chosen.status, await chosen.clone().text()).toBe(200)
      expect(await setup(owner.cookie, clientId)).toMatchObject({
        nextStep: "locations",
        accountsActive: 3,
      })
      expect((await setup(owner.cookie, clientId)).nextStep).toBe("locations")

      // Stage 3: discover and link all nine locations.
      const listed = await request("/api/google/locations", owner.cookie)
      expect(listed.status, await listed.clone().text()).toBe(200)
      const { locations } = (await listed.json()) as {
        locations: { id: string; googleLocationName: string }[]
      }
      const nine = locations.filter((location) =>
        accounts.some((account) =>
          location.googleLocationName.startsWith(
            `locations/${account.split("/")[1]}`
          )
        )
      )
      expect(nine).toHaveLength(9)
      for (const [index, location] of nine.entries()) {
        const linked = await request("/api/location-links", owner.cookie, {
          method: "POST",
          body: JSON.stringify({
            externalLocationId: location.id,
            timezone: "Europe/London",
            clientId,
          }),
        })
        expect(linked.status, await linked.clone().text()).toBe(201)
        // Interrupted part-way through linking: resumes past the locations
        // step as soon as one is linked, with the count so far.
        if (index === 3) {
          expect(await setup(owner.cookie, clientId)).toMatchObject({
            nextStep: "backfill",
            locationsLinked: 4,
          })
        }
      }
      expect(await setup(owner.cookie, clientId)).toMatchObject({
        nextStep: "backfill",
        locationsLinked: 9,
      })

      // Stage 4: import history. Started, then the runner does the work.
      const backfill = await request("/api/sync/backfill", owner.cookie, {
        method: "POST",
        body: JSON.stringify({
          externalLocationIds: nine.map((location) => location.id),
        }),
      })
      expect(backfill.status, await backfill.clone().text()).toBeLessThan(300)
      // Interrupted while importing: the step is not skipped.
      const importing = await setup(owner.cookie, clientId)
      expect(["backfill", "notifications"]).toContain(importing.nextStep)
      for (let tick = 0; tick < 10; tick += 1) {
        if ((await setup(owner.cookie, clientId)).backfill === "done") break
        await fetch(`${server.baseUrl}/api/jobs/run`, {
          headers: { authorization: CRON_BEARER },
        })
      }
      expect(await setup(owner.cookie, clientId)).toMatchObject({
        backfill: "done",
        nextStep: "notifications",
      })

      // Stage 5: review notifications for one of the accounts.
      const notified = await request(
        "/api/google/notifications",
        owner.cookie,
        {
          method: "PATCH",
          body: JSON.stringify({
            accountId: ours[0].id,
            pubsubTopic: "projects/naba-presence/topics/reviews",
          }),
        }
      )
      expect(notified.status, await notified.clone().text()).toBe(200)
      expect((await setup(owner.cookie, clientId)).nextStep).toBe("team")

      // Stage 6: invite the team.
      const invited = await request("/api/invitations", owner.cookie, {
        method: "POST",
        body: JSON.stringify({
          email: `manager-${marker}@lapen.example`,
          role: "member",
        }),
      })
      expect(invited.status, await invited.clone().text()).toBeLessThan(300)
      expect((await setup(owner.cookie, clientId)).nextStep).toBe("done")

      // The connection that made it all is recorded against the person.
      const [row] = await admin<{ connectedBy: string }[]>`
      select connected_by_user_id::text as "connectedBy"
      from google_connection where id = ${connectionId}
    `
      expect(row.connectedBy).toBe(owner.userId)
    }, 240_000)

    it("keeps one client's account choice from touching another client's", async () => {
      const owner = await createTestTenant(admin)
      organisations.push(owner.organisationId)
      const first = await client(owner, "First Group")
      const second = await client(owner, "Second Group")
      // Each client has its own login with its own accounts.
      const logins = []
      for (const [index, clientId] of [first, second].entries()) {
        const connectionId = randomUUID()
        await admin`
        insert into google_connection (id, organisation_id, google_subject, google_email, status, scope)
        values (${connectionId}, ${owner.organisationId}, ${`iso-${marker}-${index}`},
          ${`login-${index}@example.test`}, 'active', ${SCOPE})
      `
        await admin`
        insert into client_google_connection (organisation_id, client_id, google_connection_id)
        values (${owner.organisationId}, ${clientId}, ${connectionId})
      `
        const ids = await admin<{ id: string }[]>`
        insert into google_account (organisation_id, google_connection_id, google_account_name, account_name, is_active)
        values
          (${owner.organisationId}, ${connectionId}, ${`accounts/iso-${marker}-${index}-a`}, 'A', true),
          (${owner.organisationId}, ${connectionId}, ${`accounts/iso-${marker}-${index}-b`}, 'B', true)
        returning id::text as id
      `
        logins.push({
          clientId,
          connectionId,
          accountIds: ids.map((row) => row.id),
        })
      }

      // The first client narrows its choice to one account...
      const narrowed = await request("/api/google/accounts", owner.cookie, {
        method: "PATCH",
        body: JSON.stringify({
          clientId: first,
          connectionId: logins[0].connectionId,
          accountIds: [logins[0].accountIds[0]],
        }),
      })
      expect(narrowed.status, await narrowed.clone().text()).toBe(200)

      // ...and cannot pick the other client's account at all...
      const reaching = await request("/api/google/accounts", owner.cookie, {
        method: "PATCH",
        body: JSON.stringify({
          clientId: first,
          accountIds: [logins[1].accountIds[0]],
        }),
      })
      expect(reaching.status).toBe(400)

      // ...while the second client's accounts stay exactly as they were.
      const states = await admin<{ id: string; active: boolean }[]>`
      select id::text as id, is_active as active from google_account
      where google_connection_id in (${logins[0].connectionId}, ${logins[1].connectionId})
    `
      const active = new Map(states.map((row) => [row.id, row.active]))
      expect(active.get(logins[0].accountIds[0])).toBe(true)
      expect(active.get(logins[0].accountIds[1])).toBe(false)
      expect(active.get(logins[1].accountIds[0])).toBe(true)
      expect(active.get(logins[1].accountIds[1])).toBe(true)
      expect((await setup(owner.cookie, second)).accountsActive).toBe(2)
    }, 120_000)

    it("keeps an account on for a client that shares the login", async () => {
      const owner = await createTestTenant(admin)
      organisations.push(owner.organisationId)
      const first = await client(owner, "Shared First")
      const second = await client(owner, "Shared Second")
      // One agency login attached to both clients.
      const connectionId = randomUUID()
      await admin`
        insert into google_connection (id, organisation_id, google_subject, google_email, status, scope)
        values (${connectionId}, ${owner.organisationId}, ${`shared-${marker}`},
          'agency@example.test', 'active', ${SCOPE})
      `
      for (const clientId of [first, second]) {
        await admin`
          insert into client_google_connection (organisation_id, client_id, google_connection_id)
          values (${owner.organisationId}, ${clientId}, ${connectionId})
        `
      }
      const [x, y] = await admin<{ id: string; name: string }[]>`
        insert into google_account (organisation_id, google_connection_id, google_account_name, account_name, is_active)
        values
          (${owner.organisationId}, ${connectionId}, ${`accounts/shared-${marker}-x`}, 'X', true),
          (${owner.organisationId}, ${connectionId}, ${`accounts/shared-${marker}-y`}, 'Y', true)
        returning id::text as id, google_account_name as name
      `
      // The first client already has a listing from account Y.
      const externalLocationId = randomUUID()
      const locationId = randomUUID()
      await admin`
        insert into external_location (id, organisation_id, google_connection_id, google_account_name, google_location_name, title, verified)
        values (${externalLocationId}, ${owner.organisationId}, ${connectionId}, ${y.name},
          ${`locations/shared-${marker}-y1`}, 'Y venue', true)
      `
      await admin`
        insert into location (id, organisation_id, name, client_id)
        values (${locationId}, ${owner.organisationId}, 'Y venue', ${first})
      `
      await admin`
        insert into location_link (organisation_id, external_location_id, location_id, is_active)
        values (${owner.organisationId}, ${externalLocationId}, ${locationId}, true)
      `

      // The second client picks only X during its own setup.
      const picked = await request("/api/google/accounts", owner.cookie, {
        method: "PATCH",
        body: JSON.stringify({
          clientId: second,
          connectionId,
          accountIds: [x.id],
        }),
      })
      expect(picked.status, await picked.clone().text()).toBe(200)

      // Y stays on: the first client's listing depends on it.
      const states = await admin<{ id: string; active: boolean }[]>`
        select id::text as id, is_active as active from google_account
        where google_connection_id = ${connectionId}
      `
      const active = new Map(states.map((row) => [row.id, row.active]))
      expect(active.get(x.id)).toBe(true)
      expect(active.get(y.id)).toBe(true)
      expect((await setup(owner.cookie, first)).accountsActive).toBeGreaterThan(
        0
      )

      // With no other client relying on it, the same save does switch Y off.
      await admin`update location set client_id = ${second} where id = ${locationId}`
      const narrowed = await request("/api/google/accounts", owner.cookie, {
        method: "PATCH",
        body: JSON.stringify({
          clientId: second,
          connectionId,
          accountIds: [x.id],
        }),
      })
      expect(narrowed.status, await narrowed.clone().text()).toBe(200)
      const [yAfter] = await admin<{ active: boolean }[]>`
        select is_active as active from google_account where id = ${y.id}
      `
      expect(yAfter.active).toBe(false)
    }, 120_000)

    it("moves a listing to a newly discovered login only when its own login is broken", async () => {
      const owner = await createTestTenant(admin)
      organisations.push(owner.organisationId)
      const [working, broken, discoverer] = [
        randomUUID(),
        randomUUID(),
        randomUUID(),
      ]
      for (const [id, status] of [
        [working, "active"],
        [broken, "revoked"],
        [discoverer, "active"],
      ] as const) {
        await admin`
        insert into google_connection (
          id, organisation_id, google_subject, google_email, status, scope,
          access_token_ciphertext, access_token_expires_at
        )
        values (
          ${id}, ${owner.organisationId}, ${`move-${id}`}, ${`${id.slice(0, 6)}@example.test`},
          ${status}, ${SCOPE}, null, null
        )
      `
      }
      await admin`
      insert into connection_task (organisation_id, google_connection_id, task_type, status, reason_code)
      values (${owner.organisationId}, ${broken}, 'reconnect', 'open', 'invalid_grant')
    `
      const account = `accounts/move-${marker}`
      const onWorking = `locations/move-${marker}-kept`
      const onBroken = `locations/move-${marker}-moved`
      for (const [connectionId, name] of [
        [working, onWorking],
        [broken, onBroken],
      ]) {
        await admin`
        insert into external_location (
          organisation_id, google_connection_id, google_account_name,
          google_location_name, title, verified
        )
        values (${owner.organisationId}, ${connectionId}, ${account}, ${name}, ${name}, true)
      `
      }
      // The discovering login can see both listings.
      await admin`
      insert into google_account (organisation_id, google_connection_id, google_account_name, account_name, is_active)
      values (${owner.organisationId}, ${discoverer}, ${account}, 'Shared', true)
    `
      stub.reset()
      stub.respond(
        { method: "GET", pathIncludes: `${account}/locations` },
        () => ({
          status: 200,
          json: {
            locations: [onWorking, onBroken].map((name) => ({
              name,
              title: name,
              metadata: { hasVoiceOfMerchant: true },
            })),
          },
        })
      )
      // Give the discovering login a usable token through the harness key.
      const { createCipheriv, createHash, randomBytes } =
        await import("node:crypto")
      const key = createHash("sha256")
        .update(
          process.env.TOKEN_ENCRYPTION_KEY ??
            "route-harness-token-key-32-characters!!",
          "utf8"
        )
        .digest()
      const iv = randomBytes(12)
      const cipher = createCipheriv("aes-256-gcm", key, iv)
      const body = Buffer.concat([
        cipher.update("move-access", "utf8"),
        cipher.final(),
      ])
      await admin`
      update google_connection
      set access_token_ciphertext = ${Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), body])},
          access_token_expires_at = now() + interval '1 hour'
      where id = ${discoverer}
    `
      const listed = await request(
        `/api/google/locations?account_name=${encodeURIComponent(account)}`,
        owner.cookie
      )
      expect(listed.status, await listed.clone().text()).toBe(200)
      const rows = await admin<{ name: string; connectionId: string }[]>`
      select google_location_name as name, google_connection_id::text as "connectionId"
      from external_location
      where google_location_name in (${onWorking}, ${onBroken})
    `
      const owners = new Map(rows.map((row) => [row.name, row.connectionId]))
      // A working login keeps its listing...
      expect(owners.get(onWorking)).toBe(working)
      // ...a broken one's listing moves to the login that just reached it.
      expect(owners.get(onBroken)).toBe(discoverer)
    }, 120_000)
  }
)
