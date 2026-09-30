import postgres from "postgres"
import type { Page } from "@playwright/test"

import { startAppServer } from "../../integration/helpers/app-server"
import { startGoogleStub } from "../../integration/helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedLocation,
} from "../../integration/helpers/tenant"

const d = (date: string) => {
  const [year, month, day] = date.split("-").map(Number)
  return { year, month, day }
}

/**
 * Real standalone app, owned PostgreSQL and a loopback Google stub for the
 * WP6–WP9 surfaces. The stub keeps per-listing special hours and local posts
 * so bulk changes and scheduled publication are observed, not assumed.
 */
export async function startOperationsBackend() {
  if (!process.env.DIRECT_DATABASE_URL)
    throw new Error("Isolated PostgreSQL required")
  const admin = postgres(process.env.DIRECT_DATABASE_URL, { max: 1 })
  const google = await startGoogleStub()
  const organisations: string[] = []
  const server = await startAppServer({
    GOOGLE_API_PROXY_BASE: google.baseUrl,
    GBP_PROFILE_WRITES_ENABLED: "true",
    GBP_POSTS_ENABLED: "true",
    PUBLISH_ENABLED: "true",
    JOBS_ENABLED: "true",
    GBP_PERFORMANCE_ENABLED: "true",
    RESEND_API_KEY: "",
  })
  const listings = new Map<string, { specialHourPeriods: unknown[] }>()
  const posts: Array<Record<string, unknown>> = []
  const nameOf = (path: string) =>
    new URL(path, "https://stub.test").pathname.replace(/^\/v\d\//, "")
  function install() {
    google.reset()
    google.respond({ method: "GET", pathIncludes: "readMask=" }, (call) => {
      const state = listings.get(nameOf(call.path))
      return state
        ? { status: 200, json: { specialHours: state } }
        : { status: 404, json: {} }
    })
    google.respond(
      { method: "PATCH", pathIncludes: "updateMask=specialHours" },
      (call) => {
        const state = listings.get(nameOf(call.path))
        if (!state) return { status: 404, json: {} }
        state.specialHourPeriods = (
          call.body as { specialHours: { specialHourPeriods: unknown[] } }
        ).specialHours.specialHourPeriods
        return { status: 200, json: { specialHours: state } }
      }
    )
    google.respond({ method: "POST", pathIncludes: "/localPosts" }, (call) => {
      const post = {
        ...(call.body as object),
        name: `${nameOf(call.path)}/p${posts.length + 1}`,
        state: "LIVE",
      }
      posts.push(post)
      return { status: 200, json: post }
    })
    google.respond({ method: "GET", pathIncludes: "/localPosts?" }, () => ({
      status: 200,
      json: { localPosts: posts },
    }))
    google.respond({ method: "GET", pathIncludes: "/localPosts/" }, (call) => {
      const found = posts.find((post) => call.path.includes(String(post.name)))
      return found ? { status: 200, json: found } : { status: 404, json: {} }
    })
  }
  return {
    admin,
    google,
    server,
    listings,
    posts,
    async stop() {
      await server.stop()
      await google.stop()
      await destroyTenants(admin, organisations)
      await admin.end()
    },
    async tick() {
      const response = await fetch(`${server.baseUrl}/api/jobs/run`, {
        method: "POST",
        headers: { authorization: "Bearer route-harness-cron-secret" },
      })
      if (!response.ok) throw new Error(`job tick failed: ${response.status}`)
    },
    async fixture(page: Page, count = 2) {
      install()
      listings.clear()
      posts.length = 0
      const owner = await createTestTenant(admin)
      organisations.push(owner.organisationId)
      const connection = await seedGoogleConnection(admin, {
        organisationId: owner.organisationId,
      })
      const linked = []
      for (let index = 0; index < count; index += 1) {
        const location = await seedLinkedLocation(admin, {
          organisationId: owner.organisationId,
          ...connection,
        })
        await admin`update location set name = ${`Fixture Inn ${index + 1}`} where id = ${location.locationId}`
        listings.set(location.googleLocationName, {
          specialHourPeriods: [
            {
              startDate: d("2026-12-25"),
              endDate: d("2026-12-25"),
              closed: true,
            },
          ],
        })
        linked.push(location)
      }
      await page
        .context()
        .addCookies([
          {
            name: "naba_session",
            value: owner.cookie.slice("naba_session=".length),
            url: server.baseUrl,
            httpOnly: true,
            sameSite: "Lax",
          },
        ])
      const incident = async (
        kind: string,
        locationId: string | null,
        title = "Fixture Inn 1"
      ) => {
        const [row] = await admin<{ id: string }[]>`
          insert into notification_incident (organisation_id, kind, subject_type, subject_id, summary, location_id, reason)
          values (${owner.organisationId}, ${kind}, 'attempt', ${crypto.randomUUID()}, ${admin.json({ title })}, ${locationId}, 'provider_rejected') returning id::text as id`
        return row.id
      }
      return {
        owner,
        connection,
        linked,
        incident,
        goto: (path: string) => page.goto(`${server.baseUrl}${path}`),
      }
    },
  }
}
