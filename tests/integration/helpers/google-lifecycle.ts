import postgres from "postgres"
import { afterAll, beforeAll } from "vitest"
import { startAppServer } from "./app-server"
import { startGoogleStub } from "./google-stub"
import { createTestTenant, destroyTenants, seedGoogleConnection, seedLinkedLocation } from "./tenant"

type Location = { name: string; metadata: { placeId: string; canDelete: boolean } }
export function lifecycleHarness(serverEnv: Record<string, string> = {}) {
  let database: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  let google: Awaited<ReturnType<typeof startGoogleStub>>
  const organisations: string[] = []
  beforeAll(async () => {
    if (!process.env.DIRECT_DATABASE_URL) throw new Error("Isolated database required")
    database = postgres(process.env.DIRECT_DATABASE_URL, { max: 3 })
    google = await startGoogleStub()
    server = await startAppServer({ GOOGLE_API_PROXY_BASE: google.baseUrl, PUBLISH_ENABLED: "true", GBP_PROFILE_WRITES_ENABLED: "true", ...serverEnv })
  })
  afterAll(async () => {
    await server.stop(); await google.stop()
    await destroyTenants(database, organisations); await database.end()
  })
  async function fixture() {
    google.reset()
    const owner = await createTestTenant(database); organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(database, { organisationId: owner.organisationId })
    const linked = await seedLinkedLocation(database, { organisationId: owner.organisationId, ...connection })
    const destinationAccount = `accounts/destination_${owner.organisationId.replaceAll("-", "")}`
    const location: Location = { name: linked.googleLocationName, metadata: { placeId: `ChIJ_fixture_${linked.locationId}`, canDelete: true } }
    const destination: Location[] = []
    const state = {
      source: [location], destination, sourceRole: "OWNER", destinationRole: "MANAGER",
      location, locationReadStatus: 200, afterDeleteReadStatus: 404, readStatus: 200, writeStatus: 200, applyWrite: true, delayMs: 0,
    }
    google.respond({ method: "GET", pathEndsWith: connection.googleAccountName }, () => ({ status: state.readStatus, json: { name: connection.googleAccountName, role: state.sourceRole } }))
    google.respond({ method: "GET", pathEndsWith: destinationAccount }, () => ({ status: state.readStatus, json: { name: destinationAccount, role: state.destinationRole } }))
    google.respond({ method: "GET", pathIncludes: `/v1/${connection.googleAccountName}/locations?` }, () => ({ status: state.readStatus, json: { locations: state.source } }))
    google.respond({ method: "GET", pathIncludes: `/v1/${destinationAccount}/locations?` }, () => ({ status: state.readStatus, json: { locations: state.destination } }))
    google.respond({ method: "GET", pathIncludes: `/v1/${linked.googleLocationName}?` }, () => ({ status: state.locationReadStatus, json: state.locationReadStatus === 200 ? state.location : {} }))
    google.respond({ method: "POST", pathEndsWith: `${linked.googleLocationName}:transfer` }, () => {
      if (state.applyWrite) { state.source = []; state.destination = [state.location] }
      return { status: state.writeStatus, json: {}, delayMs: state.delayMs }
    })
    google.respond({ method: "DELETE", pathEndsWith: linked.googleLocationName }, () => {
      if (state.applyWrite) { state.source = []; state.locationReadStatus = state.afterDeleteReadStatus }
      return { status: state.writeStatus, json: {}, delayMs: state.delayMs }
    })
    const root = `/api/locations/${linked.locationId}/administration-lifecycle-reviews`
    async function request(path: string, method = "GET", body?: unknown, cookie = owner.cookie) {
      return fetch(`${server.baseUrl}${root}${path}`, { method, headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    }
    return { owner, connection, linked, destinationAccount, state, request, provider: google,
      baseUrl: server.baseUrl, calls: () => google.calls, writes: () => google.calls.filter((call) => call.method === "DELETE" || call.method === "POST" && call.path.endsWith(":transfer")),
    }
  }
  return { fixture, database: () => database }
}
