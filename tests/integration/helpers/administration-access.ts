import postgres from "postgres"
import { afterAll, beforeAll, expect } from "vitest"
import { z } from "zod"
import { administrationAccessReviewResponseSchema, type AdministrationAccessRequest, type AdministrationAccessReview } from "@/lib/contracts/google-administration-review"
import { administrationAccessAttemptSchema } from "@/lib/contracts/google-administration-attempt"
import { startAppServer } from "./app-server"
import { startGoogleStub } from "./google-stub"
import { createTestTenant, destroyTenants, seedGoogleConnection, seedLinkedLocation } from "./tenant"

export function administrationHarness() {
  let database: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  let google: Awaited<ReturnType<typeof startGoogleStub>>
  const organisations: string[] = []
  beforeAll(async () => {
    database = postgres(process.env.DIRECT_DATABASE_URL!, { max: 3 })
    google = await startGoogleStub()
    server = await startAppServer({ GOOGLE_API_PROXY_BASE: google.baseUrl, PUBLISH_ENABLED: "true", GBP_PROFILE_WRITES_ENABLED: "true" })
  })
  afterAll(async () => {
    await server.stop()
    await google.stop()
    await destroyTenants(database, organisations)
    await database.end()
  })
  async function fixture() {
    google.reset()
    const owner = await createTestTenant(database)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(database, { organisationId: owner.organisationId })
    const location = await seedLinkedLocation(database, { organisationId: owner.organisationId, ...connection })
    const parent = location.googleLocationName
    const state: { admins: Record<string, unknown>[]; invitations: Record<string, unknown>[]; account: Record<string, unknown>; writeStatus: number; applyWrite: boolean; readStatus: number; delayMs: number } = {
      admins: [{ name: `${parent}/admins/manager`, admin: "manager@example.test", role: "MANAGER" }],
      invitations: [], account: { name: connection.googleAccountName, role: "MANAGER" },
      writeStatus: 200, applyWrite: true, readStatus: 200, delayMs: 0,
    }
    const adminsCollection = `${parent}/admins`
    const invitationsCollection = `${connection.googleAccountName}/invitations`
    google.respond({ method: "GET", pathEndsWith: adminsCollection }, () => ({ status: state.readStatus, json: { admins: state.admins } }))
    google.respond({ method: "GET", pathEndsWith: `${connection.googleAccountName}/admins` }, () => ({ status: state.readStatus, json: { accountAdmins: state.admins } }))
    google.respond({ method: "GET", pathEndsWith: invitationsCollection }, () => ({ status: state.readStatus, json: { invitations: state.invitations } }))
    google.respond({ method: "GET", pathEndsWith: connection.googleAccountName }, () => ({ status: state.readStatus, json: state.account }))
    for (const collection of [adminsCollection, `${connection.googleAccountName}/admins`]) {
      google.respond({ method: "POST", pathEndsWith: collection }, ({ body }) => {
        const parsed = administrationAccessRequestSchemaForInvite(body)
        const row = { name: `${collection}/new`, ...parsed, pendingInvitation: true }
        if (state.applyWrite) state.admins.push(row)
        return { status: state.writeStatus, json: row, delayMs: state.delayMs }
      })
    }
    google.respond({ method: "PATCH", pathIncludes: `${parent}/admins/manager?` }, ({ body }) => {
      if (state.applyWrite) state.admins[0] = { ...state.admins[0], ...administrationAccessRole(body) }
      return { status: state.writeStatus, json: state.admins[0], delayMs: state.delayMs }
    })
    google.respond({ method: "DELETE", pathEndsWith: `${parent}/admins/manager` }, () => {
      if (state.applyWrite) state.admins = []
      return { status: state.writeStatus, delayMs: state.delayMs }
    })
    for (const action of ["accept", "decline"]) google.respond({ method: "POST", pathEndsWith: `${invitationsCollection}/pending:${action}` }, () => {
      if (state.applyWrite) state.invitations = []
      return { status: state.writeStatus, delayMs: state.delayMs }
    })
    const root = `/api/locations/${location.locationId}/administration-access-reviews`
    async function request(path: string, method = "GET", body?: unknown, cookie = owner.cookie) {
      return fetch(`${server.baseUrl}${root}${path}`, { method, headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    }
    async function review(input: AdministrationAccessRequest) {
      const response = await request("", "POST", input)
      expect(response.status).toBe(200)
      return administrationAccessReviewResponseSchema.parse(await response.json()).review
    }
    async function approve(saved: AdministrationAccessReview, cookie = owner.cookie) {
      return request(`/${saved.changeSet.id}`, "POST", { expectedPayloadHash: saved.changeSet.payloadHash }, cookie)
    }
    async function execute(saved: AdministrationAccessReview, method = "POST") {
      const response = await request(`/${saved.changeSet.id}/execute`, method, method === "PATCH" ? {} : { expectedPayloadHash: saved.changeSet.payloadHash })
      expect(response.status).toBe(200)
      const body: unknown = await response.json()
      return z.object({ attempt: administrationAccessAttemptSchema }).parse(body).attempt
    }
    return { owner, connection, location, state, review, approve, execute, request, baseUrl: server.baseUrl, writes: () => google.calls.filter((call) => call.method !== "GET"), calls: () => google.calls }
  }
  return { fixture, database: () => database }
}

const administrationAccessRequestSchemaForInvite = (value: unknown) => z.object({ admin: z.string().optional(), account: z.string().optional(), role: z.string() }).parse(value)
const administrationAccessRole = (value: unknown) => z.object({ name: z.string(), role: z.string() }).parse(value)
