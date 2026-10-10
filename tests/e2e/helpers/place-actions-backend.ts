import type { Page } from "@playwright/test"
import { placeActionInputSchema } from "@/lib/contracts/location-place-actions"
import { startVerificationBackend } from "./verification-backend"
export async function startPlaceActionsBackend() {
  const backend = await startVerificationBackend()
  return { ...backend, async actionFixture(page: Page) {
    const fixture = await backend.fixture(page)
    const state: { links: Array<Record<string, unknown>>; types: string[]; status: number; apply: boolean; readStatus: number } = { links: [], types: ["SHOP_ONLINE"], status: 200, apply: true, readStatus: 200 }
    backend.google.respond({ method: "GET", pathIncludes: `/v1/${fixture.linked.googleLocationName}?` }, () => ({ status: 200, json: { name: fixture.linked.googleLocationName, title: "Fixture Retail Business", categories: { primaryCategory: { name: "categories/gcid:hardware_store", displayName: "Hardware store" } } } }))
    backend.google.respond({ method: "GET", pathIncludes: "/placeActionTypeMetadata" }, () => ({ status: state.readStatus, json: { placeActionTypeMetadata: state.types.map((placeActionType) => ({ placeActionType })) } }))
    backend.google.respond({ method: "GET", pathIncludes: "/placeActionLinks" }, () => ({ status: state.readStatus, json: { placeActionLinks: state.links } }))
    backend.google.respond({ method: "POST", pathIncludes: "/placeActionLinks" }, (call) => {
      const link = { name: `${fixture.linked.googleLocationName}/placeActionLinks/merchant${state.links.length + 1}`, providerType: "MERCHANT", isEditable: true, ...placeActionInputSchema.parse(call.body) }
      if (state.apply) state.links.push(link)
      return { status: state.status, json: state.status === 200 ? link : { error: { status: "UNAVAILABLE" } } }
    })
    backend.google.respond({ method: "PATCH", pathIncludes: "/placeActionLinks/" }, (call) => {
      const name = new URL(call.path, backend.google.baseUrl).pathname.replace(/^\/v1\//, "")
      if (state.apply) state.links = state.links.map((link) => link.name === name ? { ...link, ...placeActionInputSchema.parse(call.body) } : link)
      return { status: state.status, json: state.links.find((link) => link.name === name) ?? {} }
    })
    backend.google.respond({ method: "DELETE", pathIncludes: "/placeActionLinks/" }, (call) => {
      const name = new URL(call.path, backend.google.baseUrl).pathname.replace(/^\/v1\//, "")
      if (state.apply) state.links = state.links.filter((link) => link.name !== name)
      return { status: state.status, json: {} }
    })
    const writes = () => backend.google.calls.filter((call) => ["POST", "PATCH", "DELETE"].includes(call.method) && call.path.includes("placeActionLinks"))
    return { ...fixture, state, writes, open: () => page.goto(`${backend.server.baseUrl}/listings/${fixture.linked.locationId}/booking`) }
  } }
}
