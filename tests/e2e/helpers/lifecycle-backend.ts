import type { Page } from "@playwright/test"
import { startAdministrationBackend } from "./administration-backend"

type Location = { name: string; title: string; metadata: { placeId: string; canDelete: boolean } }
export async function startLifecycleBackend() {
  const backend = await startAdministrationBackend()
  return { ...backend, async lifecycleFixture(page: Page) {
    const fixture = await backend.accessFixture(page)
    const [local] = await backend.admin<{ name: string }[]>`select name from location where id = ${fixture.linked.locationId}`
    if (!local) throw new Error("Owned lifecycle location missing")
    const destinationAccount = `accounts/destination_${fixture.owner.organisationId.replaceAll("-", "")}`
    const location: Location = { name: fixture.linked.googleLocationName, title: "Fixture Service Business", metadata: { placeId: `ChIJ_fixture_${fixture.linked.locationId}`, canDelete: true } }
    const destination: Location[] = []
    const state = { source: [location], destination, locationStatus: 200, afterDeleteStatus: 404, writeStatus: 200, apply: true, destinationRole: "MANAGER" }
    backend.google.respond({ method: "GET", pathEndsWith: fixture.connection.googleAccountName }, () => ({ status: 200, json: { name: fixture.connection.googleAccountName, role: "OWNER" } }))
    backend.google.respond({ method: "GET", pathEndsWith: destinationAccount }, () => ({ status: 200, json: { name: destinationAccount, role: state.destinationRole } }))
    backend.google.respond({ method: "GET", pathIncludes: `/v1/${fixture.connection.googleAccountName}/locations?` }, () => ({ status: 200, json: { locations: state.source } }))
    backend.google.respond({ method: "GET", pathIncludes: `/v1/${destinationAccount}/locations?` }, () => ({ status: 200, json: { locations: state.destination } }))
    backend.google.respond({ method: "GET", pathIncludes: `/v1/${fixture.linked.googleLocationName}?` }, () => ({ status: state.locationStatus, json: state.locationStatus === 200 ? location : {} }))
    backend.google.respond({ method: "POST", pathEndsWith: `${fixture.linked.googleLocationName}:transfer` }, () => {
      if (state.apply) { state.source = []; state.destination = [location] }
      return { status: state.writeStatus, json: {} }
    })
    backend.google.respond({ method: "DELETE", pathEndsWith: fixture.linked.googleLocationName }, () => {
      if (state.apply) { state.source = []; state.locationStatus = state.afterDeleteStatus }
      return { status: state.writeStatus, json: {} }
    })
    return { ...fixture, lifecycleState: state, destinationAccount, locationName: local.name,
      lifecycleWrites: () => backend.google.calls.filter((call) => call.method === "DELETE" && call.path.endsWith(fixture.linked.googleLocationName) || call.method === "POST" && call.path.endsWith(":transfer")),
    }
  } }
}
