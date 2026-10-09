import { describe, expect, it } from "vitest"

import { resolveImportSource } from "@/lib/connections/import-source"

const account = (name: string, isActive: boolean, googleConnectionId = "c1") => ({
  googleAccountName: name,
  accountName: name,
  isActive,
  googleConnectionId,
})

describe("resolveImportSource", () => {
  it("shows the first active account when several are on, instead of none", () => {
    const source = resolveImportSource({
      accounts: [account("accounts/1", true), account("accounts/2", true), account("accounts/3", true)],
      connectionId: "c1",
      chosenAccountName: null,
    })
    expect(source.activeAccounts).toHaveLength(3)
    expect(source.accountName).toBe("accounts/1")
  })

  it("keeps the operator's choice while it is still active", () => {
    const accounts = [account("accounts/1", true), account("accounts/2", true)]
    expect(
      resolveImportSource({ accounts, connectionId: "c1", chosenAccountName: "accounts/2" }).accountName
    ).toBe("accounts/2")
    expect(
      resolveImportSource({
        accounts: [account("accounts/1", true), account("accounts/2", false)],
        connectionId: "c1",
        chosenAccountName: "accounts/2",
      }).accountName
    ).toBe("accounts/1")
  })

  it("only offers accounts the working login reaches", () => {
    const source = resolveImportSource({
      accounts: [account("accounts/1", true, "c2"), account("accounts/2", true, "c1")],
      connectionId: "c1",
      chosenAccountName: "accounts/1",
    })
    expect(source.activeAccounts.map((a) => a.googleAccountName)).toEqual(["accounts/2"])
    expect(source.accountName).toBe("accounts/2")
  })

  it("has no account when none is switched on", () => {
    expect(
      resolveImportSource({ accounts: [account("accounts/1", false)], connectionId: "c1", chosenAccountName: null })
        .accountName
    ).toBeNull()
  })
})
