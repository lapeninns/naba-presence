import { type Page } from "@playwright/test"
import { z } from "zod"
import { startVerificationBackend } from "./verification-backend"

const adminBody = z.object({ admin: z.string().optional(), account: z.string().optional(), role: z.string() })
export async function startAdministrationBackend() {
  const backend = await startVerificationBackend()
  return {
    ...backend,
    async accessFixture(page: Page) {
      const fixture = await backend.fixture(page)
      const locationCollection = `${fixture.linked.googleLocationName}/admins`
      const accountCollection = `${fixture.connection.googleAccountName}/admins`
      const invitationName = `${fixture.connection.googleAccountName}/invitations/pending`
      const state = {
        locationAdmins: [{ name: `${locationCollection}/owner`, admin: "Fixture Primary Owner", role: "PRIMARY_OWNER", pendingInvitation: false }, { name: `${locationCollection}/manager`, admin: "manager@example.test", role: "MANAGER", pendingInvitation: false }],
        accountAdmins: [{ name: `${accountCollection}/owner`, admin: "Fixture Account Owner", role: "PRIMARY_OWNER", pendingInvitation: false }],
        invitations: [{ name: invitationName, role: "MANAGER", targetType: "ACCOUNT", targetAccount: { name: fixture.connection.googleAccountName } }],
        status: 200, apply: true, readStatus: 200,
      }
      backend.google.respond({ method: "GET", pathEndsWith: locationCollection }, () => ({ status: state.readStatus, json: { admins: state.locationAdmins } }))
      backend.google.respond({ method: "GET", pathEndsWith: accountCollection }, () => ({ status: state.readStatus, json: { accountAdmins: state.accountAdmins } }))
      backend.google.respond({ method: "GET", pathEndsWith: `${fixture.connection.googleAccountName}/invitations` }, () => ({ status: state.readStatus, json: { invitations: state.invitations } }))
      backend.google.respond({ method: "GET", pathEndsWith: fixture.connection.googleAccountName }, () => ({ status: state.readStatus, json: { name: fixture.connection.googleAccountName, role: "MANAGER" } }))
      for (const scope of ["location", "account"] as const) {
        const collection = scope === "location" ? locationCollection : accountCollection
        backend.google.respond({ method: "POST", pathEndsWith: collection }, ({ body }) => {
          const values = adminBody.parse(body)
          const row = { name: `${collection}/new`, admin: values.admin ?? values.account ?? "Unknown", role: values.role, pendingInvitation: true }
          if (state.apply) (scope === "location" ? state.locationAdmins : state.accountAdmins).push(row)
          return { status: state.status, json: row }
        })
      }
      backend.google.respond({ method: "PATCH", pathIncludes: `${locationCollection}/manager?` }, ({ body }) => {
        if (state.apply) state.locationAdmins[1].role = adminBody.parse(body).role
        return { status: state.status, json: state.locationAdmins[1] }
      })
      backend.google.respond({ method: "DELETE", pathEndsWith: `${locationCollection}/manager` }, () => {
        if (state.apply) state.locationAdmins = state.locationAdmins.filter((row) => row.name !== `${locationCollection}/manager`)
        return { status: state.status }
      })
      for (const action of ["accept", "decline"]) backend.google.respond({ method: "POST", pathEndsWith: `${invitationName}:${action}` }, () => {
        if (state.apply) state.invitations = []
        return { status: state.status }
      })
      return { ...fixture, state, open: () => page.goto(`${backend.server.baseUrl}/listings/${fixture.linked.locationId}/people`), writes: () => backend.google.calls.filter((call) => call.method !== "GET") }
    },
  }
}
