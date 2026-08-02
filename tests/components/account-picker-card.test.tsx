import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AccountPickerCard } from "@/components/settings/account-picker-card"
import { Toaster } from "@/components/ui/toast"
import type { GoogleAccount } from "@/lib/api/google-accounts"

const workspaceMock = vi.fn()
const accountsMock = vi.fn()
vi.mock("@/lib/queries/use-connection-workspace", () => ({ useConnectionWorkspace: () => workspaceMock() }))
vi.mock("@/lib/queries/use-google-accounts", () => ({ useGoogleAccounts: () => accountsMock() }))

function account(overrides: Partial<GoogleAccount>): GoogleAccount {
  return {
    id: "a1",
    googleAccountName: "accounts/1",
    accountName: "Riverside Group",
    type: "LOCATION_GROUP",
    role: "OWNER",
    permissionLevel: "OWNER_LEVEL",
    isActive: false,
    ...overrides,
  }
}

function renderCard(accounts: GoogleAccount[], save = vi.fn()) {
  workspaceMock.mockReturnValue({
    query: { data: { connections: [{ id: "c1", status: "active" }] }, isPending: false, isError: false },
  })
  accountsMock.mockReturnValue({
    query: { data: { accounts }, isPending: false, isError: false, refetch: vi.fn() },
    save: { mutate: save, isPending: false },
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <AccountPickerCard />
      </Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => vi.clearAllMocks())

describe("AccountPickerCard", () => {
  it("lists discovered accounts and saves the active set", () => {
    const save = vi.fn()
    renderCard([account({ id: "a1", accountName: "Riverside Group" })], save)
    expect(screen.getByText("Riverside Group")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("checkbox", { name: "Use Riverside Group" }))
    fireEvent.click(screen.getByRole("button", { name: "Save accounts" }))
    expect(save).toHaveBeenCalledWith(["a1"])
  })

  it("shows an empty state when no accounts are discovered", () => {
    renderCard([])
    expect(screen.getByText("No Google accounts found")).toBeInTheDocument()
  })
})
