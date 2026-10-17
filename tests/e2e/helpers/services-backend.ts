import { expect, type Page } from "@playwright/test"
import { googleServiceItemsSchema } from "@/lib/domain/google-services"
import { startVerificationBackend } from "./verification-backend"

export async function startServicesBackend() {
  const backend = await startVerificationBackend()
  return { ...backend, async serviceFixture(page: Page, kind: "healthcare" | "retail" = "healthcare") {
    const fixture = await backend.fixture(page)
    const retail = kind === "retail"
    const state = { items: googleServiceItemsSchema.parse(retail ? [] : [{ freeFormServiceItem: { category: "gcid:doctor", label: { displayName: "Consultation", description: "Initial appointment" } }, price: { currencyCode: "GBP", units: "35", nanos: 500000000 } }]), eligible: !retail, apply: true, status: 200 }
    backend.google.respond({ method: "GET", pathIncludes: `/v1/${fixture.linked.googleLocationName}?` }, () => ({ status: 200, json: {
      name: fixture.linked.googleLocationName, title: retail ? "Fixture Retail Business" : "Fixture Clinic", metadata: { canModifyServiceList: state.eligible, canOperateHealthData: !retail },
      categories: { primaryCategory: { name: retail ? "categories/gcid:hardware_store" : "categories/gcid:doctor", displayName: retail ? "Hardware store" : "Doctor" } }, serviceItems: state.items,
    } }))
    backend.google.respond({ method: "GET", pathIncludes: "/categories:batchGet" }, () => ({ status: 200, json: { categories: [{ name: "gcid:doctor", displayName: "Doctor", serviceTypes: [] }] } }))
    backend.google.respond({ method: "GET", pathIncludes: "/v1/attributes?" }, () => ({ status: 200, json: { attributeMetadata: retail ? [{ parent: "attributes/has_in_store_pickup", displayName: "In-store pickup", groupDisplayName: "Service options", valueType: "BOOL" }] : [] } }))
    backend.google.respond({ method: "GET", pathIncludes: `${fixture.linked.googleLocationName}/attributes` }, () => ({ status: 200, json: { name: `${fixture.linked.googleLocationName}/attributes`, attributes: retail ? [{ name: "attributes/has_in_store_pickup", values: [false] }] : [] } }))
    backend.google.respond({ method: "PATCH", pathIncludes: `/v1/${fixture.linked.googleLocationName}?` }, (call) => {
      const items = googleServiceItemsSchema.parse(typeof call.body === "object" && call.body && "serviceItems" in call.body ? call.body.serviceItems : undefined)
      const validateOnly = new URL(call.path, backend.google.baseUrl).searchParams.get("validateOnly") === "true"
      if (!validateOnly && state.apply) state.items = items
      return { status: validateOnly ? 200 : state.status, json: { name: fixture.linked.googleLocationName, serviceItems: state.items } }
    })
    const writes = () => backend.google.calls.filter((call) => call.method === "PATCH" && new URL(call.path, backend.google.baseUrl).searchParams.get("validateOnly") !== "true")
    return { ...fixture, state, writes, open: async () => {
      // `goto` resolves at the load event, while React is still hydrating. A field filled or a
      // radio chosen in the server-rendered markup before then is reset when the draft is seeded,
      // which leaves the review action disabled. Each editor reads from an effect (the service
      // metadata, or the attribute reviews on a retail listing), and that only runs once it has
      // hydrated and committed: wait for that real read before the test touches the page.
      const read = retail ? "attribute_reviews" : "services"
      const hydrated = page.waitForResponse((response) => response.request().method() === "GET" && new URL(response.url()).pathname === `/api/locations/${fixture.linked.locationId}/business-information` && new URL(response.url()).searchParams.get("type") === read)
      await page.goto(`${backend.server.baseUrl}/listings/${fixture.linked.locationId}/profile`)
      await hydrated
      if (!retail) await expect(page.getByText("Loading available services…", { exact: true })).toHaveCount(0)
    } }
  } }
}
