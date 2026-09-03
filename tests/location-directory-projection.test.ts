import { describe, expect, it } from "vitest"

import {
  projectDefault,
  projectManagement,
  toDirectoryEntriesFromDefault,
  toDirectoryEntriesFromManagement,
  type DirectoryRow,
} from "@/lib/locations/directory"
import { pickPrimaryLocationId } from "@/lib/locations/primary-location"

const ROWS: DirectoryRow[] = [
  {
    locationId: "loc-2",
    name: "Aardvark Cafe",
    address: { addressLines: ["1 River Road"], locality: "Bath" },
    timezone: "Europe/London",
    linkId: null,
    externalLocationId: null,
    googleLocationName: null,
    googleTitle: null,
    verified: null, clientId: null, clientName: null
  },
  {
    locationId: "loc-1",
    name: "Zebra Bistro",
    address: { addressLines: ["9 High Street"], locality: "Bristol" },
    timezone: "Europe/London",
    linkId: "link-1",
    externalLocationId: "ext-1",
    googleLocationName: "locations/1",
    googleTitle: "Zebra Bistro",
    verified: true, clientId: null, clientName: null
  },
]

describe("directory projections", () => {
  it("gives member and viewer `linked` but withholds owner/admin-only fields", () => {
    const entries = projectDefault(ROWS, "member")
    // `clientId`/`clientName` are NOT withheld: which client a location
    // belongs to is not privileged, the inbox rail groups by it for every
    // role, and a member who can see the location can see whose it is.
    expect(entries).toEqual([
      {
        id: "loc-2",
        name: "Aardvark Cafe",
        linked: false,
        clientId: null,
        clientName: null,
      },
      {
        id: "loc-1",
        name: "Zebra Bistro",
        linked: true,
        clientId: null,
        clientName: null,
      },
    ])
    for (const entry of entries) {
      expect(entry).not.toHaveProperty("googleLocationName")
      expect(entry).not.toHaveProperty("verified")
      expect(entry).not.toHaveProperty("address")
      expect(entry).not.toHaveProperty("timezone")
    }
  })

  it("gives owner and admin googleLocationName", () => {
    expect(projectDefault(ROWS, "owner")[1]).toMatchObject({
      id: "loc-1",
      linked: true,
      googleLocationName: "locations/1",
    })
  })

  it("resolves the same primary from the member and management projections", () => {
    // The parity test. The two payloads carry different fields, so if the
    // ranking rule ever depended on something only one of them has, a member
    // and an owner in the same org would be looking at different businesses.
    const fromDefault = pickPrimaryLocationId(
      toDirectoryEntriesFromDefault(projectDefault(ROWS, "member"))
    )
    const fromManagement = pickPrimaryLocationId(
      toDirectoryEntriesFromManagement(projectManagement(ROWS))
    )
    expect(fromDefault).toBe(fromManagement)
    expect(fromDefault).toBe("loc-1")
  })

  it.each([
    ["default", () => projectDefault(ROWS, "owner")],
    ["management", () => projectManagement(ROWS)],
  ])("survives a JSON round trip unchanged (%s)", (_label, project) => {
    // The RSC path hands these objects straight to the hydration boundary
    // while the HTTP path serialises them. Anything that round-trips
    // differently — a Date, an explicit `undefined` — would make the two paths
    // disagree the way timestamps once did in listConnections.
    const value = project()
    expect(JSON.parse(JSON.stringify(value))).toEqual(value)
  })
})
