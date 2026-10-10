import { describe, expect, it } from "vitest"

import { lodgingSchema } from "@/lib/contracts/google-lodging"
import { industryMutationSchema, INDUSTRY_CONFIRMATION } from "@/lib/contracts/location-industry"
import { GOOGLE_LODGING_EXCLUDED_FIELDS, GOOGLE_LODGING_UPDATE_PATHS } from "@/lib/domain/google-lodging"
import discovery from "@/lib/domain/google-lodging-schema.json"

type SchemaNode = {
  readonly $ref?: string
  readonly type?: string
  readonly enum?: readonly string[]
  readonly readOnly?: boolean
  readonly properties?: Readonly<Record<string, SchemaNode>>
  readonly items?: SchemaNode
}

const schemas: Readonly<Record<string, SchemaNode>> = discovery.schemas

function sample(node: SchemaNode, root = false): unknown {
  if (node.$ref) return sample(schemas[node.$ref])
  if (node.enum) return node.enum[0]
  switch (node.type) {
    case "object":
      return Object.fromEntries(Object.entries(node.properties ?? {}).filter(([key, value]) => !value.readOnly && !(root && key in GOOGLE_LODGING_EXCLUDED_FIELDS)).map(([key, value]) => [key, key === "updateTime" ? "2026-09-29T12:00:00Z" : sample(value)]))
    case "array":
      return node.items ? [sample(node.items)] : []
    case "boolean": return false
    case "integer":
    case "number": return 0
    case "string": return "sample"
    default: throw new TypeError(`Unhandled discovery type: ${node.type}`)
  }
}

function mutation(payload: unknown, updateMask: string[]) {
  return industryMutationSchema.safeParse({ operation: "update_lodging", confirmation: INDUSTRY_CONFIRMATION, payload, updateMask })
}

describe("pinned Google lodging contract", () => {
  it("preserves every writable field from the pinned provider schema", () => {
    const payload = sample(schemas.Lodging, true)
    expect(lodgingSchema.parse(payload)).toEqual(payload)
  })

  it("preserves absence, explicit false and exception values independently", () => {
    expect(lodgingSchema.parse({})).toEqual({})
    const payload = { pets: { petsAllowed: false, petsAllowedException: "DEPENDENT_ON_SEASON" } }
    expect(lodgingSchema.parse(payload)).toEqual(payload)
    expect(lodgingSchema.parse({ pets: {} })).toEqual({ pets: {} })
  })

  it.each([
    { pets: { petsAllowed: "false" } },
    { pets: { petsAllowed: null } },
    { pets: { petsAllowedException: "NOT_APPLICABLE" } },
    { pets: { inventedAmenity: true } },
    { property: { roomsCount: 1.5 } },
    { property: { roomsCount: 2147483648 } },
    { policies: { checkinTime: { hours: 25 } } },
    { policies: { checkinTime: { minutes: 60 } } },
    { policies: { checkinTime: { nanos: -1 } } },
    { guestUnits: [{ codes: [123] }] },
    { guestUnits: [{ label: "Twin" }] },
    { guestUnits: [{ codes: ["TWIN"] }] },
    { guestUnits: [{ label: "Twin", codes: ["TWIN", "TWIN"] }] },
    { guestUnits: [{ label: "Twin", codes: ["TWIN"] }, { label: "Double", codes: ["TWIN"] }] },
    { services: { languagesSpoken: [{}] } },
    { sustainability: { sustainabilityCertifications: { ecoCertifications: [{}] } } },
    { metadata: { updateTime: "yesterday" } },
    { name: "locations/another/lodging" },
    { allUnits: {} },
    { someUnits: {} },
  ])("rejects malformed, unknown or read-only payload %j", (payload) => {
    expect(lodgingSchema.safeParse(payload).success).toBe(false)
  })

  it.each(["*", "name", "allUnits", "someUnits", "pets.unknown", "guestUnits.0.label", "guestUnits.features", " pets", ""])('rejects unsafe update mask "%s"', (path) => {
    expect(mutation({}, [path]).success).toBe(false)
  })

  it("supports parent replacement, leaf changes and explicit masked clearing", () => {
    expect(mutation({ pets: { petsAllowed: false } }, ["pets"]).success).toBe(true)
    expect(mutation({ pets: { petsAllowed: false } }, ["pets.petsAllowed"]).success).toBe(true)
    expect(mutation({}, ["pets.petsAllowed"]).success).toBe(true)
    expect(mutation({ guestUnits: [] }, ["guestUnits"]).success).toBe(true)
    expect(mutation({}, []).success).toBe(false)
    expect(GOOGLE_LODGING_UPDATE_PATHS.has("policies.checkinTime.hours")).toBe(true)
  })
})
