import { describe, expect, it } from "vitest"

import { deriveAutoSelection } from "@/lib/connections/derive-auto-selection"

describe("deriveAutoSelection", () => {
  it("returns nulls when there are no connections", () => {
    expect(deriveAutoSelection({ connections: [], accounts: [], selectedConnectionId: null, selectedAccountName: null })).toEqual({
      connectionId: null,
      accountName: null,
    })
  })

  it("keeps a still-valid selection", () => {
    const result = deriveAutoSelection({
      connections: [{ id: "c1", status: "active" }, { id: "c2", status: "active" }],
      accounts: [{ googleAccountName: "accounts/1", isActive: true }, { googleAccountName: "accounts/2", isActive: true }],
      selectedConnectionId: "c2",
      selectedAccountName: "accounts/2",
    })
    expect(result).toEqual({ connectionId: "c2", accountName: "accounts/2" })
  })

  it("prefers the first active connection when nothing valid is selected", () => {
    const result = deriveAutoSelection({
      connections: [{ id: "c1", status: "revoked" }, { id: "c2", status: "active" }],
      accounts: [],
      selectedConnectionId: "gone",
      selectedAccountName: null,
    })
    expect(result.connectionId).toBe("c2")
  })

  it("auto-selects the sole active account but not when several are active", () => {
    expect(
      deriveAutoSelection({
        connections: [{ id: "c1", status: "active" }],
        accounts: [{ googleAccountName: "accounts/only", isActive: true }, { googleAccountName: "accounts/off", isActive: false }],
        selectedConnectionId: null,
        selectedAccountName: null,
      }).accountName
    ).toBe("accounts/only")
    expect(
      deriveAutoSelection({
        connections: [{ id: "c1", status: "active" }],
        accounts: [{ googleAccountName: "accounts/a", isActive: true }, { googleAccountName: "accounts/b", isActive: true }],
        selectedConnectionId: null,
        selectedAccountName: null,
      }).accountName
    ).toBeNull()
  })
})
