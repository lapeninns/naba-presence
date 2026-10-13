import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ConnectionCard } from "@/components/settings/connection-card"
import { Toaster } from "@/components/ui/toast"
import type { ConnectionSummary } from "@/lib/api/connections"

const workspaceMock = vi.fn()
vi.mock("@/lib/queries/use-connection-workspace", () => ({ useConnectionWorkspace: () => workspaceMock() }))

function connection(overrides: Partial<ConnectionSummary>): ConnectionSummary {
  return {
    id: "c1",
    googleEmail: "owner@riverside.test",
    status: "active",
    notificationsEnabled: true,
    lastRefreshAt: "2026-08-01T00:00:00.000Z",
    lastErrorCode: null,
    reconnectRequired: false,
    createdAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  }
}

function renderCard(connections: ConnectionSummary[], disconnectMutate = vi.fn()) {
  workspaceMock.mockReturnValue({
    query: { data: { connections }, isPending: false, isError: false, refetch: vi.fn() },
    connect: { mutate: vi.fn(), isPending: false },
    disconnect: { mutate: disconnectMutate, isPending: false },
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <ConnectionCard />
      </Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => vi.clearAllMocks())

describe("ConnectionCard", () => {
  it("lists a connected account with a humanised status and a disconnect action", () => {
    renderCard([connection({})])
    expect(screen.getByText("owner@riverside.test")).toBeInTheDocument()
    expect(screen.getByText("Connected")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Disconnect owner@riverside.test" })).toBeInTheDocument()
  })

  it("offers a connect button when there are no connections", () => {
    renderCard([])
    expect(screen.getByRole("button", { name: "Connect Google Business Profile" })).toBeInTheDocument()
  })

  it("keeps Disconnect disarmed until the login's email is typed, then disconnects once", async () => {
    const user = userEvent.setup()
    const mutate = vi.fn()
    renderCard([connection({})], mutate)
    await user.click(screen.getByRole("button", { name: "Disconnect owner@riverside.test" }))
    const dialog = await screen.findByRole("alertdialog")
    // The consequences stay, and the cancel keeps its words.
    expect(within(dialog).getByText("After 7 days")).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "Keep it connected" })).toBeInTheDocument()
    const confirm = within(dialog).getByRole("button", { name: "Disconnect" })
    expect(confirm).toBeDisabled()
    const field = within(dialog).getByRole("textbox", { name: /Type owner@riverside\.test to confirm/ })
    await user.type(field, "owner@riverside")
    expect(confirm).toBeDisabled()
    await user.click(confirm)
    expect(mutate).not.toHaveBeenCalled()
    await user.type(field, ".test")
    expect(confirm).toBeEnabled()
    await user.click(confirm)
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate).toHaveBeenCalledWith("c1", expect.objectContaining({ onSuccess: expect.any(Function) }))
    // The outcome toast names the login and offers no Undo (a Google write).
    act(() => mutate.mock.calls[0][1].onSuccess())
    expect(await screen.findByText("Disconnected owner@riverside.test")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /undo/i })).not.toBeInTheDocument()
  })

  it("asks for the word DISCONNECT when the login has no email on record", async () => {
    const user = userEvent.setup()
    const mutate = vi.fn()
    renderCard([connection({ googleEmail: null })], mutate)
    await user.click(screen.getByRole("button", { name: "Disconnect Google account" }))
    const dialog = await screen.findByRole("alertdialog")
    const confirm = within(dialog).getByRole("button", { name: "Disconnect" })
    expect(confirm).toBeDisabled()
    await user.type(within(dialog).getByRole("textbox", { name: /Type DISCONNECT to confirm/ }), "disconnect")
    expect(confirm).toBeEnabled()
    await user.click(confirm)
    expect(mutate).toHaveBeenCalledTimes(1)
  })
})
