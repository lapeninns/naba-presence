import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AccountPickerCard } from "@/components/settings/account-picker-card"
import { Toaster } from "@/components/ui/toast"
import { ApiClientError } from "@/lib/api/client"
import type { GoogleAccount } from "@/lib/api/google-accounts"

const workspaceMock = vi.fn()
const accountsMock = vi.fn()
vi.mock("@/lib/queries/use-connection-workspace", () => ({
  useConnectionWorkspace: () => workspaceMock(),
}))
vi.mock("@/lib/queries/use-google-accounts", () => ({
  useGoogleAccounts: () => accountsMock(),
}))

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

function renderCard(
  accounts: GoogleAccount[],
  save = vi.fn(),
  props: React.ComponentProps<typeof AccountPickerCard> = {}
) {
  workspaceMock.mockReturnValue({
    query: {
      data: { connections: [{ id: "c1", status: "active" }] },
      isPending: false,
      isError: false,
    },
  })
  accountsMock.mockReturnValue({
    query: {
      data: { accounts },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    },
    save: { mutate: save, isPending: false },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <AccountPickerCard {...props} />
      </Toaster>
    </QueryClientProvider>
  )
}

function renderLoadError(isFetching: boolean, refetch = vi.fn()) {
  workspaceMock.mockReturnValue({
    query: {
      data: { connections: [{ id: "c1", status: "active" }] },
      isPending: false,
      isError: false,
    },
  })
  accountsMock.mockReturnValue({
    query: {
      data: undefined,
      isPending: false,
      isError: true,
      isFetching,
      error: new ApiClientError(502, "upstream_unavailable", "Bad gateway"),
      refetch,
    },
    save: { mutate: vi.fn(), isPending: false },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
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
    fireEvent.click(screen.getByRole("checkbox", { name: "Riverside Group" }))
    fireEvent.click(screen.getByRole("button", { name: "Save accounts" }))
    expect(save).toHaveBeenCalledWith(["a1"])
  })

  it("lets the wizard's Continue save a changed selection", async () => {
    const mutateAsync = vi.fn().mockResolvedValue(undefined)
    workspaceMock.mockReturnValue({
      query: {
        data: { connections: [{ id: "c1", status: "active" }] },
        isPending: false,
        isError: false,
      },
    })
    accountsMock.mockReturnValue({
      query: {
        data: { accounts: [account({ id: "a1" })] },
        isPending: false,
        isError: false,
        refetch: vi.fn(),
      },
      save: {
        mutate: vi.fn(),
        mutateAsync,
        isPending: false,
        isError: false,
        error: null,
      },
    })
    const ref: { current: (() => Promise<boolean>) | null } = { current: null }
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <Toaster>
          <AccountPickerCard clientId="cl1" saveBeforeContinueRef={ref} />
        </Toaster>
      </QueryClientProvider>
    )
    // Nothing changed: Continue does not save.
    await expect(ref.current?.()).resolves.toBe(true)
    expect(mutateAsync).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("checkbox", { name: "Riverside Group" }))
    expect(screen.getByText("Continue saves your choice.")).toBeInTheDocument()
    await expect(ref.current?.()).resolves.toBe(true)
    expect(mutateAsync).toHaveBeenCalledWith(["a1"])
  })

  it("shows a failed save inline, and Continue stays put", async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new Error("nope"))
    workspaceMock.mockReturnValue({
      query: {
        data: { connections: [{ id: "c1", status: "active" }] },
        isPending: false,
        isError: false,
      },
    })
    accountsMock.mockReturnValue({
      query: {
        data: { accounts: [account({ id: "a1" })] },
        isPending: false,
        isError: false,
        refetch: vi.fn(),
      },
      save: {
        mutate: vi.fn(),
        mutateAsync,
        isPending: false,
        isError: true,
        error: new Error("nope"),
      },
    })
    const ref: { current: (() => Promise<boolean>) | null } = { current: null }
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <Toaster>
          <AccountPickerCard clientId="cl1" saveBeforeContinueRef={ref} />
        </Toaster>
      </QueryClientProvider>
    )
    fireEvent.click(screen.getByRole("checkbox", { name: "Riverside Group" }))
    await expect(ref.current?.()).resolves.toBe(false)
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your account choice wasn’t saved."
    )
  })

  it("shows an empty state when no accounts are discovered", () => {
    renderCard([])
    expect(
      screen.getByText("This Google login has no Business Profile accounts")
    ).toBeInTheDocument()
    // No way out to offer without the setup callback.
    expect(
      screen.queryByRole("button", { name: "Use another Google login" })
    ).not.toBeInTheDocument()
  })

  it("offers another Google login from the empty state in setup", () => {
    const onChooseAnotherLogin = vi.fn()
    renderCard([], vi.fn(), { onChooseAnotherLogin })
    fireEvent.click(
      screen.getByRole("button", { name: "Use another Google login" })
    )
    expect(onChooseAnotherLogin).toHaveBeenCalledTimes(1)
  })

  it("announces a failed load as an error, with Try again outside the alert", () => {
    const refetch = vi.fn()
    renderLoadError(false, refetch)
    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("We couldn’t load your Google accounts")
    expect(alert).toHaveTextContent("Nothing was changed.")
    const retry = screen.getByRole("button", { name: "Try again" })
    expect(alert).not.toContainElement(retry)
    fireEvent.click(retry)
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it("shows the retry running", () => {
    renderLoadError(true)
    const retry = screen.getByRole("button", { name: "Trying again…" })
    expect(retry).toHaveAttribute("aria-busy", "true")
  })

  it("names Google roles in words, and shows nothing for a missing role", () => {
    renderCard([
      account({
        id: "a1",
        accountName: "Riverside Group",
        role: "PRIMARY_OWNER",
      }),
      account({ id: "a2", accountName: "Harbour Inn", role: "SITE_MANAGER" }),
      account({ id: "a3", accountName: "Mill House", role: "NEW_ROLE" }),
      account({ id: "a4", accountName: "Old Forge", role: null }),
    ])
    expect(screen.getByText("Primary owner")).toBeInTheDocument()
    expect(screen.getByText("Site manager")).toBeInTheDocument()
    expect(screen.getByText("New role")).toBeInTheDocument()
    expect(screen.queryByText("PRIMARY_OWNER")).not.toBeInTheDocument()
    expect(screen.queryByText("—")).not.toBeInTheDocument()
  })
})
