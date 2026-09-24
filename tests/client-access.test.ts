import { describe, expect, it } from "vitest"

import {
  clientAccessUpdateSchema,
  UNFILED_CLIENT_ID,
} from "@/lib/contracts/client-access"
import {
  describeAccessChange,
  describeMemberAccess,
  planClientAccess,
  summariseClientAccess,
  type AccessGrant,
  type ClientCatalogueEntry,
} from "@/lib/settings/client-access"
import { accessSummary } from "@/lib/settings/roles"

const CROWN = "00000000-0000-4000-8000-00000000c001"
const BELL = "00000000-0000-4000-8000-00000000c002"
const EMPTY = "00000000-0000-4000-8000-00000000c003"

const catalogue: ClientCatalogueEntry[] = [
  {
    clientId: CROWN,
    name: "Old Crown",
    listingIds: ["l1", "l2", "l3", "l4", "l5"],
  },
  { clientId: BELL, name: "The Bell", listingIds: ["l6", "l7"] },
  { clientId: EMPTY, name: "New Client", listingIds: [] },
  { clientId: UNFILED_CLIENT_ID, name: "Unfiled listings", listingIds: ["u1"] },
]
const totals = catalogue.map(({ listingIds, ...client }) => ({
  ...client,
  archived: client.archived ?? false,
  total: listingIds.length,
}))

function grant(
  locationId: string,
  clientId: string | null,
  canPublish = false
): AccessGrant {
  return { locationId, clientId, canPublish }
}

describe("summariseClientAccess", () => {
  it("is all clients when the member holds no rows", () => {
    const summary = summariseClientAccess([], totals)
    expect(summary.allClients).toBe(true)
    expect(summary.clients.every((client) => client.granted === 0)).toBe(true)
  })

  it("groups rows by client, unfiled listings under the unfiled group", () => {
    const summary = summariseClientAccess(
      [grant("l1", CROWN, true), grant("l2", CROWN), grant("u1", null, true)],
      totals
    )
    expect(summary.allClients).toBe(false)
    expect(summary.clients).toEqual([
      {
        clientId: CROWN,
        name: "Old Crown",
        archived: false,
        total: 5,
        granted: 2,
        publishing: "some",
      },
      {
        clientId: BELL,
        name: "The Bell",
        archived: false,
        total: 2,
        granted: 0,
        publishing: "none",
      },
      {
        clientId: EMPTY,
        name: "New Client",
        archived: false,
        total: 0,
        granted: 0,
        publishing: "none",
      },
      {
        clientId: UNFILED_CLIENT_ID,
        name: "Unfiled listings",
        archived: false,
        total: 1,
        granted: 1,
        publishing: "all",
      },
    ])
  })
})

describe("describeMemberAccess", () => {
  const summarise = (grants: AccessGrant[]) =>
    summariseClientAccess(grants, totals)

  it("says All clients for owners and admins whatever rows they hold", () => {
    expect(
      describeMemberAccess("admin", summarise([grant("l1", CROWN)]))
    ).toEqual({
      label: "All clients",
      detail: null,
    })
  })

  it("says All clients, including later ones, for a member with no rows", () => {
    expect(describeMemberAccess("member", summarise([]))).toEqual({
      label: "All clients",
      detail: "Including clients added later",
    })
  })

  it("names one whole client", () => {
    expect(
      describeMemberAccess(
        "viewer",
        summarise([grant("l6", BELL), grant("l7", BELL)])
      )
    ).toEqual({ label: "The Bell", detail: "2 listings" })
  })

  it("shows a legacy partial grant as some listings of the client", () => {
    expect(
      describeMemberAccess(
        "member",
        summarise([grant("l1", CROWN), grant("l2", CROWN), grant("l3", CROWN)])
      )
    ).toEqual({ label: "Old Crown (3 of 5 listings)", detail: "Some listings" })
  })

  it("counts several clients and flags the partial one", () => {
    expect(
      describeMemberAccess(
        "member",
        summarise([grant("l1", CROWN), grant("l6", BELL), grant("l7", BELL)])
      )
    ).toEqual({
      label: "2 clients",
      detail: "Old Crown, The Bell · some listings in Old Crown",
    })
  })
})

describe("accessSummary (Team row)", () => {
  it("no longer calls an unscoped member 'No listings assigned yet'", () => {
    expect(accessSummary({ role: "member", locations: [] }, totals)).toEqual({
      label: "All clients",
      detail: "Including clients added later",
    })
    expect(accessSummary({ role: "member", locations: [] })).toEqual({
      label: "All clients",
      detail: "Including clients added later",
    })
  })

  it("reads the client of each row from the members response", () => {
    expect(
      accessSummary(
        {
          role: "member",
          locations: [
            { locationId: "l6", canPublish: false, clientId: BELL },
            { locationId: "l7", canPublish: false, clientId: BELL },
          ],
        },
        totals
      ).label
    ).toBe("The Bell")
  })
})

describe("planClientAccess — the zero-rows guard", () => {
  const base = { catalogue, current: [] as AccessGrant[] }

  it("refuses an empty client list instead of widening to every client", () => {
    const plan = planClientAccess({
      ...base,
      role: "member",
      request: { clients: [] },
    })
    expect(plan).toMatchObject({
      ok: false,
      status: 409,
      code: "would_widen_to_all_clients",
    })
  })

  it("refuses clients that hold no listings for the same reason", () => {
    const plan = planClientAccess({
      ...base,
      role: "viewer",
      request: { clients: [{ clientId: EMPTY }] },
    })
    expect(plan).toMatchObject({
      ok: false,
      code: "would_widen_to_all_clients",
    })
  })

  it("refuses 'unchanged' for a client the member holds nothing of, if that is all", () => {
    const plan = planClientAccess({
      ...base,
      role: "member",
      request: { clients: [{ clientId: BELL, listings: "unchanged" }] },
    })
    expect(plan).toMatchObject({
      ok: false,
      code: "would_widen_to_all_clients",
    })
  })

  it("accepts All clients only when asked for by name", () => {
    const plan = planClientAccess({
      ...base,
      role: "member",
      current: [grant("l1", CROWN)],
      request: { allClients: true },
    })
    expect(plan).toEqual({ ok: true, allClients: true, rows: [] })
  })

  it("refuses owners and admins, who always see everything", () => {
    for (const role of ["owner", "admin"] as const) {
      expect(
        planClientAccess({ ...base, role, request: { allClients: true } })
      ).toMatchObject({ ok: false, status: 409, code: "role_sees_all_clients" })
    }
  })

  it("refuses unknown and duplicate clients", () => {
    expect(
      planClientAccess({
        ...base,
        role: "member",
        request: {
          clients: [{ clientId: "00000000-0000-4000-8000-0000000000ff" }],
        },
      })
    ).toMatchObject({ ok: false, status: 404, code: "client_not_found" })
    expect(
      planClientAccess({
        ...base,
        role: "member",
        request: {
          clients: [{ clientId: BELL }, { clientId: BELL.toUpperCase() }],
        },
      })
    ).toMatchObject({ ok: false, status: 400, code: "duplicate_client" })
  })

  it("expands a client into every listing, with the client's publish setting", () => {
    const plan = planClientAccess({
      ...base,
      role: "member",
      request: {
        clients: [
          { clientId: BELL, canPublish: true },
          { clientId: UNFILED_CLIENT_ID },
        ],
      },
    })
    expect(plan).toEqual({
      ok: true,
      allClients: false,
      rows: [
        { locationId: "l6", canPublish: true },
        { locationId: "l7", canPublish: true },
        { locationId: "u1", canPublish: false },
      ],
    })
  })

  it("never lets a viewer publish", () => {
    expect(
      planClientAccess({
        ...base,
        role: "viewer",
        request: { clients: [{ clientId: BELL, canPublish: true }] },
      })
    ).toMatchObject({ ok: false, code: "viewer_cannot_publish" })
    const plan = planClientAccess({
      ...base,
      role: "viewer",
      current: [grant("l1", CROWN, true)],
      request: { clients: [{ clientId: CROWN, listings: "unchanged" }] },
    })
    expect(plan).toEqual({
      ok: true,
      allClients: false,
      rows: [{ locationId: "l1", canPublish: false }],
    })
  })

  it("keeps legacy partial grants as they are with listings: unchanged", () => {
    const current = [
      grant("l1", CROWN, true),
      grant("l3", CROWN, false),
      grant("l6", BELL),
    ]
    const plan = planClientAccess({
      catalogue,
      current,
      role: "member",
      request: { clients: [{ clientId: CROWN, listings: "unchanged" }] },
    })
    // The Bell was not listed, so its row goes; the Old Crown keeps exactly
    // its two listings and their publish flags.
    expect(plan).toEqual({
      ok: true,
      allClients: false,
      rows: [
        { locationId: "l1", canPublish: true },
        { locationId: "l3", canPublish: false },
      ],
    })
  })

  it("overrides publishing on kept rows when canPublish is sent", () => {
    const plan = planClientAccess({
      catalogue,
      current: [grant("l1", CROWN, true), grant("l3", CROWN, false)],
      role: "member",
      request: {
        clients: [
          { clientId: CROWN, listings: "unchanged", canPublish: false },
        ],
      },
    })
    expect(plan.ok && plan.rows.every((row) => !row.canPublish)).toBe(true)
  })
})

describe("clientAccessUpdateSchema", () => {
  it("needs allClients: true to be spelled out; false and extra keys are refused", () => {
    expect(
      clientAccessUpdateSchema.safeParse({ allClients: true }).success
    ).toBe(true)
    expect(
      clientAccessUpdateSchema.safeParse({ allClients: false }).success
    ).toBe(false)
    expect(clientAccessUpdateSchema.safeParse({}).success).toBe(false)
    expect(
      clientAccessUpdateSchema.safeParse({ allClients: true, clients: [] })
        .success
    ).toBe(false)
  })

  it("accepts real client ids and the unfiled group", () => {
    const parsed = clientAccessUpdateSchema.parse({
      clients: [
        { clientId: CROWN },
        { clientId: UNFILED_CLIENT_ID, canPublish: true },
      ],
    })
    expect(parsed).toEqual({
      clients: [
        { clientId: CROWN, listings: "all" },
        { clientId: UNFILED_CLIENT_ID, listings: "all", canPublish: true },
      ],
    })
    expect(
      clientAccessUpdateSchema.safeParse({
        clients: [{ clientId: "not-a-client" }],
      }).success
    ).toBe(false)
  })
})

describe("describeAccessChange", () => {
  const scoped = summariseClientAccess(
    [grant("l6", BELL), grant("l7", BELL)],
    totals
  )
  const everything = summariseClientAccess([], totals)

  it("warns when moving someone from some clients to all", () => {
    const change = describeAccessChange({
      name: "Ben",
      before: scoped,
      allClients: true,
      selected: [],
      totalClients: 3,
    })
    expect(change.consequence).toBe(
      "Ben will see every client and listing, including clients added later."
    )
    expect(change.warning?.title).toBe("This widens Ben’s access")
  })

  it("warns when narrowing someone who sees every client", () => {
    const change = describeAccessChange({
      name: "Ben",
      before: everything,
      allClients: false,
      selected: [{ name: "Old Crown", listings: 5 }],
      totalClients: 3,
    })
    expect(change.consequence).toBe(
      "Ben will see 1 client (5 listings): Old Crown. The other 2 clients are hidden from them, and so are clients added later."
    )
    expect(change.warning?.title).toBe("This narrows Ben’s access")
  })

  it("explains why nothing ticked can't be saved", () => {
    const change = describeAccessChange({
      name: "Ben",
      before: scoped,
      allClients: false,
      selected: [{ name: "New Client", listings: 0 }],
      totalClients: 3,
    })
    expect(change.consequence).toMatch(/would see every client/)
    expect(change.warning).toBeNull()
  })
})
