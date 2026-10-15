import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ConnectionCard } from "@/components/settings/connection-card"
import { Toaster } from "@/components/ui/toast"
import type { ConnectionSummary } from "@/lib/api/connections"

const workspaceMock = vi.fn()
vi.mock("@/lib/queries/use-connection-workspace", () => ({
  useConnectionWorkspace: () => workspaceMock(),
}))

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

function renderCard(
  connections: ConnectionSummary[],
  disconnectMutate = vi.fn()
) {
  workspaceMock.mockReturnValue({
    query: {
      data: { connections },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    },
    connect: { mutate: vi.fn(), isPending: false },
    disconnect: { mutate: disconnectMutate, isPending: false },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <ConnectionCard />
      </Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => vi.clearAllMocks())

/** Opens the row's ⋯ menu and chooses Disconnect, as a person would. */
async function chooseDisconnect(
  user: ReturnType<typeof userEvent.setup>,
  name: string
) {
  await user.click(screen.getByRole("button", { name: `Actions for ${name}` }))
  await user.click(await screen.findByRole("menuitem", { name: /^Disconnect/ }))
}

describe("ConnectionCard", () => {
  it("lists a connected account with its status trailing and Disconnect behind a menu", async () => {
    const user = userEvent.setup()
    renderCard([connection({})])
    expect(screen.getByText("owner@riverside.test")).toBeInTheDocument()
    expect(screen.getByText("Connected")).toBeInTheDocument()
    // The account is the row's headline and the status sits at the end of the
    // title line; neither is a label beside a red button.
    const cells = screen
      .getByText("owner@riverside.test")
      .closest("tr")!
      .querySelectorAll("td")
    expect(cells[0]).toHaveAttribute("data-priority", "primary")
    expect(screen.getByText("Connected").closest("td")).toHaveAttribute(
      "data-priority",
      "trailing"
    )
    // No Disconnect button in the headline spot: it is the menu's last item.
    expect(
      screen.queryByRole("button", { name: /^Disconnect/ })
    ).not.toBeInTheDocument()
    await user.click(
      screen.getByRole("button", { name: "Actions for owner@riverside.test" })
    )
    const items = await screen.findAllByRole("menuitem")
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveAccessibleName(/^Disconnect/)
    expect(items[0]).toHaveAttribute("data-variant", "destructive")
  })

  it("has no menu on an account that is already disconnected", () => {
    renderCard([connection({ status: "disconnected" })])
    expect(
      screen.queryByRole("button", { name: /^Actions for/ })
    ).not.toBeInTheDocument()
  })

  it("offers a connect button when there are no connections", () => {
    renderCard([])
    expect(
      screen.getByRole("button", { name: "Connect Google Business Profile" })
    ).toBeInTheDocument()
  })

  it("keeps Disconnect disarmed until the login's email is typed, then disconnects once", async () => {
    const user = userEvent.setup()
    const mutate = vi.fn()
    renderCard([connection({})], mutate)
    await chooseDisconnect(user, "owner@riverside.test")
    const dialog = await screen.findByRole("alertdialog")
    // The consequences stay, and the cancel keeps its words.
    expect(within(dialog).getByText("After 7 days")).toBeInTheDocument()
    // The consequences match what the server does: the purge deletes the
    // reviews and Google data, keeps held reviews, and never the listings.
    expect(
      within(dialog).getByText(
        "Their reviews and the Google data we hold for them are permanently deleted, unless this login is reconnected first. Reviews under a legal hold are kept. The listings stay in NabaPresence, unlinked."
      )
    ).toBeInTheDocument()
    // The consequences are said once, in the list: no helper line repeats them.
    expect(
      within(dialog).queryByText(/This unlinks its listings now/)
    ).toBeNull()
    expect(
      within(dialog).queryByText(/Its listings and their reviews/)
    ).toBeNull()
    expect(
      within(dialog).getByRole("button", { name: "Keep it connected" })
    ).toBeInTheDocument()
    const confirm = within(dialog).getByRole("button", { name: "Disconnect" })
    expect(confirm).toBeDisabled()
    const field = within(dialog).getByRole("textbox", {
      name: /Type owner@riverside\.test to confirm/,
    })
    // Typing an email: the keyboard has an "@".
    expect(field).toHaveAttribute("inputmode", "email")
    await user.type(field, "owner@riverside")
    expect(confirm).toBeDisabled()
    await user.click(confirm)
    expect(mutate).not.toHaveBeenCalled()
    await user.type(field, ".test")
    expect(confirm).toBeEnabled()
    await user.click(confirm)
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ onSuccess: expect.any(Function) })
    )
    // The outcome toast names the login and offers no Undo (a Google write).
    act(() => mutate.mock.calls[0][1].onSuccess())
    expect(
      await screen.findByText("Disconnected owner@riverside.test")
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /undo/i })
    ).not.toBeInTheDocument()
  })

  it("returns focus to the row's ⋯ trigger when the dialog is cancelled", async () => {
    const user = userEvent.setup()
    renderCard([connection({})])
    await chooseDisconnect(user, "owner@riverside.test")
    const dialog = await screen.findByRole("alertdialog")
    await user.click(
      within(dialog).getByRole("button", { name: "Keep it connected" })
    )
    await vi.waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    )
    await vi.waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Actions for owner@riverside.test" })
      ).toHaveFocus()
    )
  })

  it("asks for the word DISCONNECT when the login has no email on record", async () => {
    const user = userEvent.setup()
    const mutate = vi.fn()
    renderCard([connection({ googleEmail: null })], mutate)
    await chooseDisconnect(user, "Google account")
    const dialog = await screen.findByRole("alertdialog")
    const confirm = within(dialog).getByRole("button", { name: "Disconnect" })
    expect(confirm).toBeDisabled()
    await user.type(
      within(dialog).getByRole("textbox", {
        name: /Type DISCONNECT to confirm/,
      }),
      "disconnect"
    )
    expect(confirm).toBeEnabled()
    await user.click(confirm)
    expect(mutate).toHaveBeenCalledTimes(1)
  })
})
