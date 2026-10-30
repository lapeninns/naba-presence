import { randomUUID } from "node:crypto"

import postgres from "postgres"
import type { Page } from "@playwright/test"

import { startAppServer } from "../../integration/helpers/app-server"
import { startGoogleStub } from "../../integration/helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedLocation,
  seedMemberUser,
} from "../../integration/helpers/tenant"

/**
 * Real standalone app, owned PostgreSQL and a private loopback Google stub
 * for the Google change watch (S5). The stub holds one Google location per
 * fixture that a spec edits in place, as someone editing the listing on
 * Google would; every non-validate PATCH is recorded and applied, so a "Put
 * ours back" publish is observed on "Google", not assumed. No real Google.
 */
export async function startGoogleWatchBackend() {
  if (!process.env.DIRECT_DATABASE_URL)
    throw new Error("Isolated PostgreSQL required")
  const admin = postgres(process.env.DIRECT_DATABASE_URL, { max: 1 })
  const organisations: string[] = []
  let google: Awaited<ReturnType<typeof startGoogleStub>> | null = null
  let server: Awaited<ReturnType<typeof startAppServer>>
  try {
    google = await startGoogleStub({ port: 0 })
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: google.baseUrl,
      GBP_PROFILE_WRITES_ENABLED: "true",
      PUBLISH_ENABLED: "true",
      RESEND_API_KEY: "",
    })
  } catch (error) {
    await google?.stop()
    await admin.end()
    throw error
  }
  const stub = google

  return {
    admin,
    google: stub,
    server,
    async stop() {
      try {
        await server.stop()
        await stub.stop()
      } finally {
        await destroyTenants(admin, organisations)
        await admin.end()
      }
    },
    async fixture(page: Page) {
      stub.reset()
      const owner = await createTestTenant(admin)
      organisations.push(owner.organisationId)
      const connection = await seedGoogleConnection(admin, {
        organisationId: owner.organisationId,
      })
      const linked = await seedLinkedLocation(admin, {
        organisationId: owner.organisationId,
        connectionId: connection.connectionId,
        googleAccountName: connection.googleAccountName,
      })
      await admin`update location set name = 'The Old Crown' where id = ${linked.locationId}`
      const member = await seedMemberUser(admin, {
        organisationId: owner.organisationId,
        role: "member",
        canPublish: true,
      })
      const location: Record<string, unknown> = {
        name: linked.googleLocationName,
        title: "Old Crown",
        profile: { description: "Village pub" },
        phoneNumbers: { primaryPhone: "+44 1223 000000" },
        websiteUri: "https://old-crown.example",
        categories: {
          primaryCategory: { name: "gcid:pub", displayName: "Pub" },
        },
        regularHours: {
          periods: ["FRIDAY", "SATURDAY"].map((day) => ({
            openDay: day,
            openTime: { hours: 12 },
            closeDay: day,
            closeTime: { hours: 23 },
          })),
        },
        metadata: {},
      }
      /** What reached "Google": each real (not validate-only) PATCH. */
      const writes: Array<Record<string, unknown>> = []
      const updateMasks: string[] = []
      stub.respond({ method: "GET", pathIncludes: "/v1/" }, () => ({
        status: 200,
        json: {},
      }))
      stub.respond(
        { method: "GET", pathIncludes: `/v1/${linked.googleLocationName}` },
        () => ({ status: 200, json: location })
      )
      stub.respond(
        {
          method: "GET",
          pathIncludes: `/v1/${linked.googleLocationName}/attributes`,
        },
        () => ({ status: 200, json: { attributes: [], attributeMetadata: [] } })
      )
      stub.respond({ method: "GET", pathIncludes: "/v1/attributes?" }, () => ({
        status: 200,
        json: { attributeMetadata: [] },
      }))
      stub.respond(
        { method: "GET", pathIncludes: "/categories:batchGet" },
        (call) => ({
          status: 200,
          json: {
            categories: new URL(call.path, stub.baseUrl).searchParams
              .getAll("names")
              .map((name) => ({
                name,
                displayName: name.replace("gcid:", ""),
              })),
          },
        })
      )
      stub.respond(
        { method: "PATCH", pathIncludes: `/v1/${linked.googleLocationName}` },
        (call) => {
          const body = call.body as Record<string, unknown>
          const params = new URL(call.path, stub.baseUrl).searchParams
          if (params.get("validateOnly") !== "true") {
            writes.push(body)
            updateMasks.push(params.get("updateMask") ?? "")
            Object.assign(location, body)
          }
          return { status: 200, json: location }
        }
      )
      const signIn = (cookie: string) =>
        page.context().addCookies([
          {
            name: "naba_session",
            value: cookie.slice("naba_session=".length),
            url: server.baseUrl,
            httpOnly: true,
            sameSite: "Lax",
          },
        ])
      await signIn(owner.cookie)
      const api = `${server.baseUrl}/api/locations/${linked.locationId}`
      return {
        owner,
        member,
        linked,
        location,
        writes,
        updateMasks,
        signIn,
        goto: (path: string) => page.goto(`${server.baseUrl}${path}`),
        /** "Check Google now" for the watch, as the owner, without the page. */
        async check() {
          const response = await fetch(`${api}/google-changes/check`, {
            method: "POST",
            headers: {
              cookie: owner.cookie,
              "content-type": "application/json",
              "Idempotency-Key": randomUUID(),
            },
            body: "{}",
          })
          if (!response.ok)
            throw new Error(
              `check failed: ${response.status} ${await response.text()}`
            )
          return (await response.json()) as { found: number }
        },
      }
    },
  }
}
