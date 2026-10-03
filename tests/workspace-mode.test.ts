import { describe, expect, it } from "vitest"

import { sessionSchema } from "@/lib/contracts/session"
import { clientAccessUpdateSchema } from "@/lib/contracts/client-access"
import { summariseHealth } from "@/lib/clients/health"
import {
  planClientAccess,
  type AccessGrant,
  type ClientCatalogueEntry,
} from "@/lib/settings/client-access"
import { accessSummary, roleDescriptions } from "@/lib/settings/roles"
import {
  businessModeRedirect,
  withoutClientScopeParam,
  workspaceTerms,
} from "@/lib/workspace/terms"

describe("sessionSchema", () => {
  const base = {
    userId: "u",
    organisationId: "o",
    organisationName: "The Barley Mow",
    displayName: "Aman",
    email: "a@example.test",
    role: "owner",
    canPublish: true,
  }

  it("carries the workspace mode", () => {
    expect(
      sessionSchema.parse({ ...base, workspaceMode: "business" })
    ).toMatchObject({
      workspaceMode: "business",
    })
  })

  it("refuses a session without a mode or with an unknown one", () => {
    expect(sessionSchema.safeParse(base).success).toBe(false)
    expect(
      sessionSchema.safeParse({ ...base, workspaceMode: "franchise" }).success
    ).toBe(false)
  })
})

describe("workspaceTerms", () => {
  it("gives a business no client or agency words", () => {
    const words = JSON.stringify(workspaceTerms("business"))
    expect(words).not.toMatch(/client|agency/i)
  })

  it("keeps the agency words for agency mode", () => {
    expect(workspaceTerms("agency")).toMatchObject({
      org: "Agency",
      scope: "client",
      access: "Client access",
      orgName: "Agency name",
    })
  })

  it("describes the admin role without clients for a business", () => {
    expect(roleDescriptions("business").admin).not.toMatch(/client/i)
    expect(roleDescriptions("agency").admin).toMatch(/client/i)
  })
})

describe("businessModeRedirect", () => {
  it.each([
    ["/clients", "/listings"],
    ["/clients/", "/listings"],
    ["/clients/new", "/listings"],
    ["/clients/new?listing=abc", "/listings"],
    ["/clients?view=archived", "/listings"],
    ["/clients/0f1e/", "/listings"],
    ["/clients/0f1e/reports", "/listings"],
    ["/clients/0f1e/settings", "/settings"],
    ["/clients/0f1e/settings/", "/settings"],
    ["/clients/0f1e/settings?tab=x", "/settings"],
  ])("sends %s to %s", (from, to) => {
    expect(businessModeRedirect(from)).toBe(to)
  })

  it.each([
    "/inbox",
    "/listings",
    "/listings/clients",
    "/reports",
    "/team",
    "/settings",
    "/clientsx",
  ])("leaves %s alone", (path) => {
    expect(businessModeRedirect(path)).toBeNull()
  })
})

describe("summariseHealth in business mode", () => {
  it("never counts clients", () => {
    for (const health of [
      ["disconnected"],
      ["attention"],
      ["healthy"],
      ["unchecked"],
      ["not_connected"],
      [],
    ] as const) {
      const { label } = summariseHealth([...health], "business")
      expect(label).not.toMatch(/client/i)
    }
  })

  it("keeps the agency wording by default", () => {
    expect(summariseHealth(["disconnected"]).label).toBe(
      "1 client needs action"
    )
  })
})

describe("accessSummary in business mode", () => {
  const locations = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      locationId: `l${i}`,
      canPublish: false,
      clientId: "home",
    }))

  it("says all locations for managers and unscoped members", () => {
    expect(
      accessSummary({ role: "admin", locations: [] }, [], "business").label
    ).toBe("All locations")
    expect(
      accessSummary({ role: "member", locations: [] }, [], "business")
    ).toEqual({
      label: "All locations",
      detail: "Including locations added later",
    })
  })

  it("counts the locations a scoped member holds", () => {
    expect(
      accessSummary({ role: "member", locations: locations(1) }, [], "business")
        .label
    ).toBe("1 location")
    expect(
      accessSummary({ role: "viewer", locations: locations(3) }, [], "business")
        .label
    ).toBe("3 locations")
  })
})

describe("location access requests", () => {
  const L1 = "00000000-0000-4000-8000-0000000000a1"
  const L2 = "00000000-0000-4000-8000-0000000000a2"
  const HOME = "00000000-0000-4000-8000-00000000c001"
  const catalogue: ClientCatalogueEntry[] = [
    { clientId: HOME, name: "The Barley Mow", listingIds: [L1, L2] },
  ]
  const base = { catalogue, current: [] as AccessGrant[] }

  it("parses the per-location shape and refuses a mixed body", () => {
    expect(
      clientAccessUpdateSchema.safeParse({ locations: [{ locationId: L1 }] })
        .success
    ).toBe(true)
    expect(
      clientAccessUpdateSchema.safeParse({
        locations: [{ locationId: L1 }],
        allClients: true,
      }).success
    ).toBe(false)
    expect(
      clientAccessUpdateSchema.safeParse({
        locations: [{ locationId: "nope" }],
      }).success
    ).toBe(false)
  })

  it("turns ticked locations into rows, Drafts only unless told otherwise", () => {
    const plan = planClientAccess({
      ...base,
      role: "member",
      request: {
        locations: [{ locationId: L1, canPublish: true }, { locationId: L2 }],
      },
    })
    expect(plan).toEqual({
      ok: true,
      allClients: false,
      rows: [
        { locationId: L1, canPublish: true },
        { locationId: L2, canPublish: false },
      ],
    })
  })

  it("refuses an empty selection instead of widening to every location", () => {
    expect(
      planClientAccess({ ...base, role: "member", request: { locations: [] } })
    ).toMatchObject({
      ok: false,
      status: 409,
      code: "would_widen_to_all_clients",
    })
  })

  it("refuses unknown and duplicate locations", () => {
    expect(
      planClientAccess({
        ...base,
        role: "member",
        request: {
          locations: [{ locationId: "00000000-0000-4000-8000-0000000000ff" }],
        },
      })
    ).toMatchObject({ ok: false, status: 404, code: "location_not_found" })
    expect(
      planClientAccess({
        ...base,
        role: "member",
        request: { locations: [{ locationId: L1 }, { locationId: L1 }] },
      })
    ).toMatchObject({ ok: false, status: 400, code: "duplicate_location" })
  })

  it("never lets a viewer publish and refuses managers", () => {
    expect(
      planClientAccess({
        ...base,
        role: "viewer",
        request: { locations: [{ locationId: L1, canPublish: true }] },
      })
    ).toMatchObject({ ok: false, code: "viewer_cannot_publish" })
    expect(
      planClientAccess({
        ...base,
        role: "admin",
        request: { locations: [{ locationId: L1 }] },
      })
    ).toMatchObject({ ok: false, code: "role_sees_all_clients" })
  })
})

describe("withoutClientScopeParam", () => {
  it.each([
    ["/reports?clientId=abc", "/reports"],
    ["/listings?clientId=abc&health=bad", "/listings?health=bad"],
    ["/inbox?tab=x&clientId=abc#top", "/inbox?tab=x#top"],
  ])("%s -> %s", (from, to) => {
    expect(withoutClientScopeParam(from)).toBe(to)
  })

  it("leaves addresses without a clientId alone", () => {
    expect(withoutClientScopeParam("/reports")).toBeNull()
    expect(withoutClientScopeParam("/reports?range=30d")).toBeNull()
  })
})

describe("planClientAccess workspace mode", () => {
  const catalogue: ClientCatalogueEntry[] = [
    { clientId: "c1", name: "Home", listingIds: ["l1", "l2"] },
  ]
  const base = { role: "member" as const, catalogue, current: [] as AccessGrant[] }

  it("refuses a per-location grant in an agency workspace", () => {
    expect(
      planClientAccess({
        ...base,
        workspaceMode: "agency",
        request: { locations: [{ locationId: "l1" }] },
      })
    ).toMatchObject({ ok: false, code: "wrong_workspace_mode" })
  })

  it("refuses a per-client grant in a business workspace", () => {
    expect(
      planClientAccess({
        ...base,
        workspaceMode: "business",
        request: { clients: [{ clientId: "c1" }] },
      })
    ).toMatchObject({ ok: false, code: "wrong_workspace_mode" })
  })

  it("accepts a per-location grant in a business workspace", () => {
    expect(
      planClientAccess({
        ...base,
        workspaceMode: "business",
        request: { locations: [{ locationId: "l1" }] },
      })
    ).toMatchObject({ ok: true })
  })
})
