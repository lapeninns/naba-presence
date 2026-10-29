import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { mockWebkitShortSeptember } from "../helpers/webkit-short-month"
import { ConnectionCard } from "@/components/settings/connection-card"
import { Toaster } from "@/components/ui/toast"
import { ApiClientError } from "@/lib/api/client"
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

const connectMutate = vi.fn()
const refetch = vi.fn()

function workspace(
  connections: ConnectionSummary[],
  disconnectMutate = vi.fn(),
  disconnectError: unknown = null
) {
  return {
    query: {
      data: { connections },
      isPending: false,
      isError: false,
      refetch,
    },
    connect: { mutate: connectMutate, isPending: false },
    disconnect: {
      mutate: disconnectMutate,
      isPending: false,
      error: disconnectError,
      reset: vi.fn(),
    },
  }
}

function card({ inSection = false }: { inSection?: boolean } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={client}>
      <Toaster>
        {inSection ? (
          // As Settings › Google connections places it.
          <section aria-labelledby="connection-logins">
            <h2 id="connection-logins">Google accounts</h2>
            <ConnectionCard />
          </section>
        ) : (
          <ConnectionCard />
        )}
      </Toaster>
    </QueryClientProvider>
  )
}

function renderCard(
  connections: ConnectionSummary[],
  disconnectMutate = vi.fn(),
  disconnectError: unknown = null
) {
  workspaceMock.mockReturnValue(
    workspace(connections, disconnectMutate, disconnectError)
  )
  return render(card())
}

/** Types the login and presses Disconnect in the open dialog. */
async function confirmDisconnect(
  user: ReturnType<typeof userEvent.setup>,
  email: string
) {
  const dialog = await screen.findByRole("alertdialog")
  await user.type(
    within(dialog).getByRole("textbox", { name: /to confirm/ }),
    email
  )
  await user.click(within(dialog).getByRole("button", { name: "Disconnect" }))
  return dialog
}

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

/** Opens the row's ⋯ menu and chooses Disconnect, as a person would. */
async function chooseDisconnect(
  user: ReturnType<typeof userEvent.setup>,
  name: string
) {
  await user.click(screen.getByRole("button", { name: `Actions for ${name}` }))
  await user.click(await screen.findByRole("menuitem", { name: /^Disconnect/ }))
}

describe("ConnectionCard", () => {
  it("keeps the last refresh on the runtime clock with stable September and no year", () => {
    vi.stubEnv("TZ", "America/Los_Angeles")
    mockWebkitShortSeptember()
    renderCard([connection({ lastRefreshAt: "2026-10-01T00:30:00Z" })])
    expect(screen.getByText("30 Sept, 17:30")).toBeInTheDocument()
  })

  it.each<[string | null, string]>([
    [null, "Never"],
    ["", "Never"],
    ["invalid", "Unknown"],
  ])(
    "keeps the missing or invalid refresh sentinel for %s",
    (lastRefreshAt, expected) => {
      renderCard([connection({ lastRefreshAt })])
      expect(screen.getByText(expected)).toBeInTheDocument()
    }
  )

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
    // Before Google opens: the permission that, unticked, fails the connect.
    expect(
      screen.getByText(/leave the Business Profile permission ticked/)
    ).toBeInTheDocument()
  })

  it("offers no Reconnect on a disconnected login", () => {
    // Reconnecting relinks nothing (its listings were unlinked), so the row
    // makes no promise; connecting the same login again is the way back.
    renderCard([connection({ status: "disconnected" })])
    expect(
      screen.queryByRole("button", { name: /^Reconnect/ })
    ).not.toBeInTheDocument()
  })

  it("keeps the primary Reconnect for a broken login, sending the reconnect request", async () => {
    const user = userEvent.setup()
    renderCard([connection({ reconnectRequired: true, status: "expired" })])
    const reconnect = screen.getByRole("button", {
      name: "Reconnect owner@riverside.test",
    })
    expect(reconnect).not.toHaveAttribute("data-variant", "secondary")
    await user.click(reconnect)
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText(/keeps its warning/)).toBeInTheDocument()
    await user.click(
      within(dialog).getByRole("button", { name: "Continue to Google" })
    )
    expect(connectMutate).toHaveBeenCalledWith({ reconnectConnectionId: "c1" })
  })

  it("lets the address in a dialog title break before its @", async () => {
    const user = userEvent.setup()
    renderCard([connection({})])
    await chooseDisconnect(user, "owner@riverside.test")
    const dialog = await screen.findByRole("alertdialog")
    const title = within(dialog).getByRole("heading", {
      name: "Disconnect owner@riverside.test?",
    })
    expect(title.querySelector("wbr")).not.toBeNull()
  })

  it("says Google didn’t confirm the revoke when it didn’t, and the 7-day window either way", async () => {
    const user = userEvent.setup()
    const mutate = vi.fn()
    renderCard([connection({})], mutate)
    await chooseDisconnect(user, "owner@riverside.test")
    await confirmDisconnect(user, "owner@riverside.test")
    act(() =>
      mutate.mock.calls[0][1].onSuccess({
        status: "disconnected",
        googleRevocation: "failed",
      })
    )
    expect(
      await screen.findByText(/Google didn’t confirm removing access/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        /Its reviews are kept for 7 days; connect the same Google login again before then to keep them\./
      )
    ).toBeInTheDocument()
  })

  it("never claims a failed revoke when Google confirmed it", async () => {
    const user = userEvent.setup()
    const mutate = vi.fn()
    renderCard([connection({})], mutate)
    await chooseDisconnect(user, "owner@riverside.test")
    await confirmDisconnect(user, "owner@riverside.test")
    act(() =>
      mutate.mock.calls[0][1].onSuccess({
        status: "disconnected",
        googleRevocation: "revoked",
      })
    )
    expect(
      await screen.findByText(
        "Its reviews are kept for 7 days; connect the same Google login again before then to keep them."
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/didn’t confirm/)).toBeNull()
  })

  it("says a failed disconnect inside the dialog, not in a toast", async () => {
    const user = userEvent.setup()
    renderCard(
      [connection({})],
      vi.fn(),
      new ApiClientError(503, "service_unavailable", "Unavailable")
    )
    await chooseDisconnect(user, "owner@riverside.test")
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByRole("alert")).toBeInTheDocument()
  })

  it("leaves a step-up 403 to the two-step prompt, with no inline error", async () => {
    const user = userEvent.setup()
    renderCard(
      [connection({})],
      vi.fn(),
      new ApiClientError(403, "mfa_step_up_required", "Step up")
    )
    await chooseDisconnect(user, "owner@riverside.test")
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).queryByRole("alert")).toBeNull()
  })

  it("refreshes the list when the login was already disconnected elsewhere", async () => {
    const user = userEvent.setup()
    const mutate = vi.fn()
    renderCard([connection({})], mutate)
    await chooseDisconnect(user, "owner@riverside.test")
    await confirmDisconnect(user, "owner@riverside.test")
    act(() =>
      mutate.mock.calls[0][1].onError(
        new ApiClientError(404, "connection_not_found", "Not found")
      )
    )
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it("lands focus on the section heading after a disconnect removes the row's ⋯", async () => {
    const user = userEvent.setup()
    const mutate = vi.fn()
    workspaceMock.mockReturnValue(workspace([connection({})], mutate))
    render(card({ inSection: true }))
    await chooseDisconnect(user, "owner@riverside.test")
    await confirmDisconnect(user, "owner@riverside.test")
    // The server confirmed and the refetched list says "Disconnected".
    workspaceMock.mockReturnValue(
      workspace([connection({ status: "disconnected" })], mutate)
    )
    act(() => mutate.mock.calls[0][1].onSuccess({ status: "disconnected" }))
    await vi.waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    )
    const heading = screen.getByRole("heading", { name: "Google accounts" })
    await vi.waitFor(() => expect(heading).toHaveFocus())
    // A script-only target with the shared focus halo, never a tab stop.
    expect(heading).toHaveAttribute("tabindex", "-1")
    expect(heading).toHaveClass("focus-halo")
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

  it("returns focus to the account whose menu was opened from the keyboard", async () => {
    const user = userEvent.setup()
    renderCard([
      connection({ id: "c1", googleEmail: "owner@riverside.test" }),
      connection({ id: "c2", googleEmail: "ops@harbour.test" }),
    ])
    // A click opens and closes the first account's menu…
    await user.click(
      screen.getByRole("button", { name: "Actions for owner@riverside.test" })
    )
    await screen.findByRole("menuitem", { name: /^Disconnect/ })
    await user.keyboard("{Escape}")
    await vi.waitFor(() =>
      expect(screen.queryByRole("menuitem")).not.toBeInTheDocument()
    )
    // …then the second account's opens from the keyboard (no click).
    const second = screen.getByRole("button", {
      name: "Actions for ops@harbour.test",
    })
    second.focus()
    await user.keyboard("{ArrowDown}")
    const item = await screen.findByRole("menuitem", { name: /^Disconnect/ })
    await vi.waitFor(() => expect(item).toHaveFocus())
    await user.keyboard("{Enter}")
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog).toHaveTextContent("ops@harbour.test")
    await user.click(
      within(dialog).getByRole("button", { name: "Keep it connected" })
    )
    await vi.waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    )
    await vi.waitFor(() => expect(second).toHaveFocus())
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
