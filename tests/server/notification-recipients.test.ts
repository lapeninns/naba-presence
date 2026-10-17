import type { TransactionSql } from "postgres"
import { describe, expect, it } from "vitest"

import {
  canSeeIncident,
  loadNotificationMembers,
} from "@/lib/server/notifications/recipients"

type Row = {
  userId: string
  role: "owner" | "admin" | "member" | "viewer"
  email: string | null
  locationScope: "all" | "assigned"
  locations: string[] | null
}

/** A tagged-template stand-in that records the query and returns `rows`. */
function fakeSql(rows: Row[]) {
  const queries: string[] = []
  const sql = ((strings: TemplateStringsArray) => {
    queries.push(strings.join("?"))
    return Promise.resolve(rows)
  }) as unknown as TransactionSql
  return { sql, queries }
}

const LOCATION = "11111111-1111-4111-8111-111111111111"
const OTHER = "22222222-2222-4222-8222-222222222222"
const incident = (locationId: string | null, kind = "publication_failed") => ({
  id: "incident",
  kind,
  locationId,
})

describe("notification recipients follow the location scope", () => {
  it("never reads 'assigned' with no rows as every location", async () => {
    const { sql } = fakeSql([
      {
        userId: "none",
        role: "member",
        email: "n@x.test",
        locationScope: "assigned",
        locations: null,
      },
      {
        userId: "viewer",
        role: "viewer",
        email: "v@x.test",
        locationScope: "assigned",
        locations: null,
      },
      {
        userId: "one",
        role: "member",
        email: "o@x.test",
        locationScope: "assigned",
        locations: [LOCATION],
      },
      {
        userId: "all",
        role: "viewer",
        email: "a@x.test",
        locationScope: "all",
        locations: null,
      },
      {
        userId: "owner",
        role: "owner",
        email: "w@x.test",
        locationScope: "assigned",
        locations: null,
      },
    ])
    const members = await loadNotificationMembers(sql)
    const sees = (userId: string, locationId: string | null) =>
      canSeeIncident(members.get(userId)!, incident(locationId))

    expect(sees("none", LOCATION)).toBe(false)
    expect(sees("viewer", LOCATION)).toBe(false)
    expect(sees("one", LOCATION)).toBe(true)
    expect(sees("one", OTHER)).toBe(false)
    expect(sees("all", LOCATION)).toBe(true)
    expect(sees("all", OTHER)).toBe(true)
    expect(sees("owner", OTHER)).toBe(true)
    // Account incidents stay owner/admin only, whatever the scope.
    expect(sees("all", null)).toBe(false)
    expect(sees("owner", null)).toBe(true)
  })

  it("shows an addressed incident only to its recipients, owners included", async () => {
    const { sql } = fakeSql([
      {
        userId: "approver",
        role: "member",
        email: "p@x.test",
        locationScope: "assigned",
        locations: [LOCATION],
      },
      {
        userId: "moved",
        role: "member",
        email: "m@x.test",
        locationScope: "assigned",
        locations: [OTHER],
      },
      {
        userId: "owner",
        role: "owner",
        email: "w@x.test",
        locationScope: "all",
        locations: null,
      },
    ])
    const members = await loadNotificationMembers(sql)
    for (const kind of ["approval_requested", "reply_sent_back"]) {
      const addressed = (recipients?: string[] | null) => ({
        ...incident(LOCATION, kind),
        recipients,
      })
      const sees = (userId: string, recipients?: string[] | null) =>
        canSeeIncident(members.get(userId)!, addressed(recipients))

      expect(sees("approver", ["approver"])).toBe(true)
      expect(sees("owner", ["approver"])).toBe(false)
      expect(sees("owner", ["owner"])).toBe(true)
      // A recipient who can no longer see the location stops seeing it.
      expect(sees("moved", ["moved"])).toBe(false)
      // No recipient rows is nobody, never everybody.
      expect(sees("owner", [])).toBe(false)
      expect(sees("owner", null)).toBe(false)
      expect(sees("owner")).toBe(false)
    }
    // Other kinds ignore recipients.
    expect(
      canSeeIncident(members.get("owner")!, {
        ...incident(LOCATION),
        recipients: ["approver"],
      })
    ).toBe(true)
  })

  it("reads scope and rows from the tenant's organisation only", async () => {
    const { sql, queries } = fakeSql([])
    await loadNotificationMembers(sql)
    expect(queries[0]).toContain("m.location_scope")
    expect(queries[0]).toContain("lm.organisation_id = m.organisation_id")
    expect(queries[0]).toContain("current_setting('app.organisation_id', true)")
  })
})
