import type { Page } from "@playwright/test"
import { z } from "zod"
import { startVerificationBackend } from "./verification-backend"

const payload = z.record(z.string(), z.unknown())
function readPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => payload.safeParse(current).data?.[key], value)
}
function writePath(value: unknown, path: string, next: unknown): Record<string, unknown> {
  const record = { ...payload.parse(value) }
  const [key, ...rest] = path.split(".")
  if (!key || ["__proto__", "constructor", "prototype"].includes(key)) throw new Error("Invalid fixture update mask")
  if (rest.length) record[key] = writePath(record[key] ?? {}, rest.join("."), next)
  else if (next === undefined) delete record[key]
  else record[key] = next
  return record
}
export async function startLodgingBackend() {
  const backend = await startVerificationBackend()
  return {
    ...backend,
    async lodgingFixture(page: Page) {
      const fixture = await backend.fixture(page)
      backend.google.respond({ method: "GET", pathIncludes: `/v1/${fixture.linked.googleLocationName}?` }, () => ({ status: 200, json: {
        name: fixture.linked.googleLocationName, title: "Fixture Lodging Business",
        categories: { primaryCategory: { name: "categories/gcid:hotel", displayName: "Hotel" } },
        metadata: { canOperateLodgingData: true },
      } }))
      backend.google.respond({ method: "GET", pathIncludes: "/v1/attributes?" }, () => ({ status: 200, json: { attributeMetadata: [] } }))
      backend.google.respond({ method: "GET", pathIncludes: `${fixture.linked.googleLocationName}/attributes` }, () => ({ status: 200, json: { name: `${fixture.linked.googleLocationName}/attributes`, attributes: [] } }))
      const state = {
        lodging: payload.parse({ name: `${fixture.linked.googleLocationName}/lodging`, property: { roomsCount: 12, floorsCount: 0 }, pets: { petsAllowed: false, futureProviderSibling: "retain" }, parking: { freeParking: false, freeParkingException: "DEPENDENT_ON_SEASON" }, services: { languagesSpoken: [{ languageCode: "en", spoken: true }] } }),
        suggestions: { lodging: { pets: { petsAllowed: true }, parking: { freeParking: true } }, diffMask: "pets.petsAllowed,parking.freeParking" },
        status: 200, apply: true, readStatus: 200,
      }
      backend.google.respond({ method: "GET", pathIncludes: `${fixture.linked.googleLocationName}/lodging?` }, () => ({ status: state.readStatus, json: state.lodging }))
      backend.google.respond({ method: "GET", pathIncludes: `${fixture.linked.googleLocationName}/lodging:getGoogleUpdated?` }, () => ({ status: 200, json: state.suggestions }))
      backend.google.respond({ method: "PATCH", pathIncludes: `${fixture.linked.googleLocationName}/lodging?` }, (call) => {
        const body = payload.parse(call.body)
        const mask = new URL(call.path, backend.google.baseUrl).searchParams.get("updateMask")?.split(",") ?? []
        if (state.apply) for (const path of mask) state.lodging = writePath(state.lodging, path, readPath(body, path))
        return { status: state.status, json: state.lodging }
      })
      const writes = () => backend.google.calls.filter((call) => call.method === "PATCH" && call.path.includes("/lodging?"))
      return { ...fixture, state, open: () => page.goto(`${backend.server.baseUrl}/listings/${fixture.linked.locationId}/profile`), writes,
        applyLastWrite() {
          const call = writes().at(-1)
          if (!call) throw new Error("No lodging request to apply")
          const body = payload.parse(call.body)
          const mask = new URL(call.path, backend.google.baseUrl).searchParams.get("updateMask")?.split(",") ?? []
          for (const path of mask) state.lodging = writePath(state.lodging, path, readPath(body, path))
        },
      }
    },
  }
}
